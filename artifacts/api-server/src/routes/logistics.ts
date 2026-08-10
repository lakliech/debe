/**
 * Logistics API — Election Day Logistics & Security Command Center.
 *
 * Vehicle fleet + transport plans, milestone agent check-ins with geofence
 * validation, typed security incidents with a 5-level escalation chain, panic
 * button alerts, and the aggregated command-center views (overview, live map,
 * SSE alerts feed). All routes are tenant-scoped via withTenant().
 *
 * The alerts feed is implemented as a poll-based SSE stream (DB cursor every
 * 5s) rather than an in-process event bus so it stays correct if the API ever
 * runs more than one replica.
 */
import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  vehiclesTable,
  transportAssignmentsTable,
  agentCheckInsTable,
  securityIncidentsTable,
  panicAlertsTable,
  pollingAgentsTable,
  usersTable,
  userRolesTable,
  rolesTable,
  electionsTable,
  pollingStationsTable,
  tenantsTable,
} from "@workspace/db";
import { eq, and, desc, sql, inArray, gte, isNull, isNotNull, ne } from "drizzle-orm";
import { requireRoles, requireCountyOrAbove } from "../middlewares/rbac";
import { tenantFilter, assertTenant } from "../lib/withTenant";
import { sendRouteError } from "../lib/routeError";
import { validate } from "../lib/validate";
import { sendWhatsAppText } from "../lib/whatsapp";
import { logger } from "../lib/logger";
import { z } from "zod";

const router = Router();

/** Geofence radius for station check-ins (metres). */
const GEOFENCE_RADIUS_M = 200;

function requireAuth(req: any, res: any, next: any) {
  const auth = getAuth(req);
  if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
  req.clerkId = auth.userId;
  next();
}

/** Logistics managers: county coordinator and above (RBAC levels 1-3). */
const canManageLogistics = requireCountyOrAbove;
/** Field agents who can check in / trigger panic. */
const agentRoles = requireRoles(["polling-agent", "backup-polling-agent"]);

/**
 * Incident reports come from linked agents OR any member with a tenant role
 * (coordinators, managers). Bare-authenticated users with no link get 403 —
 * otherwise anyone with an account could flood the command center.
 */
async function requireAgentOrStaff(req: any, res: any, next: any) {
  try {
    const t = assertTenant(req);
    const agent = await resolveAgent(req.clerkId, t.id);
    if (agent) { req.logisticsAgent = agent; return next(); }
    const [membership] = await db.select({ id: userRolesTable.id })
      .from(userRolesTable)
      .innerJoin(usersTable, eq(userRolesTable.userId, usersTable.id))
      .where(and(eq(userRolesTable.tenantId, t.id), eq(usersTable.clerkId, req.clerkId)))
      .limit(1);
    if (membership) return next();
    return res.status(403).json({ code: "NOT_FIELD_STAFF", error: "Only linked agents or campaign staff can report incidents." });
  } catch (err) { sendRouteError(res, err); }
}

/** Resolve the caller's polling-agent record for this tenant (null if unlinked). */
async function resolveAgent(clerkId: string, tenantId: string): Promise<{ id: string; pollingStationId: string | null; fullName: string; phoneNumber: string } | null> {
  const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.clerkId, clerkId));
  if (!user) return null;
  const [agent] = await db
    .select({ id: pollingAgentsTable.id, pollingStationId: pollingAgentsTable.pollingStationId, fullName: pollingAgentsTable.fullName, phoneNumber: pollingAgentsTable.phoneNumber })
    .from(pollingAgentsTable)
    .where(and(eq(pollingAgentsTable.userId, user.id), tenantFilter(pollingAgentsTable, tenantId)));
  return agent ?? null;
}

/** Great-circle distance in metres between two lat/lon points. */
export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** 404 unless the election belongs to this tenant. */
async function assertElection(tenantId: string, electionId: string) {
  const [election] = await db.select({ id: electionsTable.id }).from(electionsTable)
    .where(and(eq(electionsTable.id, electionId), tenantFilter(electionsTable, tenantId)));
  return election ?? null;
}

const uuidField = z.string().uuid();
const gpsFields = {
  gpsLat: z.number().min(-90).max(90).optional(),
  gpsLon: z.number().min(-180).max(180).optional(),
};

// ─── VEHICLES ───────────────────────────────────────────────────────────────

const createVehicleSchema = z.object({
  registrationNumber: z.string().trim().min(2).max(30),
  make: z.string().trim().max(100).optional(),
  model: z.string().trim().max(100).optional(),
  capacity: z.number().int().min(1).max(200).optional(),
  vehicleType: z.enum(["car", "van", "bus", "motorbike", "truck"]).optional(),
  assignedDriverId: z.string().max(100).optional(),
  assignedCountyId: uuidField.optional(),
  assignedConstituencyId: uuidField.optional(),
  gpsDeviceId: z.string().max(100).optional(),
  fuelCapacityLiters: z.number().min(0).optional(),
  currentFuelLevel: z.number().min(0).optional(),
});
const patchVehicleSchema = createVehicleSchema.partial().extend({
  status: z.enum(["available", "deployed", "maintenance", "broken_down"]).optional(),
});

router.get("/vehicles", requireAuth, canManageLogistics, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const conditions = [tenantFilter(vehiclesTable, t.id)];
    if (req.query.status) conditions.push(eq(vehiclesTable.status, String(req.query.status)));
    if (req.query.countyId) conditions.push(eq(vehiclesTable.assignedCountyId, String(req.query.countyId)));
    const rows = await db.select().from(vehiclesTable).where(and(...conditions)).orderBy(vehiclesTable.registrationNumber);
    res.json(rows);
  } catch (err) { sendRouteError(res, err); }
});

