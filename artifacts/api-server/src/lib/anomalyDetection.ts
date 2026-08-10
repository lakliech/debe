/**
 * Anomaly Detection Engine
 *
 * Scores every result submission for statistical and procedural fraud signals
 * BEFORE it reaches human verification. Six detectors, each contributing a
 * weight to a 0-100 anomaly score:
 *
 *   impossible_turnout   40  totalVotesCast > registeredVoters × 1.05
 *   duplicate_pattern    35  identical vote vector at an unrelated station
 *   gps_impossible       30  agent GPS >500 m from the assigned station
 *   statistical_outlier  25  leading candidate share >3σ from county mean
 *   round_number_bias    15  ≥80% of candidate counts are round numbers
 *   temporal_anomaly     10  submitted in deep-night hours (00:00–04:59 EAT)
 *
 * Score ≥ HIGH_RISK_THRESHOLD auto-escalates the submission to `exception`
 * (dropping its votes from the tally, mirroring the auto-validation path).
 * Runs fire-and-forget on submit plus a 60 s backstop worker; evaluation is
 * idempotent (anomalyEvaluatedAt) and flags are wholesale-replaced on re-run.
 */

import { logger } from "./logger";
import { db } from "@workspace/db";
import {
  resultSubmissionsTable,
  resultAnomalyFlagsTable,
  submissionCandidateVotesTable,
  submissionVerificationStepsTable,
  pollingStationsTable,
} from "@workspace/db";
import { and, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import { createHash } from "node:crypto";

const POLL_MS = 60_000;
// "exception" submissions (auto-validation failures) are still scored so the
// queue shows anomaly context — but evaluation never moves their status.
const EVALUABLE_STATUSES = ["submitted", "auto_validated", "exception"] as const;

/** Score at/above which a submission is auto-escalated to exception. */
export const HIGH_RISK_THRESHOLD = 50;

export const ANOMALY_WEIGHTS = {
  impossible_turnout: 40,
  duplicate_pattern: 35,
  gps_impossible: 30,
  statistical_outlier: 25,
  round_number_bias: 15,
  temporal_anomaly: 10,
} as const;
export type AnomalyType = keyof typeof ANOMALY_WEIGHTS;

export interface AnomalyHit {
  type: AnomalyType;
  weight: number;
  details: Record<string, unknown>;
}

export interface DetectorInput {
  totalVotesCast: number | null;
  registeredVoters: number | null;
  totalValidVotes: number | null;
  votes: { candidateName: string; voteCount: number }[];
  gpsLat: number | null;
  gpsLon: number | null;
  stationLat: number | null;
  stationLon: number | null;
  submittedAt: Date | null;
  /** Leading-candidate share (0–1) of peer submissions in the same county. */
  countyPeerLeadingShares: number[];
  /** Set when another station in this tenant+election has an identical vector. */
  duplicateOfSubmissionId: string | null;
}

// ── Pure detectors ────────────────────────────────────────────────────────────

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Hour of day in Africa/Nairobi (UTC+3, no DST) — polling-day context. */
export function eatHour(ts: Date): number {
  return new Date(ts.getTime() + 3 * 3_600_000).getUTCHours();
}

export function detectImpossibleTurnout(cast: number | null, registered: number | null): AnomalyHit | null {
  if (cast == null || registered == null || registered <= 0) return null;
  if (cast > registered * 1.05) {
    return {
      type: "impossible_turnout",
      weight: ANOMALY_WEIGHTS.impossible_turnout,
      details: { totalVotesCast: cast, registeredVoters: registered, ratio: Math.round((cast / registered) * 1000) / 1000 },
    };
  }
  return null;
}

export function detectDuplicatePattern(matchedSubmissionId: string | null): AnomalyHit | null {
  if (!matchedSubmissionId) return null;
  return {
    type: "duplicate_pattern",
    weight: ANOMALY_WEIGHTS.duplicate_pattern,
    details: { matchedSubmissionId },
  };
}

export function detectGpsImpossible(
  gpsLat: number | null, gpsLon: number | null,
  stationLat: number | null, stationLon: number | null,
): AnomalyHit | null {
  if (gpsLat == null || gpsLon == null || stationLat == null || stationLon == null) return null;
  const distanceM = haversineMeters(gpsLat, gpsLon, stationLat, stationLon);
  if (distanceM > 500) {
    return {
      type: "gps_impossible",
      weight: ANOMALY_WEIGHTS.gps_impossible,
      details: { distanceM: Math.round(distanceM), thresholdM: 500 },
    };
  }
  return null;
}

export function detectStatisticalOutlier(leadingShare: number | null, peerShares: number[]): AnomalyHit | null {
  // Need a meaningful peer sample — below this, σ is noise.
  if (leadingShare == null || peerShares.length < 8) return null;
  const mean = peerShares.reduce((s, v) => s + v, 0) / peerShares.length;
  const variance = peerShares.reduce((s, v) => s + (v - mean) ** 2, 0) / peerShares.length;
  const std = Math.sqrt(variance);
  if (std > 0 && leadingShare > mean + 3 * std) {
    return {
      type: "statistical_outlier",
      weight: ANOMALY_WEIGHTS.statistical_outlier,
      details: {
        leadingShare: Math.round(leadingShare * 1000) / 1000,
        countyMean: Math.round(mean * 1000) / 1000,
        stddev: Math.round(std * 1000) / 1000,
        peers: peerShares.length,
      },
    };
  }
  return null;
}

export function detectRoundNumberBias(
  votes: { candidateName: string; voteCount: number }[],
  totalValidVotes: number | null,
): AnomalyHit | null {
  // Meaningful sample only: several candidates and a non-trivial count.
  if (votes.length < 3 || totalValidVotes == null || totalValidVotes < 100) return null;
  const roundShare = votes.filter((v) => v.voteCount % 10 === 0).length / votes.length;
  if (roundShare >= 0.8) {
    return {
      type: "round_number_bias",
      weight: ANOMALY_WEIGHTS.round_number_bias,
      details: { roundShare: Math.round(roundShare * 100) / 100, candidates: votes.length },
    };
  }
  return null;
}

export function detectTemporalAnomaly(submittedAt: Date | null): AnomalyHit | null {
  if (!submittedAt) return null;
  // Polling runs 06:00–17:00 EAT; counting and transport make evening filings
  // normal. Deep-night submissions (00:00–04:59) have no innocent explanation.
  const hour = eatHour(submittedAt);
  if (hour < 5) {
    return {
      type: "temporal_anomaly",
      weight: ANOMALY_WEIGHTS.temporal_anomaly,
      details: { submittedAt: submittedAt.toISOString(), eatHour: hour },
    };
  }
  return null;
}

export function runDetectors(input: DetectorInput): AnomalyHit[] {
  const leadingShare = input.totalValidVotes && input.totalValidVotes > 0 && input.votes.length > 0
    ? Math.max(...input.votes.map((v) => v.voteCount)) / input.totalValidVotes
    : null;
  return [
    detectImpossibleTurnout(input.totalVotesCast, input.registeredVoters),
    detectDuplicatePattern(input.duplicateOfSubmissionId),
    detectGpsImpossible(input.gpsLat, input.gpsLon, input.stationLat, input.stationLon),
    detectStatisticalOutlier(leadingShare, input.countyPeerLeadingShares),
    detectRoundNumberBias(input.votes, input.totalValidVotes),
    detectTemporalAnomaly(input.submittedAt),
  ].filter((h): h is AnomalyHit => h !== null);
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

function hashVoteVector(votes: { candidateName: string; voteCount: number }[]): string {
  const vector = votes.map((v) => `${v.candidateName}:${v.voteCount}`).sort().join("|");
  return createHash("sha256").update(vector).digest("hex");
}

/**
 * Evaluate one submission. Idempotent: submissions with anomalyEvaluatedAt
 * set are skipped (the /correct endpoint clears it to force re-evaluation).
 * Only pre-verification statuses are eligible — anything further along the
 * pipeline is already in human hands.
 */
export async function evaluateSubmission(
  submissionId: string,
  tenantId: string,
): Promise<{ score: number; flags: AnomalyHit[]; escalated: boolean } | null> {
  const [sub] = await db.select().from(resultSubmissionsTable)
    .where(and(eq(resultSubmissionsTable.id, submissionId), eq(resultSubmissionsTable.tenantId, tenantId)))
    .limit(1);
  if (!sub || sub.anomalyEvaluatedAt) return null;
  if (!(EVALUABLE_STATUSES as readonly string[]).includes(sub.status)) return null;

  const [station] = await db.select({
    registeredVoters: pollingStationsTable.registeredVoters,
    latitude: pollingStationsTable.latitude,
    longitude: pollingStationsTable.longitude,
    countyId: pollingStationsTable.countyId,
  }).from(pollingStationsTable).where(eq(pollingStationsTable.id, sub.pollingStationId)).limit(1);

  // Own votes: the only per-candidate rows this evaluation materialises.
  const ownVotes = await db.select({
    candidateName: submissionCandidateVotesTable.candidateName,
    voteCount: submissionCandidateVotesTable.voteCount,
  }).from(submissionCandidateVotesTable)
    .where(eq(submissionCandidateVotesTable.submissionId, submissionId));
  const ownTotal = sub.totalValidVotes ?? 0;
  const ownVectorHash = ownVotes.length > 0 ? hashVoteVector(ownVotes) : null;

  // Duplicate pattern — O(1) indexed lookup on the stored vector hash instead
  // of a full tenant scan. Hashes are written at evaluation time; a peer not
  // yet evaluated has no hash, but the symmetric re-evaluation below catches
  // the pair from the other side.
  let duplicateOf: string | null = null;
  if (ownVectorHash && ownTotal >= 50) {
    const [dup] = await db.select({ id: resultSubmissionsTable.id })
      .from(resultSubmissionsTable)
      .where(and(
        eq(resultSubmissionsTable.tenantId, tenantId),
        eq(resultSubmissionsTable.electionId, sub.electionId),
        eq(resultSubmissionsTable.voteVectorHash, ownVectorHash),
        ne(resultSubmissionsTable.id, submissionId),
        ne(resultSubmissionsTable.pollingStationId, sub.pollingStationId),
        gte(resultSubmissionsTable.totalValidVotes, 50),
      ))
      .limit(1);
    duplicateOf = dup?.id ?? null;
  }

  // County peers — one grouped query returns a leading share per submission;
  // raw candidate rows never leave the database.
  let peerShares: number[] = [];
  if (station) {
    const rows = await db.select({
      share: sql<number>`max(${submissionCandidateVotesTable.voteCount})::float / ${resultSubmissionsTable.totalValidVotes}`,
    })
      .from(resultSubmissionsTable)
      .innerJoin(submissionCandidateVotesTable, eq(submissionCandidateVotesTable.submissionId, resultSubmissionsTable.id))
      .innerJoin(pollingStationsTable, eq(pollingStationsTable.id, resultSubmissionsTable.pollingStationId))
      .where(and(
        eq(resultSubmissionsTable.tenantId, tenantId),
        eq(resultSubmissionsTable.electionId, sub.electionId),
        eq(pollingStationsTable.countyId, station.countyId),
        ne(resultSubmissionsTable.status, "draft"),
        ne(resultSubmissionsTable.id, submissionId),
        gte(resultSubmissionsTable.totalValidVotes, 20),
      ))
      .groupBy(resultSubmissionsTable.id, resultSubmissionsTable.totalValidVotes);
    peerShares = rows.map((r) => Number(r.share)).filter((n) => Number.isFinite(n));
  }

  const hits = runDetectors({
    totalVotesCast: sub.totalVotesCast,
    registeredVoters: sub.registeredVoters ?? station?.registeredVoters ?? null,
    totalValidVotes: sub.totalValidVotes,
    votes: ownVotes,
    gpsLat: sub.gpsLat,
    gpsLon: sub.gpsLon,
    stationLat: station?.latitude ?? null,
    stationLon: station?.longitude ?? null,
    submittedAt: sub.submittedAt,
    countyPeerLeadingShares: peerShares,
    duplicateOfSubmissionId: duplicateOf,
  });
  const score = Math.min(100, hits.reduce((s, h) => s + h.weight, 0));
  // Auto-validation exceptions are already out of the flow — score them for
  // context, but never "escalate" (their votes are already off the tally).
  const escalated = score >= HIGH_RISK_THRESHOLD && sub.status !== "exception";

  // Claim FIRST, then write effects: if a human advanced the submission while
  // we computed, the guarded update matches zero rows and the transaction
  // commits nothing — no orphan flags, no stale escalation.
  let committed = false;
  await db.transaction(async (tx) => {
    const [updated] = await tx.update(resultSubmissionsTable)
      .set({
        anomalyScore: score,
        anomalyEvaluatedAt: new Date(),
        voteVectorHash: ownVectorHash,
        ...(escalated ? { status: "exception" } : {}),
      })
      .where(and(
        eq(resultSubmissionsTable.id, submissionId),
        eq(resultSubmissionsTable.tenantId, tenantId),
        inArray(resultSubmissionsTable.status, [...EVALUABLE_STATUSES]),
        // Exclusive claim: exactly one concurrent evaluator wins. The loser's
        // update blocks on the row lock, then matches zero rows once the
        // winner has stamped anomalyEvaluatedAt — and commits nothing.
        isNull(resultSubmissionsTable.anomalyEvaluatedAt),
      ))
      .returning();
    if (!updated) return;

    committed = true;
    // Wholesale flag replacement — re-evaluation never leaves stale flags.
    await tx.delete(resultAnomalyFlagsTable)
      .where(eq(resultAnomalyFlagsTable.submissionId, submissionId));
    if (hits.length > 0) {
      await tx.insert(resultAnomalyFlagsTable).values(
        hits.map((h) => ({ submissionId, tenantId, type: h.type, weight: h.weight, details: h.details })),
      );
    }

    if (escalated) {
      // High-risk submissions auto-skip to exception — and their votes drop
      // out of the tally exactly like an auto-validation failure does.
      await tx.update(submissionCandidateVotesTable)
        .set({ isVerified: false })
        .where(eq(submissionCandidateVotesTable.submissionId, submissionId));
      await tx.insert(submissionVerificationStepsTable).values({
        submissionId,
        fromStatus: sub.status,
        toStatus: "exception",
        action: "queried",
        notes: `Anomaly engine: score ${score} — ${hits.map((h) => h.type).join(", ")}`,
      });
    }
  });
  if (!committed) return null;

  // Duplicate findings must be symmetric: the earlier submission was scored
  // before this one existed, so it carries no duplicate flag. Queue exactly
  // ONE re-evaluation of the matched submission — guarded on it not already
  // carrying the flag, otherwise a matched pair would ping-pong forever.
  if (duplicateOf) {
    const [alreadyFlagged] = await db.select({ id: resultAnomalyFlagsTable.id })
      .from(resultAnomalyFlagsTable)
      .where(and(
        eq(resultAnomalyFlagsTable.submissionId, duplicateOf),
        eq(resultAnomalyFlagsTable.type, "duplicate_pattern"),
      ))
      .limit(1);
    if (!alreadyFlagged) {
      await db.update(resultSubmissionsTable)
        .set({ anomalyEvaluatedAt: null })
        .where(and(
          eq(resultSubmissionsTable.id, duplicateOf),
          inArray(resultSubmissionsTable.status, [...EVALUABLE_STATUSES]),
        ));
    }
  }

  if (escalated) {
    logger.warn({ submissionId, tenantId, score, flags: hits.map((h) => h.type) },
      "anomaly engine escalated submission to exception");
  }
  return { score, flags: hits, escalated };
}

/** Backstop sweep: evaluate everything pending that has no score yet. */
export async function evaluatePendingAnomalies(opts?: { limit?: number }): Promise<{ scanned: number; evaluated: number }> {
  const limit = opts?.limit ?? 25;
  const pending = await db.select({
    id: resultSubmissionsTable.id,
    tenantId: resultSubmissionsTable.tenantId,
  }).from(resultSubmissionsTable)
    .where(and(
      inArray(resultSubmissionsTable.status, [...EVALUABLE_STATUSES]),
      isNull(resultSubmissionsTable.anomalyEvaluatedAt),
    ))
    .orderBy(resultSubmissionsTable.submittedAt)
    .limit(limit);

  let evaluated = 0;
  for (const row of pending) {
    if (!row.tenantId) continue;
    try {
      const result = await evaluateSubmission(row.id, row.tenantId);
      if (result) evaluated++;
    } catch (err) {
      // One bad submission must never stall the sweep.
      logger.error({ err, submissionId: row.id }, "anomaly evaluation failed");
    }
  }
  return { scanned: pending.length, evaluated };
}

let started = false;

export function startAnomalyDetector() {
  if (started) return;
  started = true;
  if (process.env.ANOMALY_DETECTOR_DISABLED === "1") {
    logger.info("Anomaly detector disabled (ANOMALY_DETECTOR_DISABLED=1)");
    return;
  }
  const tick = () => {
    evaluatePendingAnomalies().catch((err) => logger.error({ err }, "anomaly detector tick failed"));
  };
  // Stagger the first tick so boot-time migrations/seeds settle first.
  setTimeout(tick, 15_000).unref();
  setInterval(tick, POLL_MS).unref();
  logger.info({ pollMs: POLL_MS, highRiskThreshold: HIGH_RISK_THRESHOLD }, "Anomaly detector started");
}
