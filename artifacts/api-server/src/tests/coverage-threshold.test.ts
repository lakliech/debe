/**
 * Coverage-threshold gap alert integration tests.
 *
 * Verifies:
 *  - PATCH /api/config/system persists the per-tenant minimum coverage
 *    threshold (and rejects invalid values), and GET round-trips it.
 *  - GET /api/coordinator/gap-alerts returns station-level constituency gaps
 *    scoped to the campaign's own geography, counting only THIS tenant's
 *    agent assignments, and respecting the configured threshold.
 *
 * Run with: pnpm --filter @workspace/api-server test
 */

import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

const mockAuth = { userId: "" as string | null };

vi.mock("@clerk/express", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clerk/express")>();
  return {
    ...actual,
    clerkMiddleware: vi.fn(() => (_req: any, _res: any, next: any) => next()),
    getAuth: vi.fn((_req: any) => mockAuth),
  };
});

import request from "supertest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import {
  tenantsTable,
  usersTable,
  userRolesTable,
  rolesTable,
  constituenciesTable,
  pollingStationsTable,
  campaignStationProfilesTable,
  systemConfigTable,
} from "@workspace/db";
import { eq, and, inArray, sql } from "drizzle-orm";
import { bustActorCache } from "../middlewares/rbac";

const { default: app } = await import("../app");

const USER_CLERK_ID = "user_test_coverage_threshold";

let tenantId: string;
let otherTenantId: string;
let userId: string;
let scopedConstituencyId: string;
let scopedConstituencyName: string;
let stationIds: string[] = [];
let profileIds: string[] = [];

beforeAll(async () => {
  const ts = Date.now();

  // Find a constituency that actually has polling stations.
  const [target] = await db
    .select({
      id: constituenciesTable.id,
      name: constituenciesTable.name,
      stations: sql<number>`count(${pollingStationsTable.id})::int`,
    })
    .from(constituenciesTable)
    .innerJoin(pollingStationsTable, eq(pollingStationsTable.constituencyId, constituenciesTable.id))
    .groupBy(constituenciesTable.id, constituenciesTable.name)
    .having(sql`count(${pollingStationsTable.id}) >= 4`)
    .limit(1);
  if (!target) throw new Error("No constituency with stations — run seed first");
  scopedConstituencyId = target.id;
  scopedConstituencyName = target.name;

  const stations = await db
    .select({ id: pollingStationsTable.id })
    .from(pollingStationsTable)
    .where(eq(pollingStationsTable.constituencyId, scopedConstituencyId));
  stationIds = stations.map((s) => s.id);

  // MP campaign scoped to that constituency.
  const [t] = await db
    .insert(tenantsTable)
    .values({
      name: "Coverage Threshold Test",
      slug: `cov-thresh-${ts}`,
      plan: "free",
      seatType: "mp",
      scopeConstituencyId: scopedConstituencyId,
    })
    .returning();
  tenantId = t.id;

  // A second tenant whose assignments must NOT count for tenant A.
  const [tB] = await db
    .insert(tenantsTable)
    .values({
      name: "Coverage Threshold Other",
      slug: `cov-thresh-b-${ts}`,
      plan: "free",
      seatType: "mp",
      scopeConstituencyId: scopedConstituencyId,
    })
    .returning();
  otherTenantId = tB.id;

  const [user] = await db
    .insert(usersTable)
    .values({ clerkId: USER_CLERK_ID, email: `cov_thresh_${ts}@test.test`, fullName: "Coverage Tester", status: "active" })
    .onConflictDoUpdate({ target: usersTable.clerkId, set: { activeTenantId: null } })
    .returning();
  userId = user.id;

  const [superAdminRole] = await db
    .select()
    .from(rolesTable)
    .where(eq(rolesTable.slug, "super-admin"))
    .limit(1);
  if (!superAdminRole) throw new Error("super-admin role missing — run seed first");
  await db.insert(userRolesTable).values({ userId, roleId: superAdminRole.id, tenantId }).onConflictDoNothing();

  // Other tenant fully covers the constituency — this must not leak into A.
  const otherProfiles = await db
    .insert(campaignStationProfilesTable)
    .values(stationIds.map((stationId) => ({ tenantId: otherTenantId, stationId, primaryAgentId: randomUUID() })))
    .returning({ id: campaignStationProfilesTable.id });

  // Tenant A covers exactly half the stations.
  const half = stationIds.slice(0, Math.floor(stationIds.length / 2));
  const ownProfiles = await db
    .insert(campaignStationProfilesTable)
    .values(half.map((stationId) => ({ tenantId, stationId, primaryAgentId: randomUUID() })))
    .returning({ id: campaignStationProfilesTable.id });

  profileIds = [...otherProfiles, ...ownProfiles].map((p) => p.id);

  mockAuth.userId = USER_CLERK_ID;
  bustActorCache(USER_CLERK_ID);
});

