/**
 * pvtEngine.ts — Parallel Vote Tabulation statistical engine.
 *
 * Sampling design: stratified PPS *systematic* sampling without replacement.
 *   1. Universe = the campaign's accredited polling stations
 *      (campaignStationProfiles), clamped to the campaign's geographic scope.
 *   2. Strata = counties or constituencies; Neyman (voter-proportional)
 *      allocation with a minimum of 2 stations per stratum.
 *   3. Within each stratum, certainty units (size ≥ sampling interval) are
 *      taken with π = 1, then a single random start walks the cumulative-size
 *      list in fixed steps — first-order inclusion probabilities are exactly
 *      πᵢ = n_h·vᵢ/V_h for the remaining units, so design weights 1/πᵢ are
 *      valid Horvitz–Thompson weights.
 *   4. Estimation: HT point estimates; 2,000-iteration stratified bootstrap
 *      for 95% CIs and win probabilities.
 *   5. All population denominators (turnout, stratum voters) come from the
 *      SAME campaign universe the sample was drawn from — never from the
 *      geographic registered-voter totals, which campaigns only partially
 *      cover. Each sampled station row persists its stratum's universe size.
 *
 * Recount territory follows Kenyan presidential law: margin < 0.5%.
 */
import { db } from "@workspace/db";
import {
  pvtSampleDesignsTable,
  pvtSampledStationsTable,
  pvtQuickReportsTable,
  pvtProjectionsTable,
  pvtAlertsTable,
  pvtStratumSummariesTable,
  campaignStationProfilesTable,
  pollingStationsTable,
  countiesTable,
  constituenciesTable,
  candidatesTable,
  tenantsTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { resolveScopeGeoFilter } from "./campaignScope";
import { logger } from "./logger";

export const BOOTSTRAP_ITERATIONS = 2000;
export const RECOUNT_MARGIN = 0.005; // 0.5% — Kenyan presidential recount threshold
export const LOW_REPORTING_THRESHOLD = 0.5;
export const UPSET_WIN_PROBABILITY = 0.3;
export const MIN_PER_STRATUM = 2;

export interface CandidateProjection {
  candidateId: string;
  candidateName: string;
  partyId: string | null;
  partyName: string | null;
  color: string | null;
  projectedVotes: number;
  projectedVoteShare: number;
  voteShareLower: number;
  voteShareUpper: number;
  votesLower: number;
  votesUpper: number;
  winProbability: number;
}

export interface PVTProjectionResult {
  sampleDesignId: string;
  electionId: string;
  computedAt: Date;
  totalSampledStations: number;
  reportedStations: number;
  reportingRate: number;
  projectedTotalVotes: number;
  projectedTurnoutPercent: number;
  candidateProjections: CandidateProjection[];
  projectedMargin: number;
  marginLower: number;
  marginUpper: number;
  isWithinRecountTerritory: boolean;
  effectiveSampleSize: number;
  designEffect: number;
  methodology: string;
}

interface StationRow {
  stationId: string;
  stratumId: string;
  stratumName: string;
  registeredVoters: number;
  stratumVoters: number;
  countyId: string | null;
  constituencyId: string | null;
}

function mulberry32(seed: number) {
  // Deterministic PRNG so tests can seed reproducible samples.
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Systematic PPS draw of exactly n units from a stratum.
 * Certainty units (v_i ≥ interval) are pulled out first with π = 1.
 * Returns stations with their exact first-order inclusion probabilities.
 * Throws if the draw cannot produce n distinct stations (frame corruption).
 */
function systematicPpsDraw(
  stations: StationRow[],
  n: number,
  rand: () => number,
): (StationRow & { selectionProbability: number; designWeight: number })[] {
  if (n >= stations.length) {
    // Take-all stratum: π = 1
    return stations.map((s) => ({ ...s, selectionProbability: 1, designWeight: 1 }));
  }

  const remaining = [...stations];
  const picked: (StationRow & { selectionProbability: number; designWeight: number })[] = [];
  let nRem = n;

  // Certainty units: size ≥ current interval V/n
  let changed = true;
  while (changed) {
    changed = false;
    const v = remaining.reduce((a, s) => a + s.registeredVoters, 0);
    const interval = v / nRem;
    for (let i = remaining.length - 1; i >= 0; i--) {
      if (remaining[i].registeredVoters >= interval) {
        picked.push({ ...remaining[i], selectionProbability: 1, designWeight: 1 });
        remaining.splice(i, 1);
        nRem--;
        changed = true;
        break; // recompute interval after each extraction
      }
    }
    if (nRem <= 0) break;
  }

  if (nRem > 0) {
    const v = remaining.reduce((a, s) => a + s.registeredVoters, 0);
    const interval = v / nRem;
    // Random order so the systematic walk is unbiased w.r.t. listing order
    const shuffled = [...remaining];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const start = rand() * interval;
    const points = Array.from({ length: nRem }, (_, k) => start + k * interval);
    let cum = 0;
    let p = 0;
    for (const s of shuffled) {
      cum += s.registeredVoters;
      while (p < points.length && points[p] <= cum) {
        // Every remaining unit has v_i < interval, so each is hit at most once.
        picked.push({ ...s, selectionProbability: s.registeredVoters / interval, designWeight: interval / s.registeredVoters });
        p++;
      }
      if (p >= points.length) break;
    }
  }

  if (picked.length !== n) {
    // With certainty removal this cannot happen unless the frame is corrupt;
    // fail loudly rather than persisting a silently short sample.
    throw new Error(`PPS draw produced ${picked.length} of ${n} required stations — frame is inconsistent`);
  }
  return picked;
}

/**
 * Draw a stratified PPS sample of the campaign's stations.
 * Returns the new sample design id.
 */
export async function generateStratifiedSample(
  tenantId: string,
  electionId: string,
  stratumLevel: "county" | "constituency",
  targetSampleSize: number,
  generatedBy?: string,
  seed?: number,
): Promise<string> {
  const rand = seed !== undefined ? mulberry32(seed) : Math.random;

  // Station universe: campaign-accredited stations, clamped to campaign scope.
  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId)).limit(1);
  const scopeFilter = await resolveScopeGeoFilter(tenant ?? { seatType: null, scopeCountyId: null, scopeConstituencyId: null, scopeWardId: null });

  const conditions: any[] = [eq(campaignStationProfilesTable.tenantId, tenantId)];
  if (scopeFilter) {
    if (scopeFilter.wardId) conditions.push(eq(pollingStationsTable.wardId, scopeFilter.wardId));
    else if (scopeFilter.constituencyId) conditions.push(eq(pollingStationsTable.constituencyId, scopeFilter.constituencyId));
    else if (scopeFilter.countyId) conditions.push(eq(pollingStationsTable.countyId, scopeFilter.countyId));
  }

  const stations = await db
    .select({
      stationId: pollingStationsTable.id,
      registeredVoters: pollingStationsTable.registeredVoters,
      countyId: pollingStationsTable.countyId,
      constituencyId: pollingStationsTable.constituencyId,
      countyName: countiesTable.name,
      constituencyName: constituenciesTable.name,
    })
    .from(campaignStationProfilesTable)
    .innerJoin(pollingStationsTable, eq(campaignStationProfilesTable.stationId, pollingStationsTable.id))
    .leftJoin(countiesTable, eq(pollingStationsTable.countyId, countiesTable.id))
    .leftJoin(constituenciesTable, eq(pollingStationsTable.constituencyId, constituenciesTable.id))
    .where(and(...conditions));

  if (!stations.length) throw new Error("No campaign polling stations found — accredit stations before generating a sample.");

  // Group into strata (stratum voter totals = CAMPAIGN UNIVERSE totals)
  const strata = new Map<string, { name: string; stations: StationRow[]; voters: number }>();
  for (const s of stations) {
    const stratumId = stratumLevel === "county" ? s.countyId : s.constituencyId;
    if (!stratumId) continue;
    const stratumName = stratumLevel === "county"
      ? (s.countyName ?? "Unknown county")
      : (s.constituencyName ?? "Unknown constituency");
    const entry = strata.get(stratumId) ?? { name: stratumName, stations: [], voters: 0 };
    const row: StationRow = {
      stationId: s.stationId,
      stratumId,
      stratumName,
      registeredVoters: Math.max(1, s.registeredVoters ?? 1),
      stratumVoters: 0, // filled below
      countyId: s.countyId,
      constituencyId: s.constituencyId,
    };
    entry.stations.push(row);
    entry.voters += row.registeredVoters;
    strata.set(stratumId, entry);
  }
  if (!strata.size) throw new Error("Campaign stations have no geography at the requested stratum level.");
  for (const s of strata.values()) {
    for (const st of s.stations) st.stratumVoters = s.voters;
  }

  const totalVoters = [...strata.values()].reduce((sum, s) => sum + s.voters, 0);
  const totalStations = [...strata.values()].reduce((sum, s) => sum + s.stations.length, 0);
  const target = Math.min(targetSampleSize, totalStations);

  // Feasibility: the min-per-stratum floor must fit inside the target.
  const minTotal = [...strata.values()].reduce((sum, s) => sum + Math.min(MIN_PER_STRATUM, s.stations.length), 0);
  if (target < minTotal) {
    throw new Error(
      `Target sample size ${targetSampleSize} is infeasible: ${strata.size} strata require at least ${minTotal} stations (minimum ${MIN_PER_STRATUM} per stratum).`,
    );
  }

  // Neyman allocation, min-2 floor, largest-remainder fill to target.
  const alloc = new Map<string, number>();
  const remainders: { stratumId: string; rem: number }[] = [];
  let allocated = 0;
  for (const [stratumId, s] of strata) {
    const exact = (target * s.voters) / totalVoters;
    const n = Math.min(s.stations.length, Math.max(Math.min(MIN_PER_STRATUM, s.stations.length), Math.floor(exact)));
    alloc.set(stratumId, n);
    allocated += n;
    remainders.push({ stratumId, rem: exact - Math.floor(exact) });
  }
  remainders.sort((a, b) => b.rem - a.rem);
  let guard = 0;
  while (allocated < target && guard++ < target * 10) {
    let progressed = false;
    for (const { stratumId } of remainders) {
      if (allocated >= target) break;
      const cap = strata.get(stratumId)!.stations.length;
      if (alloc.get(stratumId)! < cap) {
        alloc.set(stratumId, alloc.get(stratumId)! + 1);
        allocated++;
        progressed = true;
      }
    }
    if (!progressed) break;
  }

  // Systematic PPS draw per stratum — exact first-order inclusion probabilities.
  const sampled: (StationRow & { selectionProbability: number; designWeight: number })[] = [];
  for (const [stratumId, s] of strata) {
    sampled.push(...systematicPpsDraw(s.stations, alloc.get(stratumId)!, rand));
  }

  const designId = await db.transaction(async (tx) => {
    const [design] = await tx.insert(pvtSampleDesignsTable).values({
      tenantId,
      electionId,
      stratumLevel,
      targetSampleSize: target,
      selectionMethod: "pps-systematic",
      status: "draft",
      generatedBy: generatedBy ?? null,
    } as any).returning();

    await tx.insert(pvtSampledStationsTable).values(sampled.map((s) => ({
      tenantId,
      sampleDesignId: design.id,
      electionId,
      pollingStationId: s.stationId,
      countyId: s.countyId,
      constituencyId: s.constituencyId,
      stratumId: s.stratumId,
      stratumName: s.stratumName,
      registeredVoters: s.registeredVoters,
      stratumVoters: s.stratumVoters,
      selectionProbability: s.selectionProbability,
      designWeight: s.designWeight,
    })) as any);

    return design.id;
  });

  return designId;
}

