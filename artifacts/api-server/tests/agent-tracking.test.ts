/**
 * Agent tracking — geofence presence derivation (boundary behaviour),
 * heartbeat recording + election resolution, live-map tenant isolation, and
 * the missing-agent monitor sweep (WhatsApp dispatch + 60-min cooldown).
 *
 * Run: pnpm --filter @workspace/api-server exec vitest run tests/agent-tracking.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import {
  tenantsTable,
  electionsTable,
  pollingAgentsTable,
  agentLocationPingsTable,
  agentTrackingAlertsTable,
  countiesTable,
  constituenciesTable,
  wardsTable,
  pollingCentresTable,
  pollingStationsTable,
  usersTable,
  userRolesTable,
  rolesTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";

const { sendWhatsappChannel } = vi.hoisted(() => ({
  sendWhatsappChannel: vi.fn(async () => ({ ok: true as const })),
}));
vi.mock("../src/lib/commsDispatcher", () => ({ sendWhatsappChannel }));

import {
  derivePresence,
  recordHeartbeat,
  getLiveAgentTracking,
  runTrackingSweep,
  ON_STATION_RADIUS_M,
  NEARBY_RADIUS_M,
  STALE_AFTER_MS,
} from "../src/lib/agentTracking";

const UNIQ = randomUUID().slice(0, 8);
const STATION_LAT = -1.2921;
const STATION_LON = 36.8219;
// ~87m north-east of the station (well inside the 200m geofence)
const NEAR_LAT = STATION_LAT + 0.0005;
const NEAR_LON = STATION_LON + 0.0005;

let tenantA: string;
let tenantB: string;
let electionA: string;
let electionB: string; // belongs to tenant B — used to prove cross-tenant electionIds are rejected
let countyId: string;
let constituencyId: string;
let wardId: string;
let centreId: string;
let stationId: string;
let agentOnStation: string;
let agentSilent: string;
let agentUnassigned: string;
let agentHeartbeatTarget: string;
let agentOtherTenant: string;
let officerUserId: string;
let insertedRoleIds: string[] = [];

async function ensureRole(slug: string, name: string, level: number): Promise<string> {
  const [existing] = await db.select().from(rolesTable).where(eq(rolesTable.slug, slug)).limit(1);
  if (existing) return existing.id;
  const [role] = await db.insert(rolesTable).values({ slug, name, level } as any).returning();
  insertedRoleIds.push(role.id);
  return role.id;
}

async function makeAgent(tenantId: string, label: string, station: string | null): Promise<string> {
  const [a] = await db.insert(pollingAgentsTable).values({
    tenantId,
    fullName: `Agent ${label} ${UNIQ}`,
    phoneNumber: `+2547${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
    pollingStationId: station,
  } as any).returning();
  return a.id;
}

beforeAll(async () => {
  const [ta] = await db.insert(tenantsTable).values({ name: "Tracking A", slug: `trk-a-${UNIQ}` } as any).returning();
  tenantA = ta.id;
  const [tb] = await db.insert(tenantsTable).values({ name: "Tracking B", slug: `trk-b-${UNIQ}` } as any).returning();
  tenantB = tb.id;
  const [el] = await db.insert(electionsTable).values({ tenantId: tenantA, name: "Tracking Election", year: 2099, isActive: true } as any).returning();
  electionA = el.id;
  const [elb] = await db.insert(electionsTable).values({ tenantId: tenantB, name: "Foreign Election", year: 2099, isActive: false } as any).returning();
  electionB = elb.id;

  const codeBase = 800000 + Math.floor(Math.random() * 99999);
  const [county] = await db.insert(countiesTable).values({ code: codeBase, name: `Tracking County ${UNIQ}` } as any).returning();
  countyId = county.id;
  const [con] = await db.insert(constituenciesTable).values({ code: codeBase + 1, name: `Tracking Con ${UNIQ}`, countyId } as any).returning();
  constituencyId = con.id;
  const [ward] = await db.insert(wardsTable).values({ code: codeBase + 2, name: `Tracking Ward ${UNIQ}`, constituencyId, countyId } as any).returning();
  wardId = ward.id;
  const [centre] = await db.insert(pollingCentresTable).values({ name: `Tracking Centre ${UNIQ}`, wardId, constituencyId, countyId } as any).returning();
  centreId = centre.id;
  const [st] = await db.insert(pollingStationsTable).values({
    code: `TRK-${UNIQ}`,
    name: `Tracking Station ${UNIQ}`,
    centreId, wardId, constituencyId, countyId,
    registeredVoters: 500,
    latitude: STATION_LAT,
    longitude: STATION_LON,
  } as any).returning();
  stationId = st.id;

  agentOnStation = await makeAgent(tenantA, "OnStation", stationId);
  agentSilent = await makeAgent(tenantA, "Silent", stationId);
  agentUnassigned = await makeAgent(tenantA, "Unassigned", null);
  agentHeartbeatTarget = await makeAgent(tenantA, "Heartbeat", stationId);
  agentOtherTenant = await makeAgent(tenantB, "OtherTenant", stationId);

  // Fresh on-station ping for agentOnStation; everyone else starts silent.
  await db.insert(agentLocationPingsTable).values({
    tenantId: tenantA, agentId: agentOnStation, electionId: electionA,
    lat: NEAR_LAT, lon: NEAR_LON,
  } as any);

  // Field officer for tenant A
  const roleId = await ensureRole("polling-agent-supervisor", "Polling Agent Supervisor", 5);
  const clerkId = `trk-officer-${UNIQ}`;
  const [u] = await db.insert(usersTable).values({
    clerkId, email: `${clerkId}@test.local`, fullName: clerkId, status: "active",
    isGlobalAdmin: false, activeTenantId: tenantA, phoneNumber: "+254700000001",
  } as any).returning();
  officerUserId = u.id;
  await db.insert(userRolesTable).values({ userId: officerUserId, roleId, tenantId: tenantA } as any);
});

afterAll(async () => {
  await db.delete(agentTrackingAlertsTable).where(inArray(agentTrackingAlertsTable.tenantId, [tenantA, tenantB]));
  await db.delete(agentLocationPingsTable).where(inArray(agentLocationPingsTable.tenantId, [tenantA, tenantB]));
  await db.delete(pollingAgentsTable).where(inArray(pollingAgentsTable.tenantId, [tenantA, tenantB]));
  await db.delete(userRolesTable).where(eq(userRolesTable.userId, officerUserId));
  await db.delete(usersTable).where(eq(usersTable.id, officerUserId));
  await db.delete(pollingStationsTable).where(eq(pollingStationsTable.id, stationId));
  await db.delete(pollingCentresTable).where(eq(pollingCentresTable.id, centreId));
  await db.delete(wardsTable).where(eq(wardsTable.id, wardId));
  await db.delete(constituenciesTable).where(eq(constituenciesTable.id, constituencyId));
  await db.delete(countiesTable).where(eq(countiesTable.id, countyId));
  await db.delete(electionsTable).where(inArray(electionsTable.tenantId, [tenantA, tenantB]));
  await db.delete(tenantsTable).where(inArray(tenantsTable.id, [tenantA, tenantB]));
  if (insertedRoleIds.length) await db.delete(rolesTable).where(inArray(rolesTable.id, insertedRoleIds));
});

describe("derivePresence boundaries", () => {
  const now = new Date("2026-08-10T12:00:00Z");
  const fresh = new Date(now.getTime() - 5 * 60_000);
  const stale = new Date(now.getTime() - STALE_AFTER_MS - 60_000);

  it("unassigned when the agent has no station", () => {
    expect(derivePresence({ hasAssignedStation: false, lastPingAt: fresh, distanceM: 10, now })).toBe("unassigned");
  });
  it("missing when the agent has never pinged", () => {
    expect(derivePresence({ hasAssignedStation: true, lastPingAt: null, distanceM: null, now })).toBe("missing");
  });
  it("missing once the latest ping is older than the stale window", () => {
    expect(derivePresence({ hasAssignedStation: true, lastPingAt: stale, distanceM: 5, now })).toBe("missing");
  });
  it("missing at exactly the stale window (inclusive boundary)", () => {
    const exact = new Date(now.getTime() - STALE_AFTER_MS);
    expect(derivePresence({ hasAssignedStation: true, lastPingAt: exact, distanceM: 5, now })).toBe("missing");
    const justInside = new Date(now.getTime() - STALE_AFTER_MS + 1000);
    expect(derivePresence({ hasAssignedStation: true, lastPingAt: justInside, distanceM: 5, now })).toBe("on_station");
  });
  it("no_station_gps when pinging but the station lacks coordinates", () => {
    expect(derivePresence({ hasAssignedStation: true, lastPingAt: fresh, distanceM: null, now })).toBe("no_station_gps");
  });
  it("on_station at exactly the geofence radius", () => {
    expect(derivePresence({ hasAssignedStation: true, lastPingAt: fresh, distanceM: ON_STATION_RADIUS_M, now })).toBe("on_station");
  });
  it("nearby just outside the geofence and at the outer radius", () => {
    expect(derivePresence({ hasAssignedStation: true, lastPingAt: fresh, distanceM: ON_STATION_RADIUS_M + 1, now })).toBe("nearby");
    expect(derivePresence({ hasAssignedStation: true, lastPingAt: fresh, distanceM: NEARBY_RADIUS_M, now })).toBe("nearby");
  });
  it("away beyond the outer radius", () => {
    expect(derivePresence({ hasAssignedStation: true, lastPingAt: fresh, distanceM: NEARBY_RADIUS_M + 1, now })).toBe("away");
  });
});

describe("recordHeartbeat", () => {
  it("persists the ping, resolves the active election, and reports on-station", async () => {
    const res = await recordHeartbeat({
      tenantId: tenantA, agentId: agentHeartbeatTarget, lat: NEAR_LAT, lon: NEAR_LON, accuracyM: 12,
    });
    expect(res.status).toBe("on_station");
    expect(res.distanceM).toBeLessThanOrEqual(150);
    expect(res.stationName).toContain("Tracking Station");

    const pings = await db.select().from(agentLocationPingsTable)
      .where(and(eq(agentLocationPingsTable.agentId, agentHeartbeatTarget)));
    expect(pings).toHaveLength(1);
    expect(pings[0].electionId).toBe(electionA); // active election resolved server-side
    expect(pings[0].accuracyM).toBe(12);
  });

  it("a backdated heartbeat derives as missing (late sync doesn't fake presence)", async () => {
    const res = await recordHeartbeat({
      tenantId: tenantA, agentId: agentHeartbeatTarget,
      lat: NEAR_LAT, lon: NEAR_LON,
      recordedAt: new Date(Date.now() - 20 * 60_000),
    });
    expect(res.status).toBe("missing");
  });

  it("clamps future-dated client timestamps to server time", async () => {
    const res = await recordHeartbeat({
      tenantId: tenantA, agentId: agentHeartbeatTarget,
      lat: NEAR_LAT, lon: NEAR_LON,
      recordedAt: new Date(Date.now() + 60 * 60_000), // 1h in the future
    });
    expect(res.status).toBe("on_station"); // clamped → still fresh
    // The response exposes the EFFECTIVE timestamp — it must be the clamped
    // server time, not the client's future value.
    expect(new Date(res.recordedAt).getTime()).toBeLessThanOrEqual(Date.now() + 5_000);
    const pings = await db.select().from(agentLocationPingsTable)
      .where(eq(agentLocationPingsTable.agentId, agentHeartbeatTarget));
    const latest = pings.reduce((a, b) => (a.recordedAt > b.recordedAt ? a : b));
    expect(latest.recordedAt.getTime()).toBeLessThanOrEqual(Date.now() + 5_000);
  });

  it("ignores a client-supplied electionId belonging to another tenant", async () => {
    await recordHeartbeat({
      tenantId: tenantA, agentId: agentHeartbeatTarget,
      lat: NEAR_LAT, lon: NEAR_LON, electionId: electionB,
    });
    const pings = await db.select().from(agentLocationPingsTable)
      .where(eq(agentLocationPingsTable.agentId, agentHeartbeatTarget));
    expect(pings.every((p) => p.electionId !== electionB)).toBe(true);
    expect(pings[pings.length - 1].electionId).toBe(electionA); // fell back to own active election
  });
});

describe("getLiveAgentTracking", () => {
  it("returns assigned agents of the tenant with derived statuses, excluding other tenants", async () => {
    const live = await getLiveAgentTracking(tenantA);
    const ids = live.map((a) => a.agentId);

    expect(ids).toContain(agentOnStation);
    expect(ids).toContain(agentSilent);
    expect(ids).toContain(agentHeartbeatTarget);
    expect(ids).not.toContain(agentUnassigned);   // no station → not geofenceable
    expect(ids).not.toContain(agentOtherTenant);  // tenant isolation

    const onStation = live.find((a) => a.agentId === agentOnStation)!;
    expect(onStation.status).toBe("on_station");
    expect(onStation.distanceM).toBeLessThanOrEqual(150);
    expect(onStation.stationLat).toBe(STATION_LAT);

    const silent = live.find((a) => a.agentId === agentSilent)!;
    expect(silent.status).toBe("missing");
    expect(silent.lastPingAt).toBeNull();
  });
});

describe("runTrackingSweep", () => {
  it("claims atomically — concurrent sweeps alert exactly once", async () => {
    sendWhatsappChannel.mockClear();
    const [a, b] = await Promise.all([runTrackingSweep(), runTrackingSweep()]);
    expect(a.alertsSent + b.alertsSent).toBeGreaterThanOrEqual(1);

    const calls = sendWhatsappChannel.mock.calls.filter((c) => c[0] === tenantA);
    const silentAlerts = calls.filter((c) => String(c[2]).includes(`Agent Silent ${UNIQ}`));
    expect(silentAlerts).toHaveLength(1);
    expect(silentAlerts[0][1]).toBe("+254700000001");
    // The on-station agent must NOT trigger an alert
    expect(calls.some((c) => String(c[2]).includes(`Agent OnStation ${UNIQ}`))).toBe(false);

    const rows = await db.select().from(agentTrackingAlertsTable)
      .where(and(eq(agentTrackingAlertsTable.tenantId, tenantA), eq(agentTrackingAlertsTable.agentId, agentSilent)));
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("missing");
  });

  it("respects the cooldown on subsequent sweeps", async () => {
    const countBefore = sendWhatsappChannel.mock.calls.length;
    const second = await runTrackingSweep();
    expect(sendWhatsappChannel.mock.calls.length).toBe(countBefore);
    expect(second.alertsSent).toBe(0);

    const rows = await db.select().from(agentTrackingAlertsTable)
      .where(and(eq(agentTrackingAlertsTable.tenantId, tenantA), eq(agentTrackingAlertsTable.agentId, agentSilent)));
    expect(rows).toHaveLength(1);
  });

  it("rolls back the claim when every send fails, then retries on the next sweep", async () => {
    const throwaway = await makeAgent(tenantA, "Throwaway", stationId);
    sendWhatsappChannel.mockClear();
    sendWhatsappChannel.mockImplementation(() => Promise.reject(new Error("provider down")));
    await runTrackingSweep();
    let rows = await db.select().from(agentTrackingAlertsTable)
      .where(and(eq(agentTrackingAlertsTable.tenantId, tenantA), eq(agentTrackingAlertsTable.agentId, throwaway)));
    expect(rows).toHaveLength(0); // total failure → claim rolled back, not burned

    sendWhatsappChannel.mockImplementation(async () => ({ ok: true as const }));
    sendWhatsappChannel.mockClear(); // drop the rejected attempt from the call log
    await runTrackingSweep();
    rows = await db.select().from(agentTrackingAlertsTable)
      .where(and(eq(agentTrackingAlertsTable.tenantId, tenantA), eq(agentTrackingAlertsTable.agentId, throwaway)));
    expect(rows).toHaveLength(1);
    expect(sendWhatsappChannel.mock.calls.filter((c) => String(c[2]).includes(`Agent Throwaway ${UNIQ}`))).toHaveLength(1);
  });

  it("does not alert for tenants without an active election", async () => {
    sendWhatsappChannel.mockClear();
    // Tenant B has a silent assigned agent but no ACTIVE election
    await runTrackingSweep();
    expect(sendWhatsappChannel.mock.calls.some((c) => c[0] === tenantB)).toBe(false);
  });
});