router.post("/vehicles", requireAuth, canManageLogistics, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const parsed = validate(createVehicleSchema, req.body, res);
    if (!parsed) return;
    // Registration numbers are unique per campaign (app-level guard).
    const [dup] = await db.select({ id: vehiclesTable.id }).from(vehiclesTable)
      .where(and(tenantFilter(vehiclesTable, t.id), eq(vehiclesTable.registrationNumber, parsed.registrationNumber)));
    if (dup) return res.status(409).json({ code: "DUPLICATE_REGISTRATION", error: "A vehicle with this registration number already exists." });
    const [row] = await db.insert(vehiclesTable).values({ tenantId: t.id, ...parsed }).returning();
    res.status(201).json(row);
  } catch (err) { sendRouteError(res, err); }
});

router.patch("/vehicles/:id", requireAuth, canManageLogistics, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const parsed = validate(patchVehicleSchema, req.body, res);
    if (!parsed) return;
    const [row] = await db.update(vehiclesTable).set(parsed)
      .where(and(eq(vehiclesTable.id, req.params.id), tenantFilter(vehiclesTable, t.id)))
      .returning();
    if (!row) return res.status(404).json({ error: "Vehicle not found" });
    res.json(row);
  } catch (err) { sendRouteError(res, err); }
});

const vehicleGpsSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  at: z.string().datetime({ offset: true }).optional(),
});

router.patch("/vehicles/:id/gps", requireAuth, canManageLogistics, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const parsed = validate(vehicleGpsSchema, req.body, res);
    if (!parsed) return;
    const [row] = await db.update(vehiclesTable)
      .set({ lastGpsLat: parsed.lat, lastGpsLon: parsed.lon, lastGpsAt: parsed.at ? new Date(parsed.at) : new Date() })
      .where(and(eq(vehiclesTable.id, req.params.id), tenantFilter(vehiclesTable, t.id)))
      .returning({ id: vehiclesTable.id });
    if (!row) return res.status(404).json({ error: "Vehicle not found" });
    res.json({ ok: true });
  } catch (err) { sendRouteError(res, err); }
});

router.delete("/vehicles/:id", requireAuth, canManageLogistics, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    // Block deletion while the vehicle has live transport plans.
    const [active] = await db.select({ id: transportAssignmentsTable.id }).from(transportAssignmentsTable)
      .where(and(
        tenantFilter(transportAssignmentsTable, t.id),
        eq(transportAssignmentsTable.vehicleId, req.params.id),
        inArray(transportAssignmentsTable.status, ["scheduled", "en_route", "delayed"]),
      ));
    if (active) return res.status(409).json({ code: "VEHICLE_IN_USE", error: "Vehicle has active transport assignments." });
    const [row] = await db.delete(vehiclesTable)
      .where(and(eq(vehiclesTable.id, req.params.id), tenantFilter(vehiclesTable, t.id)))
      .returning({ id: vehiclesTable.id });
    if (!row) return res.status(404).json({ error: "Vehicle not found" });
    res.json({ ok: true });
  } catch (err) { sendRouteError(res, err); }
});

// ─── TRANSPORT ASSIGNMENTS ──────────────────────────────────────────────────

const createTransportSchema = z.object({
  electionId: uuidField,
  vehicleId: uuidField,
  driverId: z.string().max(100).optional(),
  originCountyId: uuidField.optional(),
  originDescription: z.string().max(500).optional(),
  destinationCountyId: uuidField.optional(),
  destinationDescription: z.string().max(500).optional(),
  passengerAgentIds: z.array(uuidField).max(100).optional(),
  plannedDepartureAt: z.string().datetime({ offset: true }).optional(),
  plannedArrivalAt: z.string().datetime({ offset: true }).optional(),
  fuelIssuedLiters: z.number().min(0).optional(),
  fuelCostKes: z.number().min(0).optional(),
});
const patchTransportSchema = createTransportSchema.partial().omit({ electionId: true, vehicleId: true });

router.get("/transport-assignments", requireAuth, canManageLogistics, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const conditions = [tenantFilter(transportAssignmentsTable, t.id)];
    if (req.query.electionId) conditions.push(eq(transportAssignmentsTable.electionId, String(req.query.electionId)));
    if (req.query.status) conditions.push(eq(transportAssignmentsTable.status, String(req.query.status)));
    const rows = await db
      .select({
        assignment: transportAssignmentsTable,
        vehicleRegistration: vehiclesTable.registrationNumber,
        vehicleType: vehiclesTable.vehicleType,
      })
      .from(transportAssignmentsTable)
      .leftJoin(vehiclesTable, eq(transportAssignmentsTable.vehicleId, vehiclesTable.id))
      .where(and(...conditions))
      .orderBy(desc(transportAssignmentsTable.plannedDepartureAt));
    res.json(rows.map((r) => ({ ...r.assignment, vehicleRegistration: r.vehicleRegistration, vehicleType: r.vehicleType })));
  } catch (err) { sendRouteError(res, err); }
});

router.post("/transport-assignments", requireAuth, canManageLogistics, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const parsed = validate(createTransportSchema, req.body, res);
    if (!parsed) return;
    if (!(await assertElection(t.id, parsed.electionId))) return res.status(404).json({ error: "Election not found" });
    const [vehicle] = await db.select({ id: vehiclesTable.id }).from(vehiclesTable)
      .where(and(eq(vehiclesTable.id, parsed.vehicleId), tenantFilter(vehiclesTable, t.id)));
    if (!vehicle) return res.status(404).json({ error: "Vehicle not found" });
    // Every passenger must be an agent of this campaign.
    const passengerIds = parsed.passengerAgentIds ?? [];
    if (passengerIds.length > 0) {
      const found = await db.select({ id: pollingAgentsTable.id }).from(pollingAgentsTable)
        .where(and(inArray(pollingAgentsTable.id, passengerIds), tenantFilter(pollingAgentsTable, t.id)));
      if (found.length !== passengerIds.length) {
        return res.status(400).json({ code: "INVALID_AGENT", error: "One or more passengers are not agents of this campaign." });
      }
    }
    const [row] = await db.insert(transportAssignmentsTable).values({
      tenantId: t.id,
      electionId: parsed.electionId,
      vehicleId: parsed.vehicleId,
      driverId: parsed.driverId,
      originCountyId: parsed.originCountyId,
      originDescription: parsed.originDescription,
      destinationCountyId: parsed.destinationCountyId,
      destinationDescription: parsed.destinationDescription,
      passengerAgentIds: passengerIds,
      plannedDepartureAt: parsed.plannedDepartureAt ? new Date(parsed.plannedDepartureAt) : undefined,
      plannedArrivalAt: parsed.plannedArrivalAt ? new Date(parsed.plannedArrivalAt) : undefined,
      fuelIssuedLiters: parsed.fuelIssuedLiters,
      fuelCostKes: parsed.fuelCostKes,
    }).returning();
    res.status(201).json(row);
  } catch (err) { sendRouteError(res, err); }
});

