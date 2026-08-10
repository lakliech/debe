/**
 * logistics.ts — Election Day Logistics & Security Command Center schema.
 *
 * Mission-critical election-day operations: the campaign vehicle fleet and
 * transport plans, milestone-based agent check-ins (with geofence validation
 * against polling station coordinates), typed security incidents with
 * escalation levels, and fast-access panic button alerts.
 *
 * Distinct from agent tracking heartbeats (continuous location pings) and the
 * election incident reports module (general incident log): check-ins here are
 * the election-day milestone workflow, and security incidents carry panic
 * linkage plus a 5-level escalation chain.
 */
import { pgTable, uuid, text, integer, doublePrecision, timestamp, jsonb, boolean, index } from "drizzle-orm/pg-core";
import { electionsTable, pollingAgentsTable } from "./config";
import { tenantsTable } from "./core";
import { countiesTable, constituenciesTable, pollingStationsTable } from "./geography";

/** Campaign vehicle fleet. */
export const vehiclesTable = pgTable("vehicles", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  registrationNumber: text("registration_number").notNull(),
  make: text("make"),
  model: text("model"),
  capacity: integer("capacity"),
  vehicleType: text("vehicle_type"), // car | van | bus | motorbike | truck
  assignedDriverId: text("assigned_driver_id"), // users.id (text)
  assignedCountyId: uuid("assigned_county_id").references(() => countiesTable.id),
  assignedConstituencyId: uuid("assigned_constituency_id").references(() => constituenciesTable.id),
  status: text("status").notNull().default("available"), // available | deployed | maintenance | broken_down
  gpsDeviceId: text("gps_device_id"),
  lastGpsLat: doublePrecision("last_gps_lat"),
  lastGpsLon: doublePrecision("last_gps_lon"),
  lastGpsAt: timestamp("last_gps_at", { withTimezone: true }),
  fuelCapacityLiters: doublePrecision("fuel_capacity_liters"),
  currentFuelLevel: doublePrecision("current_fuel_level"), // litres remaining
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("vehicles_tenant_status_idx").on(t.tenantId, t.status),
  index("vehicles_tenant_county_idx").on(t.tenantId, t.assignedCountyId),
  index("vehicles_reg_uniq").on(t.tenantId, t.registrationNumber),
]);

/** Election day transport plans (vehicle + driver + passengers + schedule). */
export const transportAssignmentsTable = pgTable("transport_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  electionId: uuid("election_id").notNull().references(() => electionsTable.id, { onDelete: "cascade" }),
  vehicleId: uuid("vehicle_id").notNull().references(() => vehiclesTable.id, { onDelete: "cascade" }),
  driverId: text("driver_id"), // users.id (text)
  originCountyId: uuid("origin_county_id").references(() => countiesTable.id),
  originDescription: text("origin_description"),
  destinationCountyId: uuid("destination_county_id").references(() => countiesTable.id),
  destinationDescription: text("destination_description"),
  /** Array of pollingAgents.id (uuid strings). */
  passengerAgentIds: jsonb("passenger_agent_ids").$type<string[]>().notNull().default([]),
  plannedDepartureAt: timestamp("planned_departure_at", { withTimezone: true }),
  plannedArrivalAt: timestamp("planned_arrival_at", { withTimezone: true }),
  actualDepartureAt: timestamp("actual_departure_at", { withTimezone: true }),
  actualArrivalAt: timestamp("actual_arrival_at", { withTimezone: true }),
  status: text("status").notNull().default("scheduled"), // scheduled | en_route | arrived | delayed | cancelled
  delayReason: text("delay_reason"),
  fuelIssuedLiters: doublePrecision("fuel_issued_liters"),
  fuelCostKes: doublePrecision("fuel_cost_kes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("transport_tenant_election_idx").on(t.tenantId, t.electionId),
  index("transport_tenant_status_idx").on(t.tenantId, t.status),
  index("transport_vehicle_idx").on(t.vehicleId),
]);

