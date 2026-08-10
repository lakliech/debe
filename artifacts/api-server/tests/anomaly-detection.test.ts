/**
 * Anomaly detection engine — pure detectors (boundary behaviour) plus
 * DB-backed evaluation: score persistence, high-risk auto-escalation to
 * exception (with tally flag sync + audit step), duplicate-pattern pairing,
 * idempotency, and the pending-sweep worker contract.
 *
 * Run: pnpm --filter @workspace/api-server exec vitest run tests/anomaly-detection.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import {
  tenantsTable,
  electionsTable,
  resultSubmissionsTable,
  submissionCandidateVotesTable,
  submissionVerificationStepsTable,
  resultAnomalyFlagsTable,
  countiesTable,
  constituenciesTable,
  wardsTable,
  pollingCentresTable,
  pollingStationsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  evaluateSubmission,
  evaluatePendingAnomalies,
  detectImpossibleTurnout,
  detectRoundNumberBias,
  detectTemporalAnomaly,
  detectGpsImpossible,
  detectStatisticalOutlier,
  haversineMeters,
  HIGH_RISK_THRESHOLD,
} from "../src/lib/anomalyDetection";

const UNIQ = randomUUID().slice(0, 8);
let tenantId: string;
let electionId: string;
let countyId: string;
let constituencyId: string;
let wardId: string;
let centreId: string;
let stationA: string; // has GPS — sub1's station
let stationB: string; // clean
let stationC: string; // duplicate pair 1
let stationD: string; // duplicate pair 2
let stationE: string; // sweep target

async function makeStation(code: string, lat?: number, lon?: number): Promise<string> {
  const [s] = await db.insert(pollingStationsTable).values({
    code: `ANM-${UNIQ}-${code}`,
    name: `Anomaly Station ${code} ${UNIQ}`,
    centreId, wardId, constituencyId, countyId,
    registeredVoters: 1000,
    ...(lat !== undefined ? { latitude: lat, longitude: lon } : {}),
  } as any).returning();
  return s.id;
}

async function makeSubmission(opts: {
  stationId: string;
  status?: string;
  cast: number;
  registered?: number;
  votes: [string, number][];
  gps?: [number, number];
  submittedAt?: Date;
}): Promise<string> {
  const totalValid = opts.votes.reduce((s, [, c]) => s + c, 0);
  const [sub] = await db.insert(resultSubmissionsTable).values({
    tenantId,
    pollingStationId: opts.stationId,
    electionId,
    agentId: randomUUID(),
    status: opts.status ?? "submitted",
    registeredVoters: opts.registered ?? 1000,
    totalVotesCast: opts.cast,
    totalValidVotes: totalValid,
    submittedAt: opts.submittedAt ?? new Date("2099-08-10T11:00:00Z"), // 14:00 EAT — normal
    ...(opts.gps ? { gpsLat: opts.gps[0], gpsLon: opts.gps[1] } : {}),
  } as any).returning();
  await db.insert(submissionCandidateVotesTable).values(
    opts.votes.map(([candidateName, voteCount]) => ({ submissionId: sub.id, candidateName, voteCount })) as any,
  );
  return sub.id;
}

beforeAll(async () => {
  const [tenant] = await db.insert(tenantsTable).values({ name: "Anomaly Test", slug: `anm-${UNIQ}` } as any).returning();
  tenantId = tenant.id;
  const [election] = await db.insert(electionsTable).values({ tenantId, name: "Anomaly Election", year: 2099 } as any).returning();
  electionId = election.id;

  const codeBase = 700000 + Math.floor(Math.random() * 99999); // codes are integers; random avoids cross-suite collisions
  const [county] = await db.insert(countiesTable).values({ code: codeBase, name: `Anomaly County ${UNIQ}` } as any).returning();
  countyId = county.id;
  const [con] = await db.insert(constituenciesTable).values({ code: codeBase + 1, name: `Anomaly Con ${UNIQ}`, countyId } as any).returning();
  constituencyId = con.id;
  const [ward] = await db.insert(wardsTable).values({ code: codeBase + 2, name: `Anomaly Ward ${UNIQ}`, constituencyId, countyId } as any).returning();
  wardId = ward.id;
  const [centre] = await db.insert(pollingCentresTable).values({ name: `Anomaly Centre ${UNIQ}`, wardId, constituencyId, countyId } as any).returning();
  centreId = centre.id;

  stationA = await makeStation("A", -1.2921, 36.8219);
  stationB = await makeStation("B", -1.3000, 36.8300);
  stationC = await makeStation("C");
  stationD = await makeStation("D");
  stationE = await makeStation("E");
});

afterAll(async () => {
  // Tenant delete cascades submissions, votes, flags, steps, election.
  await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
  for (const id of [stationA, stationB, stationC, stationD, stationE]) {
    await db.delete(pollingStationsTable).where(eq(pollingStationsTable.id, id));
  }
  await db.delete(pollingCentresTable).where(eq(pollingCentresTable.id, centreId));
  await db.delete(wardsTable).where(eq(wardsTable.id, wardId));
  await db.delete(constituenciesTable).where(eq(constituenciesTable.id, constituencyId));
  await db.delete(countiesTable).where(eq(countiesTable.id, countyId));
});

describe("pure detectors", () => {
  it("impossible turnout trips only above the 105% boundary", () => {
    expect(detectImpossibleTurnout(105, 100)).toBeNull(); // exactly 105% is allowed
    expect(detectImpossibleTurnout(106, 100)?.type).toBe("impossible_turnout");
    expect(detectImpossibleTurnout(2000, 1000)?.details.ratio).toBe(2);
    expect(detectImpossibleTurnout(null, 100)).toBeNull(); // missing data → no flag
  });

  it("round-number bias needs ≥3 candidates, ≥100 votes, ≥80% round", () => {
    const votes = (arr: [string, number][]) => arr.map(([candidateName, voteCount]) => ({ candidateName, voteCount }));
    expect(detectRoundNumberBias(votes([["A", 150], ["B", 100], ["C", 50]]), 300)?.type).toBe("round_number_bias");
    expect(detectRoundNumberBias(votes([["A", 150], ["B", 100], ["C", 51]]), 301)).toBeNull(); // 2/3 round
    expect(detectRoundNumberBias(votes([["A", 120], ["B", 80]]), 200)).toBeNull(); // too few candidates
    expect(detectRoundNumberBias(votes([["A", 30], ["B", 20], ["C", 10]]), 60)).toBeNull(); // too few votes
  });

  it("temporal anomaly flags deep-night EAT submissions only", () => {
    expect(detectTemporalAnomaly(new Date("2099-08-10T00:30:00Z"))?.type).toBe("temporal_anomaly"); // 03:30 EAT
    expect(detectTemporalAnomaly(new Date("2099-08-10T11:00:00Z"))).toBeNull(); // 14:00 EAT
    expect(detectTemporalAnomaly(new Date("2099-08-10T20:30:00Z"))).toBeNull(); // 23:30 EAT — late counting, plausible
    expect(detectTemporalAnomaly(null)).toBeNull();
  });

  it("gps impossibility trips beyond 500 m", () => {
    expect(haversineMeters(-1.2921, 36.8219, -1.2971, 36.8219)).toBeGreaterThan(500); // ~556 m north
    expect(detectGpsImpossible(-1.2971, 36.8219, -1.2921, 36.8219)?.type).toBe("gps_impossible");
    expect(detectGpsImpossible(-1.2926, 36.8219, -1.2921, 36.8219)).toBeNull(); // ~56 m — at the station
    expect(detectGpsImpossible(null, null, -1.2921, 36.8219)).toBeNull(); // no fix captured
  });

  it("statistical outlier needs ≥8 peers and >3σ", () => {
    const peers = [0.40, 0.42, 0.38, 0.41, 0.39, 0.43, 0.37, 0.44];
    expect(detectStatisticalOutlier(0.95, peers)?.type).toBe("statistical_outlier");
    expect(detectStatisticalOutlier(0.45, peers)).toBeNull();
    expect(detectStatisticalOutlier(0.95, peers.slice(0, 4))).toBeNull(); // sample too small
    expect(detectStatisticalOutlier(null, peers)).toBeNull();
  });
});

describe("evaluateSubmission (DB-backed)", () => {
  it("escalates a high-risk submission to exception with tally flag sync + audit", async () => {
    // 2000 cast vs 1000 registered (impossible_turnout 40) + GPS ~2 km away (30) = 70.
    const subId = await makeSubmission({
      stationId: stationA, cast: 2000, votes: [["Alpha", 1200], ["Beta", 800]],
      gps: [-1.3101, 36.8219], // ~2 km from station A
    });

    const result = await evaluateSubmission(subId, tenantId);
    expect(result).not.toBeNull();
    expect(result!.score).toBe(70);
    expect(result!.escalated).toBe(true);
    expect(result!.score).toBeGreaterThanOrEqual(HIGH_RISK_THRESHOLD);

    const [sub] = await db.select().from(resultSubmissionsTable)
      .where(eq(resultSubmissionsTable.id, subId));
    expect(sub.status).toBe("exception");
    expect(sub.anomalyScore).toBe(70);
    expect(sub.anomalyEvaluatedAt).not.toBeNull();

    // Votes dropped out of the tally, exactly like an auto-validation failure.
    const votes = await db.select().from(submissionCandidateVotesTable)
      .where(eq(submissionCandidateVotesTable.submissionId, subId));
    expect(votes.every((v) => !v.isVerified)).toBe(true);

    const flags = await db.select().from(resultAnomalyFlagsTable)
      .where(eq(resultAnomalyFlagsTable.submissionId, subId));
    expect(flags.map((f) => f.type).sort()).toEqual(["gps_impossible", "impossible_turnout"]);

    const [step] = await db.select().from(submissionVerificationStepsTable)
      .where(and(eq(submissionVerificationStepsTable.submissionId, subId), eq(submissionVerificationStepsTable.toStatus, "exception")));
    expect(step.notes).toContain("Anomaly engine");
  });

  it("is idempotent — a second evaluation is a no-op", async () => {
    const [flagged] = await db.select({ submissionId: resultAnomalyFlagsTable.submissionId })
      .from(resultAnomalyFlagsTable)
      .where(eq(resultAnomalyFlagsTable.tenantId, tenantId)).limit(1);
    const again = await evaluateSubmission(flagged.submissionId, tenantId);
    expect(again).toBeNull(); // anomalyEvaluatedAt already set
  });

  it("scores a clean submission 0 and leaves its status alone", async () => {
    const subId = await makeSubmission({
      stationId: stationB, cast: 400, votes: [["Alpha", 203], ["Beta", 197]],
      gps: [-1.3000, 36.8300],
    });
    const result = await evaluateSubmission(subId, tenantId);
    expect(result!.score).toBe(0);
    expect(result!.flags).toHaveLength(0);
    const [sub] = await db.select().from(resultSubmissionsTable).where(eq(resultSubmissionsTable.id, subId));
    expect(sub.status).toBe("submitted");
    expect(sub.anomalyScore).toBe(0);
  });

  it("flags identical vote vectors at unrelated stations as a duplicate pattern", async () => {
    const votes: [string, number][] = [["Alpha", 150], ["Beta", 100], ["Gamma", 51]];
    const sub1 = await makeSubmission({ stationId: stationC, cast: 301, votes });
    const sub2 = await makeSubmission({ stationId: stationD, cast: 301, votes });

    // First evaluation runs before the second submission has a stored vector
    // hash — no match yet. The second finds the first via its hash, then the
    // sweep re-scores the first symmetrically.
    const r1 = await evaluateSubmission(sub1, tenantId);
    expect(r1!.score).toBe(0);
    const r2 = await evaluateSubmission(sub2, tenantId);
    expect(r2!.score).toBe(35); // duplicate_pattern only (51 breaks the round-number rule)
    expect(r2!.escalated).toBe(false);

    await evaluatePendingAnomalies({ limit: 50 });
    const f1 = await db.select().from(resultAnomalyFlagsTable).where(eq(resultAnomalyFlagsTable.submissionId, sub1));
    expect(f1.map((f) => f.type)).toContain("duplicate_pattern");
    expect((f1[0].details as any).matchedSubmissionId).toBe(sub2);
  });

  it("claims exclusively under concurrency — exactly one audit row", async () => {
    const subId = await makeSubmission({
      stationId: stationA, cast: 3000, votes: [["Alpha", 1800], ["Beta", 1200]],
      gps: [-1.3101, 36.8219], // ~2 km from station A → score 70, escalates
    });
    const [r1, r2] = await Promise.all([
      evaluateSubmission(subId, tenantId),
      evaluateSubmission(subId, tenantId),
    ]);
    expect([r1, r2].filter((r) => r !== null)).toHaveLength(1); // one winner
    const steps = await db.select().from(submissionVerificationStepsTable)
      .where(eq(submissionVerificationStepsTable.submissionId, subId));
    expect(steps).toHaveLength(1);
    const flags = await db.select().from(resultAnomalyFlagsTable)
      .where(eq(resultAnomalyFlagsTable.submissionId, subId));
    expect(flags).toHaveLength(2); // impossible_turnout + gps_impossible
  });

  it("symmetric: an earlier submission is re-scored when its duplicate arrives later", async () => {
    // Real hook ordering: the first submission is evaluated BEFORE the second exists.
    const votes: [string, number][] = [["Alpha", 210], ["Beta", 90], ["Gamma", 33]];
    const early = await makeSubmission({ stationId: stationC, cast: 333, votes });
    const first = await evaluateSubmission(early, tenantId);
    expect(first!.score).toBe(0); // no peer yet — nothing to match

    const late = await makeSubmission({ stationId: stationD, cast: 333, votes });
    const second = await evaluateSubmission(late, tenantId);
    expect(second!.score).toBe(35); // late one flags immediately

    // The match invalidates the earlier submission's evaluation; the sweep re-scores it.
    await evaluatePendingAnomalies({ limit: 50 });
    const flags = await db.select().from(resultAnomalyFlagsTable)
      .where(eq(resultAnomalyFlagsTable.submissionId, early));
    expect(flags.map((f) => f.type)).toContain("duplicate_pattern");
    const [rescore] = await db.select().from(resultSubmissionsTable).where(eq(resultSubmissionsTable.id, early));
    expect(rescore.anomalyScore).toBe(35);
  });

  it("scores auto-validation exceptions for context without moving their status", async () => {
    const subId = await makeSubmission({
      stationId: stationE, status: "exception", cast: 1500, votes: [["Alpha", 900], ["Beta", 600]],
    });
    const result = await evaluateSubmission(subId, tenantId);
    expect(result).not.toBeNull();
    expect(result!.score).toBe(40); // impossible_turnout only
    expect(result!.escalated).toBe(false);

    const [sub] = await db.select().from(resultSubmissionsTable).where(eq(resultSubmissionsTable.id, subId));
    expect(sub.status).toBe("exception"); // unchanged
    expect(sub.anomalyScore).toBe(40);

    // Votes were already off the tally (auto-validation) — left exactly as found.
    const votes = await db.select().from(submissionCandidateVotesTable)
      .where(eq(submissionCandidateVotesTable.submissionId, subId));
    expect(votes.every((v) => !v.isVerified)).toBe(true);
    // No audit step: the engine transitioned nothing.
    const steps = await db.select().from(submissionVerificationStepsTable)
      .where(eq(submissionVerificationStepsTable.submissionId, subId));
    expect(steps).toHaveLength(0);
  });

  it("sweep evaluates only unevaluated pre-verification submissions", async () => {
    const verifiedSub = await makeSubmission({
      stationId: stationB, status: "verified", cast: 100, votes: [["Alpha", 60], ["Beta", 40]],
    });
    const pendingSub = await makeSubmission({
      stationId: stationE, cast: 250, votes: [["Alpha", 140], ["Beta", 110]],
    });

    const { evaluated } = await evaluatePendingAnomalies({ limit: 50 });
    expect(evaluated).toBeGreaterThanOrEqual(1);

    const [done] = await db.select().from(resultSubmissionsTable).where(eq(resultSubmissionsTable.id, pendingSub));
    expect(done.anomalyEvaluatedAt).not.toBeNull();
    expect(done.anomalyScore).toBe(0);

    // Verified submissions are in human hands — never rescored by the sweep.
    const [untouched] = await db.select().from(resultSubmissionsTable).where(eq(resultSubmissionsTable.id, verifiedSub));
    expect(untouched.anomalyEvaluatedAt).toBeNull();
  });
});