interface ReportWithStation {
  sampledStationId: string;
  stratumId: string;
  designWeight: number;
  stratumVoters: number; // campaign-universe stratum registered voters
  totalVotesCast: number;
  rejectedBallots: number;
  candidateVotes: { candidateId: string; votes: number }[];
}

/** Compute (and persist) a projection for a sample design. */
export async function computeProjection(sampleDesignId: string, tenantId: string): Promise<PVTProjectionResult | null> {
  const [design] = await db.select().from(pvtSampleDesignsTable)
    .where(and(eq(pvtSampleDesignsTable.id, sampleDesignId), eq(pvtSampleDesignsTable.tenantId, tenantId)))
    .limit(1);
  if (!design) throw new Error("Sample design not found");

  const sampled = await db.select().from(pvtSampledStationsTable)
    .where(eq(pvtSampledStationsTable.sampleDesignId, sampleDesignId));
  const reports = await db.select().from(pvtQuickReportsTable)
    .where(and(eq(pvtQuickReportsTable.sampleDesignId, sampleDesignId), eq(pvtQuickReportsTable.isValid, true)));

  // Stratum populations come from the persisted sampling universe, NOT from
  // geographic registered-voter totals — the campaign's universe may be a
  // subset (partial coverage, scope clamps).
  const stratumVoters = new Map<string, number>();
  for (const s of sampled) stratumVoters.set(s.stratumId, Math.max(1, s.stratumVoters || s.registeredVoters));

  const byStation = new Map(sampled.map((s) => [s.id, s]));
  const reportRows: ReportWithStation[] = [];
  for (const r of reports) {
    const st = byStation.get(r.sampledStationId);
    if (!st) continue;
    reportRows.push({
      sampledStationId: r.sampledStationId,
      stratumId: st.stratumId,
      designWeight: st.designWeight,
      stratumVoters: stratumVoters.get(st.stratumId)!,
      totalVotesCast: r.totalVotesCast,
      rejectedBallots: r.rejectedBallots,
      candidateVotes: r.candidateVotes as { candidateId: string; votes: number }[],
    });
  }

  const candidateIds = [...new Set(reportRows.flatMap((r) => r.candidateVotes.map((v) => v.candidateId)))];
  if (!reportRows.length || !candidateIds.length) return null;

  const candRows = await db.select().from(candidatesTable)
    .where(and(eq(candidatesTable.tenantId, tenantId), inArray(candidatesTable.id, candidateIds)));
  const candMeta = new Map(candRows.map((c) => [c.id, c]));

  const byStratum = new Map<string, ReportWithStation[]>();
  for (const r of reportRows) {
    const arr = byStratum.get(r.stratumId) ?? [];
    arr.push(r);
    byStratum.set(r.stratumId, arr);
  }

  /** Horvitz–Thompson projection for a given set of (re)sampled reports. */
  function projectRows(rows: ReportWithStation[]): { votes: Map<string, number>; total: number } {
    const votes = new Map<string, number>(candidateIds.map((id) => [id, 0]));
    let total = 0;
    for (const r of rows) {
      total += r.designWeight * r.totalVotesCast;
      for (const cv of r.candidateVotes) {
        votes.set(cv.candidateId, (votes.get(cv.candidateId) ?? 0) + r.designWeight * cv.votes);
      }
    }
    return { votes, total };
  }

  const point = projectRows(reportRows);

  // Stratified bootstrap: resample with replacement WITHIN each stratum.
  const bootVotes: Map<string, number>[] = [];
  const bootTotals: number[] = [];
  for (let i = 0; i < BOOTSTRAP_ITERATIONS; i++) {
    const resampled: ReportWithStation[] = [];
    for (const [, rows] of byStratum) {
      for (let j = 0; j < rows.length; j++) {
        resampled.push(rows[Math.floor(Math.random() * rows.length)]);
      }
    }
    const proj = projectRows(resampled);
    bootVotes.push(proj.votes);
    bootTotals.push(proj.total);
  }

  const totalUniverseVoters = [...stratumVoters.values()].reduce((a, b) => a + b, 0);

  function percentile(sorted: number[], p: number): number {
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
    return sorted[idx];
  }

  const winCounts = new Map<string, number>(candidateIds.map((id) => [id, 0]));
  for (const votes of bootVotes) {
    let best: string | null = null; let bestV = -1;
    for (const [id, v] of votes) if (v > bestV) { bestV = v; best = id; }
    if (best) winCounts.set(best, (winCounts.get(best) ?? 0) + 1);
  }

  const projectedTotalVotes = point.total;
  const candidateProjections: CandidateProjection[] = candidateIds.map((id) => {
    const shareSamples = bootVotes.map((v, i) => (bootTotals[i] > 0 ? (v.get(id) ?? 0) / bootTotals[i] : 0)).sort((a, b) => a - b);
    const voteSamples = bootVotes.map((v) => v.get(id) ?? 0).sort((a, b) => a - b);
    const meta = candMeta.get(id);
    return {
      candidateId: id,
      candidateName: meta?.fullName ?? "Unknown candidate",
      partyId: null,
      partyName: meta?.partyName ?? null,
      color: null,
      projectedVotes: point.votes.get(id) ?? 0,
      projectedVoteShare: projectedTotalVotes > 0 ? (point.votes.get(id) ?? 0) / projectedTotalVotes : 0,
      voteShareLower: percentile(shareSamples, 2.5),
      voteShareUpper: percentile(shareSamples, 97.5),
      votesLower: percentile(voteSamples, 2.5),
      votesUpper: percentile(voteSamples, 97.5),
      winProbability: (winCounts.get(id) ?? 0) / BOOTSTRAP_ITERATIONS,
    };
  }).sort((a, b) => b.projectedVoteShare - a.projectedVoteShare);

  const marginSamples = bootVotes.map((v, i) => {
    if (bootTotals[i] <= 0) return 0;
    const vals = [...v.values()].sort((a, b) => b - a);
    return ((vals[0] ?? 0) - (vals[1] ?? 0)) / bootTotals[i];
  }).sort((a, b) => a - b);

  const top = candidateProjections[0];
  const second = candidateProjections[1];
  const projectedMargin = top && second ? top.projectedVoteShare - second.projectedVoteShare : (top ? 1 : 0);
  const isWithinRecountTerritory = candidateProjections.length >= 2 && projectedMargin < RECOUNT_MARGIN;

  const weights = reportRows.map((r) => r.designWeight);
  const sumW = weights.reduce((a, b) => a + b, 0);
  const sumW2 = weights.reduce((a, b) => a + b * b, 0);
  const effectiveSampleSize = sumW2 > 0 ? (sumW * sumW) / sumW2 : reportRows.length;
  const designEffect = reportRows.length > 0 && effectiveSampleSize > 0 ? reportRows.length / effectiveSampleSize : 1;

  const result: PVTProjectionResult = {
    sampleDesignId,
    electionId: design.electionId,
    computedAt: new Date(),
    totalSampledStations: sampled.length,
    reportedStations: reportRows.length,
    reportingRate: sampled.length > 0 ? reportRows.length / sampled.length : 0,
    projectedTotalVotes,
    projectedTurnoutPercent: totalUniverseVoters > 0 ? projectedTotalVotes / totalUniverseVoters : 0,
    candidateProjections,
    projectedMargin,
    marginLower: percentile(marginSamples, 2.5),
    marginUpper: percentile(marginSamples, 97.5),
    isWithinRecountTerritory,
    effectiveSampleSize,
    designEffect,
    methodology: `stratified-pps-systematic-bootstrap-${BOOTSTRAP_ITERATIONS}`,
  };

  const [row] = await db.insert(pvtProjectionsTable).values({
    tenantId,
    sampleDesignId,
    electionId: design.electionId,
    computedAt: result.computedAt,
    totalSampledStations: result.totalSampledStations,
    reportedStations: result.reportedStations,
    reportingRate: result.reportingRate,
    projectedTotalVotes: result.projectedTotalVotes,
    projectedTurnoutPercent: result.projectedTurnoutPercent,
    candidateProjections: result.candidateProjections,
    projectedMargin: result.projectedMargin,
    marginLower: result.marginLower,
    marginUpper: result.marginUpper,
    isWithinRecountTerritory: result.isWithinRecountTerritory,
    effectiveSampleSize: result.effectiveSampleSize,
    designEffect: result.designEffect,
    methodology: result.methodology,
  } as any).returning();

  await updateStratumSummaries(sampleDesignId, tenantId);
  await generatePVTAlerts(tenantId, sampleDesignId, row.id, result);

  return result;
}

