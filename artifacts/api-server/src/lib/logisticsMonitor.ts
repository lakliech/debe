/**
 * logisticsMonitor.ts — Election-day operations sweeps for the Logistics &
 * Security Command Center.
 *
 * Two jobs on a 30-minute cadence:
 *  1. Missing-agent detection — agents assigned to a station who have not
 *     checked in by the expected milestone window (+30 min grace) get a
 *     WhatsApp nudge. Dedupe is claim-first via agentTrackingAlertsTable under
 *     a per-agent advisory lock (same pattern as the agent tracking monitor),
 *     so overlapping ticks or extra replicas never double-send.
 *  2. Transport delay detection — assignments whose planned departure passed
 *     >15 min ago without a depart, or whose planned arrival passed >30 min
 *     ago while en route, are marked delayed (idempotent status guard).
 *
 * Opt out with LOGISTICS_MONITOR_DISABLED=1.
 */
import { db } from "@workspace/db";
import {
  electionsTable,
  pollingAgentsTable,
  agentCheckInsTable,
  transportAssignmentsTable,
  agentTrackingAlertsTable,
} from "@workspace/db";
import { eq, and, sql, isNotNull, isNull, lt, inArray } from "drizzle-orm";
import { sendWhatsappChannel } from "./commsDispatcher";
import { logger } from "./logger";

const SWEEP_INTERVAL_MS = 30 * 60_000;
const NUDGE_COOLDOWN_MS = 12 * 3_600_000; // one nudge per agent per milestone per day

/** Expected check-in deadlines in Africa/Nairobi wall-clock time. */
const EXPECTED_WINDOWS: { checkInType: string; hour: number; minute: number }[] = [
  { checkInType: "arrival", hour: 6, minute: 0 },
  { checkInType: "voting_started", hour: 9, minute: 0 },
  { checkInType: "voting_ended", hour: 17, minute: 0 },
  { checkInType: "results_submitted", hour: 21, minute: 0 },
];
const GRACE_MINUTES = 30;

function nairobiNow(): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

/** Milestones whose deadline (+grace) has passed, latest first. */
function dueMilestones(nowMinutes: number): string[] {
  return EXPECTED_WINDOWS
    .filter((w) => nowMinutes > w.hour * 60 + w.minute + GRACE_MINUTES)
    .map((w) => w.checkInType)
    .reverse();
}

/** (tenant, election) pairs where election-day sweeps are meaningful today. */
async function activeElectionPairs(nairobiDate: string): Promise<{ tenantId: string; electionId: string }[]> {
  // Filter in SQL — elections.election_date is text ("YYYY-MM-DD" or ISO), so a
  // lexicographic left(...,10) match works and avoids a full-table scan per sweep.
  const rows = await db
    .select({ tenantId: electionsTable.tenantId, electionId: electionsTable.id })
    .from(electionsTable)
    .where(sql`left(${electionsTable.electionDate}, 10) = ${nairobiDate}`);
  const pairs: { tenantId: string; electionId: string }[] = [];
  for (const r of rows) {
    if (r.tenantId) pairs.push({ tenantId: r.tenantId, electionId: r.electionId });
  }
  // Fallback: elections with check-in activity in the last 24h are live.
  const since = new Date(Date.now() - 24 * 3_600_000);
  const active = await db
    .selectDistinct({ tenantId: agentCheckInsTable.tenantId, electionId: agentCheckInsTable.electionId })
    .from(agentCheckInsTable)
    .where(sql`${agentCheckInsTable.createdAt} > ${since}`);
  for (const a of active) {
    if (!pairs.some((p) => p.tenantId === a.tenantId && p.electionId === a.electionId)) pairs.push(a);
  }
  return pairs;
}

