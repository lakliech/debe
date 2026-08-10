/**
 * PVT module — sample generation (stratified PPS, Neyman allocation, scope
 * clamping), quick-report validation, projection computation, and alerts.
 *
 * Run: pnpm --filter @workspace/api-server exec vitest run tests/pvt.test.ts
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import { randomUUID } from "node:crypto";

let currentClerkId = "pvt-none";
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
  candidatesTable,
  countiesTable,
  constituenciesTable,
  wardsTable,
  pollingCentresTable,
  pollingStationsTable,
  campaignStationProfilesTable,
  pollingAgentsTable,
  pvtSampleDesignsTable,
  pvtSampledStationsTable,
  pvtQuickReportsTable,
  pvtProjectionsTable,
  pvtAlertsTable,
  pvtStratumSummariesTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { resolveTenantOptional } from "../src/middlewares/resolveTenant";
import pvtRouter from "../src/routes/pvt";

const ts = randomUUID().slice(0, 8);
const PRES_CLERK = `pvt-pres-${ts}`;
const GOV_CLERK = `pvt-gov-${ts}`;
const OTHER_CLERK = `pvt-other-${ts}`;
const AGENT_CLERK = `pvt-agent-${ts}`;
const UNLINKED_CLERK = `pvt-unlinked-${ts}`;

const tenantIds: string[] = [];
const userIds: string[] = [];
const roleIds: string[] = [];
let countyA: string, countyB: string;
let presTenant: string, govTenant: string, otherTenant: string;
let presElection: string, govElection: string;
let candA: string, candB: string;
let designId: string;
const stationIds: string[] = [];
const centreIds: string[] = [];
const wardIds: string[] = [];
const conIds: string[] = [];

async function ensureRole(slug: string): Promise<string> {
  const [existing] = await db.select().from(rolesTable).where(eq(rolesTable.slug, slug)).limit(1);
  if (existing) return existing.id;
  const [role] = await db.insert(rolesTable).values({ slug, name: slug, level: 3 } as any).returning();
  roleIds.push(role.id);
  return role.id;
}

async function makeTenant(label: string, scope: Record<string, any>): Promise<string> {
  const [t] = await db.insert(tenantsTable)
    .values({ name: `PVT ${label}`, slug: `pvt-${label}-${ts}`, plan: "free", ...scope } as any)
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

/** Build a county with `n` stations of varying sizes; returns station ids. */
async function makeCounty(code: number, name: string, voters: number, n: number, tenantIdsForProfiles: string[]) {
  const [c] = await db.insert(countiesTable).values({ code, name, registeredVoters: voters } as any).returning();
  const [con] = await db.insert(constituenciesTable).values({ code: code + 1, name: `${name} Con`, countyId: c.id, registeredVoters: voters } as any).returning();
  conIds.push(con.id);
  const [w] = await db.insert(wardsTable).values({ code: code + 2, name: `${name} Ward`, constituencyId: con.id, countyId: c.id, registeredVoters: voters } as any).returning();
  wardIds.push(w.id);
  const [centre] = await db.insert(pollingCentresTable).values({ name: `${name} Centre`, wardId: w.id, constituencyId: con.id, countyId: c.id } as any).returning();
  centreIds.push(centre.id);
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const stationVoters = 200 + i * 150; // varied sizes → varied PPS probabilities
    const [s] = await db.insert(pollingStationsTable).values({
      code: `PVT-${code}-${i}-${ts}`, name: `${name} Station ${i}`, centreId: centre.id,
      wardId: w.id, constituencyId: con.id, countyId: c.id, registeredVoters: stationVoters,
    } as any).returning();
    ids.push(s.id);
    stationIds.push(s.id);
    for (const tenantId of tenantIdsForProfiles) {
      await db.insert(campaignStationProfilesTable).values({ tenantId, stationId: s.id } as any);
    }
  }
  return { countyId: c.id, stations: ids };
}

let app: express.Express;

