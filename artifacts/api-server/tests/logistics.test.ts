/**
 * Logistics module — vehicles, transport assignments, agent check-ins with
 * geofence validation, security incidents + escalation, panic button flow,
 * and command-center aggregates. Runs against the dev DB with real fixtures.
 *
 * Run: pnpm --filter @workspace/api-server exec vitest run tests/logistics.test.ts
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import { randomUUID } from "node:crypto";

let currentClerkId = "log-none";
vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: any, _res: any, next: any) => next(),
  getAuth: () => ({ userId: currentClerkId }),
}));
vi.mock("../src/middlewares/rbac", () => ({
  requireRoles: () => (_req: any, _res: any, next: any) => next(),
  requireLevel: () => (_req: any, _res: any, next: any) => next(),
  requireCountyOrAbove: (_req: any, _res: any, next: any) => next(),
  resolveActor: (_req: any, _res: any, next: any) => next(),
  bustActorCache: vi.fn(),
}));
// Never send real WhatsApp messages from tests.
vi.mock("../src/lib/whatsapp", () => ({ sendWhatsAppText: vi.fn(async () => ({ ok: true })) }));

import { db } from "@workspace/db";
import {
  tenantsTable,
  usersTable,
  userRolesTable,
  rolesTable,
  electionsTable,
  countiesTable,
  constituenciesTable,
  wardsTable,
  pollingCentresTable,
  pollingStationsTable,
  pollingAgentsTable,
  vehiclesTable,
  transportAssignmentsTable,
  agentCheckInsTable,
  securityIncidentsTable,
  panicAlertsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { resolveTenantOptional } from "../src/middlewares/resolveTenant";
import logisticsRouter, { haversineMeters } from "../src/routes/logistics";

const ts = randomUUID().slice(0, 8);
const MGR_CLERK = `log-mgr-${ts}`;
const AGENT_CLERK = `log-agent-${ts}`;
const UNLINKED_CLERK = `log-unlinked-${ts}`;
const OTHER_CLERK = `log-other-${ts}`;
const NOROLE_CLERK = `log-norole-${ts}`;

let tenantA: string, tenantB: string;
let electionId: string;
let stationId: string;
let station2Id: string;
let vehicleId: string;
let assignmentId: string;
let incidentId: string;
let panicId: string;

const tenantIds: string[] = [];
const userIds: string[] = [];
const roleIds: string[] = [];
let countyId: string, conId: string, wardId: string, centreId: string;

let app: express.Express;

beforeAll(async () => {
  // Tenants
  const [ta] = await db.insert(tenantsTable).values({ name: `Log A ${ts}`, slug: `log-a-${ts}`, plan: "free", seatType: "presidential" } as any).returning();
  const [tb] = await db.insert(tenantsTable).values({ name: `Log B ${ts}`, slug: `log-b-${ts}`, plan: "free", seatType: "presidential" } as any).returning();
  tenantA = ta.id; tenantB = tb.id; tenantIds.push(ta.id, tb.id);

  // Role + members
  let [role] = await db.select().from(rolesTable).where(eq(rolesTable.slug, "county-coordinator")).limit(1);
  if (!role) { [role] = await db.insert(rolesTable).values({ slug: "county-coordinator", name: "county-coordinator", level: 3 } as any).returning(); roleIds.push(role.id); }
  const mk = async (clerkId: string, tenantId: string) => {
    const [u] = await db.insert(usersTable).values({ clerkId, email: `${clerkId}@test.local`, fullName: clerkId, status: "active", isGlobalAdmin: false, activeTenantId: tenantId } as any).returning();
    userIds.push(u.id);
    await db.insert(userRolesTable).values({ userId: u.id, roleId: role.id, tenantId } as any);
    return u.id;
  };
  await mk(MGR_CLERK, tenantA);
  const agentUserId = await mk(AGENT_CLERK, tenantA);
  await mk(UNLINKED_CLERK, tenantA);
  await mk(OTHER_CLERK, tenantB);
  // Member of tenant A with NO role and NO agent record — must not report incidents.
  const [noRoleUser] = await db.insert(usersTable).values({
    clerkId: NOROLE_CLERK, email: `${NOROLE_CLERK}@test.local`, fullName: NOROLE_CLERK,
    status: "active", isGlobalAdmin: false, activeTenantId: tenantA,
  } as any).returning();
  userIds.push(noRoleUser.id);

  // Geography (global, shared) — station at a known Nairobi coordinate
  const codeBase = 900000 + Math.floor(Math.random() * 99999);
  const [c] = await db.insert(countiesTable).values({ code: codeBase, name: `Log County ${ts}`, registeredVoters: 5000 } as any).returning();
  countyId = c.id;
  const [con] = await db.insert(constituenciesTable).values({ code: codeBase + 1, name: `Log Con ${ts}`, countyId, registeredVoters: 5000 } as any).returning();
  conId = con.id;
  const [w] = await db.insert(wardsTable).values({ code: codeBase + 2, name: `Log Ward ${ts}`, constituencyId: conId, countyId, registeredVoters: 5000 } as any).returning();
  wardId = w.id;
  const [centre] = await db.insert(pollingCentresTable).values({ name: `Log Centre ${ts}`, wardId, constituencyId: conId, countyId } as any).returning();
  centreId = centre.id;
  const [s] = await db.insert(pollingStationsTable).values({
    code: `LOG-${codeBase}-${ts}`, name: `Log Station ${ts}`, centreId, wardId, constituencyId: conId, countyId,
    registeredVoters: 500, latitude: -1.2921, longitude: 36.8219,
  } as any).returning();
  stationId = s.id;
  const [s2] = await db.insert(pollingStationsTable).values({
    code: `LOG2-${codeBase}-${ts}`, name: `Log Station 2 ${ts}`, centreId, wardId, constituencyId: conId, countyId,
    registeredVoters: 500, latitude: -1.1000, longitude: 36.9000,
  } as any).returning();
  station2Id = s2.id;

  // Election + linked agent
  const [el] = await db.insert(electionsTable).values({ tenantId: tenantA, name: `Logistics ${ts}`, year: 2027, electionDate: "2027-08-10" } as any).returning();
  electionId = el.id;
  await db.insert(pollingAgentsTable).values({
    tenantId: tenantA, userId: agentUserId, fullName: "Log Agent", phoneNumber: `+2547${Math.floor(Math.random() * 1e8)}`,
    pollingStationId: stationId, status: "active",
  } as any);

  app = express();
  app.use(express.json());
  app.use(resolveTenantOptional);
  app.use("/logistics", logisticsRouter);
});

afterAll(async () => {
  await db.delete(panicAlertsTable).where(inArray(panicAlertsTable.tenantId, tenantIds));
  await db.delete(securityIncidentsTable).where(inArray(securityIncidentsTable.tenantId, tenantIds));
  await db.delete(agentCheckInsTable).where(inArray(agentCheckInsTable.tenantId, tenantIds));
  await db.delete(transportAssignmentsTable).where(inArray(transportAssignmentsTable.tenantId, tenantIds));
  await db.delete(vehiclesTable).where(inArray(vehiclesTable.tenantId, tenantIds));
  await db.delete(pollingAgentsTable).where(inArray(pollingAgentsTable.tenantId, tenantIds));
  await db.delete(electionsTable).where(inArray(electionsTable.tenantId, tenantIds));
  await db.delete(pollingStationsTable).where(inArray(pollingStationsTable.id, [stationId, station2Id]));
  await db.delete(pollingCentresTable).where(eq(pollingCentresTable.id, centreId));
  await db.delete(wardsTable).where(eq(wardsTable.id, wardId));
  await db.delete(constituenciesTable).where(eq(constituenciesTable.id, conId));
  await db.delete(countiesTable).where(eq(countiesTable.id, countyId));
  await db.delete(userRolesTable).where(inArray(userRolesTable.userId, userIds));
  await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  if (roleIds.length) await db.delete(rolesTable).where(inArray(rolesTable.id, roleIds));
  await db.delete(tenantsTable).where(inArray(tenantsTable.id, tenantIds));
});

describe("haversine", () => {
  it("computes ~111km per degree of latitude", () => {
    expect(haversineMeters(0, 0, 1, 0)).toBeGreaterThan(110_000);
    expect(haversineMeters(0, 0, 1, 0)).toBeLessThan(112_000);
    expect(haversineMeters(-1.2921, 36.8219, -1.2921, 36.8219)).toBe(0);
  });
});

describe("vehicles", () => {
  it("creates, lists, patches a vehicle; rejects duplicates; isolates tenants", async () => {
    currentClerkId = MGR_CLERK;
    const create = await request(app).post("/logistics/vehicles").send({ registrationNumber: `KDJ${ts}`, vehicleType: "van", capacity: 8 });
    expect(create.status).toBe(201);
    vehicleId = create.body.id;

    const dup = await request(app).post("/logistics/vehicles").send({ registrationNumber: `KDJ${ts}` });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe("DUPLICATE_REGISTRATION");

    const list = await request(app).get("/logistics/vehicles");
    expect(list.body.some((v: any) => v.id === vehicleId)).toBe(true);

    const patch = await request(app).patch(`/logistics/vehicles/${vehicleId}`).send({ status: "maintenance" });
    expect(patch.body.status).toBe("maintenance");
    await request(app).patch(`/logistics/vehicles/${vehicleId}`).send({ status: "available" });

    currentClerkId = OTHER_CLERK;
    const otherList = await request(app).get("/logistics/vehicles");
    expect(otherList.body.some((v: any) => v.id === vehicleId)).toBe(false);
    const crossPatch = await request(app).patch(`/logistics/vehicles/${vehicleId}`).send({ status: "broken_down" });
    expect(crossPatch.status).toBe(404);
    currentClerkId = MGR_CLERK;
  });
});

describe("transport assignments", () => {
  it("creates, departs, arrives; guards invalid states and foreign agents", async () => {
    currentClerkId = MGR_CLERK;
    const [agent] = await db.select({ id: pollingAgentsTable.id }).from(pollingAgentsTable).where(eq(pollingAgentsTable.tenantId, tenantA));

    const badPassenger = await request(app).post("/logistics/transport-assignments")
      .send({ electionId, vehicleId, passengerAgentIds: [randomUUID()] });
    expect(badPassenger.status).toBe(400);
    expect(badPassenger.body.code).toBe("INVALID_AGENT");

    const create = await request(app).post("/logistics/transport-assignments")
      .send({ electionId, vehicleId, passengerAgentIds: [agent.id], originDescription: "HQ", destinationDescription: "Log Station" });
    expect(create.status).toBe(201);
    assignmentId = create.body.id;

    // Vehicle cannot be deleted while assignment is scheduled.
    const del = await request(app).delete(`/logistics/vehicles/${vehicleId}`);
    expect(del.status).toBe(409);
    expect(del.body.code).toBe("VEHICLE_IN_USE");

    const depart = await request(app).post(`/logistics/transport-assignments/${assignmentId}/depart`);
    expect(depart.status).toBe(200);
    expect(depart.body.status).toBe("en_route"); // no planned departure → not delayed

    const departAgain = await request(app).post(`/logistics/transport-assignments/${assignmentId}/depart`);
    expect(departAgain.status).toBe(409);

    const arrive = await request(app).post(`/logistics/transport-assignments/${assignmentId}/arrive`);
    expect(arrive.status).toBe(200);
    expect(arrive.body.status).toBe("arrived");

    const editClosed = await request(app).patch(`/logistics/transport-assignments/${assignmentId}`).send({ originDescription: "X" });
    expect(editClosed.status).toBe(409);

    // Vehicle freed after arrival.
    const del2 = await request(app).delete(`/logistics/vehicles/${vehicleId}`);
    expect(del2.status).toBe(200);
    // Recreate for later tests that don't need it — keep suite independent.
    const recreate = await request(app).post("/logistics/vehicles").send({ registrationNumber: `KDJ${ts}` });
    vehicleId = recreate.body.id;
  });
});

describe("agent check-ins + geofence", () => {
  it("accepts in-geofence check-ins, flags out-of-geofence, rejects unlinked users", async () => {
    currentClerkId = AGENT_CLERK;
    // ~55m north of the station → inside the 200m geofence
    const near = await request(app).post("/logistics/check-ins")
      .send({ electionId, checkInType: "arrival", gpsLat: -1.2916, gpsLon: 36.8219, source: "pwa" });
    expect(near.status).toBe(201);
    expect(near.body.isWithinGeofence).toBe(true);
    expect(near.body.distanceFromStation).toBeLessThan(200);
    expect(near.body.pollingStationId).toBe(stationId); // defaults to assigned station

    // ~2.2km away → outside geofence, still accepted
    const far = await request(app).post("/logistics/check-ins")
      .send({ electionId, checkInType: "setup_complete", gpsLat: -1.2721, gpsLon: 36.8219 });
    expect(far.status).toBe(201);
    expect(far.body.isWithinGeofence).toBe(false);

    currentClerkId = UNLINKED_CLERK;
    const unlinked = await request(app).post("/logistics/check-ins").send({ electionId, checkInType: "arrival" });
    expect(unlinked.status).toBe(403);
    expect(unlinked.body.code).toBe("AGENT_UNLINKED");

    currentClerkId = MGR_CLERK;
    const list = await request(app).get(`/logistics/check-ins?electionId=${electionId}`);
    expect(list.body.length).toBe(2);

    const missing = await request(app).get(`/logistics/check-ins/missing?electionId=${electionId}&checkInType=voting_ended`);
    expect(missing.body.some((m: any) => m.fullName === "Log Agent")).toBe(true);

    const summary = await request(app).get(`/logistics/check-ins/status-summary?electionId=${electionId}`);
    expect(summary.body.distinctAgentsCheckedIn).toBe(1);
    expect(summary.body.byType.some((r: any) => r.checkInType === "arrival" && r.count === 1)).toBe(true);
  });
});

describe("security incidents + escalation", () => {
  it("creates (agent-linked), escalates up the chain, resolves, then refuses", async () => {
    currentClerkId = AGENT_CLERK;
    const create = await request(app).post("/logistics/security-incidents")
      .send({ electionId, incidentType: "intimidation", severity: "high", title: "Agent harassed at gate", pollingStationId: stationId });
    expect(create.status).toBe(201);
    expect(create.body.reportedByAgentId).toBeTruthy();
    incidentId = create.body.id;

    currentClerkId = MGR_CLERK;
    const esc1 = await request(app).post(`/logistics/security-incidents/${incidentId}/escalate`);
    expect(esc1.body.escalationLevel).toBe(2);
    expect(esc1.body.status).toBe("escalated");
    const esc2 = await request(app).post(`/logistics/security-incidents/${incidentId}/escalate`);
    expect(esc2.body.escalationLevel).toBe(3);

    const resolve = await request(app).patch(`/logistics/security-incidents/${incidentId}`)
      .send({ status: "resolved", resolutionNotes: "Officers dispatched" });
    expect(resolve.body.status).toBe("resolved");
    expect(resolve.body.resolvedAt).toBeTruthy();

    const escClosed = await request(app).post(`/logistics/security-incidents/${incidentId}/escalate`);
    expect(escClosed.status).toBe(409);

    // Tenant isolation
    currentClerkId = OTHER_CLERK;
    const cross = await request(app).patch(`/logistics/security-incidents/${incidentId}`).send({ status: "verified" });
    expect(cross.status).toBe(404);
    currentClerkId = MGR_CLERK;
  });
});

describe("panic button", () => {
  it("creates panic + critical incident; acknowledge and resolve propagate", async () => {
    currentClerkId = AGENT_CLERK;
    const panic = await request(app).post("/logistics/panic")
      .send({ electionId, gpsLat: -1.2921, gpsLon: 36.8219 });
    expect(panic.status).toBe(201);
    panicId = panic.body.panicAlert.id;
    expect(panic.body.panicAlert.status).toBe("active");
    expect(panic.body.incident.isPanicButton).toBe(true);
    expect(panic.body.incident.severity).toBe("critical");

    currentClerkId = MGR_CLERK;
    const list = await request(app).get(`/logistics/panic?electionId=${electionId}&status=active`);
    expect(list.body.length).toBe(1);
    expect(list.body[0].agentName).toBe("Log Agent");

    const ack = await request(app).post(`/logistics/panic/${panicId}/acknowledge`);
    expect(ack.body.status).toBe("acknowledged");

    const resolve = await request(app).post(`/logistics/panic/${panicId}/resolve`).send({ notes: "Agent safe" });
    expect(resolve.body.status).toBe("resolved");

    const [incident] = await db.select().from(securityIncidentsTable).where(eq(securityIncidentsTable.id, panic.body.incident.id));
    expect(incident.status).toBe("resolved");

    const resolveAgain = await request(app).post(`/logistics/panic/${panicId}/resolve`).send({});
    expect(resolveAgain.status).toBe(409);
  });
});

describe("command center", () => {
  it("aggregates overview stats and serves the live map", async () => {
    currentClerkId = MGR_CLERK;
    const overview = await request(app).get(`/logistics/command-center/overview?electionId=${electionId}`);
    expect(overview.status).toBe(200);
    expect(overview.body.totalAgents).toBe(1);
    expect(overview.body.checkedInAgents).toBe(1);
    expect(overview.body.checkedInPct).toBe(100);
    expect(overview.body.activePanicAlerts).toBe(0);
    expect(overview.body.activeIncidents).toBe(0);

    const map = await request(app).get(`/logistics/command-center/live-map?electionId=${electionId}`);
    expect(map.status).toBe(200);
    expect(map.body.agents.length).toBe(1);
    expect(map.body.agents[0].agentName).toBe("Log Agent");

    const noElection = await request(app).get(`/logistics/command-center/overview`);
    expect(noElection.status).toBe(400);
  });
});

describe("transport lifecycle hardening", () => {
  it("auto-delayed assignments can still depart; undeparted delayed assignments cannot arrive; vehicle stays deployed while another assignment is active", async () => {
    currentClerkId = MGR_CLERK;
    const past = new Date(Date.now() - 60 * 60_000).toISOString();

    // A + B share the same vehicle.
    const mk = (extra: Record<string, any> = {}) =>
      request(app).post("/logistics/transport-assignments").send({ electionId, vehicleId, ...extra });
    const a = await mk({ plannedDepartureAt: past });
    const b = await mk({});
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);

    // Simulate the monitor flagging A as delayed without a departure.
    await db.update(transportAssignmentsTable).set({ status: "delayed" })
      .where(eq(transportAssignmentsTable.id, a.body.id));

    // Delayed-but-never-departed cannot arrive.
    const earlyArrive = await request(app).post(`/logistics/transport-assignments/${a.body.id}/arrive`);
    expect(earlyArrive.status).toBe(409);

    // A delayed assignment CAN still depart (late departure recorded, stays delayed).
    const depart = await request(app).post(`/logistics/transport-assignments/${a.body.id}/depart`);
    expect(depart.status).toBe(200);
    expect(depart.body.status).toBe("delayed");

    // Second depart is rejected (timestamp already recorded).
    const depart2 = await request(app).post(`/logistics/transport-assignments/${a.body.id}/depart`);
    expect(depart2.status).toBe(409);

    // Arriving A does NOT free the vehicle — B is still scheduled on it.
    await request(app).post(`/logistics/transport-assignments/${a.body.id}/arrive`);
    const [v] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, vehicleId));
    expect(v.status).toBe("deployed");

    // Depart + arrive B → vehicle finally freed.
    await request(app).post(`/logistics/transport-assignments/${b.body.id}/depart`);
    await request(app).post(`/logistics/transport-assignments/${b.body.id}/arrive`);
    const [v2] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, vehicleId));
    expect(v2.status).toBe("available");
  });

  it("concurrent arrivals on the same vehicle serialize and free it exactly once", async () => {
    currentClerkId = MGR_CLERK;
    const mk = () => request(app).post("/logistics/transport-assignments").send({ electionId, vehicleId });
    const a = await mk();
    const b = await mk();
    await request(app).post(`/logistics/transport-assignments/${a.body.id}/depart`);
    await request(app).post(`/logistics/transport-assignments/${b.body.id}/depart`);

    // Fire both arrivals in parallel — the vehicle-row lock must serialize them.
    const [ra, rb] = await Promise.all([
      request(app).post(`/logistics/transport-assignments/${a.body.id}/arrive`),
      request(app).post(`/logistics/transport-assignments/${b.body.id}/arrive`),
    ]);
    expect(ra.status).toBe(200);
    expect(rb.status).toBe(200);
    const [v] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, vehicleId));
    expect(v.status).toBe("available"); // freed exactly once, not stuck deployed
  });
});

describe("panic pair identity", () => {
  it("two concurrent panics from one agent stay independently paired to their incidents", async () => {
    currentClerkId = AGENT_CLERK;
    const p1 = await request(app).post("/logistics/panic").send({ electionId, gpsLat: -1.2921, gpsLon: 36.8219 });
    const p2 = await request(app).post("/logistics/panic").send({ electionId, gpsLat: -1.2921, gpsLon: 36.8219 });
    expect(p1.status).toBe(201);
    expect(p2.status).toBe(201);
    const inc1 = p1.body.incident.id, inc2 = p2.body.incident.id;
    expect(inc1).not.toBe(inc2);
    expect(p1.body.panicAlert.incidentId).toBe(inc1);
    expect(p2.body.panicAlert.incidentId).toBe(inc2);

    currentClerkId = MGR_CLERK;
    await request(app).post(`/logistics/panic/${p1.body.panicAlert.id}/acknowledge`);
    const [i1] = await db.select().from(securityIncidentsTable).where(eq(securityIncidentsTable.id, inc1));
    const [i2] = await db.select().from(securityIncidentsTable).where(eq(securityIncidentsTable.id, inc2));
    expect(i1.status).toBe("verified");
    expect(i2.status).toBe("reported"); // untouched — exactly-one pairing

    await request(app).post(`/logistics/panic/${p2.body.panicAlert.id}/resolve`).send({ notes: "safe" });
    const [i2b] = await db.select().from(securityIncidentsTable).where(eq(securityIncidentsTable.id, inc2));
    const [i1b] = await db.select().from(securityIncidentsTable).where(eq(securityIncidentsTable.id, inc1));
    expect(i2b.status).toBe("resolved");
    expect(i1b.status).toBe("verified");

    // Close p1 so suite-level aggregates stay deterministic.
    await request(app).post(`/logistics/panic/${p1.body.panicAlert.id}/resolve`).send({});
  });
});

describe("authorization hardening", () => {
  it("rejects incident reports from members with no role and no agent link", async () => {
    currentClerkId = NOROLE_CLERK;
    const res = await request(app).post("/logistics/security-incidents")
      .send({ electionId, incidentType: "other", severity: "low", title: "Should be blocked" });
    // Blocked either at tenant resolution (no role → no tenant context → 409
    // NO_CAMPAIGN_SELECTED) or at the agent-or-staff guard (403).
    expect([403, 409]).toContain(res.status);
    expect(["NOT_FIELD_STAFF", "NO_CAMPAIGN_SELECTED"]).toContain(res.body.code);
    currentClerkId = MGR_CLERK;
  });

  it("pins assigned agents to their own station for check-ins", async () => {
    currentClerkId = AGENT_CLERK;
    // Agent tries to check in at station 2 (far away) while assigned to station 1.
    const res = await request(app).post("/logistics/check-ins")
      .send({ electionId, checkInType: "departure", pollingStationId: station2Id, gpsLat: -1.2916, gpsLon: 36.8219 });
    expect(res.status).toBe(201);
    expect(res.body.pollingStationId).toBe(stationId); // forced to assigned station
    expect(res.body.isWithinGeofence).toBe(true); // measured against station 1, where the GPS actually is
    currentClerkId = MGR_CLERK;
  });
});