async function nudgeMissingAgents(tenantId: string, electionId: string, nairobiDate: string, nowMinutes: number): Promise<number> {
  const due = dueMilestones(nowMinutes);
  if (due.length === 0) return 0;
  const checkInType = due[0]; // latest missed milestone
  const missing = await db
    .select({
      agentId: pollingAgentsTable.id,
      fullName: pollingAgentsTable.fullName,
      phoneNumber: pollingAgentsTable.phoneNumber,
    })
    .from(pollingAgentsTable)
    .where(and(
      eq(pollingAgentsTable.tenantId, tenantId),
      eq(pollingAgentsTable.status, "active"),
      isNotNull(pollingAgentsTable.pollingStationId),
      isNull(sql`(
        SELECT c.id FROM agent_check_ins c
        WHERE c.tenant_id = ${tenantId} AND c.election_id = ${electionId}
          AND c.agent_id = ${pollingAgentsTable.id} AND c.check_in_type = ${checkInType}
        LIMIT 1
      )`),
    ));

  let nudged = 0;
  const kind = `checkin_nudge:${checkInType}:${nairobiDate}`;
  for (const agent of missing) {
    if (!agent.phoneNumber) continue;
    const claimId = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${tenantId}:${agent.agentId}:${kind}`}))`);
      const [recent] = await tx
        .select({ id: agentTrackingAlertsTable.id })
        .from(agentTrackingAlertsTable)
        .where(and(
          eq(agentTrackingAlertsTable.tenantId, tenantId),
          eq(agentTrackingAlertsTable.agentId, agent.agentId),
          eq(agentTrackingAlertsTable.kind, kind),
        ))
        .limit(1);
      if (recent) return null;
      const [claim] = await tx
        .insert(agentTrackingAlertsTable)
        .values({ tenantId, agentId: agent.agentId, electionId, kind } as any)
        .returning({ id: agentTrackingAlertsTable.id });
      return claim.id as string;
    });
    if (!claimId) continue;

    const message = `Ushindi Command Center: you have not checked in ("${checkInType}") at your polling station. Please confirm your status by checking in, or reply if you need help.`;
    const res = await sendWhatsappChannel(tenantId, agent.phoneNumber, message).catch((err) => ({ ok: false, error: String(err) }));
    if (res.ok) {
      nudged += 1;
    } else {
      // Roll the claim back so the next sweep retries instead of going silent.
      await db.delete(agentTrackingAlertsTable).where(eq(agentTrackingAlertsTable.id, claimId));
      logger.warn({ err: res.error, agentId: agent.agentId }, "check-in nudge send failed");
    }
  }
  return nudged;
}

async function flagDelayedTransport(): Promise<number> {
  // Scheduled but never departed >15 min after planned departure.
  const lateDepartures = await db.update(transportAssignmentsTable)
    .set({ status: "delayed", delayReason: "Auto: departure not recorded within 15 min of schedule" })
    .where(and(
      eq(transportAssignmentsTable.status, "scheduled"),
      isNotNull(transportAssignmentsTable.plannedDepartureAt),
      lt(transportAssignmentsTable.plannedDepartureAt, new Date(Date.now() - 15 * 60_000)),
    ))
    .returning({ id: transportAssignmentsTable.id });
  // En route but planned arrival passed >30 min ago.
  const lateArrivals = await db.update(transportAssignmentsTable)
    .set({ status: "delayed", delayReason: "Auto: arrival overdue by more than 30 min" })
    .where(and(
      eq(transportAssignmentsTable.status, "en_route"),
      isNotNull(transportAssignmentsTable.plannedArrivalAt),
      lt(transportAssignmentsTable.plannedArrivalAt, new Date(Date.now() - 30 * 60_000)),
    ))
    .returning({ id: transportAssignmentsTable.id });
  return lateDepartures.length + lateArrivals.length;
}

export async function runLogisticsSweep(): Promise<{ pairs: number; nudged: number; delayed: number }> {
  const { date, minutes } = nairobiNow();
  const pairs = await activeElectionPairs(date);
  let nudged = 0;
  for (const p of pairs) {
    try {
      nudged += await nudgeMissingAgents(p.tenantId, p.electionId, date, minutes);
    } catch (err) {
      logger.warn({ err, tenantId: p.tenantId }, "logistics sweep failed for tenant");
    }
  }
  const delayed = await flagDelayedTransport().catch((err) => {
    logger.warn({ err }, "transport delay sweep failed");
    return 0;
  });
  return { pairs: pairs.length, nudged, delayed };
}

let sweepInFlight = false;
export function startLogisticsMonitor(): void {
  if (process.env.LOGISTICS_MONITOR_DISABLED === "1") {
    logger.info("logistics monitor disabled via LOGISTICS_MONITOR_DISABLED=1");
    return;
  }
  const timer = setInterval(() => {
    if (sweepInFlight) return; // never overlap passes in-process
    sweepInFlight = true;
    runLogisticsSweep()
      .catch((err) => logger.warn({ err }, "logistics sweep error"))
      .finally(() => { sweepInFlight = false; });
  }, SWEEP_INTERVAL_MS);
  timer.unref();
  logger.info({ intervalMs: SWEEP_INTERVAL_MS }, "logistics monitor started");
}
