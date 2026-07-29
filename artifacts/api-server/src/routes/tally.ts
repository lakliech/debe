/**
 * Tally API: compute & serve aggregated election results
 * Only 'verified' submissions are counted.
 */
import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  tallySnapshotsTable,
  submissionCandidateVotesTable,
  resultSubmissionsTable,
  pollingStationsTable,
  electionsTable,
  usersTable,
} from "@workspace/db";
import { eq, desc, and, sql, count, sum, countDistinct } from "drizzle-orm";
import { requireRoles } from "../middlewares/rbac";
import { tenantFilter, assertTenant } from '../lib/withTenant';

const router = Router();

function requireAuth(req: any, res: any, next: any) {
  const auth = getAuth(req);
  if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
  req.clerkId = auth.userId;
  next();
}

const canViewResults = requireRoles([
  "campaign-exec-director", "national-campaign-manager", "returning-officer",
  "county-coordinator", "constituency-coordinator", "polling-agent-supervisor", "result-verifier",
]);
const canManageElections = requireRoles([
  "campaign-exec-director", "national-campaign-manager", "returning-officer",
]);

// ─── GET /api/tally/snapshot ──────────────────────────────────────────────────
router.get("/snapshot", requireAuth, canViewResults, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const { electionId, level, entityId } = req.query;
    if (!electionId) return res.status(400).json({ error: "electionId required" });

    const conditions: any[] = [tenantFilter(tallySnapshotsTable, t.id), eq(tallySnapshotsTable.electionId, electionId)];
    if (level) conditions.push(eq(tallySnapshotsTable.level, level));
    if (entityId) conditions.push(eq(tallySnapshotsTable.entityId, entityId));

    const rows = await db.select().from(tallySnapshotsTable)
      .where(and(...conditions))
      .orderBy(desc(tallySnapshotsTable.computedAt));
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/tally/compute ──────────────────────────────────────────────────
router.post("/compute", requireAuth, canManageElections, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const { electionId, level, entityId } = req.body;
    if (!electionId) return res.status(400).json({ error: "electionId required" });

    // Aggregate: sum voteCount for verified submissions
    const aggregated = await db
      .select({
        candidateId: submissionCandidateVotesTable.candidateId,
        candidateName: submissionCandidateVotesTable.candidateName,
        partyAbbreviation: submissionCandidateVotesTable.partyAbbreviation,
        votes: sum(submissionCandidateVotesTable.voteCount),
      })
      .from(submissionCandidateVotesTable)
      .innerJoin(
        resultSubmissionsTable,
        eq(submissionCandidateVotesTable.submissionId, resultSubmissionsTable.id),
      )
      .where(and(
        tenantFilter(resultSubmissionsTable, t.id),
        eq(resultSubmissionsTable.electionId, electionId),
        eq(resultSubmissionsTable.status, "verified"),
        eq(submissionCandidateVotesTable.isVerified, true),
      ))
      .groupBy(
        submissionCandidateVotesTable.candidateId,
        submissionCandidateVotesTable.candidateName,
        submissionCandidateVotesTable.partyAbbreviation,
      );

    // Station counts — scoped to stations with submissions from this tenant
    const stationCounts = await db
      .select({ total: countDistinct(resultSubmissionsTable.pollingStationId) })
      .from(resultSubmissionsTable)
      .where(and(tenantFilter(resultSubmissionsTable, t.id), eq(resultSubmissionsTable.electionId, electionId)));

    const totalStations = await db
      .select({ total: countDistinct(resultSubmissionsTable.pollingStationId) })
      .from(resultSubmissionsTable)
      .where(and(tenantFilter(resultSubmissionsTable, t.id), eq(resultSubmissionsTable.electionId, electionId)));

    const stationsReporting = await db
      .select({ total: count(resultSubmissionsTable.id) })
      .from(resultSubmissionsTable)
      .where(and(
        tenantFilter(resultSubmissionsTable, t.id),
        eq(resultSubmissionsTable.electionId, electionId),
      ));

    const stationsVerified = await db
      .select({ total: count(resultSubmissionsTable.id) })
      .from(resultSubmissionsTable)
      .where(and(
        tenantFilter(resultSubmissionsTable, t.id),
        eq(resultSubmissionsTable.electionId, electionId),
        eq(resultSubmissionsTable.status, "verified"),
      ));

    const totalValidVotesResult = aggregated.reduce((s, r) => s + Number(r.votes ?? 0), 0);

    const computedAt = new Date();
    const snapshots = [];

    for (const row of aggregated) {
      const snapshotData = {
        tenantId: t.id,
        electionId,
        level: level ?? "national",
        entityId: entityId ?? null,
        entityName: entityId ? undefined : "National",
        candidateId: row.candidateId ?? undefined,
        candidateName: row.candidateName,
        partyAbbreviation: row.partyAbbreviation ?? undefined,
        votes: Number(row.votes ?? 0),
        validVotes: totalValidVotesResult,
        registeredVoters: 0,
        totalStations: Number(totalStations[0]?.total ?? 0),
        stationsReporting: Number(stationsReporting[0]?.total ?? 0),
        stationsVerified: Number(stationsVerified[0]?.total ?? 0),
        stationsPending: 0,
        stationsDisputed: 0,
        computedAt,
      };

      const [snapshot] = await db.insert(tallySnapshotsTable).values(snapshotData).returning();
      snapshots.push(snapshot);
    }

    res.json({ computed: snapshots.length, snapshots });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/tally/national/:electionId ─────────────────────────────────────
router.get("/national/:electionId", requireAuth, canViewResults, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const { electionId } = req.params;

    const votes = await db
      .select({
        candidateId: submissionCandidateVotesTable.candidateId,
        candidateName: submissionCandidateVotesTable.candidateName,
        partyAbbreviation: submissionCandidateVotesTable.partyAbbreviation,
        totalVotes: sum(submissionCandidateVotesTable.voteCount),
      })
      .from(submissionCandidateVotesTable)
      .innerJoin(resultSubmissionsTable, eq(submissionCandidateVotesTable.submissionId, resultSubmissionsTable.id))
      .where(and(
        tenantFilter(resultSubmissionsTable, t.id),
        eq(resultSubmissionsTable.electionId, electionId),
        eq(resultSubmissionsTable.status, "verified"),
      ))
      .groupBy(
        submissionCandidateVotesTable.candidateId,
        submissionCandidateVotesTable.candidateName,
        submissionCandidateVotesTable.partyAbbreviation,
      )
      .orderBy(desc(sum(submissionCandidateVotesTable.voteCount)));

    // Count only stations tracked by this tenant for this election
    const [totalStations] = await db.select({ total: countDistinct(resultSubmissionsTable.pollingStationId) })
      .from(resultSubmissionsTable).where(and(tenantFilter(resultSubmissionsTable, t.id), eq(resultSubmissionsTable.electionId, electionId)));
    const [stationsVerified] = await db.select({ total: count() }).from(resultSubmissionsTable)
      .where(and(tenantFilter(resultSubmissionsTable, t.id), eq(resultSubmissionsTable.electionId, electionId), eq(resultSubmissionsTable.status, "verified")));
    const [stationsReporting] = await db.select({ total: count() }).from(resultSubmissionsTable)
      .where(and(tenantFilter(resultSubmissionsTable, t.id), eq(resultSubmissionsTable.electionId, electionId)));

    const totalN = Number(totalStations?.total ?? 0);
    const reportingN = Number(stationsReporting?.total ?? 0);
    const verifiedN = Number(stationsVerified?.total ?? 0);

    // County-level breakdown: group verified submissions by countyId
    const countyBreakdown = await db
      .select({
        countyId: pollingStationsTable.countyId,
        candidateId: submissionCandidateVotesTable.candidateId,
        candidateName: submissionCandidateVotesTable.candidateName,
        totalVotes: sum(submissionCandidateVotesTable.voteCount),
      })
      .from(submissionCandidateVotesTable)
      .innerJoin(resultSubmissionsTable, eq(submissionCandidateVotesTable.submissionId, resultSubmissionsTable.id))
      .innerJoin(pollingStationsTable, eq(resultSubmissionsTable.pollingStationId, pollingStationsTable.id))
      .where(and(
        tenantFilter(resultSubmissionsTable, t.id),
        eq(resultSubmissionsTable.electionId, electionId),
        eq(resultSubmissionsTable.status, "verified"),
      ))
      .groupBy(pollingStationsTable.countyId, submissionCandidateVotesTable.candidateId, submissionCandidateVotesTable.candidateName);

    // Build breakdown rows grouped by county — include candidateResults, ourCandidateVotes, leadingCandidate
    const countyMap: Record<string, any> = {};
    for (const row of countyBreakdown) {
      const cid = row.countyId ?? "unknown";
      if (!countyMap[cid]) countyMap[cid] = { entityId: cid, entityName: `County ${cid.slice(0, 8)}`, stationsReported: 0, stationsTotal: 0, candidateResults: [] };
      countyMap[cid].candidateResults.push({ candidateId: row.candidateId, candidateName: row.candidateName, votes: Number(row.totalVotes ?? 0) });
    }
    // Derive ourCandidateVotes (top candidate per county) and leadingCandidate
    for (const county of Object.values(countyMap) as any[]) {
      const sorted = [...county.candidateResults].sort((a: any, b: any) => b.votes - a.votes);
      county.ourCandidateVotes = sorted[0]?.votes ?? 0;
      county.leadingCandidate = sorted[0]?.candidateName ?? "—";
    }
    const breakdown = Object.values(countyMap);

    const candidateList = votes.map(v => ({ ...v, votes: Number(v.totalVotes ?? 0), totalVotes: Number(v.totalVotes ?? 0) }));

    res.json({
      electionId,
      level: "national",
      candidates: candidateList,
      breakdown,
      reporting: { total: totalN, reporting: reportingN, verified: verifiedN, pending: Math.max(0, totalN - reportingN) },
      stations: { received: reportingN, verified: verifiedN, outstanding: Math.max(0, totalN - reportingN), disputed: 0 },
      stationCounts: { total: totalN, reporting: reportingN, verified: verifiedN },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/tally/county/:electionId/:countyId ─────────────────────────────
router.get("/county/:electionId/:countyId", requireAuth, canViewResults, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const { electionId, countyId } = req.params;

    const stationIds = await db.select({ id: pollingStationsTable.id })
      .from(pollingStationsTable).where(eq(pollingStationsTable.countyId, countyId));
    const ids = stationIds.map(s => s.id);

    if (!ids.length) return res.json({ electionId, countyId, candidates: [], stationCounts: {} });

    const votes = await db
      .select({
        candidateId: submissionCandidateVotesTable.candidateId,
        candidateName: submissionCandidateVotesTable.candidateName,
        partyAbbreviation: submissionCandidateVotesTable.partyAbbreviation,
        totalVotes: sum(submissionCandidateVotesTable.voteCount),
      })
      .from(submissionCandidateVotesTable)
      .innerJoin(resultSubmissionsTable, eq(submissionCandidateVotesTable.submissionId, resultSubmissionsTable.id))
      .where(and(
        tenantFilter(resultSubmissionsTable, t.id),
        eq(resultSubmissionsTable.electionId, electionId),
        eq(resultSubmissionsTable.status, "verified"),
        sql`${resultSubmissionsTable.pollingStationId} = ANY(${sql.raw(`ARRAY['${ids.join("','")}']::uuid[]`)})`,
      ))
      .groupBy(
        submissionCandidateVotesTable.candidateId,
        submissionCandidateVotesTable.candidateName,
        submissionCandidateVotesTable.partyAbbreviation,
      );

    const countySubs = await db.select({ status: resultSubmissionsTable.status, total: count() })
      .from(resultSubmissionsTable)
      .where(and(tenantFilter(resultSubmissionsTable, t.id), eq(resultSubmissionsTable.electionId, electionId), sql`${resultSubmissionsTable.pollingStationId} = ANY(${sql.raw(`ARRAY['${ids.join("','")}']::uuid[]`)})`))
      .groupBy(resultSubmissionsTable.status);
    const countyReceived = countySubs.reduce((s, r) => s + Number(r.total), 0);
    const countyVerified = countySubs.find(r => r.status === "verified")?.total ?? 0;

    // Constituency-level sub-units for drilldown
    const constituencyBreakdown = await db
      .select({ constituencyId: pollingStationsTable.constituencyId, candidateId: submissionCandidateVotesTable.candidateId, candidateName: submissionCandidateVotesTable.candidateName, totalVotes: sum(submissionCandidateVotesTable.voteCount) })
      .from(submissionCandidateVotesTable)
      .innerJoin(resultSubmissionsTable, eq(submissionCandidateVotesTable.submissionId, resultSubmissionsTable.id))
      .innerJoin(pollingStationsTable, eq(resultSubmissionsTable.pollingStationId, pollingStationsTable.id))
      .where(and(tenantFilter(resultSubmissionsTable, t.id), eq(resultSubmissionsTable.electionId, electionId), eq(resultSubmissionsTable.status, "verified"), sql`${pollingStationsTable.countyId} = ${countyId}`))
      .groupBy(pollingStationsTable.constituencyId, submissionCandidateVotesTable.candidateId, submissionCandidateVotesTable.candidateName);
    const constMap: Record<string, any> = {};
    for (const row of constituencyBreakdown) {
      const cid = row.constituencyId ?? "unknown";
      if (!constMap[cid]) constMap[cid] = { entityId: cid, entityName: `Constituency ${cid.slice(0, 8)}`, parentEntityId: countyId, stationsReported: 0, stationsTotal: 0, candidateResults: [] };
      constMap[cid].candidateResults.push({ candidateId: row.candidateId, candidateName: row.candidateName, votes: Number(row.totalVotes ?? 0) });
    }
    for (const unit of Object.values(constMap) as any[]) {
      const sorted = [...unit.candidateResults].sort((a: any, b: any) => b.votes - a.votes);
      unit.ourCandidateVotes = sorted[0]?.votes ?? 0;
      unit.leadingCandidate = sorted[0]?.candidateName ?? "—";
    }

    res.json({
      electionId, countyId, level: "county",
      entityName: `County ${countyId.slice(0, 8)}`,
      parentEntityId: null,
      candidates: votes.map(v => ({ ...v, votes: Number(v.totalVotes ?? 0), totalVotes: Number(v.totalVotes ?? 0) })),
      subUnits: Object.values(constMap),
      reporting: { total: ids.length, reporting: countyReceived, verified: Number(countyVerified), pending: Math.max(0, ids.length - countyReceived) },
      stations: { received: countyReceived, verified: Number(countyVerified), outstanding: Math.max(0, ids.length - countyReceived), disputed: 0 },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/tally/constituency/:electionId/:constituencyId ─────────────────
router.get("/constituency/:electionId/:constituencyId", requireAuth, canViewResults, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const { electionId, constituencyId } = req.params;

    const stationIds = await db.select({ id: pollingStationsTable.id })
      .from(pollingStationsTable).where(eq(pollingStationsTable.constituencyId, constituencyId));
    const ids = stationIds.map(s => s.id);

    if (!ids.length) return res.json({ electionId, constituencyId, candidates: [] });

    const votes = await db
      .select({
        candidateId: submissionCandidateVotesTable.candidateId,
        candidateName: submissionCandidateVotesTable.candidateName,
        partyAbbreviation: submissionCandidateVotesTable.partyAbbreviation,
        totalVotes: sum(submissionCandidateVotesTable.voteCount),
      })
      .from(submissionCandidateVotesTable)
      .innerJoin(resultSubmissionsTable, eq(submissionCandidateVotesTable.submissionId, resultSubmissionsTable.id))
      .where(and(
        tenantFilter(resultSubmissionsTable, t.id),
        eq(resultSubmissionsTable.electionId, electionId),
        eq(resultSubmissionsTable.status, "verified"),
        sql`${resultSubmissionsTable.pollingStationId} = ANY(${sql.raw(`ARRAY['${ids.join("','")}']::uuid[]`)})`,
      ))
      .groupBy(
        submissionCandidateVotesTable.candidateId,
        submissionCandidateVotesTable.candidateName,
        submissionCandidateVotesTable.partyAbbreviation,
      );

    const constSubs = await db.select({ status: resultSubmissionsTable.status, total: count() })
      .from(resultSubmissionsTable)
      .where(and(tenantFilter(resultSubmissionsTable, t.id), eq(resultSubmissionsTable.electionId, electionId), sql`${resultSubmissionsTable.pollingStationId} = ANY(${sql.raw(`ARRAY['${ids.join("','")}']::uuid[]`)})`))
      .groupBy(resultSubmissionsTable.status);
    const constReceived = constSubs.reduce((s, r) => s + Number(r.total), 0);
    const constVerified = constSubs.find(r => r.status === "verified")?.total ?? 0;

    // Ward-level sub-units for drilldown
    const wardBreakdown = await db
      .select({ wardId: pollingStationsTable.wardId, candidateId: submissionCandidateVotesTable.candidateId, candidateName: submissionCandidateVotesTable.candidateName, totalVotes: sum(submissionCandidateVotesTable.voteCount) })
      .from(submissionCandidateVotesTable)
      .innerJoin(resultSubmissionsTable, eq(submissionCandidateVotesTable.submissionId, resultSubmissionsTable.id))
      .innerJoin(pollingStationsTable, eq(resultSubmissionsTable.pollingStationId, pollingStationsTable.id))
      .where(and(tenantFilter(resultSubmissionsTable, t.id), eq(resultSubmissionsTable.electionId, electionId), eq(resultSubmissionsTable.status, "verified"), sql`${pollingStationsTable.constituencyId} = ${constituencyId}`))
      .groupBy(pollingStationsTable.wardId, submissionCandidateVotesTable.candidateId, submissionCandidateVotesTable.candidateName);
    const wardMap: Record<string, any> = {};
    for (const row of wardBreakdown) {
      const wid = row.wardId ?? "unknown";
      if (!wardMap[wid]) wardMap[wid] = { entityId: wid, entityName: `Ward ${wid.slice(0, 8)}`, parentEntityId: constituencyId, stationsReported: 0, stationsTotal: 0, candidateResults: [] };
      wardMap[wid].candidateResults.push({ candidateId: row.candidateId, candidateName: row.candidateName, votes: Number(row.totalVotes ?? 0) });
    }
    for (const unit of Object.values(wardMap) as any[]) {
      const sorted = [...unit.candidateResults].sort((a: any, b: any) => b.votes - a.votes);
      unit.ourCandidateVotes = sorted[0]?.votes ?? 0;
      unit.leadingCandidate = sorted[0]?.candidateName ?? "—";
    }

    // Find parent countyId for back navigation
    const [sampleStation] = await db.select({ countyId: pollingStationsTable.countyId })
      .from(pollingStationsTable).where(eq(pollingStationsTable.constituencyId, constituencyId)).limit(1);

    res.json({
      electionId, constituencyId, level: "constituency",
      entityName: `Constituency ${constituencyId.slice(0, 8)}`,
      parentEntityId: sampleStation?.countyId ?? null,
      candidates: votes.map(v => ({ ...v, votes: Number(v.totalVotes ?? 0), totalVotes: Number(v.totalVotes ?? 0) })),
      subUnits: Object.values(wardMap),
      reporting: { total: ids.length, reporting: constReceived, verified: Number(constVerified), pending: Math.max(0, ids.length - constReceived) },
      stations: { received: constReceived, verified: Number(constVerified), outstanding: Math.max(0, ids.length - constReceived), disputed: 0 },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/tally/ward/:electionId/:wardId ─────────────────────────────────
router.get("/ward/:electionId/:wardId", requireAuth, canViewResults, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const { electionId, wardId } = req.params;

    const stationIds = await db.select({ id: pollingStationsTable.id })
      .from(pollingStationsTable).where(eq(pollingStationsTable.wardId, wardId));
    const ids = stationIds.map(s => s.id);

    if (!ids.length) return res.json({ electionId, wardId, candidates: [] });

    const votes = await db
      .select({
        candidateId: submissionCandidateVotesTable.candidateId,
        candidateName: submissionCandidateVotesTable.candidateName,
        partyAbbreviation: submissionCandidateVotesTable.partyAbbreviation,
        totalVotes: sum(submissionCandidateVotesTable.voteCount),
      })
      .from(submissionCandidateVotesTable)
      .innerJoin(resultSubmissionsTable, eq(submissionCandidateVotesTable.submissionId, resultSubmissionsTable.id))
      .where(and(
        tenantFilter(resultSubmissionsTable, t.id),
        eq(resultSubmissionsTable.electionId, electionId),
        eq(resultSubmissionsTable.status, "verified"),
        sql`${resultSubmissionsTable.pollingStationId} = ANY(${sql.raw(`ARRAY['${ids.join("','")}']::uuid[]`)})`,
      ))
      .groupBy(
        submissionCandidateVotesTable.candidateId,
        submissionCandidateVotesTable.candidateName,
        submissionCandidateVotesTable.partyAbbreviation,
      );

    const wardSubs = await db.select({ status: resultSubmissionsTable.status, total: count() })
      .from(resultSubmissionsTable)
      .where(and(tenantFilter(resultSubmissionsTable, t.id), eq(resultSubmissionsTable.electionId, electionId), sql`${resultSubmissionsTable.pollingStationId} = ANY(${sql.raw(`ARRAY['${ids.join("','")}']::uuid[]`)})`))
      .groupBy(resultSubmissionsTable.status);
    const wardReceived = wardSubs.reduce((s, r) => s + Number(r.total), 0);
    const wardVerified = wardSubs.find(r => r.status === "verified")?.total ?? 0;

    // Station-level sub-units for ward drilldown — include submission data for navigation
    const stationDetails = await db.select({
      id: pollingStationsTable.id, name: pollingStationsTable.name, code: pollingStationsTable.code,
      registeredVoters: pollingStationsTable.registeredVoters, constituencyId: pollingStationsTable.constituencyId,
    }).from(pollingStationsTable).where(eq(pollingStationsTable.wardId, wardId));

    // Get submission status + ID for each station
    const wardStationIds = stationDetails.map(s => s.id);
    const wardSubmissions = wardStationIds.length > 0 ? await db
      .select({ pollingStationId: resultSubmissionsTable.pollingStationId, id: resultSubmissionsTable.id, status: resultSubmissionsTable.status })
      .from(resultSubmissionsTable)
      .where(and(tenantFilter(resultSubmissionsTable, t.id), eq(resultSubmissionsTable.electionId, electionId), sql`${resultSubmissionsTable.pollingStationId} = ANY(${sql.raw(`ARRAY['${wardStationIds.join("','")}']::uuid[]`)})`))
      .orderBy(desc(resultSubmissionsTable.version)) : [];
    const submissionByStation: Record<string, any> = {};
    for (const sub of wardSubmissions) {
      if (sub.pollingStationId && !submissionByStation[sub.pollingStationId]) submissionByStation[sub.pollingStationId] = sub;
    }

    // Get top candidate votes per station
    const stationVotes = wardStationIds.length > 0 ? await db
      .select({ pollingStationId: resultSubmissionsTable.pollingStationId, candidateName: submissionCandidateVotesTable.candidateName, totalVotes: sum(submissionCandidateVotesTable.voteCount) })
      .from(submissionCandidateVotesTable)
      .innerJoin(resultSubmissionsTable, eq(submissionCandidateVotesTable.submissionId, resultSubmissionsTable.id))
      .where(and(tenantFilter(resultSubmissionsTable, t.id), eq(resultSubmissionsTable.electionId, electionId), sql`${resultSubmissionsTable.pollingStationId} = ANY(${sql.raw(`ARRAY['${wardStationIds.join("','")}']::uuid[]`)})`))
      .groupBy(resultSubmissionsTable.pollingStationId, submissionCandidateVotesTable.candidateName) : [];
    const topVotesByStation: Record<string, number> = {};
    for (const sv of stationVotes) {
      if (!sv.pollingStationId) continue;
      const v = Number(sv.totalVotes ?? 0);
      if (v > (topVotesByStation[sv.pollingStationId] ?? 0)) topVotesByStation[sv.pollingStationId] = v;
    }

    const stationSubUnits = stationDetails.map(s => {
      const sub = submissionByStation[s.id];
      return {
        entityId: s.id, entityName: s.name ?? s.code ?? s.id, parentEntityId: wardId,
        code: s.code, registeredVoters: s.registeredVoters,
        submissionId: sub?.id ?? null, status: sub?.status ?? "pending",
        ourCandidateVotes: topVotesByStation[s.id] ?? 0,
        stationsReported: sub ? 1 : 0, stationsTotal: 1,
      };
    });

    // Find parent constituencyId for back navigation
    const [sampleStationW] = await db.select({ constituencyId: pollingStationsTable.constituencyId })
      .from(pollingStationsTable).where(eq(pollingStationsTable.wardId, wardId)).limit(1);

    res.json({
      electionId, wardId, level: "ward",
      entityName: `Ward ${wardId.slice(0, 8)}`,
      parentEntityId: sampleStationW?.constituencyId ?? null,
      candidates: votes.map(v => ({ ...v, votes: Number(v.totalVotes ?? 0), totalVotes: Number(v.totalVotes ?? 0) })),
      subUnits: stationSubUnits,
      reporting: { total: ids.length, reporting: wardReceived, verified: Number(wardVerified), pending: Math.max(0, ids.length - wardReceived) },
      stations: { received: wardReceived, verified: Number(wardVerified), outstanding: Math.max(0, ids.length - wardReceived), disputed: 0 },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/tally/station/:electionId/:stationId ───────────────────────────
router.get("/station/:electionId/:stationId", requireAuth, canViewResults, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const { electionId, stationId } = req.params;

    const [submission] = await db.select().from(resultSubmissionsTable)
      .where(and(
        tenantFilter(resultSubmissionsTable, t.id),
        eq(resultSubmissionsTable.electionId, electionId),
        eq(resultSubmissionsTable.pollingStationId, stationId),
        eq(resultSubmissionsTable.status, "verified"),
      ))
      .orderBy(desc(resultSubmissionsTable.version))
      .limit(1);

    if (!submission) return res.json({ electionId, stationId, submission: null, candidates: [] });

    const votes = await db.select().from(submissionCandidateVotesTable)
      .where(eq(submissionCandidateVotesTable.submissionId, submission.id));

    res.json({ electionId, stationId, level: "station", submission, candidates: votes });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/tally/progress/:electionId ─────────────────────────────────────
router.get("/progress/:electionId", requireAuth, canViewResults, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const { electionId } = req.params;

    // Total stations by county
    const totalByCounty = await db
      .select({
        countyId: pollingStationsTable.countyId,
        total: count(pollingStationsTable.id),
      })
      .from(pollingStationsTable)
      .groupBy(pollingStationsTable.countyId);

    // Reporting by county (has any submission)
    const reportingByCounty = await db
      .select({
        countyId: pollingStationsTable.countyId,
        reporting: count(resultSubmissionsTable.id),
      })
      .from(resultSubmissionsTable)
      .innerJoin(pollingStationsTable, eq(resultSubmissionsTable.pollingStationId, pollingStationsTable.id))
      .where(and(tenantFilter(resultSubmissionsTable, t.id), eq(resultSubmissionsTable.electionId, electionId)))
      .groupBy(pollingStationsTable.countyId);

    // Verified by county
    const verifiedByCounty = await db
      .select({
        countyId: pollingStationsTable.countyId,
        verified: count(resultSubmissionsTable.id),
      })
      .from(resultSubmissionsTable)
      .innerJoin(pollingStationsTable, eq(resultSubmissionsTable.pollingStationId, pollingStationsTable.id))
      .where(and(
        tenantFilter(resultSubmissionsTable, t.id),
        eq(resultSubmissionsTable.electionId, electionId),
        eq(resultSubmissionsTable.status, "verified"),
      ))
      .groupBy(pollingStationsTable.countyId);

    const reportingMap = Object.fromEntries(reportingByCounty.map(r => [r.countyId, Number(r.reporting)]));
    const verifiedMap = Object.fromEntries(verifiedByCounty.map(r => [r.countyId, Number(r.verified)]));

    const progress = totalByCounty.map(t => ({
      countyId: t.countyId,
      total: Number(t.total),
      reporting: reportingMap[t.countyId] ?? 0,
      verified: verifiedMap[t.countyId] ?? 0,
      pending: Number(t.total) - (reportingMap[t.countyId] ?? 0),
    }));

    res.json({ electionId, byCounty: progress });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