router.patch("/transport-assignments/:id", requireAuth, canManageLogistics, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const parsed = validate(patchTransportSchema, req.body, res);
    if (!parsed) return;
    const [existing] = await db.select({ status: transportAssignmentsTable.status }).from(transportAssignmentsTable)
      .where(and(eq(transportAssignmentsTable.id, req.params.id), tenantFilter(transportAssignmentsTable, t.id)));
    if (!existing) return res.status(404).json({ error: "Transport assignment not found" });
    if (existing.status === "arrived" || existing.status === "cancelled") {
      return res.status(409).json({ code: "ASSIGNMENT_CLOSED", error: `Cannot edit a ${existing.status} assignment.` });
    }
    const [row] = await db.update(transportAssignmentsTable).set({
      ...parsed,
      plannedDepartureAt: parsed.plannedDepartureAt ? new Date(parsed.plannedDepartureAt) : undefined,
      plannedArrivalAt: parsed.plannedArrivalAt ? new Date(parsed.plannedArrivalAt) : undefined,
    }).where(eq(transportAssignmentsTable.id, req.params.id)).returning();
    res.json(row);
  } catch (err) { sendRouteError(res, err); }
});

router.post("/transport-assignments/:id/depart", requireAuth, canManageLogistics, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    // Scheduled or auto-delayed (monitor flags overdue departures as delayed) —
    // either way the journey has not departed yet. Guarded on actualDepartureAt
    // so a duplicate depart can never overwrite the real timestamp.
    const row = await db.transaction(async (tx) => {
      // Lock the vehicle row first: every depart/arrive for this vehicle
      // serializes on this lock, so concurrent replicas can't race the
      // "is the vehicle still needed?" bookkeeping.
      const [a] = await tx.select({ vehicleId: transportAssignmentsTable.vehicleId })
        .from(transportAssignmentsTable)
        .where(and(eq(transportAssignmentsTable.id, req.params.id), tenantFilter(transportAssignmentsTable, t.id)))
        .limit(1);
      if (!a) return null;
      await tx.select({ id: vehiclesTable.id }).from(vehiclesTable)
        .where(and(eq(vehiclesTable.id, a.vehicleId), tenantFilter(vehiclesTable, t.id)))
        .for("update");
      const [r] = await tx.update(transportAssignmentsTable)
        .set({
          actualDepartureAt: new Date(),
          // >15 min after planned departure counts as delayed.
          status: sql`CASE WHEN ${transportAssignmentsTable.plannedDepartureAt} IS NOT NULL AND now() > ${transportAssignmentsTable.plannedDepartureAt} + interval '15 minutes' THEN 'delayed' ELSE 'en_route' END`,
        })
        .where(and(
          eq(transportAssignmentsTable.id, req.params.id),
          tenantFilter(transportAssignmentsTable, t.id),
          inArray(transportAssignmentsTable.status, ["scheduled", "delayed"]),
          isNull(transportAssignmentsTable.actualDepartureAt),
        ))
        .returning();
      if (!r) return null;
      await tx.update(vehiclesTable).set({ status: "deployed" })
        .where(and(eq(vehiclesTable.id, r.vehicleId), tenantFilter(vehiclesTable, t.id)));
      return r;
    });
    if (!row) return res.status(409).json({ code: "INVALID_STATE", error: "Assignment not found or already departed." });
    res.json(row);
  } catch (err) { sendRouteError(res, err); }
});

router.post("/transport-assignments/:id/arrive", requireAuth, canManageLogistics, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    // Only a journey that actually departed can arrive. Vehicle is freed in the
    // same transaction, and only when no other assignment still needs it.
    const row = await db.transaction(async (tx) => {
      // Lock the vehicle row first so concurrent arrivals on the same vehicle
      // serialize — without it two replicas can both see the other's assignment
      // as still active and leave the vehicle stuck "deployed".
      const [a] = await tx.select({ vehicleId: transportAssignmentsTable.vehicleId })
        .from(transportAssignmentsTable)
        .where(and(eq(transportAssignmentsTable.id, req.params.id), tenantFilter(transportAssignmentsTable, t.id)))
        .limit(1);
      if (!a) return null;
      await tx.select({ id: vehiclesTable.id }).from(vehiclesTable)
        .where(and(eq(vehiclesTable.id, a.vehicleId), tenantFilter(vehiclesTable, t.id)))
        .for("update");
      const [r] = await tx.update(transportAssignmentsTable)
        .set({ actualArrivalAt: new Date(), status: "arrived" })
        .where(and(
          eq(transportAssignmentsTable.id, req.params.id),
          tenantFilter(transportAssignmentsTable, t.id),
          inArray(transportAssignmentsTable.status, ["en_route", "delayed"]),
          isNotNull(transportAssignmentsTable.actualDepartureAt),
        ))
        .returning();
      if (!r) return null;
      const [stillActive] = await tx.select({ id: transportAssignmentsTable.id })
        .from(transportAssignmentsTable)
        .where(and(
          tenantFilter(transportAssignmentsTable, t.id),
          eq(transportAssignmentsTable.vehicleId, r.vehicleId),
          inArray(transportAssignmentsTable.status, ["scheduled", "en_route", "delayed"]),
        ))
        .limit(1);
      if (!stillActive) {
        await tx.update(vehiclesTable).set({ status: "available" })
          .where(and(eq(vehiclesTable.id, r.vehicleId), tenantFilter(vehiclesTable, t.id)));
      }
      return r;
    });
    if (!row) return res.status(409).json({ code: "INVALID_STATE", error: "Assignment not found or not en route." });
    res.json(row);
  } catch (err) { sendRouteError(res, err); }
});

