/**
 * Coverage-gaps count correctness — GET /coverage-gaps on pollingStationsMgmt.
 *
 * The endpoint LEFT JOINs tenant-scoped campaign_station_profiles onto shared
 * polling_stations and relies on COUNT(primaryAgentId) for "assigned" counts.
 * This test seeds its own geography (county → constituencies → wards →
 * stations) plus two tenants scoped to that county and verifies:
 *
 *   - summary.assigned and ward-level assigned match exactly what was seeded
 *   - profile rows with NULL primaryAgentId are NOT counted as assigned
 *   - stations with no profile row at all are NOT counted as assigned
 *   - multiple polling_agents records on the same station never inflate counts
 *   - two tenants profiling the SAME station never double-count or bleed
 *     into each other's numbers (cross-tenant isolation)
 *   - countyId / constituencyId filters return only matching ward rows
 *
 * Run: pnpm --filter @workspace/api-server exec vitest run tests/coverage-gaps.test.ts
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import { randomUUID } from "node:crypto";

let currentClerkId = "covgap-none";
vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: any, _res: any, next: any) => next(),
  getAuth: () => ({ userId: currentClerkId }),
}));

// The endpoint gates on requireRoles — RBAC is not under test here; the
// count/isolation logic below it is.
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
  pollingCentresTable,
  pollingStationsTable,
  pollingAgentsTable,
  campaignStationProfilesTable,
} from "@workspace/db";
import { eq, ne, inArray } from "drizzle-orm";
import pollingStationsMgmtRouter from "../src/routes/pollingStationsMgmt";

const ts = randomUUID().slice(0, 8);
const A_CLERK = `covgap-a-${ts}`;
const B_CLERK = `covgap-b-${ts}`;

// Integer geography codes must be globally unique — pick a random high base.
const codeBase = 800_000 + Math.floor(Math.random() * 150_000);
let nextCode = codeBase;

const tenantIds: string[] = [];
const userIds: string[] = [];
const insertedRoleIds: string[] = [];

let app: express.Express;

let county: { id: string };
let otherCountyId: string; // a real county outside our fixture
let constC1: { id: string };
let constC2: { id: string };
let wardW1: { id: string };
let wardW2: { id: string };
let wardW3: { id: string };
// stations per ward
let sW1: string[] = []; // 3 stations
let sW2: string[] = []; // 2 stations
let sW3: string[] = []; // 2 stations
let tenantAId: string;
let tenantBId: string;

async function makeStations(wardId: string, constituencyId: string, countyId: string, centreId: string, n: number) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const [s] = await db
      .insert(pollingStationsTable)
      .values({
        code: `covgap-${ts}-${nextCode++}`,
        name: `CovGap Station ${nextCode}`,
        centreId,
        wardId,
        constituencyId,
        countyId,
        registeredVoters: 100,
      })
      .returning({ id: pollingStationsTable.id });
    ids.push(s.id);
  }
  return ids;
}

async function makeAgent(tenantId: string, stationId: string, label: string): Promise<string> {
  const [a] = await db
    .insert(pollingAgentsTable)
    .values({
      tenantId,
      fullName: `CovGap Agent ${label}`,
      phoneNumber: `+2547${Math.floor(Math.random() * 1e8)}`,
      pollingStationId: stationId,
    })
    .returning({ id: pollingAgentsTable.id });
  return a.id;
}

beforeAll(async () => {
  // ── Fixture geography: 1 county, 2 constituencies, 3 wards, 7 stations ──
  const [c] = await db
    .insert(countiesTable)
    .values({ code: nextCode++, name: `CovGap County ${ts}` })
    .returning({ id: countiesTable.id });
  county = c;

  const [c1] = await db
    .insert(constituenciesTable)
    .values({ code: nextCode++, name: `CovGap Const 1 ${ts}`, countyId: county.id })
    .returning({ id: constituenciesTable.id });
  constC1 = c1;
  const [c2] = await db
    .insert(constituenciesTable)
    .values({ code: nextCode++, name: `CovGap Const 2 ${ts}`, countyId: county.id })
    .returning({ id: constituenciesTable.id });
  constC2 = c2;

  const mkWard = async (name: string, constituencyId: string) => {
    const [w] = await db
      .insert(wardsTable)
      .values({ code: nextCode++, name, constituencyId, countyId: county.id })
      .returning({ id: wardsTable.id });
    return w;
  };
  wardW1 = await mkWard(`CovGap Ward 1 ${ts}`, constC1.id);
  wardW2 = await mkWard(`CovGap Ward 2 ${ts}`, constC1.id);
  wardW3 = await mkWard(`CovGap Ward 3 ${ts}`, constC2.id);

  const mkCentre = async (wardId: string, constituencyId: string) => {
    const [ce] = await db
      .insert(pollingCentresTable)
      .values({ name: `CovGap Centre ${nextCode++}`, wardId, constituencyId, countyId: county.id })
      .returning({ id: pollingCentresTable.id });
    return ce.id;
  };
  sW1 = await makeStations(wardW1.id, constC1.id, county.id, await mkCentre(wardW1.id, constC1.id), 3);
  sW2 = await makeStations(wardW2.id, constC1.id, county.id, await mkCentre(wardW2.id, constC1.id), 2);
  sW3 = await makeStations(wardW3.id, constC2.id, county.id, await mkCentre(wardW3.id, constC2.id), 2);

  // Any pre-existing county other than ours, for the cross-filter test.
  const [other] = await db
    .select({ id: countiesTable.id })
    .from(countiesTable)
    .where(ne(countiesTable.id, county.id))
    .limit(1);
  otherCountyId = other.id;

  // ── Tenants scoped to the fixture county ──
  const mkTenant = async (label: string) => {
    const [t] = await db
      .insert(tenantsTable)
      .values({
        name: `CovGap ${label}`,
        slug: `covgap-${label}-${ts}`,
        plan: "free",
        seatType: "senator",
        scopeCountyId: county.id,
      })
      .returning({ id: tenantsTable.id });
    tenantIds.push(t.id);
    return t.id;
  };
  tenantAId = await mkTenant("a");
  tenantBId = await mkTenant("b");

  // ── Members (resolveTenant runs for real; RBAC is mocked out) ──
  const [role] = await db
    .insert(rolesTable)
    .values({ slug: `covgap-role-${ts}`, name: "CovGap Role", level: 9 })
    .returning({ id: rolesTable.id });
  insertedRoleIds.push(role.id);

  const mkMember = async (clerkId: string, tenantId: string) => {
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
      .returning({ id: usersTable.id });
    userIds.push(u.id);
    await db.insert(userRolesTable).values({ userId: u.id, roleId: role.id, tenantId });
  };
  await mkMember(A_CLERK, tenantAId);
  await mkMember(B_CLERK, tenantBId);

  // ── Assignments ──
  // Tenant A: W1 → 2 assigned (sW1[0], sW1[1]); W2 → 1 assigned (sW2[0]);
  //           W3 → 1 assigned (sW3[0]). Total assigned = 4 of 7.
  // sW1[2] gets a profile row with NULL primaryAgentId — must NOT count.
  const assignA = [sW1[0], sW1[1], sW2[0], sW3[0]];
  for (const stationId of assignA) {
    // Same station has MULTIPLE agent records (primary + backup + extra) —
    // counts must still be per-station, not per-agent.
    const primary = await makeAgent(tenantAId, stationId, "primary");
    const backup = await makeAgent(tenantAId, stationId, "backup");
    await makeAgent(tenantAId, stationId, "extra");
    await db.insert(campaignStationProfilesTable).values({
      tenantId: tenantAId,
      stationId,
      primaryAgentId: primary,
      backupAgentId: backup,
    });
  }
  await db.insert(campaignStationProfilesTable).values({
    tenantId: tenantAId,
    stationId: sW1[2],
    primaryAgentId: null, // profiled but unassigned
  });

  // Tenant B: assigns ONLY sW1[0] — the same station tenant A assigned.
  const bPrimary = await makeAgent(tenantBId, sW1[0], "b-primary");
  await db.insert(campaignStationProfilesTable).values({
    tenantId: tenantBId,
    stationId: sW1[0],
    primaryAgentId: bPrimary,
  });

  app = express();
  app.use(express.json());
  app.use("/mgmt", pollingStationsMgmtRouter);
});

afterAll(async () => {
  const stationIds = [...sW1, ...sW2, ...sW3];
  if (tenantIds.length) {
    await db.delete(campaignStationProfilesTable).where(inArray(campaignStationProfilesTable.tenantId, tenantIds));
    await db.delete(pollingAgentsTable).where(inArray(pollingAgentsTable.tenantId, tenantIds));
  }
  if (userIds.length) {
    await db.delete(userRolesTable).where(inArray(userRolesTable.userId, userIds));
    await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  }
  if (tenantIds.length) await db.delete(tenantsTable).where(inArray(tenantsTable.id, tenantIds));
  if (stationIds.length) await db.delete(pollingStationsTable).where(inArray(pollingStationsTable.id, stationIds));
  if (county) {
    await db.delete(pollingCentresTable).where(eq(pollingCentresTable.countyId, county.id));
    await db.delete(wardsTable).where(eq(wardsTable.countyId, county.id));
    await db.delete(constituenciesTable).where(eq(constituenciesTable.countyId, county.id));
    await db.delete(countiesTable).where(eq(countiesTable.id, county.id));
  }
  if (insertedRoleIds.length) await db.delete(rolesTable).where(inArray(rolesTable.id, insertedRoleIds));
});

function wardRow(body: any, wardId: string) {
  return body.rows.find((r: any) => r.wardId === wardId);
}

describe("coverage-gaps counts", () => {
  it("tenant A: summary matches seeded assignments exactly", async () => {
    currentClerkId = A_CLERK;
    const res = await request(app).get("/mgmt/coverage-gaps");
    expect(res.status).toBe(200);
    expect(res.body.summary.total).toBe(7);
    expect(res.body.summary.assigned).toBe(4);
    expect(res.body.summary.unassigned).toBe(3);
    expect(res.body.summary.coveragePct).toBe(Math.round((4 / 7) * 100));
  });

  it("tenant A: ward-level totals and assigned counts are exact", async () => {
    currentClerkId = A_CLERK;
    const res = await request(app).get("/mgmt/coverage-gaps");
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(3);

    const w1 = wardRow(res.body, wardW1.id);
    // 3 stations; 2 assigned. The NULL-primaryAgent profile row on sW1[2] and
    // the multiple agent records per station must not inflate either number.
    expect(w1).toMatchObject({ total: 3, assigned: 2, unassigned: 1 });

    expect(wardRow(res.body, wardW2.id)).toMatchObject({ total: 2, assigned: 1, unassigned: 1 });
    expect(wardRow(res.body, wardW3.id)).toMatchObject({ total: 2, assigned: 1, unassigned: 1 });
  });

  it("tenant B: sees only its own single assignment — A's are invisible", async () => {
    currentClerkId = B_CLERK;
    const res = await request(app).get("/mgmt/coverage-gaps");
    expect(res.status).toBe(200);
    expect(res.body.summary.total).toBe(7);
    expect(res.body.summary.assigned).toBe(1);
    expect(res.body.summary.unassigned).toBe(6);

    expect(wardRow(res.body, wardW1.id)).toMatchObject({ total: 3, assigned: 1 });
    expect(wardRow(res.body, wardW2.id)).toMatchObject({ total: 2, assigned: 0 });
    expect(wardRow(res.body, wardW3.id)).toMatchObject({ total: 2, assigned: 0 });
  });

  it("both tenants profiling the SAME station never double-counts a ward total", async () => {
    // sW1[0] has profile rows from BOTH tenants. If the left-join were not
    // tenant-scoped, W1's total would inflate past its 3 physical stations.
    currentClerkId = A_CLERK;
    const a = await request(app).get("/mgmt/coverage-gaps");
    expect(wardRow(a.body, wardW1.id).total).toBe(3);

    currentClerkId = B_CLERK;
    const b = await request(app).get("/mgmt/coverage-gaps");
    expect(wardRow(b.body, wardW1.id).total).toBe(3);
  });

  it("constituencyId filter returns only that constituency's wards", async () => {
    currentClerkId = A_CLERK;
    const res = await request(app).get(`/mgmt/coverage-gaps?constituencyId=${constC1.id}`);
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(2);
    expect(res.body.rows.every((r: any) => r.constituencyId === constC1.id)).toBe(true);
    expect(wardRow(res.body, wardW1.id)).toMatchObject({ total: 3, assigned: 2 });
    expect(wardRow(res.body, wardW2.id)).toMatchObject({ total: 2, assigned: 1 });
  });

  it("countyId filter: own county returns all rows; a foreign county returns none", async () => {
    currentClerkId = A_CLERK;
    const own = await request(app).get(`/mgmt/coverage-gaps?countyId=${county.id}`);
    expect(own.status).toBe(200);
    expect(own.body.rows).toHaveLength(3);

    const foreign = await request(app).get(`/mgmt/coverage-gaps?countyId=${otherCountyId}`);
    expect(foreign.status).toBe(200);
    expect(foreign.body.rows).toHaveLength(0);
  });
});
