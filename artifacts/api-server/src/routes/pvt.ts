/**
 * PVT API — Parallel Vote Tabulation: sample designs, quick reports,
 * projections, alerts, and stratum summaries. All routes are tenant-scoped.
 */
import { logger } from "../lib/logger";
import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  pvtSampleDesignsTable,
  pvtSampledStationsTable,
  pvtQuickReportsTable,
  pvtProjectionsTable,
  pvtAlertsTable,
  pvtStratumSummariesTable,
  pollingAgentsTable,
  usersTable,
  userRolesTable,
  rolesTable,
  electionsTable,
  candidatesTable,
} from "@workspace/db";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { requireRoles } from "../middlewares/rbac";
import { tenantFilter, assertTenant } from "../lib/withTenant";
import { generateStratifiedSample, computeProjection } from "../lib/pvtEngine";
import { z } from "zod";
import { validate } from "../lib/validate";

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
const canManageAgents = requireRoles([
  "campaign-exec-director", "national-campaign-manager", "returning-officer",
  "county-coordinator", "polling-agent-supervisor",
]);
const canSubmitReports = requireRoles([
  "campaign-exec-director", "national-campaign-manager", "returning-officer",
  "county-coordinator", "constituency-coordinator", "polling-agent-supervisor",
  "result-verifier", "polling-agent",
]);

const createSampleSchema = z.object({
  electionId: z.string().uuid(),
  stratumLevel: z.enum(["county", "constituency"]),
  targetSampleSize: z.number().int().min(10).max(5000),
  confidenceLevel: z.number().min(0.8).max(0.99).optional(),
  marginOfError: z.number().min(0.005).max(0.05).optional(),
});

const quickReportSchema = z.object({
  sampledStationId: z.string().uuid(),
  totalVotesCast: z.number().int().min(0),
  registeredVoters: z.number().int().min(1),
  rejectedBallots: z.number().int().min(0).default(0),
  candidateVotes: z.array(z.object({
    candidateId: z.string().uuid(),
    votes: z.number().int().min(0),
  })).min(1),
  source: z.enum(["mobile", "ussd", "ivr", "sms"]).default("mobile"),
});

/** Resolve the caller's polling-agent row (if any) for attribution + authorization. */
async function resolveAgent(clerkId: string, tenantId: string): Promise<{ id: string; pollingStationId: string | null } | null> {
  const [user] = await db.select({ id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.clerkId, clerkId)).limit(1);
  if (!user) return null;
  const [agent] = await db.select({ id: pollingAgentsTable.id, pollingStationId: pollingAgentsTable.pollingStationId })
    .from(pollingAgentsTable)
    .where(and(eq(pollingAgentsTable.userId, user.id), tenantFilter(pollingAgentsTable, tenantId)))
    .limit(1);
  return agent ?? null;
}