// ─── AGENT CHECK-INS ────────────────────────────────────────────────────────

const CHECK_IN_TYPES = ["arrival", "setup_complete", "voting_started", "voting_ended", "counting_started", "results_submitted", "departure"] as const;

const checkInSchema = z.object({
  electionId: uuidField,
  checkInType: z.enum(CHECK_IN_TYPES),
  pollingStationId: uuidField.optional(),
  ...gpsFields,
  gpsAccuracy: z.number().min(0).optional(),
  photoUrl: z.string().max(1000).optional(),
  deviceId: z.string().max(200).optional(),
  source: z.enum(["app", "pwa", "ussd", "manual"]).optional(),
});

router.post("/check-ins", requireAuth, agentRoles, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const parsed = validate(checkInSchema, req.body, res);
    if (!parsed) return;
    const agent = await resolveAgent(req.clerkId, t.id);
    if (!agent) return res.status(403).json({ code: "AGENT_UNLINKED", error: "Your account is not linked to a polling agent record." });
    if (!(await assertElection(t.id, parsed.electionId))) return res.status(404).json({ error: "Election not found" });

    // An assigned agent can only check in at their own station — honoring a
    // caller-supplied station id would let them claim an in-geofence check-in
    // anywhere in Kenya. Unassigned agents may still pass a station explicitly
    // (pre-assignment field flows).
    const stationId = agent.pollingStationId ?? parsed.pollingStationId;
    let distanceFromStation: number | null = null;
    let isWithinGeofence: boolean | null = null;
    if (stationId && parsed.gpsLat != null && parsed.gpsLon != null) {
      // Geography is global (no tenant_id) — station ids are validated by
      // existence; agents are pinned to their assigned station above.
      const [station] = await db
        .select({ lat: pollingStationsTable.latitude, lon: pollingStationsTable.longitude })
        .from(pollingStationsTable)
        .where(eq(pollingStationsTable.id, stationId));
      if (!station) return res.status(404).json({ error: "Polling station not found" });
      if (station.lat != null && station.lon != null) {
        distanceFromStation = Math.round(haversineMeters(parsed.gpsLat, parsed.gpsLon, station.lat, station.lon));
        isWithinGeofence = distanceFromStation <= GEOFENCE_RADIUS_M;
      }
    }

    const [row] = await db.insert(agentCheckInsTable).values({
      tenantId: t.id,
      electionId: parsed.electionId,
      agentId: agent.id,
      pollingStationId: stationId ?? null,
      checkInType: parsed.checkInType,
      gpsLat: parsed.gpsLat,
      gpsLon: parsed.gpsLon,
      gpsAccuracy: parsed.gpsAccuracy,
      photoUrl: parsed.photoUrl,
      distanceFromStation,
      isWithinGeofence,
      deviceId: parsed.deviceId,
      source: parsed.source ?? "app",
    }).returning();
    // Geofence violations are accepted but surfaced for the command center.
    if (isWithinGeofence === false) {
      logger.warn({ tenantId: t.id, agentId: agent.id, checkInId: row.id, distanceFromStation }, "geofence violation on check-in");
    }
    res.status(201).json(row);
  } catch (err) { sendRouteError(res, err); }
});

router.get("/check-ins", requireAuth, canManageLogistics, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const conditions = [tenantFilter(agentCheckInsTable, t.id)];
    if (req.query.electionId) conditions.push(eq(agentCheckInsTable.electionId, String(req.query.electionId)));
    if (req.query.agentId) conditions.push(eq(agentCheckInsTable.agentId, String(req.query.agentId)));
    if (req.query.checkInType) conditions.push(eq(agentCheckInsTable.checkInType, String(req.query.checkInType)));
    const rows = await db
      .select({ checkIn: agentCheckInsTable, agentName: pollingAgentsTable.fullName, stationName: pollingStationsTable.name })
      .from(agentCheckInsTable)
      .leftJoin(pollingAgentsTable, eq(agentCheckInsTable.agentId, pollingAgentsTable.id))
      .leftJoin(pollingStationsTable, eq(agentCheckInsTable.pollingStationId, pollingStationsTable.id))
      .where(and(...conditions))
      .orderBy(desc(agentCheckInsTable.createdAt))
      .limit(500);
    res.json(rows.map((r) => ({ ...r.checkIn, agentName: r.agentName, stationName: r.stationName })));
  } catch (err) { sendRouteError(res, err); }
});

// Agents assigned to a station who have NOT checked in with the given type.
router.get("/check-ins/missing", requireAuth, canManageLogistics, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const electionId = String(req.query.electionId ?? "");
    const checkInType = String(req.query.checkInType ?? "arrival");
    if (!z.string().uuid().safeParse(electionId).success) return res.status(400).json({ error: "electionId is required" });
    if (!(CHECK_IN_TYPES as readonly string[]).includes(checkInType)) return res.status(400).json({ error: "Invalid checkInType" });
    const rows = await db
      .select({
        agentId: pollingAgentsTable.id,
        fullName: pollingAgentsTable.fullName,
        phoneNumber: pollingAgentsTable.phoneNumber,
        pollingStationId: pollingAgentsTable.pollingStationId,
        stationName: pollingStationsTable.name,
      })
      .from(pollingAgentsTable)
      .leftJoin(pollingStationsTable, eq(pollingAgentsTable.pollingStationId, pollingStationsTable.id))
      .where(and(
        tenantFilter(pollingAgentsTable, t.id),
        eq(pollingAgentsTable.status, "active"),
        isNotNull(pollingAgentsTable.pollingStationId),
        isNull(sql`(
          SELECT c.id FROM agent_check_ins c
          WHERE c.tenant_id = ${t.id} AND c.election_id = ${electionId}
            AND c.agent_id = ${pollingAgentsTable.id} AND c.check_in_type = ${checkInType}
          LIMIT 1
        )`),
      ));
    res.json(rows);
  } catch (err) { sendRouteError(res, err); }
});