beforeAll(async () => {
  presTenant = await makeTenant("pres", { seatType: "presidential" });
  otherTenant = await makeTenant("other", { seatType: "presidential" });

  // Geography first — gov tenant needs county A's id at insert time (scope CHECK)
  const codeBase = 800000 + Math.floor(Math.random() * 99999);
  const a = await makeCounty(codeBase, `PVT County A ${ts}`, 20000, 8, [presTenant]);
  countyA = a.countyId;
  const b = await makeCounty(codeBase + 100, `PVT County B ${ts}`, 10000, 6, [presTenant]);
  countyB = b.countyId;

  // Gubernatorial tenant clamped to county A (scope CHECK requires the FK at insert)
  govTenant = await makeTenant("gov", { seatType: "gubernatorial", scopeCountyId: countyA });
  for (const sid of stationIds) {
    await db.insert(campaignStationProfilesTable).values({ tenantId: govTenant, stationId: sid } as any);
  }

  const roleId = await ensureRole("county-coordinator");
  await makeMember(PRES_CLERK, presTenant, roleId);
  await makeMember(GOV_CLERK, govTenant, roleId);
  await makeMember(OTHER_CLERK, otherTenant, roleId);
  // Agent user: registered as a polling agent whose OWN station differs from
  // the stations they'll try to report for.
  await makeMember(AGENT_CLERK, presTenant, roleId);
  const [agentUser] = await db.select({ id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.clerkId, AGENT_CLERK)).limit(1);
  await db.insert(pollingAgentsTable).values({
    tenantId: presTenant, userId: agentUser.id,
    fullName: "Pvt Agent", phoneNumber: `+2547${Math.floor(Math.random() * 1e8)}`,
    pollingStationId: stationIds[0], status: "active",
  } as any);
  // Unlinked: holds the polling-agent ROLE but has no polling_agents record.
  const pollingAgentRoleId = await ensureRole("polling-agent");
  await makeMember(UNLINKED_CLERK, presTenant, pollingAgentRoleId);

  const [e] = await db.insert(electionsTable).values({ tenantId: presTenant, name: "PVT Election", year: 2099 } as any).returning();
  presElection = e.id;
  const [ca] = await db.insert(candidatesTable).values({ tenantId: presTenant, electionId: presElection, fullName: "Candidate Alpha", partyName: "Party A", isOurCandidate: true, displayOrder: 1 } as any).returning();
  candA = ca.id;
  const [cb] = await db.insert(candidatesTable).values({ tenantId: presTenant, electionId: presElection, fullName: "Candidate Beta", partyName: "Party B", isOurCandidate: false, displayOrder: 2 } as any).returning();
  candB = cb.id;

  // The gubernatorial tenant gets its OWN election (foreign elections are rejected)
  const [ge] = await db.insert(electionsTable).values({ tenantId: govTenant, name: "PVT Gov Election", year: 2099 } as any).returning();
  govElection = ge.id;

  app = express();
  app.use(express.json());
  app.use(resolveTenantOptional);
  app.use("/pvt", pvtRouter);
});

afterAll(async () => {
  await db.delete(pvtAlertsTable).where(inArray(pvtAlertsTable.tenantId, tenantIds));
  await db.delete(pvtProjectionsTable).where(inArray(pvtProjectionsTable.tenantId, tenantIds));
  await db.delete(pvtStratumSummariesTable).where(inArray(pvtStratumSummariesTable.tenantId, tenantIds));
  await db.delete(pvtQuickReportsTable).where(inArray(pvtQuickReportsTable.tenantId, tenantIds));
  await db.delete(pvtSampledStationsTable).where(inArray(pvtSampledStationsTable.tenantId, tenantIds));
  await db.delete(pvtSampleDesignsTable).where(inArray(pvtSampleDesignsTable.tenantId, tenantIds));
  await db.delete(pollingAgentsTable).where(inArray(pollingAgentsTable.tenantId, tenantIds));
  await db.delete(campaignStationProfilesTable).where(inArray(campaignStationProfilesTable.stationId, stationIds));
  await db.delete(candidatesTable).where(inArray(candidatesTable.id, [candA, candB]));
  await db.delete(electionsTable).where(inArray(electionsTable.tenantId, tenantIds));
  await db.delete(userRolesTable).where(inArray(userRolesTable.userId, userIds));
  await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  await db.delete(tenantsTable).where(inArray(tenantsTable.id, tenantIds));
  await db.delete(pollingStationsTable).where(inArray(pollingStationsTable.id, stationIds));
  await db.delete(pollingCentresTable).where(inArray(pollingCentresTable.id, centreIds));
  await db.delete(wardsTable).where(inArray(wardsTable.id, wardIds));
  await db.delete(constituenciesTable).where(inArray(constituenciesTable.id, conIds));
  await db.delete(countiesTable).where(inArray(countiesTable.id, [countyA, countyB]));
  if (roleIds.length) await db.delete(rolesTable).where(inArray(rolesTable.id, roleIds));
});

async function reportFor(stationId: string, votesA: number, votesB: number, cast: number) {
  return request(app).post("/pvt/quick-reports").send({
    sampledStationId: stationId,
    totalVotesCast: cast,
    registeredVoters: Math.max(cast, 1),
    rejectedBallots: 0,
    candidateVotes: [
      { candidateId: candA, votes: votesA },
      { candidateId: candB, votes: votesB },
    ],
    source: "mobile",
  });
}

