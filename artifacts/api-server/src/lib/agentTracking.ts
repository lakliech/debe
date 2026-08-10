/**
 * Agent geofencing + live tracking.
 *
 * The agent app POSTs a GPS heartbeat (~every 5 min on election day). Pings
 * are append-only facts; presence status is ALWAYS derived at query time from
 * the latest ping vs the assigned station's coordinates, so a late-arriving
 * or corrected ping immediately fixes the map — no stored status to go stale.
 *
 * Statuses:
 *   on_station     latest ping ≤ 200 m from the assigned station      (green)
 *   nearby         latest ping ≤ 1 000 m                              (yellow)
 *   away           latest ping > 1 000 m                              (red)
 *   missing        no ping in the last 15 min (or never)              (red)
 *   no_station_gps pinging, but the station has no coordinates        (grey)
 *   unassigned     agent has no assigned station                      (grey)
 *
 * A 60-second monitor sweep finds missing agents for tenants with an active
 * election and alerts field officers (polling-agent-supervisor,
 * constituency-coordinator, county-coordinator) over WhatsApp, with a 60-minute
 * per-agent cooldown recorded in agent_tracking_alerts. Alerting is
 * fire-and-forget: failures are logged, never thrown.
 */
import { db } from "@workspace/db";
import {
  agentLocationPingsTable,
  agentTrackingAlertsTable,
  pollingAgentsTable,
  pollingStationsTable,
  electionsTable,
  userRolesTable,
  rolesTable,
  usersTable,
} from "@workspace/db";
import { and, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";
import { haversineMeters } from "./anomalyDetection";
import { sendWhatsappChannel } from "./commsDispatcher";
import { logger } from "./logger";

export const ON_STATION_RADIUS_M = 200;
export const NEARBY_RADIUS_M = 1000;
export const STALE_AFTER_MS = 15 * 60_000;
export const ALERT_COOLDOWN_MS = 60 * 60_000;
const SWEEP_INTERVAL_MS = 60_000;

const ESCALATION_ROLES = [
  "polling-agent-supervisor",
  "constituency-coordinator",
  "county-coordinator",
];

export type PresenceStatus =
  | "on_station"
  | "nearby"
  | "away"
  | "missing"
  | "no_station_gps"
  | "unassigned";

/** Pure status derivation — exported for boundary tests. */
export function derivePresence(args: {
  hasAssignedStation: boolean;
  lastPingAt: Date | null;
  distanceM: number | null;
  now?: Date;
}): PresenceStatus {
  if (!args.hasAssignedStation) return "unassigned";
  const now = args.now ?? new Date();
  // "No ping in 15 min = missing" — a ping exactly STALE_AFTER_MS old is missing.
  if (!args.lastPingAt || now.getTime() - args.lastPingAt.getTime() >= STALE_AFTER_MS) {
    return "missing";
  }
  if (args.distanceM == null) return "no_station_gps";
  if (args.distanceM <= ON_STATION_RADIUS_M) return "on_station";
  if (args.distanceM <= NEARBY_RADIUS_M) return "nearby";
  return "away";
}

async function resolveActiveElectionId(tenantId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: electionsTable.id })
    .from(electionsTable)
    .where(and(eq(electionsTable.tenantId, tenantId), eq(electionsTable.isActive, true)))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Use the client-supplied election only when it belongs to this tenant;
 * otherwise fall back to the tenant's active election. Never trust a bare UUID.
 */
async function resolveElectionId(tenantId: string, requested?: string | null): Promise<string | null> {
  if (requested) {
    const [row] = await db
      .select({ id: electionsTable.id })
      .from(electionsTable)
      .where(and(eq(electionsTable.id, requested), eq(electionsTable.tenantId, tenantId)))
      .limit(1);
    if (row) return row.id;
  }
  return resolveActiveElectionId(tenantId);
}

/** Devices may be slightly ahead; anything beyond this is clamped to server time. */
const MAX_CLOCK_SKEW_MS = 2 * 60_000;

/**
 * Persist a heartbeat and return the freshly-derived presence for the agent.
 * The caller (agent app) uses this to show "You are at your station" feedback.
 */
