/**
 * Geography scope filtering — /api/geography list endpoints narrow to the
 * caller's campaign scope once tenant context resolves (resolveTenantOptional).
 * A Nairobi senatorial campaign sees Nairobi's hierarchy, not 47 counties.
 * ?all=1 bypasses for scope-selection pickers; callers with no campaign
 * (registration wizard) see the full map.
 *
 * Run: pnpm --filter @workspace/api-server exec vitest run tests/geography-scope.test.ts
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import { randomUUID } from "node:crypto";

let currentClerkId = "geo-none";
vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: any, _res: any, next: any) => next(),
  getAuth: () => ({ userId: currentClerkId }),
}));

// pollingStationsMgmt gates routes with requireRoles — bypass RBAC here; the
// scope filter under test sits below it.
vi.mock("../src/middlewares/rbac", () => ({
  requireRoles: () => (_req: any, _res: any, next: any) => next(),
  requireLevel: () => (_req: any, _res: any, next: any) => next(),
  resolveActor: (_req: any, _res: any, next: any) => next(),
  bustActorCache: vi.fn(),
}));

import { db } from "@workspace/db";
import {
  tenantsTable,
  usersTable,
  userRolesTable,
  rolesTable,
  countiesTable,
  constituenciesTable,
  wardsTable,
  pollingStationsTable,
  campaignStationProfilesTable,
} from "@workspace/db";
import { eq, ne, inArray, count } from "drizzle-orm";
import { resolveTenantOptional } from "../src/middlewares/resolveTenant";
import geographyRouter from "../src/routes/geography";
import pollingStationsMgmtRouter from "../src/routes/pollingStationsMgmt";

const ts = randomUUID().slice(0, 8);
const SENATOR_CLERK = `geo-senator-${ts}`;
const MP_CLERK = `geo-mp-${ts}`;
const MCA_CLERK = `geo-mca-${ts}`;
const PRES_CLERK = `geo-pres-${ts}`;
const NOMEMBER_CLERK = `geo-nomember-${ts}`;

const tenantIds: string[] = [];
const userIds: string[] = [];
const insertedRoleIds: string[] = [];

let app: express.Express;
let countyA: { id: string; name: string };
let countyB: { id: string; name: string };
let constA1: { id: string; name: string };
let constB1: { id: string };
let wardA1: { id: string; name: string };
let stationB1: { id: string; countyId: string; constituencyId: string };
let mcaTenantId: string;

async function ensureRole(slug: string, name: string, level: number): Promise<string> {
  const [existing] = await db.select().from(rolesTable).where(eq(rolesTable.slug, slug)).limit(1);
  if (existing) return existing.id;
  const [role] = await db.insert(rolesTable).values({ slug, name, level }).returning();
  insertedRoleIds.push(role.id);
  return role.id;
}

async function makeTenant(
  label: string,
  scope: Partial<{
    seatType: string;
    scopeCountyId: string;
    scopeConstituencyId: string;
    scopeWardId: string;
  }>,
): Promise<string> {
  const [t] = await db
    .insert(tenantsTable)
    .values({ name: `Geo ${label}`, slug: `geo-${label}-${ts}`, plan: "free", ...scope })
    .returning();
  tenantIds.push(t.id);
  return t.id;
}

async function makeMember(clerkId: string, tenantId: string, roleId: string): Promise<string> {
  const [u] = await db
    .insert(usersTable)
    .values({
      clerkId,
      email: `${clerkId}@test.local`,
      fullName: clerkId,
      status: "active",
      isGlobalAdmin: false,
      activeTenantId: tenantId,
    })
    .returning();
  userIds.push(u.id);
  await db.insert(userRolesTable).values({ userId: u.id, roleId, tenantId });
  return u.id;
}

beforeAll(async () => {
  // Real seeded geography, chained through stations so the ward fixture
  // definitely has polling stations.
  const [chain] = await db
    .select({
      countyId: countiesTable.id,
      countyName: countiesTable.name,
      constituencyId: constituenciesTable.id,
      constituencyName: constituenciesTable.name,
      wardId: wardsTable.id,
      wardName: wardsTable.name,
    })
    .from(pollingStationsTable)
    .innerJoin(wardsTable, eq(pollingStationsTable.wardId, wardsTable.id))
    .innerJoin(constituenciesTable, eq(wardsTable.constituencyId, constituenciesTable.id))
    .innerJoin(countiesTable, eq(constituenciesTable.countyId, countiesTable.id))
    .limit(1);
  countyA = { id: chain.countyId, name: chain.countyName };
  constA1 = { id: chain.constituencyId, name: chain.constituencyName };
  wardA1 = { id: chain.wardId, name: chain.wardName };

  // A station OUTSIDE countyA anchors the out-of-scope fixtures, guaranteeing
  // countyB actually has stations/wards for the exclusion assertions.
  const [stB] = await db
    .select({
      id: pollingStationsTable.id,
      countyId: pollingStationsTable.countyId,
      constituencyId: pollingStationsTable.constituencyId,
    })
    .from(pollingStationsTable)
    .where(ne(pollingStationsTable.countyId, countyA.id))
    .limit(1);
  stationB1 = stB;
  const [b] = await db
    .select({ id: countiesTable.id, name: countiesTable.name })
    .from(countiesTable)
    .where(eq(countiesTable.id, stationB1.countyId))
    .limit(1);
  countyB = b;
  constB1 = { id: stationB1.constituencyId };

  const senatorT = await makeTenant("senator", { seatType: "senator", scopeCountyId: countyA.id });
  const mpT = await makeTenant("mp", { seatType: "mp", scopeConstituencyId: constA1.id });
  const mcaT = await makeTenant("mca", { seatType: "mca", scopeWardId: wardA1.id });
  mcaTenantId = mcaT;
  const presT = await makeTenant("pres", { seatType: "presidential" });

  const roleId = await ensureRole(`geo-test-role-${ts}`, "Geo Test Role", 9);
  await makeMember(SENATOR_CLERK, senatorT, roleId);
  await makeMember(MP_CLERK, mpT, roleId);
  await makeMember(MCA_CLERK, mcaT, roleId);
  await makeMember(PRES_CLERK, presT, roleId);
  // Registration-wizard caller: authenticated, belongs to no campaign.
  const [nomember] = await db
    .insert(usersTable)
    .values({
      clerkId: NOMEMBER_CLERK,
      email: `${NOMEMBER_CLERK}@test.local`,
      fullName: NOMEMBER_CLERK,
      status: "active",
      isGlobalAdmin: false,
      activeTenantId: null,
    })
    .returning();
  userIds.push(nomember.id);

  // Same mounting as routes/index.ts: optional tenant context, then the router.
  app = express();
  app.use(express.json());
  app.use(resolveTenantOptional);
  app.use("/geography", geographyRouter);
  // pollingStationsMgmt resolves tenant per-route via resolveTenant.
  app.use("/mgmt", pollingStationsMgmtRouter);
});

afterAll(async () => {
  // campaign_station_profiles.tenantId is a plain uuid (no FK cascade) — clean up explicitly.
  await db.delete(campaignStationProfilesTable).where(inArray(campaignStationProfilesTable.tenantId, tenantIds));
  await db.delete(userRolesTable).where(inArray(userRolesTable.userId, userIds));
  await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  await db.delete(tenantsTable).where(inArray(tenantsTable.id, tenantIds));
  if (insertedRoleIds.length > 0) {
    await db.delete(rolesTable).where(inArray(rolesTable.id, insertedRoleIds));
  }
});

describe("county-seat scope (senator)", () => {
  it("sees only the scoped county in /counties", async () => {
    currentClerkId = SENATOR_CLERK;
    const res = await request(app).get("/geography/counties");
    expect(res.status).toBe(200);
    expect(res.body.map((c: any) => c.id)).toEqual([countyA.id]);
    // Per-county totals are scoped too — not the national counts.
    expect(res.body[0].constituencyCount).toBeGreaterThan(0);
  });

  it("sees only that county's constituencies", async () => {
    currentClerkId = SENATOR_CLERK;
    const res = await request(app).get("/geography/constituencies");
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.every((c: any) => c.countyId === countyA.id)).toBe(true);
    expect(res.body.some((c: any) => c.id === constB1.id)).toBe(false);
  });

  it("cannot see another county's detail or its wards", async () => {
    currentClerkId = SENATOR_CLERK;
    const detail = await request(app).get(`/geography/counties/${countyB.id}`);
    expect(detail.status).toBe(404);
    const wards = await request(app).get(`/geography/wards?constituencyId=${constB1.id}`);
    expect(wards.status).toBe(200);
    expect(wards.body).toEqual([]);
  });

  it("?all=1 bypasses the filter (scope-selection pickers)", async () => {
    currentClerkId = SENATOR_CLERK;
    const res = await request(app).get("/geography/counties?all=1");
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(1);
  });
});

describe("constituency-seat scope (mp)", () => {
  it("sees exactly the scoped constituency and its parent county", async () => {
    currentClerkId = MP_CLERK;
    const cons = await request(app).get("/geography/constituencies");
    expect(cons.status).toBe(200);
    expect(cons.body.map((c: any) => c.id)).toEqual([constA1.id]);

    const counties = await request(app).get("/geography/counties");
    expect(counties.body.map((c: any) => c.id)).toEqual([countyA.id]);
  });

  it("sees only that constituency's wards", async () => {
    currentClerkId = MP_CLERK;
    const res = await request(app).get("/geography/wards");
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.every((w: any) => w.constituencyId === constA1.id)).toBe(true);
  });
});

describe("ward-seat scope (mca)", () => {
  it("sees exactly the scoped ward and its parent chain", async () => {
    currentClerkId = MCA_CLERK;
    const wards = await request(app).get("/geography/wards");
    expect(wards.body.map((w: any) => w.id)).toEqual([wardA1.id]);

    const cons = await request(app).get("/geography/constituencies");
    expect(cons.body.map((c: any) => c.id)).toEqual([constA1.id]);

    const counties = await request(app).get("/geography/counties");
    expect(counties.body.map((c: any) => c.id)).toEqual([countyA.id]);
  });

  it("sees only the scoped ward's polling stations", async () => {
    currentClerkId = MCA_CLERK;
    const res = await request(app).get("/geography/polling-stations");
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0); // fixture ward has stations by construction
    expect(res.body.every((s: any) => s.wardId === wardA1.id)).toBe(true);
  });
});

describe("unscoped contexts see the full map", () => {
  it("presidential campaigns are not filtered", async () => {
    currentClerkId = PRES_CLERK;
    const res = await request(app).get("/geography/counties");
    expect(res.body.length).toBeGreaterThan(1);
    const wards = await request(app).get(`/geography/wards?constituencyId=${constB1.id}`);
    expect(wards.body.length).toBeGreaterThan(0);
  });

  it("callers with no campaign (registration wizard) are not filtered", async () => {
    currentClerkId = NOMEMBER_CLERK;
    const res = await request(app).get("/geography/counties");
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(1);
  });
});

describe("/geography/stats reflects the scope", () => {
  it("senator sees county-level totals; presidential sees national totals", async () => {
    currentClerkId = SENATOR_CLERK;
    const scoped = await request(app).get("/geography/stats");
    expect(scoped.status).toBe(200);
    expect(scoped.body.countyCount).toBe(1);
    expect(scoped.body.constituencyCount).toBeGreaterThan(0);

    currentClerkId = PRES_CLERK;
    const national = await request(app).get("/geography/stats");
    expect(national.body.countyCount).toBeGreaterThan(1);
    expect(national.body.constituencyCount).toBeGreaterThan(scoped.body.constituencyCount);
  });
});

describe("polling-station management endpoints respect the scope", () => {
  it("senator: /mgmt/stations lists only in-county stations with a scoped denominator and dropdown", async () => {
    currentClerkId = SENATOR_CLERK;
    const res = await request(app).get("/mgmt/stations?limit=100");
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.every((s: any) => s.countyId === countyA.id)).toBe(true);
    expect(res.body.counties.map((c: any) => c.id)).toEqual([countyA.id]);
    // Denominator is the scope total, not the national figure.
    const [{ c }] = await db
      .select({ c: count() })
      .from(pollingStationsTable)
      .where(eq(pollingStationsTable.countyId, countyA.id));
    expect(res.body.totalAll).toBe(Number(c));
  });

  it("mca: /mgmt/stations lists only the scoped ward's stations", async () => {
    currentClerkId = MCA_CLERK;
    const res = await request(app).get("/mgmt/stations?limit=100");
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.every((s: any) => s.wardId === wardA1.id)).toBe(true);
  });

  it("mca: cannot view or profile an out-of-scope station", async () => {
    currentClerkId = MCA_CLERK;
    const view = await request(app).get(`/mgmt/stations/${stationB1.id}`);
    expect(view.status).toBe(404);
    const patch = await request(app)
      .patch(`/mgmt/stations/${stationB1.id}`)
      .send({ accreditationStatus: "accredited" });
    expect(patch.status).toBe(404);
  });

  it("mca: bulk-status rejects out-of-scope station ids", async () => {
    currentClerkId = MCA_CLERK;
    const res = await request(app)
      .post("/mgmt/stations/bulk-status")
      .send({ stationIds: [stationB1.id], contactStatus: "contacted" });
    expect(res.status).toBe(403);
  });

  it("mp: /mgmt/coverage-gaps aggregates only the scoped constituency", async () => {
    currentClerkId = MP_CLERK;
    const res = await request(app).get("/mgmt/coverage-gaps");
    expect(res.status).toBe(200);
    expect(res.body.rows.length).toBeGreaterThan(0);
    expect(res.body.rows.every((r: any) => r.constituencyId === constA1.id)).toBe(true);
    expect(res.body.counties.map((c: any) => c.id)).toEqual([countyA.id]);

    currentClerkId = PRES_CLERK;
    const national = await request(app).get("/mgmt/coverage-gaps");
    expect(national.body.summary.total).toBeGreaterThan(res.body.summary.total);
  });

  it("mca: assignedCount excludes legacy out-of-scope profiles", async () => {
    // Legacy state: this campaign has profiles (with agents) on one station
    // inside its ward and one far outside it.
    const [inScopeStation] = await db
      .select({ id: pollingStationsTable.id })
      .from(pollingStationsTable)
      .where(eq(pollingStationsTable.wardId, wardA1.id))
      .limit(1);
    await db.insert(campaignStationProfilesTable).values([
      { tenantId: mcaTenantId, stationId: inScopeStation.id, primaryAgentId: randomUUID() },
      { tenantId: mcaTenantId, stationId: stationB1.id, primaryAgentId: randomUUID() },
    ]);

    currentClerkId = MCA_CLERK;
    const list = await request(app).get("/mgmt/stations?limit=100");
    expect(list.status).toBe(200);
    expect(list.body.assignedCount).toBe(1); // only the in-scope assignment

    const gaps = await request(app).get("/mgmt/coverage-gaps");
    expect(gaps.body.summary.assigned).toBe(1);
  });
});