describe("sample generation", () => {
  it("creates a stratified PPS sample with Neyman allocation", async () => {
    currentClerkId = PRES_CLERK;
    const res = await request(app).post("/pvt/samples").send({
      electionId: presElection, stratumLevel: "county", targetSampleSize: 10,
      confidenceLevel: 0.95, marginOfError: 0.015,
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("draft");
    expect(res.body.sampledStations).toBe(10);
    designId = res.body.id;
  });

  it("stations carry valid PPS probabilities and design weights across both strata", async () => {
    currentClerkId = PRES_CLERK;
    const res = await request(app).get(`/pvt/samples/${designId}/stations`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(10);
    const strata = new Set(res.body.map((s: any) => s.stratumId));
    expect(strata.size).toBe(2); // both counties represented (min 2 per stratum)
    for (const s of res.body) {
      expect(s.selectionProbability).toBeGreaterThan(0);
      expect(s.selectionProbability).toBeLessThanOrEqual(1);
      expect(s.designWeight).toBeCloseTo(1 / s.selectionProbability, 6);
    }
    // Larger stratum (20k voters) gets more samples than the 10k stratum
    const countA = res.body.filter((s: any) => s.stratumId === countyA).length;
    const countB = res.body.filter((s: any) => s.stratumId === countyB).length;
    expect(countA).toBeGreaterThan(countB);
  });

  it("scoped (gubernatorial) tenant only samples in-scope stations", async () => {
    currentClerkId = GOV_CLERK;
    const res = await request(app).post("/pvt/samples").send({
      electionId: govElection, stratumLevel: "county", targetSampleSize: 10,
    });
    expect(res.status).toBe(201);
    const stations = await request(app).get(`/pvt/samples/${res.body.id}/stations`);
    expect(stations.body.length).toBeGreaterThan(0);
    for (const s of stations.body) {
      expect(s.countyId).toBe(countyA);
    }
  });

  it("activates the sample for live reporting", async () => {
    currentClerkId = PRES_CLERK;
    const res = await request(app).post(`/pvt/samples/${designId}/activate`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("active");
  });
});

describe("quick reports + projections", () => {
  let firstStationId: string;

  it("accepts a balanced quick report and auto-computes a projection", async () => {
    currentClerkId = PRES_CLERK;
    const stations = await request(app).get(`/pvt/samples/${designId}/stations`);
    firstStationId = stations.body[0].id;
    const res = await reportFor(firstStationId, 100, 100, 200);
    expect(res.status).toBe(201);
    expect(res.body.projection).toBeTruthy();
    expect(res.body.projection.reportedStations).toBe(1);

    // Station status flipped
    const after = await request(app).get(`/pvt/samples/${designId}/stations?status=quick_reported`);
    expect(after.body.map((s: any) => s.id)).toContain(firstStationId);
  });

  it("flags recount territory (margin < 0.5%) and low reporting with alerts", async () => {
    currentClerkId = PRES_CLERK;
    const proj = await request(app).get(`/pvt/projections/latest?sampleDesignId=${designId}`);
    expect(proj.status).toBe(200);
    expect(proj.body.isWithinRecountTerritory).toBe(true); // 100-100 tie → margin 0
    expect(proj.body.reportingRate).toBeLessThan(0.5);

    const alerts = await request(app).get(`/pvt/alerts?sampleDesignId=${designId}&status=active`);
    const types = alerts.body.map((a: any) => a.alertType);
    expect(types).toContain("recount_territory");
    expect(types).toContain("low_reporting");
  });

  it("rejects an over-voted (unbalanced) report", async () => {
    currentClerkId = PRES_CLERK;
    const stations = await request(app).get(`/pvt/samples/${designId}/stations?status=pending`);
    const res = await reportFor(stations.body[0].id, 80, 60, 100); // 140 > 100 valid
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("UNBALANCED");
  });

  it("prevents duplicate reports per station", async () => {
    currentClerkId = PRES_CLERK;
    const res = await reportFor(firstStationId, 50, 50, 100);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("DUPLICATE_REPORT");
  });

  it("produces sane confidence intervals as more stations report", async () => {
    currentClerkId = PRES_CLERK;
    const pending = await request(app).get(`/pvt/samples/${designId}/stations?status=pending`);
    // 3 more stations, Alpha ahead 60-40
    for (const s of pending.body.slice(0, 3)) {
      const res = await reportFor(s.id, 120, 80, 200);
      expect(res.status).toBe(201);
    }
    const proj = await request(app).get(`/pvt/projections/latest?sampleDesignId=${designId}`);
    expect(proj.status).toBe(200);
    expect(proj.body.reportedStations).toBe(4);
    for (const c of proj.body.candidateProjections) {
      expect(c.voteShareLower).toBeGreaterThanOrEqual(0);
      expect(c.voteShareUpper).toBeLessThanOrEqual(1);
      expect(c.voteShareLower).toBeLessThanOrEqual(c.projectedVoteShare + 1e-9);
      expect(c.projectedVoteShare).toBeLessThanOrEqual(c.voteShareUpper + 1e-9);
      expect(c.winProbability).toBeGreaterThanOrEqual(0);
      expect(c.winProbability).toBeLessThanOrEqual(1);
    }
    // Alpha (3× 60% + 1× 50%) leads
    expect(proj.body.candidateProjections[0].candidateId).toBe(candA);
    expect(proj.body.projectedMargin).toBeGreaterThan(0);
  });

  it("updates stratum summaries after reports", async () => {
    currentClerkId = PRES_CLERK;
    const res = await request(app).get(`/pvt/strata?sampleDesignId=${designId}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    const reported = res.body.reduce((a: number, s: any) => a + s.reportedStations, 0);
    expect(reported).toBe(4);
  });
});

describe("tenant isolation", () => {
  it("another tenant sees no PVT data for this design", async () => {
    currentClerkId = OTHER_CLERK;
    const stations = await request(app).get(`/pvt/samples/${designId}/stations`);
    expect(stations.status).toBe(200);
    expect(stations.body).toHaveLength(0);
    const proj = await request(app).get(`/pvt/projections/latest?sampleDesignId=${designId}`);
    expect(proj.status).toBe(404);
  });

  it("draft (inactive) samples reject quick reports", async () => {
    currentClerkId = PRES_CLERK;
    const res = await request(app).post("/pvt/samples").send({
      electionId: presElection, stratumLevel: "county", targetSampleSize: 10,
    });
    expect(res.status).toBe(201);
    const stations = await request(app).get(`/pvt/samples/${res.body.id}/stations`);
    const report = await reportFor(stations.body[0].id, 10, 10, 20);
    expect(report.status).toBe(400);
    expect(report.body.error).toMatch(/not active/);
  });
});

describe("authorization hardening", () => {
  it("rejects a sample tied to another tenant's election", async () => {
    currentClerkId = GOV_CLERK;
    const res = await request(app).post("/pvt/samples").send({
      electionId: presElection, stratumLevel: "county", targetSampleSize: 10,
    });
    expect(res.status).toBe(404);
  });

  it("rejects quick reports carrying foreign candidate ids", async () => {
    currentClerkId = PRES_CLERK;
    const stations = await request(app).get(`/pvt/samples/${designId}/stations`);
    const res = await request(app).post("/pvt/quick-reports").send({
      sampledStationId: stations.body[0].id,
      totalVotesCast: 100, registeredVoters: 200, rejectedBallots: 0,
      candidateVotes: [{ candidateId: randomUUID(), votes: 50 }, { candidateId: candA, votes: 50 }],
      source: "mobile",
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_CANDIDATE");
  });

  it("blocks an agent from reporting for a station they are not assigned to", async () => {
    currentClerkId = AGENT_CLERK;
    const pending = await request(app).get(`/pvt/samples/${designId}/stations?status=pending`);
    const target = pending.body.find((s: any) => s.pollingStationId !== stationIds[0]);
    expect(target).toBeTruthy();
    const res = await request(app).post("/pvt/quick-reports").send({
      sampledStationId: target.id,
      totalVotesCast: 100, registeredVoters: 200, rejectedBallots: 0,
      candidateVotes: [{ candidateId: candA, votes: 60 }, { candidateId: candB, votes: 40 }],
      source: "mobile",
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NOT_ASSIGNED");
  });

  it("blocks a polling-agent-role user with no linked agent record", async () => {
    currentClerkId = UNLINKED_CLERK;
    const pending = await request(app).get(`/pvt/samples/${designId}/stations?status=pending`);
    const res = await request(app).post("/pvt/quick-reports").send({
      sampledStationId: pending.body[0].id,
      totalVotesCast: 100, registeredVoters: 200, rejectedBallots: 0,
      candidateVotes: [{ candidateId: candA, votes: 60 }, { candidateId: candB, votes: 40 }],
      source: "mobile",
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("AGENT_UNLINKED");
  });

  it("rejects an infeasible target (fewer than 2 per stratum)", async () => {
    currentClerkId = PRES_CLERK;
    // Zod floor first
    const tooSmall = await request(app).post("/pvt/samples").send({
      electionId: presElection, stratumLevel: "county", targetSampleSize: 5,
    });
    expect(tooSmall.status).toBe(400);

    // Valid-but-infeasible: 6 more strata with 2 stations each → 8 strata total
    // need ≥16 stations, so target 10 must 400 (not 500).
    const base = 900000 + Math.floor(Math.random() * 99999);
    for (let i = 0; i < 6; i++) {
      await makeCounty(base + i * 10, `PVT Mini ${i} ${ts}`, 4000, 2, [presTenant]);
    }
    const res = await request(app).post("/pvt/samples").send({
      electionId: presElection, stratumLevel: "county", targetSampleSize: 10,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/infeasible/);
  });
});