export async function recordHeartbeat(args: {
  tenantId: string;
  agentId: string;
  lat: number;
  lon: number;
  accuracyM?: number | null;
  recordedAt?: Date | null;
  electionId?: string | null;
}): Promise<{ status: PresenceStatus; distanceM: number | null; stationName: string | null; recordedAt: string }> {
  const electionId = await resolveElectionId(args.tenantId, args.electionId);

  // A future-dated client timestamp would stay "fresh" forever and win LATERAL
  // ordering over real pings — clamp to server time beyond small clock skew.
  let recordedAt = args.recordedAt ?? null;
  if (recordedAt && recordedAt.getTime() > Date.now() + MAX_CLOCK_SKEW_MS) {
    recordedAt = new Date();
  }
  // The effective persisted timestamp — status is derived from THIS, never the
  // raw client value, so the response matches what the map will show.
  const effectiveRecordedAt = recordedAt ?? new Date();

  await db.insert(agentLocationPingsTable).values({
    tenantId: args.tenantId,
    agentId: args.agentId,
    electionId,
    lat: args.lat,
    lon: args.lon,
    accuracyM: args.accuracyM ?? null,
    recordedAt: effectiveRecordedAt,
  } as any);

  const [agent] = await db
    .select({
      pollingStationId: pollingAgentsTable.pollingStationId,
      stationName: pollingStationsTable.name,
      stationLat: pollingStationsTable.latitude,
      stationLon: pollingStationsTable.longitude,
    })
    .from(pollingAgentsTable)
    .leftJoin(pollingStationsTable, eq(pollingAgentsTable.pollingStationId, pollingStationsTable.id))
    .where(and(eq(pollingAgentsTable.id, args.agentId), eq(pollingAgentsTable.tenantId, args.tenantId)))
    .limit(1);

  const hasStation = !!agent?.pollingStationId;
  const distanceM =
    hasStation && agent!.stationLat != null && agent!.stationLon != null
      ? haversineMeters(args.lat, args.lon, agent!.stationLat!, agent!.stationLon!)
      : null;

  return {
    status: derivePresence({
      hasAssignedStation: hasStation,
      lastPingAt: effectiveRecordedAt,
      distanceM,
    }),
    distanceM: distanceM == null ? null : Math.round(distanceM),
    stationName: agent?.stationName ?? null,
    recordedAt: effectiveRecordedAt.toISOString(),
  };
}

export interface LiveAgentPosition {
  agentId: string;
  fullName: string;
  phoneNumber: string;
  stationId: string;
  stationName: string;
  stationCode: string;
  stationLat: number | null;
  stationLon: number | null;
  lastPingAt: string | null;
  lat: number | null;
  lon: number | null;
  accuracyM: number | null;
  distanceM: number | null;
  minutesSincePing: number | null;
  status: PresenceStatus;
}

/**
 * Live map payload: every agent with an assigned station plus their latest
 * ping and derived presence. One indexed LATERAL lookup per agent — no stored
 * status, no N+1.
 */
export async function getLiveAgentTracking(tenantId: string, now = new Date()): Promise<LiveAgentPosition[]> {
  const { rows } = await db.execute(sql`
    SELECT
      a.id AS agent_id,
      a.full_name,
      a.phone_number,
      a.polling_station_id AS station_id,
      s.name AS station_name,
      s.code AS station_code,
      s.latitude AS station_lat,
      s.longitude AS station_lon,
      p.lat,
      p.lon,
      p.accuracy_m,
      p.recorded_at
    FROM polling_agents a
    JOIN polling_stations s ON s.id = a.polling_station_id
    LEFT JOIN LATERAL (
      SELECT lat, lon, accuracy_m, recorded_at
      FROM agent_location_pings p
      WHERE p.tenant_id = a.tenant_id AND p.agent_id = a.id
      ORDER BY p.recorded_at DESC
      LIMIT 1
    ) p ON TRUE
    WHERE a.tenant_id = ${tenantId}
      AND a.polling_station_id IS NOT NULL
  `);

  return (rows as any[]).map((r) => {
    const lastPingAt: Date | null = r.recorded_at ? new Date(r.recorded_at) : null;
    const distanceM =
      lastPingAt && r.station_lat != null && r.station_lon != null
        ? Math.round(haversineMeters(r.lat, r.lon, r.station_lat, r.station_lon))
        : null;
    return {
      agentId: r.agent_id,
      fullName: r.full_name,
      phoneNumber: r.phone_number,
      stationId: r.station_id,
      stationName: r.station_name,
      stationCode: r.station_code,
      stationLat: r.station_lat,
      stationLon: r.station_lon,
      lastPingAt: lastPingAt?.toISOString() ?? null,
      lat: r.lat,
      lon: r.lon,
      accuracyM: r.accuracy_m,
      distanceM,
      minutesSincePing: lastPingAt ? Math.floor((now.getTime() - lastPingAt.getTime()) / 60_000) : null,
      status: derivePresence({ hasAssignedStation: true, lastPingAt, distanceM, now }),
    };
  });
}

/**
 * One monitor pass: for every tenant with an active election, alert field
 * officers about agents with an assigned station whose latest ping is stale
 * or absent. Cooldown: at most one 'missing' alert per agent per 60 minutes.
 */