// ─── POST /api/pvt/samples — generate a new stratified sample ───────────────
router.post("/samples", requireAuth, canManageElections, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const parsed = validate(createSampleSchema, req.body, res);
    if (!parsed) return;

    // The election must belong to this tenant — no cross-tenant designs.
    const [election] = await db.select({ id: electionsTable.id }).from(electionsTable)
      .where(and(eq(electionsTable.id, parsed.electionId), tenantFilter(electionsTable, t.id)))
      .limit(1);
    if (!election) return res.status(404).json({ error: "Election not found in this campaign" });

    const designId = await generateStratifiedSample(
      t.id, parsed.electionId, parsed.stratumLevel, parsed.targetSampleSize, req.clerkId,
    );
    const [design] = await db.select().from(pvtSampleDesignsTable)
      .where(eq(pvtSampleDesignsTable.id, designId)).limit(1);
    const [counts] = await db.select({
      total: sql<number>`count(*)::int`,
    }).from(pvtSampledStationsTable).where(eq(pvtSampledStationsTable.sampleDesignId, designId));
    res.status(201).json({ ...design, sampledStations: counts?.total ?? 0 });
  } catch (err: any) {
    if (err?.message?.includes("No campaign polling stations") || err?.message?.includes("no geography") || err?.message?.includes("infeasible")) {
      return res.status(400).json({ error: err.message });
    }
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ─── GET /api/pvt/samples — list sample designs ─────────────────────────────
router.get("/samples", requireAuth, canViewResults, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const conditions: any[] = [tenantFilter(pvtSampleDesignsTable, t.id)];
    if (req.query.electionId) conditions.push(eq(pvtSampleDesignsTable.electionId, String(req.query.electionId)));
    const rows = await db.select().from(pvtSampleDesignsTable)
      .where(and(...conditions))
      .orderBy(desc(pvtSampleDesignsTable.createdAt))
      .limit(50);
    res.json(rows);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ─── POST /api/pvt/samples/:id/activate ─────────────────────────────────────
router.post("/samples/:id/activate", requireAuth, canManageElections, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [design] = await db.select().from(pvtSampleDesignsTable)
      .where(and(eq(pvtSampleDesignsTable.id, req.params.id), tenantFilter(pvtSampleDesignsTable, t.id)))
      .limit(1);
    if (!design) return res.status(404).json({ error: "Sample design not found" });
    if (design.status !== "draft") return res.status(400).json({ error: `Cannot activate from status: ${design.status}` });
    const [updated] = await db.update(pvtSampleDesignsTable)
      .set({ status: "active", activatedAt: new Date() } as any)
      .where(eq(pvtSampleDesignsTable.id, design.id)).returning();
    res.json(updated);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ─── GET /api/pvt/samples/:id/stations ──────────────────────────────────────
router.get("/samples/:id/stations", requireAuth, canViewResults, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const conditions: any[] = [
      eq(pvtSampledStationsTable.sampleDesignId, req.params.id),
      tenantFilter(pvtSampledStationsTable, t.id),
    ];
    if (req.query.status) conditions.push(eq(pvtSampledStationsTable.reportStatus, String(req.query.status)));
    const rows = await db.select().from(pvtSampledStationsTable)
      .where(and(...conditions))
      .orderBy(pvtSampledStationsTable.stratumName, pvtSampledStationsTable.createdAt)
      .limit(5000);
    res.json(rows);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ─── GET /api/pvt/stations/:id — one sampled station (for the report form) ──
router.get("/stations/:id", requireAuth, canSubmitReports, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [station] = await db.select().from(pvtSampledStationsTable)
      .where(and(eq(pvtSampledStationsTable.id, req.params.id), tenantFilter(pvtSampledStationsTable, t.id)))
      .limit(1);
    if (!station) return res.status(404).json({ error: "Sampled station not found" });
    res.json(station);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ─── PATCH /api/pvt/stations/:id/assign-agent ───────────────────────────────
router.patch("/stations/:id/assign-agent", requireAuth, canManageAgents, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const parsed = validate(z.object({ agentId: z.string().uuid().nullable() }), req.body, res);
    if (!parsed) return;
    const [station] = await db.select().from(pvtSampledStationsTable)
      .where(and(eq(pvtSampledStationsTable.id, req.params.id), tenantFilter(pvtSampledStationsTable, t.id)))
      .limit(1);
    if (!station) return res.status(404).json({ error: "Sampled station not found" });
    if (parsed.agentId) {
      const [agent] = await db.select({ id: pollingAgentsTable.id }).from(pollingAgentsTable)
        .where(and(eq(pollingAgentsTable.id, parsed.agentId), tenantFilter(pollingAgentsTable, t.id)))
        .limit(1);
      if (!agent) return res.status(404).json({ error: "Agent not found in this campaign" });
    }
    const [updated] = await db.update(pvtSampledStationsTable)
      .set({ assignedAgentId: parsed.agentId } as any)
      .where(eq(pvtSampledStationsTable.id, station.id)).returning();
    res.json(updated);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ─── POST /api/pvt/quick-reports — agent quick report ───────────────────────
router.post("/quick-reports", requireAuth, canSubmitReports, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const parsed = validate(quickReportSchema, req.body, res);
    if (!parsed) return;

    const [station] = await db.select().from(pvtSampledStationsTable)
      .where(and(eq(pvtSampledStationsTable.id, parsed.sampledStationId), tenantFilter(pvtSampledStationsTable, t.id)))
      .limit(1);
    if (!station) return res.status(404).json({ error: "Sampled station not found" });

    const [design] = await db.select().from(pvtSampleDesignsTable)
      .where(eq(pvtSampleDesignsTable.id, station.sampleDesignId)).limit(1);
    if (!design || design.status !== "active") {
      return res.status(400).json({ error: "This PVT sample is not active for reporting" });
    }

    // Candidates must belong to this tenant + the design's election.
    const candidateIds = parsed.candidateVotes.map((c) => c.candidateId);
    const validCands = await db.select({ id: candidatesTable.id }).from(candidatesTable)
      .where(and(
        tenantFilter(candidatesTable, t.id),
        eq(candidatesTable.electionId, station.electionId),
        inArray(candidatesTable.id, candidateIds),
      ));
    if (validCands.length !== new Set(candidateIds).size) {
      return res.status(400).json({ error: "One or more candidates do not belong to this election", code: "INVALID_CANDIDATE" });
    }

    // Callers who ARE registered agents may only report for their assigned
    // station (explicit assignment or their own polling station). Coordinators
    // and managers (no agent record) may capture reports on an agent's behalf.
    const callerAgent = await resolveAgent(req.clerkId, t.id);
    if (callerAgent) {
      const isAssigned = station.assignedAgentId === callerAgent.id
        || (!station.assignedAgentId && callerAgent.pollingStationId === station.pollingStationId);
      if (!isAssigned) {
        return res.status(403).json({ error: "You are not assigned to this sampled station", code: "NOT_ASSIGNED" });
      }
    } else {
      // A caller whose tenant role is polling-agent but who has NO linked
      // agent record must not inherit coordinator-style broad access.
      const [user] = await db.select({ id: usersTable.id }).from(usersTable)
        .where(eq(usersTable.clerkId, req.clerkId)).limit(1);
      if (user) {
        const [agentRole] = await db.select({ slug: rolesTable.slug }).from(userRolesTable)
          .innerJoin(rolesTable, eq(userRolesTable.roleId, rolesTable.id))
          .where(and(
            eq(userRolesTable.userId, user.id),
            tenantFilter(userRolesTable, t.id),
            eq(rolesTable.slug, "polling-agent"),
          ))
          .limit(1);
        if (agentRole) {
          return res.status(403).json({
            error: "Your agent profile is not linked to a station. Contact your coordinator.",
            code: "AGENT_UNLINKED",
          });
        }
      }
    }

    // Balance check: candidate total must not exceed valid ballots.
    const candidateTotal = parsed.candidateVotes.reduce((a, c) => a + c.votes, 0);
    const validBallots = parsed.totalVotesCast - parsed.rejectedBallots;
    if (candidateTotal > validBallots) {
      return res.status(400).json({
        error: `Candidate votes (${candidateTotal}) exceed valid ballots (${validBallots} = ${parsed.totalVotesCast} cast − ${parsed.rejectedBallots} rejected)`,
        code: "UNBALANCED",
      });
    }

    // One report per sampled station.
    const [existing] = await db.select({ id: pvtQuickReportsTable.id }).from(pvtQuickReportsTable)
      .where(eq(pvtQuickReportsTable.sampledStationId, station.id)).limit(1);
    if (existing) return res.status(409).json({ error: "This station has already reported", code: "DUPLICATE_REPORT" });

    // Insert + status flip atomically; a concurrent duplicate hits the unique
    // index and must surface as 409, not a 500 (constraint code on err.cause).
    let report: any;
    try {
      report = await db.transaction(async (tx) => {
        const [r] = await tx.insert(pvtQuickReportsTable).values({
          tenantId: t.id,
          sampleDesignId: station.sampleDesignId,
          sampledStationId: station.id,
          electionId: station.electionId,
          agentId: callerAgent?.id ?? null,
          totalVotesCast: parsed.totalVotesCast,
          registeredVoters: parsed.registeredVoters,
          rejectedBallots: parsed.rejectedBallots,
          candidateVotes: parsed.candidateVotes,
          isValid: candidateTotal === validBallots, // exact balance = fully valid; under-count flagged but kept
          validationNotes: candidateTotal === validBallots
            ? null
            : `Under-count: candidate total ${candidateTotal} vs valid ballots ${validBallots}`,
          source: parsed.source,
        } as any).returning();

        await tx.update(pvtSampledStationsTable)
          .set({ reportStatus: "quick_reported", quickReportedAt: new Date() } as any)
          .where(eq(pvtSampledStationsTable.id, station.id));
        return r;
      });
    } catch (err: any) {
      const pgCode = err?.cause?.code ?? err?.code;
      if (pgCode === "23505") {
        return res.status(409).json({ error: "This station has already reported", code: "DUPLICATE_REPORT" });
      }
      throw err;
    }

    // Auto-compute a fresh projection (+ alerts + stratum summaries). Never
    // fail the submission if the projection itself errors.
    let projection = null;
    try {
      projection = await computeProjection(station.sampleDesignId, t.id);
    } catch (err) {
      logger.error({ err }, "pvt projection compute failed after quick report");
    }

    res.status(201).json({ report, projection });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ─── GET /api/pvt/quick-reports?sampleDesignId= ─────────────────────────────
router.get("/quick-reports", requireAuth, canViewResults, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const conditions: any[] = [tenantFilter(pvtQuickReportsTable, t.id)];
    if (req.query.sampleDesignId) conditions.push(eq(pvtQuickReportsTable.sampleDesignId, String(req.query.sampleDesignId)));
    const rows = await db.select().from(pvtQuickReportsTable)
      .where(and(...conditions))
      .orderBy(desc(pvtQuickReportsTable.submittedAt))
      .limit(5000);
    res.json(rows);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ─── GET /api/pvt/projections/latest?sampleDesignId= ────────────────────────
router.get("/projections/latest", requireAuth, canViewResults, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const conditions: any[] = [tenantFilter(pvtProjectionsTable, t.id)];
    if (req.query.sampleDesignId) conditions.push(eq(pvtProjectionsTable.sampleDesignId, String(req.query.sampleDesignId)));
    const [row] = await db.select().from(pvtProjectionsTable)
      .where(and(...conditions))
      .orderBy(desc(pvtProjectionsTable.computedAt))
      .limit(1);
    if (!row) return res.status(404).json({ error: "No projection computed yet" });
    res.json(row);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ─── GET /api/pvt/projections/history?sampleDesignId= ───────────────────────
router.get("/projections/history", requireAuth, canViewResults, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const conditions: any[] = [tenantFilter(pvtProjectionsTable, t.id)];
    if (req.query.sampleDesignId) conditions.push(eq(pvtProjectionsTable.sampleDesignId, String(req.query.sampleDesignId)));
    const rows = await db.select().from(pvtProjectionsTable)
      .where(and(...conditions))
      .orderBy(pvtProjectionsTable.computedAt)
      .limit(1000);
    res.json(rows);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ─── POST /api/pvt/projections/compute — manual trigger ─────────────────────
router.post("/projections/compute", requireAuth, canManageElections, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const parsed = validate(z.object({ sampleDesignId: z.string().uuid() }), req.body, res);
    if (!parsed) return;
    const [design] = await db.select({ id: pvtSampleDesignsTable.id }).from(pvtSampleDesignsTable)
      .where(and(eq(pvtSampleDesignsTable.id, parsed.sampleDesignId), tenantFilter(pvtSampleDesignsTable, t.id)))
      .limit(1);
    if (!design) return res.status(404).json({ error: "Sample design not found" });
    const projection = await computeProjection(parsed.sampleDesignId, t.id);
    if (!projection) return res.status(400).json({ error: "No quick reports yet — projection requires at least one report" });
    res.json(projection);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ─── GET /api/pvt/alerts?status=&severity= ──────────────────────────────────
router.get("/alerts", requireAuth, canViewResults, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const conditions: any[] = [tenantFilter(pvtAlertsTable, t.id)];
    if (req.query.sampleDesignId) conditions.push(eq(pvtAlertsTable.sampleDesignId, String(req.query.sampleDesignId)));
    if (req.query.status) conditions.push(eq(pvtAlertsTable.status, String(req.query.status)));
    if (req.query.severity) conditions.push(eq(pvtAlertsTable.severity, String(req.query.severity)));
    const rows = await db.select().from(pvtAlertsTable)
      .where(and(...conditions))
      .orderBy(desc(pvtAlertsTable.createdAt))
      .limit(200);
    res.json(rows);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ─── PATCH /api/pvt/alerts/:id/acknowledge ──────────────────────────────────
router.patch("/alerts/:id/acknowledge", requireAuth, canManageElections, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [updated] = await db.update(pvtAlertsTable)
      .set({ status: "acknowledged", acknowledgedBy: req.clerkId, acknowledgedAt: new Date() } as any)
      .where(and(eq(pvtAlertsTable.id, req.params.id), tenantFilter(pvtAlertsTable, t.id)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Alert not found" });
    res.json(updated);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ─── GET /api/pvt/strata?sampleDesignId= ────────────────────────────────────
router.get("/strata", requireAuth, canViewResults, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const conditions: any[] = [tenantFilter(pvtStratumSummariesTable, t.id)];
    if (req.query.sampleDesignId) conditions.push(eq(pvtStratumSummariesTable.sampleDesignId, String(req.query.sampleDesignId)));
    const rows = await db.select().from(pvtStratumSummariesTable)
      .where(and(...conditions))
      .orderBy(desc(pvtStratumSummariesTable.registeredVoters))
      .limit(500);
    res.json(rows);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

export default router;
