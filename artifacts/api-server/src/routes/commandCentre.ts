/**
 * Command Centre API: Election-night dashboard & task management
 */
import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  commandCentreTasksTable,
  tallySnapshotsTable,
  resultSubmissionsTable,
  electionIncidentReportsTable,
  agentSyncStatusTable,
  pollingStationsTable,
  electionDisputesTable,
  usersTable,
} from "@workspace/db";
import { eq, desc, and, count, inArray } from "drizzle-orm";
import { requireRoles } from "../middlewares/rbac";

const router = Router();

function requireAuth(req: any, res: any, next: any) {
  const auth = getAuth(req);
  if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
  req.clerkId = auth.userId;
  next();
}

async function resolveActorUUID(clerkId: string): Promise<string | null> {
  const [row] = await db.select({ id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.clerkId, clerkId)).limit(1);
  return row?.id ?? null;
}

const canViewCC = requireRoles([
  "campaign-exec-director", "national-campaign-manager", "returning-officer", "county-coordinator",
]);
const canManageCC = requireRoles([
  "campaign-exec-director", "national-campaign-manager", "returning-officer",
]);

// ─── DASHBOARD ───────────────────────────────────────────────────────────────

// GET /api/command-centre/dashboard/:electionId
router.get("/dashboard/:electionId", requireAuth, canViewCC, async (req: any, res: any) => {
  try {
    const { electionId } = req.params;

    const [
      nationalTally,
      submissionRows,
      incidentRows,
      agentSync,
      pendingTasks,
      legalEscalations,
    ] = await Promise.all([
      // National tally — top candidates from latest snapshots
      db.select({
        candidateId: tallySnapshotsTable.candidateId,
        candidateName: tallySnapshotsTable.candidateName,
        partyAbbreviation: tallySnapshotsTable.partyAbbreviation,
        votes: tallySnapshotsTable.votes,
        computedAt: tallySnapshotsTable.computedAt,
      })
        .from(tallySnapshotsTable)
        .where(and(
          eq(tallySnapshotsTable.electionId, electionId),
          eq(tallySnapshotsTable.level, "national"),
        ))
        .orderBy(desc(tallySnapshotsTable.computedAt))
        .limit(20),

      // Stations summary — count by status
      db.select({
        status: resultSubmissionsTable.status,
        total: count(resultSubmissionsTable.id),
      })
        .from(resultSubmissionsTable)
        .where(eq(resultSubmissionsTable.electionId, electionId))
        .groupBy(resultSubmissionsTable.status),

      // Incident summary — count by severity
      db.select({
        severity: electionIncidentReportsTable.severity,
        total: count(electionIncidentReportsTable.id),
      })
        .from(electionIncidentReportsTable)
        .where(eq(electionIncidentReportsTable.electionId, electionId))
        .groupBy(electionIncidentReportsTable.severity),

      // Agent sync summary
      db.select({
        syncStatus: agentSyncStatusTable.syncStatus,
        total: count(agentSyncStatusTable.id),
      })
        .from(agentSyncStatusTable)
        .groupBy(agentSyncStatusTable.syncStatus),

      // Pending tasks
      db.select()
        .from(commandCentreTasksTable)
        .where(and(
          eq(commandCentreTasksTable.electionId, electionId),
          eq(commandCentreTasksTable.status, "open"),
        ))
        .orderBy(desc(commandCentreTasksTable.createdAt))
        .limit(20),

      // Legal escalations — open disputes
      db.select({
        id: electionDisputesTable.id,
        title: electionDisputesTable.title,
        priority: electionDisputesTable.priority,
        disputeType: electionDisputesTable.disputeType,
        status: electionDisputesTable.status,
      })
        .from(electionDisputesTable)
        .where(and(
          eq(electionDisputesTable.electionId, electionId),
          eq(electionDisputesTable.status, "open"),
        ))
        .orderBy(desc(electionDisputesTable.createdAt))
        .limit(10),
    ]);

    res.json({
      electionId,
      nationalTally,
      // Convert to key-indexed objects so frontend can read stationsSummary.verified etc.
      stationsSummary: submissionRows.reduce((acc: Record<string, number>, r) => {
        acc[r.status ?? "unknown"] = Number(r.total);
        return acc;
      }, {}),
      incidentSummary: incidentRows.reduce((acc: Record<string, number>, r) => {
        acc[r.severity ?? "unknown"] = Number(r.total);
        return acc;
      }, {}),
      agentSyncSummary: agentSync.reduce((acc: Record<string, number>, r) => {
        acc[r.syncStatus ?? "unknown"] = Number(r.total);
        return acc;
      }, {}),
      pendingTasks,
      legalEscalations,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/command-centre/county-dashboard/:electionId/:countyId
router.get("/county-dashboard/:electionId/:countyId", requireAuth, canViewCC, async (req: any, res: any) => {
  try {
    const { electionId, countyId } = req.params;

    // Get station IDs for county
    const countyStations = await db.select({ id: pollingStationsTable.id })
      .from(pollingStationsTable)
      .where(eq(pollingStationsTable.countyId, countyId));
    const stationIds = countyStations.map(s => s.id);

    const [
      countyTally,
      submissionRows,
      incidentRows,
      pendingTasks,
      legalEscalations,
    ] = await Promise.all([
      // County tally
      db.select({
        candidateId: tallySnapshotsTable.candidateId,
        candidateName: tallySnapshotsTable.candidateName,
        partyAbbreviation: tallySnapshotsTable.partyAbbreviation,
        votes: tallySnapshotsTable.votes,
        computedAt: tallySnapshotsTable.computedAt,
      })
        .from(tallySnapshotsTable)
        .where(and(
          eq(tallySnapshotsTable.electionId, electionId),
          eq(tallySnapshotsTable.level, "county"),
          eq(tallySnapshotsTable.entityId, countyId),
        ))
        .orderBy(desc(tallySnapshotsTable.computedAt))
        .limit(20),

      // Submissions in county stations
      stationIds.length > 0
        ? db.select({
            status: resultSubmissionsTable.status,
            total: count(resultSubmissionsTable.id),
          })
          .from(resultSubmissionsTable)
          .where(and(
            eq(resultSubmissionsTable.electionId, electionId),
            inArray(resultSubmissionsTable.pollingStationId, stationIds),
          ))
          .groupBy(resultSubmissionsTable.status)
        : Promise.resolve([]),

      // Incidents in county
      db.select({
        severity: electionIncidentReportsTable.severity,
        total: count(electionIncidentReportsTable.id),
      })
        .from(electionIncidentReportsTable)
        .where(and(
          eq(electionIncidentReportsTable.electionId, electionId),
          eq(electionIncidentReportsTable.countyId, countyId),
        ))
        .groupBy(electionIncidentReportsTable.severity),

      // Pending tasks for county stations
      db.select()
        .from(commandCentreTasksTable)
        .where(and(
          eq(commandCentreTasksTable.electionId, electionId),
          eq(commandCentreTasksTable.status, "open"),
        ))
        .orderBy(desc(commandCentreTasksTable.createdAt))
        .limit(20),

      // Legal escalations in county
      stationIds.length > 0
        ? db.select({
            id: electionDisputesTable.id,
            title: electionDisputesTable.title,
            priority: electionDisputesTable.priority,
            disputeType: electionDisputesTable.disputeType,
            status: electionDisputesTable.status,
          })
          .from(electionDisputesTable)
          .where(and(
            eq(electionDisputesTable.electionId, electionId),
            eq(electionDisputesTable.status, "open"),
            inArray(electionDisputesTable.pollingStationId, stationIds),
          ))
          .orderBy(desc(electionDisputesTable.createdAt))
          .limit(10)
        : Promise.resolve([]),
    ]);

    res.json({
      electionId,
      countyId,
      countyTally,
      stationsSummary: (submissionRows as any[]).map((r: any) => ({ status: r.status, count: Number(r.total) })),
      incidentSummary: incidentRows.map(r => ({ severity: r.severity, count: Number(r.total) })),
      pendingTasks,
      legalEscalations,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── TASKS ────────────────────────────────────────────────────────────────────

// GET /api/command-centre/tasks
router.get("/tasks", requireAuth, canViewCC, async (req: any, res: any) => {
  try {
    const { electionId, status, priority, assignedTo, page = "1", limit = "20" } = req.query;
    const pageNum = parseInt(page) || 1;
    const pageSize = Math.min(parseInt(limit) || 20, 100);
    const offset = (pageNum - 1) * pageSize;

    const conditions: any[] = [];
    if (electionId) conditions.push(eq(commandCentreTasksTable.electionId, electionId));
    if (status) conditions.push(eq(commandCentreTasksTable.status, status));
    if (priority) conditions.push(eq(commandCentreTasksTable.priority, priority));
    if (assignedTo) conditions.push(eq(commandCentreTasksTable.assignedTo, assignedTo));
    const where = conditions.length ? and(...conditions) : undefined;

    const [rows, [{ total }]] = await Promise.all([
      db.select().from(commandCentreTasksTable).where(where)
        .orderBy(desc(commandCentreTasksTable.createdAt))
        .limit(pageSize).offset(offset),
      db.select({ total: count() }).from(commandCentreTasksTable).where(where),
    ]);
    res.json({ data: rows, total: Number(total), page: pageNum, pageSize });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/command-centre/tasks
router.post("/tasks", requireAuth, canManageCC, async (req: any, res: any) => {
  try {
    const actorId = await resolveActorUUID(req.clerkId);
    if (!actorId) return res.status(403).json({ error: "Actor not found" });
    const [row] = await db.insert(commandCentreTasksTable).values({
      ...req.body,
      createdBy: actorId,
      status: req.body.status ?? "open",
    }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/command-centre/tasks/:id
router.patch("/tasks/:id", requireAuth, canManageCC, async (req: any, res: any) => {
  try {
    const updateData: any = { ...req.body };
    if (updateData.status === "completed") updateData.completedAt = new Date();

    const [row] = await db.update(commandCentreTasksTable).set(updateData)
      .where(eq(commandCentreTasksTable.id, req.params.id)).returning();
    if (!row) return res.status(404).json({ error: "Task not found" });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