export async function runTrackingSweep(now = new Date()): Promise<{ tenantsScanned: number; alertsSent: number }> {
  const activeElections = await db
    .select({ tenantId: electionsTable.tenantId, electionId: electionsTable.id })
    .from(electionsTable)
    .where(and(eq(electionsTable.isActive, true), isNotNull(electionsTable.tenantId)));

  let alertsSent = 0;
  for (const { tenantId, electionId } of activeElections) {
    if (!tenantId) continue;
    try {
      const live = await getLiveAgentTracking(tenantId, now);
      const missing = live.filter((a) => a.status === "missing");
      if (missing.length === 0) continue;

      const officers = await db
        .select({ phone: usersTable.phoneNumber })
        .from(userRolesTable)
        .innerJoin(rolesTable, eq(userRolesTable.roleId, rolesTable.id))
        .innerJoin(usersTable, eq(userRolesTable.userId, usersTable.id))
        .where(and(
          eq(userRolesTable.tenantId, tenantId),
          inArray(rolesTable.slug, ESCALATION_ROLES),
          isNotNull(usersTable.phoneNumber),
        ));
      if (officers.length === 0) continue;

      const cooldownAfter = new Date(now.getTime() - ALERT_COOLDOWN_MS);
      for (const agent of missing) {
        // Atomic claim-first: the advisory lock serializes concurrent sweepers
        // (overlapping ticks, multiple replicas), then the alert row is inserted
        // BEFORE sending. A concurrent pass blocks on the lock, then sees the row
        // and skips. If every send fails, the claim is rolled back so the next
        // tick retries instead of going silent for the full cooldown.
        const claimId = await db.transaction(async (tx) => {
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtext(${`${tenantId}:${agent.agentId}:missing`}))`,
          );
          const [recent] = await tx
            .select({ id: agentTrackingAlertsTable.id })
            .from(agentTrackingAlertsTable)
            .where(and(
              eq(agentTrackingAlertsTable.tenantId, tenantId),
              eq(agentTrackingAlertsTable.agentId, agent.agentId),
              eq(agentTrackingAlertsTable.kind, "missing"),
              gt(agentTrackingAlertsTable.sentAt, cooldownAfter),
            ))
            .limit(1);
          if (recent) return null;
          const [claim] = await tx
            .insert(agentTrackingAlertsTable)
            .values({ tenantId, agentId: agent.agentId, electionId, kind: "missing" } as any)
            .returning({ id: agentTrackingAlertsTable.id });
          return claim.id as string;
        });
        if (!claimId) continue;

        const lastSeen = agent.lastPingAt
          ? `${agent.minutesSincePing} min ago`
          : "never";
        const message =
          `🚨 Agent ${agent.fullName} is missing from ${agent.stationName} ` +
          `(${agent.stationCode}) — no GPS check-in (last seen: ${lastSeen}). ` +
          `Please follow up. Phone: ${agent.phoneNumber}`;

        let delivered = false;
        for (const o of officers) {
          try {
            const res = await sendWhatsappChannel(tenantId, o.phone!, message);
            if (res.ok) delivered = true;
            else logger.warn({ err: res.error, agentId: agent.agentId }, "tracking alert send failed");
          } catch (err) {
            logger.warn({ err, agentId: agent.agentId }, "tracking alert send threw");
          }
        }
        if (delivered) {
          alertsSent += 1;
        } else {
          // Total failure — roll the claim back so the next sweep retries.
          await db.delete(agentTrackingAlertsTable).where(eq(agentTrackingAlertsTable.id, claimId));
        }
      }
    } catch (err) {
      logger.warn({ err, tenantId }, "tracking sweep failed for tenant");
    }
  }
  return { tenantsScanned: activeElections.length, alertsSent };
}

/** Start the 60-second monitor. Opt out with AGENT_TRACKING_DISABLED=1. */
let sweepInFlight = false;
export function startAgentTrackingMonitor(): void {
  if (process.env.AGENT_TRACKING_DISABLED === "1") {
    logger.info("agent tracking monitor disabled via AGENT_TRACKING_DISABLED=1");
    return;
  }
  const timer = setInterval(() => {
    if (sweepInFlight) return; // never overlap passes in-process
    sweepInFlight = true;
    runTrackingSweep()
      .catch((err) => logger.warn({ err }, "tracking sweep error"))
      .finally(() => { sweepInFlight = false; });
  }, SWEEP_INTERVAL_MS);
  timer.unref();
  logger.info({ intervalMs: SWEEP_INTERVAL_MS }, "agent tracking monitor started");
}
