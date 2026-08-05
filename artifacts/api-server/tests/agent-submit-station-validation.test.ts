/**
 * Agent-submit station validation.
 *
 * Regression for "agent-submit validated agentId belongs to tenant but not
 * pollingStationId": polling_stations is SHARED global geography, so an agent
 * could submit results for any station in the country. The endpoint now
 * requires a campaign_station_profiles row for the submitting tenant —
 * proving the campaign actually operates that station.
 *
 * Run: pnpm --filter @workspace/api-server exec vitest run tests/agent-submit-station-validation.test.ts
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import { randomUUID } from "node:crypto";

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: any, _res: any, next: any) => next(),
  getAuth: () => ({ userId: "station-validation-clerk" }),
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
  electionsTable,
  pollingAgentsTable,
  countiesTable,
  constituenciesTable,
  wardsTable,
  pollingCentresTable,
  pollingStationsTable,
  campaignStationProfilesTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import electionResultsRouter from "../src/routes/electionResults";

const SLUG = `stn-val-${randomUUID().slice(0, 8)}`;
let tenantAId: string;
let tenantBId: string;
let electionId: string;
let agentAId: string;
let station1Id: string; // registered to tenant A
let station2Id: string; // registered to tenant B only
let countyId: string;
let constituencyId: string;
let wardId: string;
let centreId: string;
let app: express.Express;

beforeAll(async () => {
  const uniq = 900000 + Math.floor(Math.random() * 99999);

  const [tenantA] = await db.insert(tenantsTable).values({ name: "Station Val A", slug: `${SLUG}-a` }).returning();
  const [tenantB] = await db.insert(tenantsTable).values({ name: "Station Val B", slug: `${SLUG}-b` }).returning();
  tenantAId = tenantA.id;
  tenantBId = tenantB.id;

  // Shared geography chain (no tenant).
  const [county] = await db.insert(countiesTable).values({ code: uniq, name: `Test County ${uniq}` }).returning();
  countyId = county.id;
  const [constituency] = await db.insert(constituenciesTable).values({ code: uniq + 1, name: `Test Con ${uniq}`, countyId }).returning();
  constituencyId = constituency.id;
  const [ward] = await db.insert(wardsTable).values({ code: uniq + 2, name: `Test Ward ${uniq}`, constituencyId, countyId }).returning();
  wardId = ward.id;
  const [centre] = await db.insert(pollingCentresTable).values({ name: `Test Centre ${uniq}`, wardId, constituencyId, countyId }).returning();
  centreId = centre.id;

  const [station1] = await db.insert(pollingStationsTable).values({
    code: `ST-${uniq}-1`, name: `Station One ${uniq}`, centreId, wardId, constituencyId, countyId,
  }).returning();
  station1Id = station1.id;
  const [station2] = await db.insert(pollingStationsTable).values({
    code: `ST-${uniq}-2`, name: `Station Two ${uniq}`, centreId, wardId, constituencyId, countyId,
  }).returning();
  station2Id = station2.id;

  const [agent] = await db.insert(pollingAgentsTable).values({
    tenantId: tenantAId, fullName: "Agent A", phoneNumber: "254700000001",
  }).returning();
  agentAId = agent.id;

  const [election] = await db.insert(electionsTable).values({ tenantId: tenantAId, name: "Val Election", year: 2099 }).returning();
  electionId = election.id;

  // Tenant A is registered on station 1 (agentA as primary); tenant B on station 2.
  await db.insert(campaignStationProfilesTable).values({ tenantId: tenantAId, stationId: station1Id, primaryAgentId: agentAId });
  await db.insert(campaignStationProfilesTable).values({ tenantId: tenantBId, stationId: station2Id });

  app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.tenant = { id: tenantAId };
    next();
  });
  app.use("/", electionResultsRouter);
});

afterAll(async () => {
  // Profiles' tenantId has no FK — clean them explicitly, then unwind the
  // geography chain, then the tenants (cascade: elections, agents, submissions).
  await db.delete(campaignStationProfilesTable).where(inArray(campaignStationProfilesTable.tenantId, [tenantAId, tenantBId]));
  await db.delete(pollingStationsTable).where(inArray(pollingStationsTable.id, [station1Id, station2Id]));
  await db.delete(pollingCentresTable).where(eq(pollingCentresTable.id, centreId));
  await db.delete(wardsTable).where(eq(wardsTable.id, wardId));
  await db.delete(constituenciesTable).where(eq(constituenciesTable.id, constituencyId));
  await db.delete(countiesTable).where(eq(countiesTable.id, countyId));
  await db.delete(tenantsTable).where(inArray(tenantsTable.id, [tenantAId, tenantBId]));
});

const submit = (pollingStationId: string) =>
  request(app).post("/submissions/agent-submit").send({ pollingStationId, electionId, agentId: agentAId });

describe("agent-submit station validation", () => {
  it("rejects a station with no campaign profile at all", async () => {
    const res = await submit(randomUUID());
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not registered to this campaign/i);
  });

  it("rejects a station registered only to ANOTHER campaign", async () => {
    const res = await submit(station2Id);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not registered to this campaign/i);
  });

  it("accepts a station registered to this campaign", async () => {
    const res = await submit(station1Id);
    expect(res.status).toBe(201);
    expect(res.body.submission).toBeDefined();
    expect(res.body.submission.pollingStationId).toBe(station1Id);
  });
});