afterAll(async () => {
  if (profileIds.length) await db.delete(campaignStationProfilesTable).where(inArray(campaignStationProfilesTable.id, profileIds));
  if (tenantId) await db.delete(systemConfigTable).where(eq(systemConfigTable.tenantId, tenantId));
  if (userId) await db.delete(userRolesTable).where(eq(userRolesTable.userId, userId));
  if (tenantId) await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
  if (otherTenantId) await db.delete(tenantsTable).where(eq(tenantsTable.id, otherTenantId));
  if (userId) await db.delete(usersTable).where(eq(usersTable.id, userId));
});

describe("PATCH /api/config/system — minimum coverage threshold", () => {
  it("persists a valid threshold and round-trips through GET", async () => {
    const patch = await request(app)
      .patch("/api/config/system")
      .send({ minCoverageThresholdPct: 65 });
    expect(patch.status).toBe(200);
    expect(patch.body.minCoverageThresholdPct).toBe(65);

    const get = await request(app).get("/api/config/system");
    expect(get.status).toBe(200);
    expect(get.body.minCoverageThresholdPct).toBe(65);
  });

  it("rejects out-of-range and non-integer values", async () => {
    for (const bad of [101, -1, 50.5, null, "eighty"]) {
      const res = await request(app)
        .patch("/api/config/system")
        .send({ minCoverageThresholdPct: bad });
      expect(res.status).toBe(400);
    }
    // Value unchanged
    const get = await request(app).get("/api/config/system");
    expect(get.body.minCoverageThresholdPct).toBe(65);
  });
});

describe("GET /api/coordinator/gap-alerts — station-level constituency gaps", () => {
  it("flags the scoped constituency when its coverage (own tenant only) is below the threshold", async () => {
    // Tenant A covers ~50% — below the configured 65% threshold.
    // The other tenant's 100% coverage must not count.
    const res = await request(app).get("/api/coordinator/gap-alerts");
    expect(res.status).toBe(200);
    expect(res.body.coverageThresholdPct).toBe(65);

    const list = res.body.lowCoverageConstituencies as any[];
    expect(Array.isArray(list)).toBe(true);
    const entry = list.find((c) => c.constituencyId === scopedConstituencyId);
    expect(entry).toBeTruthy();
    expect(entry.constituencyName).toBe(scopedConstituencyName);
    expect(entry.totalStations).toBe(stationIds.length);
    expect(entry.assignedStations).toBe(Math.floor(stationIds.length / 2));
    expect(entry.coveragePct).toBeLessThan(65);

    // Scope: an MP campaign sees only its own constituency in the gap list.
    for (const c of list) {
      expect(c.constituencyId).toBe(scopedConstituencyId);
    }
  });

  it("does not flag the constituency once the threshold is below its coverage", async () => {
    const patch = await request(app)
      .patch("/api/config/system")
      .send({ minCoverageThresholdPct: 10 });
    expect(patch.status).toBe(200);

    const res = await request(app).get("/api/coordinator/gap-alerts");
    expect(res.status).toBe(200);
    expect(res.body.coverageThresholdPct).toBe(10);
    const list = res.body.lowCoverageConstituencies as any[];
    expect(list.find((c) => c.constituencyId === scopedConstituencyId)).toBeUndefined();
  });
});