/** Milestone GPS check-ins throughout election day. */
export const agentCheckInsTable = pgTable("agent_check_ins", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  electionId: uuid("election_id").notNull().references(() => electionsTable.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").notNull().references(() => pollingAgentsTable.id, { onDelete: "cascade" }),
  pollingStationId: uuid("polling_station_id").references(() => pollingStationsTable.id, { onDelete: "set null" }),
  checkInType: text("check_in_type").notNull(), // arrival | setup_complete | voting_started | voting_ended | counting_started | results_submitted | departure
  gpsLat: doublePrecision("gps_lat"),
  gpsLon: doublePrecision("gps_lon"),
  gpsAccuracy: doublePrecision("gps_accuracy"), // metres
  photoUrl: text("photo_url"),
  distanceFromStation: doublePrecision("distance_from_station"), // metres, haversine
  isWithinGeofence: boolean("is_within_geofence"),
  deviceId: text("device_id"),
  source: text("source").notNull().default("app"), // app | pwa | ussd | manual
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("checkins_tenant_election_idx").on(t.tenantId, t.electionId),
  index("checkins_tenant_agent_idx").on(t.tenantId, t.agentId),
  index("checkins_tenant_station_idx").on(t.tenantId, t.pollingStationId),
  index("checkins_tenant_created_idx").on(t.tenantId, t.createdAt),
  index("checkins_tenant_type_idx").on(t.tenantId, t.checkInType),
]);

/** Typed security incidents with a 5-level escalation chain + panic linkage. */
export const securityIncidentsTable = pgTable("security_incidents", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  electionId: uuid("election_id").notNull().references(() => electionsTable.id, { onDelete: "cascade" }),
  reportedByAgentId: uuid("reported_by_agent_id").references(() => pollingAgentsTable.id, { onDelete: "set null" }),
  reportedByUserId: text("reported_by_user_id"), // users.id (text)
  countyId: uuid("county_id").references(() => countiesTable.id),
  constituencyId: uuid("constituency_id").references(() => constituenciesTable.id),
  pollingStationId: uuid("polling_station_id").references(() => pollingStationsTable.id, { onDelete: "set null" }),
  gpsLat: doublePrecision("gps_lat"),
  gpsLon: doublePrecision("gps_lon"),
  incidentType: text("incident_type").notNull(), // violence | intimidation | vote_buying | ballot_stuffing | agent_exclusion | voter_suppression | property_damage | injury | death | other
  severity: text("severity").notNull().default("medium"), // low | medium | high | critical
  title: text("title").notNull(),
  description: text("description"),
  photoUrls: jsonb("photo_urls").$type<string[]>().notNull().default([]),
  videoUrls: jsonb("video_urls").$type<string[]>().notNull().default([]),
  status: text("status").notNull().default("reported"), // reported | verified | escalated | resolved | false_alarm
  assignedTo: text("assigned_to"), // users.id (text)
  escalationLevel: integer("escalation_level").notNull().default(1), // 1 field officer … 5 campaign manager + legal
  resolutionNotes: text("resolution_notes"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: text("resolved_by"),
  isPanicButton: boolean("is_panic_button").notNull().default(false),
  panicButtonAcknowledgedAt: timestamp("panic_acknowledged_at", { withTimezone: true }),
  panicButtonAcknowledgedBy: text("panic_acknowledged_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("security_incidents_tenant_election_idx").on(t.tenantId, t.electionId),
  index("security_incidents_tenant_status_idx").on(t.tenantId, t.status),
  index("security_incidents_tenant_severity_idx").on(t.tenantId, t.severity),
  index("security_incidents_tenant_station_idx").on(t.tenantId, t.pollingStationId),
  index("security_incidents_tenant_created_idx").on(t.tenantId, t.createdAt),
]);

/** Fast-access panic button alerts (paired with a security_incidents row). */
export const panicAlertsTable = pgTable("panic_alerts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  electionId: uuid("election_id").notNull().references(() => electionsTable.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").notNull().references(() => pollingAgentsTable.id, { onDelete: "cascade" }),
  pollingStationId: uuid("polling_station_id").references(() => pollingStationsTable.id, { onDelete: "set null" }),
  // The paired critical security_incidents row — every panic alert owns exactly
  // one. NOT NULL + RESTRICT: the pair invariant is enforced at the DB boundary.
  incidentId: uuid("incident_id").notNull().references(() => securityIncidentsTable.id, { onDelete: "restrict" }),
  gpsLat: doublePrecision("gps_lat"),
  gpsLon: doublePrecision("gps_lon"),
  status: text("status").notNull().default("active"), // active | acknowledged | resolved | false_alarm
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  acknowledgedBy: text("acknowledged_by"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("panic_alerts_tenant_election_idx").on(t.tenantId, t.electionId),
  index("panic_alerts_tenant_status_idx").on(t.tenantId, t.status),
  index("panic_alerts_tenant_agent_idx").on(t.tenantId, t.agentId),
  index("panic_alerts_tenant_created_idx").on(t.tenantId, t.createdAt),
]);