router.get("/check-ins/status-summary", requireAuth, canManageLogistics, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const electionId = String(req.query.electionId ?? "");
    if (!z.string().uuid().safeParse(electionId).success) return res.status(400).json({ error: "electionId is required" });
    const byType = await db
      .select({ checkInType: agentCheckInsTable.checkInType, count: sql<number>`cast(count(*) as int)` })
      .from(agentCheckInsTable)
      .where(and(tenantFilter(agentCheckInsTable, t.id), eq(agentCheckInsTable.electionId, electionId)))
      .groupBy(agentCheckInsTable.checkInType);
    const [distinct] = await db
      .select({ agents: sql<number>`cast(count(distinct ${agentCheckInsTable.agentId}) as int)` })
      .from(agentCheckInsTable)
      .where(and(tenantFilter(agentCheckInsTable, t.id), eq(agentCheckInsTable.electionId, electionId)));
    res.json({ byType, distinctAgentsCheckedIn: distinct?.agents ?? 0 });
  } catch (err) { sendRouteError(res, err); }
});

// ─── SECURITY INCIDENTS ─────────────────────────────────────────────────────

const INCIDENT_TYPES = ["violence", "intimidation", "vote_buying", "ballot_stuffing", "agent_exclusion", "voter_suppression", "property_damage", "injury", "death", "other"] as const;
const SEVERITIES = ["low", "medium", "high", "critical"] as const;
const INCIDENT_STATUSES = ["reported", "verified", "escalated", "resolved", "false_alarm"] as const;

const createIncidentSchema = z.object({
  electionId: uuidField,
  incidentType: z.enum(INCIDENT_TYPES),
  severity: z.enum(SEVERITIES).default("medium"),
  title: z.string().trim().min(3).max(300),
  description: z.string().max(5000).optional(),
  countyId: uuidField.optional(),
  constituencyId: uuidField.optional(),
  pollingStationId: uuidField.optional(),
  ...gpsFields,
  photoUrls: z.array(z.string().max(1000)).max(10).optional(),
  videoUrls: z.array(z.string().max(1000)).max(5).optional(),
});

/** Escalation level → role slugs to notify (best-effort WhatsApp). */
const ESCALATION_ROLE_MAP: Record<number, string[]> = {
  2: ["county-coordinator"],
  3: ["regional-director", "county-coordinator"],
  4: ["national-security-chief", "security-director", "national-campaign-manager"],
  5: ["national-campaign-manager", "campaign-exec-director", "super-admin"],
};

async function notifyEscalation(tenantId: string, level: number, incident: { id: string; title: string; severity: string }) {
  try {
    const slugs = ESCALATION_ROLE_MAP[level] ?? [];
    if (slugs.length === 0) return;
    const recipients = await db
      .select({ phoneNumber: usersTable.phoneNumber })
      .from(userRolesTable)
      .innerJoin(rolesTable, eq(userRolesTable.roleId, rolesTable.id))
      .innerJoin(usersTable, eq(userRolesTable.userId, usersTable.id))
      .where(and(eq(userRolesTable.tenantId, tenantId), inArray(rolesTable.slug, slugs), isNotNull(usersTable.phoneNumber)));
    const [tenant] = await db.select({ waPhoneId: tenantsTable.whatsappPhoneNumberId }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
    const body = `🚨 Security incident escalated to level ${level}: "${incident.title}" (${incident.severity}). Open the Command Center to respond.`;
    await Promise.allSettled(recipients.map((r) => sendWhatsAppText(r.phoneNumber!, body, tenant?.waPhoneId ?? undefined)));
  } catch (err) {
    logger.warn({ err, tenantId, level }, "escalation notification failed (non-fatal)");
  }
}

router.post("/security-incidents", requireAuth, requireAgentOrStaff, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const parsed = validate(createIncidentSchema, req.body, res);
    if (!parsed) return;
    if (!(await assertElection(t.id, parsed.electionId))) return res.status(404).json({ error: "Election not found" });
    // Agents get linked to their agent record; staff are recorded by user id.
    const agent = req.logisticsAgent ?? null;
    const [row] = await db.insert(securityIncidentsTable).values({
      tenantId: t.id,
      electionId: parsed.electionId,
      reportedByAgentId: agent?.id ?? null,
      reportedByUserId: agent ? null : req.clerkId,
      countyId: parsed.countyId,
      constituencyId: parsed.constituencyId,
      pollingStationId: parsed.pollingStationId,
      gpsLat: parsed.gpsLat,
      gpsLon: parsed.gpsLon,
      incidentType: parsed.incidentType,
      severity: parsed.severity,
      title: parsed.title,
      description: parsed.description,
      photoUrls: parsed.photoUrls ?? [],
      videoUrls: parsed.videoUrls ?? [],
    }).returning();
    res.status(201).json(row);
  } catch (err) { sendRouteError(res, err); }
});

router.get("/security-incidents", requireAuth, canManageLogistics, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const conditions = [tenantFilter(securityIncidentsTable, t.id)];
    if (req.query.electionId) conditions.push(eq(securityIncidentsTable.electionId, String(req.query.electionId)));
    if (req.query.status) conditions.push(eq(securityIncidentsTable.status, String(req.query.status)));
    if (req.query.severity) conditions.push(eq(securityIncidentsTable.severity, String(req.query.severity)));
    const rows = await db.select().from(securityIncidentsTable).where(and(...conditions))
      .orderBy(desc(securityIncidentsTable.createdAt)).limit(500);
    res.json(rows);
  } catch (err) { sendRouteError(res, err); }
});

const patchIncidentSchema = z.object({
  status: z.enum(INCIDENT_STATUSES).optional(),
  severity: z.enum(SEVERITIES).optional(),
  assignedTo: z.string().max(100).nullable().optional(),
  resolutionNotes: z.string().max(5000).optional(),
});

router.patch("/security-incidents/:id", requireAuth, canManageLogistics, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const parsed = validate(patchIncidentSchema, req.body, res);
    if (!parsed) return;
    const patch: Record<string, any> = { ...parsed };
    if (parsed.status === "resolved" || parsed.status === "false_alarm") {
      patch.resolvedAt = new Date();
      patch.resolvedBy = req.clerkId;
    }
    const [row] = await db.update(securityIncidentsTable).set(patch)
      .where(and(eq(securityIncidentsTable.id, req.params.id), tenantFilter(securityIncidentsTable, t.id)))
      .returning();
    if (!row) return res.status(404).json({ error: "Incident not found" });
    res.json(row);
  } catch (err) { sendRouteError(res, err); }
});