/** Trigger alerts from a computed projection. Active alerts dedupe by type. */
export async function generatePVTAlerts(
  tenantId: string,
  sampleDesignId: string,
  projectionId: string,
  projection: PVTProjectionResult,
): Promise<void> {
  const candidates: { alertType: string; severity: string; title: string; description: string; contextData: Record<string, unknown> }[] = [];

  if (projection.isWithinRecountTerritory) {
    candidates.push({
      alertType: "recount_territory",
      severity: "critical",
      title: "Race within recount territory",
      description: `Projected margin is ${(projection.projectedMargin * 100).toFixed(2)}% — below the 0.5% recount threshold. Prepare legal and verification teams.`,
      contextData: { margin: projection.projectedMargin, marginLower: projection.marginLower, marginUpper: projection.marginUpper },
    });
  }

  if (projection.reportingRate < LOW_REPORTING_THRESHOLD) {
    candidates.push({
      alertType: "low_reporting",
      severity: "high",
      title: "Low sample reporting",
      description: `Only ${(projection.reportingRate * 100).toFixed(0)}% of sampled stations have reported. The projection is unreliable below 50%.`,
      contextData: { reportingRate: projection.reportingRate, reported: projection.reportedStations, total: projection.totalSampledStations },
    });
  }

  const second = projection.candidateProjections[1];
  if (second && second.winProbability > UPSET_WIN_PROBABILITY) {
    candidates.push({
      alertType: "upset_warning",
      severity: "medium",
      title: "Upset warning",
      description: `${second.candidateName} has a ${(second.winProbability * 100).toFixed(0)}% win probability. The race is not safe.`,
      contextData: { candidateId: second.candidateId, winProbability: second.winProbability },
    });
  }

  if (!candidates.length) return;
  const active = await db.select({ alertType: pvtAlertsTable.alertType }).from(pvtAlertsTable)
    .where(and(
      eq(pvtAlertsTable.sampleDesignId, sampleDesignId),
      eq(pvtAlertsTable.status, "active"),
    ));
  const activeTypes = new Set(active.map((a) => a.alertType));

  for (const alert of candidates) {
    if (activeTypes.has(alert.alertType)) continue; // don't spam duplicates
    await db.insert(pvtAlertsTable).values({ tenantId, sampleDesignId, projectionId, ...alert } as any);
  }
}

