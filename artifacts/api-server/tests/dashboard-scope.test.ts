/**
 * Dashboard scope enforcement — tally endpoints, result-submissions list, and
 * the field-coordinator dashboard must restrict to the campaign's election
 * scope (tenant.seatType + scope geography). A Nairobi gubernatorial campaign
 * must not see a National tally; an MCA never sees a constituency tally.
 *
 * Run: pnpm --filter @workspace/api-server exec vitest run tests/dashboard-scope.test.ts
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import { randomUUID } from "node:crypto";

let currentClerkId = "scope-none";
vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: any, _res: any, next: any) => next(),
  getAuth: () => ({ userId: currentClerkId }),
}));
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
  electionsTable,
  resultSubmissionsTable,
  tallySnapshotsTable,
  countiesTable,
  constituenciesTable,
  wardsTable,
  pollingCentresTable,
  pollingStationsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { resolveTenantOptional } from "../src/middlewares/resolveTenant";
import tallyRouter from "../src/routes/tally";
import electionResultsRouter from "../src/routes/electionResults";
import coordinatorRouter from "../src/routes/coordinator";

const ts = randomUUID().slice(0, 8);
const GOV_CLERK = `scope-gov-${ts}`;
const MP_CLERK = `scope-mp-${ts}`;
const MCA_CLERK = `scope-mca-${ts}`;
const PRES_CLERK = `scope-pres-${ts}`;

const tenantIds: string[] = [];
const userIds: string[] = [];
const roleIds: string[] = [];
let countyA: string, countyB: string;
let conA: string, conB: string;
let wardA: string, wardB: string;
let centreA: string, centreB: string;
let stationA: string, stationB: string;
let govTenant: string, mpTenant: string, mcaTenant: string, presTenant: string;
let govElection: string, mpElection: string, mcaElection: string, presElection: string;
let subInScope: string, subOutOfScope: string;
let snapshotIds: string[] = [];

async function ensureRole(slug: string): Promise<string> {
  const [existing] = await db.select().from(rolesTable).where(eq(rolesTable.slug, slug)).limit(1);
  if (existing) return existing.id;
  const [role] = await db.insert(rolesTable).values({ slug, name: slug, level: 3 } as any).returning();
  roleIds.push(role.id);
  return role.id;
}

async function makeTenant(label: string, scope: Record<string, any>): Promise<string> {
  const [t] = await db.insert(tenantsTable)
    .values({ name: `Scope ${label}`, slug: `scope-${label}-${ts}`, plan: "free", ...scope } as any)
    .returning();
  tenantIds.push(t.id);
  return t.id;
}

async function makeMember(clerkId: string, tenantId: string, roleId: string): Promise<void> {
  const [u] = await db.insert(usersTable).values({
    clerkId, email: `${clerkId}@test.local`, fullName: clerkId, status: "active",
    isGlobalAdmin: false, activeTenantId: tenantId,
  } as any).returning();
  userIds.push(u.id);
  await db.insert(userRolesTable).values({ userId: u.id, roleId, tenantId } as any);
}

let app: express.Express;

beforeAll(async () => {
  const codeBase = 900000 + Math.floor(Math.random() * 99999);
  const [ca] = await db.insert(countiesTable).values({ code: codeBase, name: `Scope County A ${ts}` } as any).returning();
  countyA = ca.id;
  const [cb] = await db.insert(countiesTable).values({ code: codeBase + 10, name: `Scope County B ${ts}` } as any).returning();
  countyB = cb.id;
  const [cona] = await db.insert(constituenciesTable).values({ code: codeBase + 1, name: `Scope Con A ${ts}`, countyId: countyA } as any).returning();
  conA = cona.id;
  const [conb] = await db.insert(constituenciesTable).values({ code: codeBase + 11, name: `Scope Con B ${ts}`, countyId: countyB } as any).returning();
  conB = conb.id;
  const [wa] = await db.insert(wardsTable).values({ code: codeBase + 2, name: `Scope Ward A ${ts}`, constituencyId: conA, countyId: countyA } as any).returning();
  wardA = wa.id;
  const [wb] = await db.insert(wardsTable).values({ code: codeBase + 12, name: `Scope Ward B ${ts}`, constituencyId: conB, countyId: countyB } as any).returning();
  wardB = wb.id;
  const [cea] = await db.insert(pollingCentresTable).values({ name: `Scope Centre A ${ts}`, wardId: wardA, constituencyId: conA, countyId: countyA } as any).returning();
  centreA = cea.id;
  const [ceb] = await db.insert(pollingCentresTable).values({ name: `Scope Centre B ${ts}`, wardId: wardB, constituencyId: conB, countyId: countyB } as any).returning();
  centreB = ceb.id;
  const [sa] = await db.insert(pollingStationsTable).values({
    code: `SCP-A-${ts}`, name: `Scope Station A ${ts}`, centreId: centreA, wardId: wardA, constituencyId: conA, countyId: countyA, registeredVoters: 500,
  } as any).returning();
  stationA = sa.id;
  const [sb] = await db.insert(pollingStationsTable).values({
    code: `SCP-B-${ts}`, name: `Scope Station B ${ts}`, centreId: centreB, wardId: wardB, constituencyId: conB, countyId: countyB, registeredVoters: 500,
  } as any).returning();
  stationB = sb.id;

  govTenant = await makeTenant("gov", { seatType: "gubernatorial", scopeCountyId: countyA });
  mpTenant = await makeTenant("mp", { seatType: "mp", scopeConstituencyId: conA });
  mcaTenant = await makeTenant("mca", { seatType: "mca", scopeWardId: wardA });
  presTenant = await makeTenant("pres", { seatType: "presidential" });

  const roleId = await ensureRole("county-coordinator");
  await makeMember(GOV_CLERK, govTenant, roleId);
  await makeMember(MP_CLERK, mpTenant, roleId);
  await makeMember(MCA_CLERK, mcaTenant, roleId);
  await makeMember(PRES_CLERK, presTenant, roleId);

  const mkElection = async (tenantId: string, name: string) => {
    const [e] = await db.insert(electionsTable).values({ tenantId, name, year: 2099 } as any).returning();
    return e.id;
  };
  govElection = await mkElection(govTenant, "Gov Election");
  mpElection = await mkElection(mpTenant, "MP Election");
  mcaElection = await mkElection(mcaTenant, "MCA Election");
  presElection = await mkElection(presTenant, "Pres Election");

  // Gov tenant has one submission IN scope (station A) and one OUT of scope (station B)
  const [inScope] = await db.insert(resultSubmissionsTable).values({
    tenantId: govTenant, pollingStationId: stationA, electionId: govElection,
    agentId: randomUUID(), status: "submitted",
  } as any).returning();
  subInScope = inScope.id;
  const [outScope] = await db.insert(resultSubmissionsTable).values({
    tenantId: govTenant, pollingStationId: stationB, electionId: govElection,
    agentId: randomUUID(), status: "submitted",
  } as any).returning();
  subOutOfScope = outScope.id;

  // Stored snapshots: in-scope county, out-of-scope county, national (gov), national (pres)
  const snap = (level: string, entityId: string | null, tenantId: string, electionId: string) => ({
    tenantId, electionId, level, entityId,
    candidateName: `Snap Cand ${ts}`, votes: 10, validVotes: 10, registeredVoters: 0,
    totalStations: 0, stationsReporting: 0, stationsVerified: 0, stationsPending: 0, stationsDisputed: 0,
    computedAt: new Date(),
  });
  const snapRows = await db.insert(tallySnapshotsTable).values([
    snap("county", countyA, govTenant, govElection),
    snap("county", countyB, govTenant, govElection),
    snap("national", null, govTenant, govElection),
    snap("national", null, presTenant, presElection),
  ] as any).returning();
  snapshotIds = snapRows.map((r) => r.id);

  app = express();
  app.use(express.json());
  app.use(resolveTenantOptional);
  app.use("/tally", tallyRouter);
  app.use("/election-results", electionResultsRouter);
  app.use("/coordinator", coordinatorRouter);
});

afterAll(async () => {
  if (snapshotIds.length) await db.delete(tallySnapshotsTable).where(inArray(tallySnapshotsTable.id, snapshotIds));
  await db.delete(resultSubmissionsTable).where(inArray(resultSubmissionsTable.id, [subInScope, subOutOfScope]));
  await db.delete(electionsTable).where(inArray(electionsTable.tenantId, tenantIds));
  await db.delete(userRolesTable).where(inArray(userRolesTable.userId, userIds));
  await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  await db.delete(tenantsTable).where(inArray(tenantsTable.id, tenantIds));
  await db.delete(pollingStationsTable).where(inArray(pollingStationsTable.id, [stationA, stationB]));
  await db.delete(pollingCentresTable).where(inArray(pollingCentresTable.id, [centreA, centreB]));
  await db.delete(wardsTable).where(inArray(wardsTable.id, [wardA, wardB]));
  await db.delete(constituenciesTable).where(inArray(constituenciesTable.id, [conA, conB]));
  await db.delete(countiesTable).where(inArray(countiesTable.id, [countyA, countyB]));
  if (roleIds.length) await db.delete(rolesTable).where(inArray(rolesTable.id, roleIds));
});

describe("tally level enforcement", () => {
  it("gubernatorial campaign cannot access the national tally", async () => {
    currentClerkId = GOV_CLERK;
    const res = await request(app).get(`/tally/national/${govElection}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("OUT_OF_SCOPE");
  });

  it("gubernatorial campaign gets its own county but not another", async () => {
    currentClerkId = GOV_CLERK;
    const own = await request(app).get(`/tally/county/${govElection}/${countyA}`);
    expect(own.status).toBe(200);
    const other = await request(app).get(`/tally/county/${govElection}/${countyB}`);
    expect(other.status).toBe(403);
    expect(other.body.code).toBe("OUT_OF_SCOPE");
  });

  it("gubernatorial campaign can drill into in-scope constituency/ward/station only", async () => {
    currentClerkId = GOV_CLERK;
    expect((await request(app).get(`/tally/constituency/${govElection}/${conA}`)).status).toBe(200);
    expect((await request(app).get(`/tally/constituency/${govElection}/${conB}`)).status).toBe(403);
    expect((await request(app).get(`/tally/ward/${govElection}/${wardA}`)).status).toBe(200);
    expect((await request(app).get(`/tally/ward/${govElection}/${wardB}`)).status).toBe(403);
    expect((await request(app).get(`/tally/station/${govElection}/${stationA}`)).status).toBe(200);
    expect((await request(app).get(`/tally/station/${govElection}/${stationB}`)).status).toBe(403);
  });

  it("MP campaign cannot access county tally — even its own parent county", async () => {
    currentClerkId = MP_CLERK;
    expect((await request(app).get(`/tally/national/${mpElection}`)).status).toBe(403);
    expect((await request(app).get(`/tally/county/${mpElection}/${countyA}`)).status).toBe(403);
    expect((await request(app).get(`/tally/constituency/${mpElection}/${conA}`)).status).toBe(200);
    expect((await request(app).get(`/tally/constituency/${mpElection}/${conB}`)).status).toBe(403);
  });

  it("MCA campaign is restricted to its own ward", async () => {
    currentClerkId = MCA_CLERK;
    expect((await request(app).get(`/tally/national/${mcaElection}`)).status).toBe(403);
    expect((await request(app).get(`/tally/constituency/${mcaElection}/${conA}`)).status).toBe(403);
    expect((await request(app).get(`/tally/ward/${mcaElection}/${wardA}`)).status).toBe(200);
    expect((await request(app).get(`/tally/ward/${mcaElection}/${wardB}`)).status).toBe(403);
  });

  it("presidential campaign keeps full national access", async () => {
    currentClerkId = PRES_CLERK;
    const res = await request(app).get(`/tally/national/${presElection}`);
    expect(res.status).toBe(200);
    expect(res.body.level).toBe("national");
  });

  it("progress only counts in-scope stations", async () => {
    currentClerkId = GOV_CLERK;
    const res = await request(app).get(`/tally/progress/${govElection}`);
    expect(res.status).toBe(200);
    const countyIds = res.body.byCounty.map((r: any) => r.countyId);
    expect(countyIds).toContain(countyA);
    expect(countyIds).not.toContain(countyB);
  });
});

describe("result submissions list scoping", () => {
  it("excludes submissions at stations outside the campaign scope", async () => {
    currentClerkId = GOV_CLERK;
    const res = await request(app).get(`/election-results/submissions?limit=100&electionId=${govElection}`);
    expect(res.status).toBe(200);
    const ids = res.body.data.map((r: any) => r.id);
    expect(ids).toContain(subInScope);
    expect(ids).not.toContain(subOutOfScope);
    expect(res.body.total).toBe(1);
  });
});

describe("field coordinator dashboard scoping", () => {
  it("coverage map only includes the scope county", async () => {
    currentClerkId = GOV_CLERK;
    const res = await request(app).get("/coordinator/coverage");
    expect(res.status).toBe(200);
    const countyIds = res.body.map((r: any) => r.countyId);
    expect(countyIds).toContain(countyA);
    expect(countyIds).not.toContain(countyB);
    expect(countyIds).toHaveLength(1);
  });
});

describe("submission detail scoping", () => {
  it("in-scope submission detail loads; out-of-scope ID is denied", async () => {
    currentClerkId = GOV_CLERK;
    const ok = await request(app).get(`/election-results/submissions/${subInScope}`);
    expect(ok.status).toBe(200);
    const denied = await request(app).get(`/election-results/submissions/${subOutOfScope}`);
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("OUT_OF_SCOPE");
  });
});

describe("stored snapshot scoping", () => {
  it("snapshot list only returns in-scope entities and levels", async () => {
    currentClerkId = GOV_CLERK;
    const res = await request(app).get(`/tally/snapshot?electionId=${govElection}`);
    expect(res.status).toBe(200);
    const keys = res.body.map((r: any) => `${r.level}:${r.entityId}`).sort();
    expect(keys).toEqual([`county:${countyA}`]);
  });

  it("explicit out-of-scope snapshot entity returns nothing", async () => {
    currentClerkId = GOV_CLERK;
    const res = await request(app).get(`/tally/snapshot?electionId=${govElection}&level=county&entityId=${countyB}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it("presidential tenant still sees national snapshots", async () => {
    currentClerkId = PRES_CLERK;
    const res = await request(app).get(`/tally/snapshot?electionId=${presElection}`);
    expect(res.status).toBe(200);
    expect(res.body.some((r: any) => r.level === "national")).toBe(true);
  });
});

describe("submission write scoping", () => {
  it("verify is blocked for an out-of-scope submission and status stays unchanged", async () => {
    currentClerkId = GOV_CLERK;
    const res = await request(app)
      .post(`/election-results/submissions/${subOutOfScope}/verify`)
      .send({ action: "verify", toStatus: "verified" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("OUT_OF_SCOPE");
    const [row] = await db.select({ status: resultSubmissionsTable.status })
      .from(resultSubmissionsTable)
      .where(eq(resultSubmissionsTable.id, subOutOfScope));
    expect(row.status).toBe("submitted");
  });

  it("submit is blocked for an out-of-scope submission", async () => {
    currentClerkId = GOV_CLERK;
    const res = await request(app)
      .post(`/election-results/submissions/${subOutOfScope}/submit`)
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("OUT_OF_SCOPE");
    const [row] = await db.select({ status: resultSubmissionsTable.status })
      .from(resultSubmissionsTable)
      .where(eq(resultSubmissionsTable.id, subOutOfScope));
    expect(row.status).toBe("submitted");
  });
});