router.post("/security-incidents/:id/escalate", requireAuth, canManageLogistics, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [row] = await db.update(securityIncidentsTable)
      .set({
        escalationLevel: sql`least(5, ${securityIncidentsTable.escalationLevel} + 1)`,
        status: "escalated",
      })
      .where(and(
        eq(securityIncidentsTable.id, req.params.id),
        tenantFilter(securityIncidentsTable, t.id),
        ne(securityIncidentsTable.status, "resolved"),
        ne(securityIncidentsTable.status, "false_alarm"),
      ))
      .returning();
    if (!row) return res.status(409).json({ code: "INVALID_STATE", error: "Incident not found or already closed." });
    // Fire-and-forget: alerting must not block the escalation response.
    void notifyEscalation(t.id, row.escalationLevel, row);
    res.json(row);
  } catch (err) { sendRouteError(res, err); }
});

// ─── PANIC BUTTON ───────────────────────────────────────────────────────────

const panicSchema = z.object({
  electionId: uuidField,
  pollingStationId: uuidField.optional(),
  ...gpsFields,
});

router.post("/panic", requireAuth, agentRoles, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const parsed = validate(panicSchema, req.body, res);
    if (!parsed) return;
    const agent = await resolveAgent(req.clerkId, t.id);
    if (!agent) return res.status(403).json({ code: "AGENT_UNLINKED", error: "Your account is not linked to a polling agent record." });
    if (!(await assertElection(t.id, parsed.electionId))) return res.status(404).json({ error: "Election not found" });
    // Same rule as check-ins: an assigned agent's panic is attributed to their
    // own station; GPS still records where they actually are.
    const stationId = agent.pollingStationId ?? parsed.pollingStationId;

    // Every panic alert owns exactly one critical security incident. Created
    // atomically: a panic without its paired incident can never exist.
    const { panic, incident } = await db.transaction(async (tx) => {
      const [inc] = await tx.insert(securityIncidentsTable).values({
        tenantId: t.id,
        electionId: parsed.electionId,
        reportedByAgentId: agent.id,
        pollingStationId: stationId ?? null,
        gpsLat: parsed.gpsLat,
        gpsLon: parsed.gpsLon,
        incidentType: "other",
        severity: "critical",
        title: `PANIC BUTTON — ${agent.fullName}`,
        description: "Agent triggered the panic button. Immediate response required.",
        isPanicButton: true,
      }).returning();
      const [p] = await tx.insert(panicAlertsTable).values({
        tenantId: t.id,
        electionId: parsed.electionId,
        agentId: agent.id,
        pollingStationId: stationId ?? null,
        incidentId: inc.id,
        gpsLat: parsed.gpsLat,
        gpsLon: parsed.gpsLon,
      }).returning();
      return { panic: p, incident: inc };
    });
    logger.warn({ tenantId: t.id, agentId: agent.id, panicId: panic.id }, "PANIC BUTTON triggered");
    res.status(201).json({ panicAlert: panic, incident });
  } catch (err) { sendRouteError(res, err); }
});

router.post("/panic/:id/acknowledge", requireAuth, canManageLogistics, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [row] = await db.update(panicAlertsTable)
      .set({ status: "acknowledged", acknowledgedAt: new Date(), acknowledgedBy: req.clerkId })
      .where(and(eq(panicAlertsTable.id, req.params.id), tenantFilter(panicAlertsTable, t.id), eq(panicAlertsTable.status, "active")))
      .returning();
    if (!row) return res.status(409).json({ code: "INVALID_STATE", error: "Panic alert not found or not active." });
    // A null link is a data-integrity failure — never report success.
    if (!row.incidentId) return res.status(500).json({ code: "PANIC_LINK_MISSING", error: "Panic alert is missing its paired incident." });
    // Mirror onto exactly this panic's paired incident.
    {
      await db.update(securityIncidentsTable)
        .set({ status: "verified", panicButtonAcknowledgedAt: new Date(), panicButtonAcknowledgedBy: req.clerkId })
        .where(and(
          eq(securityIncidentsTable.id, row.incidentId),
          tenantFilter(securityIncidentsTable, t.id),
          eq(securityIncidentsTable.status, "reported"),
        ));
    }
    res.json(row);
  } catch (err) { sendRouteError(res, err); }
});

const resolvePanicSchema = z.object({ notes: z.string().max(2000).optional(), falseAlarm: z.boolean().optional() });

router.post("/panic/:id/resolve", requireAuth, canManageLogistics, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const parsed = validate(resolvePanicSchema, req.body ?? {}, res);
    if (!parsed) return;
    const [row] = await db.update(panicAlertsTable)
      .set({ status: parsed.falseAlarm ? "false_alarm" : "resolved", resolvedAt: new Date(), notes: parsed.notes })
      .where(and(eq(panicAlertsTable.id, req.params.id), tenantFilter(panicAlertsTable, t.id), inArray(panicAlertsTable.status, ["active", "acknowledged"])))
      .returning();
    if (!row) return res.status(409).json({ code: "INVALID_STATE", error: "Panic alert not found or already closed." });
    if (!row.incidentId) return res.status(500).json({ code: "PANIC_LINK_MISSING", error: "Panic alert is missing its paired incident." });
    {
      await db.update(securityIncidentsTable)
        .set({ status: parsed.falseAlarm ? "false_alarm" : "resolved", resolvedAt: new Date(), resolvedBy: req.clerkId, resolutionNotes: parsed.notes })
        .where(and(
          eq(securityIncidentsTable.id, row.incidentId),
          tenantFilter(securityIncidentsTable, t.id),
          inArray(securityIncidentsTable.status, ["reported", "verified", "escalated"]),
        ));
    }
    res.json(row);
  } catch (err) { sendRouteError(res, err); }
});