/** Refresh the per-stratum summary table for fast dashboard reads. */
export async function updateStratumSummaries(sampleDesignId: string, tenantId: string): Promise<void> {
  const sampled = await db.select().from(pvtSampledStationsTable)
    .where(eq(pvtSampledStationsTable.sampleDesignId, sampleDesignId));
  const reports = await db.select().from(pvtQuickReportsTable)
    .where(and(eq(pvtQuickReportsTable.sampleDesignId, sampleDesignId), eq(pvtQuickReportsTable.isValid, true)));

  const byStratum = new Map<string, { name: string; sampled: typeof sampled; reports: typeof reports }>();
  const stationById = new Map(sampled.map((s) => [s.id, s]));
  for (const s of sampled) {
    const entry = byStratum.get(s.stratumId) ?? { name: s.stratumName, sampled: [], reports: [] };
    entry.sampled.push(s);
    byStratum.set(s.stratumId, entry);
  }
  for (const r of reports) {
    const st = stationById.get(r.sampledStationId);
    if (!st) continue;
    byStratum.get(st.stratumId)?.reports.push(r);
  }

  for (const [stratumId, entry] of byStratum) {
    const totalVotesCast = entry.reports.reduce((a, r) => a + r.totalVotesCast, 0);
    const rejected = entry.reports.reduce((a, r) => a + r.rejectedBallots, 0);
    const validVotes = Math.max(0, totalVotesCast - rejected);
    // Universe-consistent denominator: the stratum's campaign-frame voters.
    const registered = Math.max(...entry.sampled.map((s) => s.stratumVoters || 0), entry.sampled.reduce((a, s) => a + s.registeredVoters, 0));

    const voteTotals = new Map<string, number>();
    for (const r of entry.reports) {
      for (const cv of r.candidateVotes as { candidateId: string; votes: number }[]) {
        voteTotals.set(cv.candidateId, (voteTotals.get(cv.candidateId) ?? 0) + cv.votes);
      }
    }
    const shares: Record<string, number> = {};
    for (const [cid, v] of voteTotals) shares[cid] = validVotes > 0 ? v / validVotes : 0;

    const values = {
      tenantId,
      sampleDesignId,
      stratumId,
      stratumName: entry.name,
      totalStations: entry.sampled.length,
      sampledStations: entry.sampled.length,
      reportedStations: entry.reports.length,
      registeredVoters: registered,
      totalVotesCast,
      candidateVoteShares: shares,
      turnoutPercent: registered > 0 ? totalVotesCast / registered : 0,
    };
    await db.insert(pvtStratumSummariesTable).values(values as any)
      .onConflictDoUpdate({
        target: [pvtStratumSummariesTable.sampleDesignId, pvtStratumSummariesTable.stratumId],
        set: {
          stratumName: values.stratumName,
          totalStations: values.totalStations,
          sampledStations: values.sampledStations,
          reportedStations: values.reportedStations,
          registeredVoters: values.registeredVoters,
          totalVotesCast: values.totalVotesCast,
          candidateVoteShares: values.candidateVoteShares,
          turnoutPercent: values.turnoutPercent,
        },
      });
  }
}