router.get("/panic", requireAuth, canManageLogistics, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const conditions = [tenantFilter(panicAlertsTable, t.id)];
    if (req.query.electionId) conditions.push(eq(panicAlertsTable.electionId, String(req.query.electionId)));
    if (req.query.status) conditions.push(eq(panicAlertsTable.status, String(req.query.status)));
    const rows = await db
      .select({ panic: panicAlertsTable, agentName: pollingAgentsTable.fullName, stationName: pollingStationsTable.name })
      .from(panicAlertsTable)
      .leftJoin(pollingAgentsTable, eq(panicAlertsTable.agentId, pollingAgentsTable.id))
      .leftJoin(pollingStationsTable, eq(panicAlertsTable.pollingStationId, pollingStationsTable.id))
      .where(and(...conditions))
      .orderBy(desc(panicAlertsTable.createdAt))
      .limit(200);
    res.json(rows.map((r) => ({ ...r.panic, agentName: r.agentName, stationName: r.stationName })));
  } catch (err) { sendRouteError(res, err); }
});

// ─── COMMAND CENTER ─────────────────────────────────────────────────────────

router.get("/command-center/overview", requireAuth, canManageLogistics, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const electionId = String(req.query.electionId ?? "");
    if (!z.string().uuid().safeParse(electionId).success) return res.status(400).json({ error: "electionId is required" });

    const [agentStats] = await db
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(pollingAgentsTable)
      .where(and(tenantFilter(pollingAgentsTable, t.id), eq(pollingAgentsTable.status, "active"), isNotNull(pollingAgentsTable.pollingStationId)));
    const [checkedIn] = await db
      .select({ n: sql<number>`cast(count(distinct ${agentCheckInsTable.agentId}) as int)` })
      .from(agentCheckInsTable)
      .where(and(tenantFilter(agentCheckInsTable, t.id), eq(agentCheckInsTable.electionId, electionId)));
    const [incidentStats] = await db
      .select({ active: sql<number>`cast(count(*) as int)` })
      .from(securityIncidentsTable)
      .where(and(tenantFilter(securityIncidentsTable, t.id), eq(securityIncidentsTable.electionId, electionId), inArray(securityIncidentsTable.status, ["reported", "verified", "escalated"])));
    const [panicStats] = await db
      .select({ active: sql<number>`cast(count(*) as int)` })
      .from(panicAlertsTable)
      .where(and(tenantFilter(panicAlertsTable, t.id), eq(panicAlertsTable.electionId, electionId), eq(panicAlertsTable.status, "active")));
    const [transportStats] = await db
      .select({ enRoute: sql<number>`cast(count(*) as int)` })
      .from(transportAssignmentsTable)
      .where(and(tenantFilter(transportAssignmentsTable, t.id), eq(transportAssignmentsTable.electionId, electionId), inArray(transportAssignmentsTable.status, ["en_route", "delayed"])));

    const totalAgents = agentStats?.total ?? 0;
    const checkedInAgents = checkedIn?.n ?? 0;
    res.json({
      totalAgents,
      checkedInAgents,
      checkedInPct: totalAgents > 0 ? Math.round((checkedInAgents / totalAgents) * 100) : 0,
      missingAgents: Math.max(0, totalAgents - checkedInAgents),
      activeIncidents: incidentStats?.active ?? 0,
      activePanicAlerts: panicStats?.active ?? 0,
      vehiclesEnRoute: transportStats?.enRoute ?? 0,
    });
  } catch (err) { sendRouteError(res, err); }
});

router.get("/command-center/live-map", requireAuth, canManageLogistics, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const electionId = String(req.query.electionId ?? "");
    if (!z.string().uuid().safeParse(electionId).success) return res.status(400).json({ error: "electionId is required" });

    // Latest check-in per agent (for this election).
    const agentRows = await db.execute(sql`
      SELECT DISTINCT ON (c.agent_id)
        c.agent_id AS "agentId", a.full_name AS "agentName",
        c.polling_station_id AS "pollingStationId", s.name AS "stationName",
        c.gps_lat AS "gpsLat", c.gps_lon AS "gpsLon",
        c.is_within_geofence AS "isWithinGeofence", c.check_in_type AS "checkInType",
        c.created_at AS "at"
      FROM agent_check_ins c
      JOIN polling_agents a ON a.id = c.agent_id
      LEFT JOIN polling_stations s ON s.id = c.polling_station_id
      WHERE c.tenant_id = ${t.id} AND c.election_id = ${electionId} AND c.gps_lat IS NOT NULL
      ORDER BY c.agent_id, c.created_at DESC
    `);
    // Active panics (override agent dot colour on the map).
    const panicRows = await db
      .select({ agentId: panicAlertsTable.agentId, gpsLat: panicAlertsTable.gpsLat, gpsLon: panicAlertsTable.gpsLon, at: panicAlertsTable.createdAt })
      .from(panicAlertsTable)
      .where(and(tenantFilter(panicAlertsTable, t.id), eq(panicAlertsTable.electionId, electionId), eq(panicAlertsTable.status, "active")));
    const vehicleRows = await db
      .select({ id: vehiclesTable.id, registrationNumber: vehiclesTable.registrationNumber, status: vehiclesTable.status, gpsLat: vehiclesTable.lastGpsLat, gpsLon: vehiclesTable.lastGpsLon, at: vehiclesTable.lastGpsAt })
      .from(vehiclesTable)
      .where(and(tenantFilter(vehiclesTable, t.id), isNotNull(vehiclesTable.lastGpsLat)));

    res.json({ agents: agentRows.rows, panics: panicRows, vehicles: vehicleRows });
  } catch (err) { sendRouteError(res, err); }
});

/**
 * SSE alerts feed. Polls the event tables on a 5s DB cursor (multi-replica
 * safe — no in-process bus) and streams new check-ins, incidents, panic
 * alerts, and delayed transport as `event: alert` frames.
 */
router.get("/command-center/alerts-feed", requireAuth, canManageLogistics, async (req: any, res: any) => {
  const t = assertTenant(req);
  const electionId = String(req.query.electionId ?? "");
  if (!z.string().uuid().safeParse(electionId).success) return res.status(400).json({ error: "electionId is required" });

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(`: connected\n\n`);

  let cursor = new Date();
  let closed = false;
  req.on("close", () => { closed = true; });

  const poll = async () => {
    if (closed) return;
    try {
      const since = cursor;
      const events: any[] = [];
      const checkIns = await db
        .select({ id: agentCheckInsTable.id, at: agentCheckInsTable.createdAt, agentId: agentCheckInsTable.agentId, type: agentCheckInsTable.checkInType, geofence: agentCheckInsTable.isWithinGeofence, agentName: pollingAgentsTable.fullName })
        .from(agentCheckInsTable)
        .leftJoin(pollingAgentsTable, eq(agentCheckInsTable.agentId, pollingAgentsTable.id))
        .where(and(tenantFilter(agentCheckInsTable, t.id), eq(agentCheckInsTable.electionId, electionId), gte(agentCheckInsTable.createdAt, since)))
        .orderBy(agentCheckInsTable.createdAt).limit(50);
      for (const c of checkIns) events.push({ kind: "check_in", ...c, severity: c.geofence === false ? "medium" : "info" });

      const incidents = await db.select({ id: securityIncidentsTable.id, at: securityIncidentsTable.createdAt, title: securityIncidentsTable.title, severity: securityIncidentsTable.severity, incidentType: securityIncidentsTable.incidentType })
        .from(securityIncidentsTable)
        .where(and(tenantFilter(securityIncidentsTable, t.id), eq(securityIncidentsTable.electionId, electionId), gte(securityIncidentsTable.createdAt, since)))
        .orderBy(securityIncidentsTable.createdAt).limit(50);
      for (const i of incidents) events.push({ kind: "incident", ...i });

      const panics = await db.select({ id: panicAlertsTable.id, at: panicAlertsTable.createdAt, agentId: panicAlertsTable.agentId, agentName: pollingAgentsTable.fullName })
        .from(panicAlertsTable)
        .leftJoin(pollingAgentsTable, eq(panicAlertsTable.agentId, pollingAgentsTable.id))
        .where(and(tenantFilter(panicAlertsTable, t.id), eq(panicAlertsTable.electionId, electionId), gte(panicAlertsTable.createdAt, since)))
        .orderBy(panicAlertsTable.createdAt).limit(50);
      for (const p of panics) events.push({ kind: "panic", ...p, severity: "critical" });

      const delayed = await db.select({ id: transportAssignmentsTable.id, at: transportAssignmentsTable.updatedAt, vehicleId: transportAssignmentsTable.vehicleId, delayReason: transportAssignmentsTable.delayReason })
        .from(transportAssignmentsTable)
        .where(and(tenantFilter(transportAssignmentsTable, t.id), eq(transportAssignmentsTable.electionId, electionId), eq(transportAssignmentsTable.status, "delayed"), gte(transportAssignmentsTable.updatedAt, since)))
        .orderBy(transportAssignmentsTable.updatedAt).limit(50);
      for (const d of delayed) events.push({ kind: "transport_delayed", ...d, severity: "high" });

      events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
      for (const e of events) {
        res.write(`event: alert\ndata: ${JSON.stringify(e)}\n\n`);
      }
      const maxAt = events.reduce((m, e) => Math.max(m, new Date(e.at).getTime()), 0);
      if (maxAt > 0) cursor = new Date(maxAt + 1); // +1ms: avoid re-emitting the boundary row
    } catch (err) {
      logger.warn({ err }, "alerts-feed poll failed");
    }
  };

  const pollTimer = setInterval(poll, 5_000);
  const heartbeat = setInterval(() => { if (!closed) res.write(`: ping\n\n`); }, 15_000);
  req.on("close", () => { clearInterval(pollTimer); clearInterval(heartbeat); });
});

// ─── AGENT SELF-SERVICE (PWA) ───────────────────────────────────────────────

// The agent's own transport assignments for an election (passenger or driver).
router.get("/my-transport", requireAuth, agentRoles, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const electionId = String(req.query.electionId ?? "");
    if (!z.string().uuid().safeParse(electionId).success) return res.status(400).json({ error: "electionId is required" });
    const agent = await resolveAgent(req.clerkId, t.id);
    if (!agent) return res.status(403).json({ code: "AGENT_UNLINKED", error: "Your account is not linked to a polling agent record." });
    const rows = await db
      .select({ assignment: transportAssignmentsTable, vehicleRegistration: vehiclesTable.registrationNumber, vehicleType: vehiclesTable.vehicleType })
      .from(transportAssignmentsTable)
      .leftJoin(vehiclesTable, eq(transportAssignmentsTable.vehicleId, vehiclesTable.id))
      .where(and(
        tenantFilter(transportAssignmentsTable, t.id),
        eq(transportAssignmentsTable.electionId, electionId),
        sql`${transportAssignmentsTable.passengerAgentIds} @> ${JSON.stringify([agent.id])}::jsonb`,
      ));
    res.json(rows.map((r) => ({ ...r.assignment, vehicleRegistration: r.vehicleRegistration, vehicleType: r.vehicleType })));
  } catch (err) { sendRouteError(res, err); }
});

// The agent's latest panic alert (for "alert acknowledged" status updates).
router.get("/my-panic", requireAuth, agentRoles, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const electionId = String(req.query.electionId ?? "");
    if (!z.string().uuid().safeParse(electionId).success) return res.status(400).json({ error: "electionId is required" });
    const agent = await resolveAgent(req.clerkId, t.id);
    if (!agent) return res.status(403).json({ code: "AGENT_UNLINKED", error: "Your account is not linked to a polling agent record." });
    const [row] = await db.select().from(panicAlertsTable)
      .where(and(tenantFilter(panicAlertsTable, t.id), eq(panicAlertsTable.electionId, electionId), eq(panicAlertsTable.agentId, agent.id)))
      .orderBy(desc(panicAlertsTable.createdAt))
      .limit(1);
    res.json(row ?? null);
  } catch (err) { sendRouteError(res, err); }
});

export default router;
