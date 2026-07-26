/**
 * Election Incidents API
 * Uses electionIncidentReportsTable (NOT the old incidentsTable)
 */
import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  electionIncidentReportsTable,
  usersTable,
} from "@workspace/db";
import { eq, desc, and, count } from "drizzle-orm";
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

const canViewIncidents = requireRoles([
  "campaign-exec-director", "national-campaign-manager", "returning-officer",
  "county-coordinator", "constituency-coordinator", "polling-agent-supervisor",
  "legal-officer", "communications-officer",
]);
const canReportIncidents = requireRoles([
  "campaign-exec-director", "national-campaign-manager", "returning-officer",
  "county-coordinator", "constituency-coordinator", "polling-agent-supervisor",
  "legal-officer", "communications-officer",
]);
const canManageIncidents = requireRoles([
  "campaign-exec-director", "national-campaign-manager", "returning-officer", "legal-officer",
]);

// GET /api/election-incidents/
router.get("/", requireAuth, canViewIncidents, async (req: any, res: any) => {
  try {
    const {
      electionId, countyId, constituencyId, pollingStationId,
      incidentType, severity, status, page = "1", limit = "20",
    } = req.query;
    const pageNum = parseInt(page) || 1;
    const pageSize = Math.min(parseInt(limit) || 20, 100);
    const offset = (pageNum - 1) * pageSize;

    const conditions: any[] = [];
    if (electionId) conditions.push(eq(electionIncidentReportsTable.electionId, electionId));
    if (countyId) conditions.push(eq(electionIncidentReportsTable.countyId, countyId));
    if (constituencyId) conditions.push(eq(electionIncidentReportsTable.constituencyId, constituencyId));
    if (pollingStationId) conditions.push(eq(electionIncidentReportsTable.pollingStationId, pollingStationId));
    if (incidentType) conditions.push(eq(electionIncidentReportsTable.incidentType, incidentType));
    if (severity) conditions.push(eq(electionIncidentReportsTable.severity, severity));
    if (status) conditions.push(eq(electionIncidentReportsTable.status, status));
    const where = conditions.length ? and(...conditions) : undefined;

    const [rows, [{ total }]] = await Promise.all([
      db.select().from(electionIncidentReportsTable).where(where)
        .orderBy(desc(electionIncidentReportsTable.createdAt)).limit(pageSize).offset(offset),
      db.select({ total: count() }).from(electionIncidentReportsTable).where(where),
    ]);
    res.json({ data: rows, total: Number(total), page: pageNum, pageSize });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/election-incidents/
router.post("/", requireAuth, canReportIncidents, async (req: any, res: any) => {
  try {
    const actorId = await resolveActorUUID(req.clerkId);
    const [row] = await db.insert(electionIncidentReportsTable).values({
      ...req.body,
      reportedBy: actorId ?? undefined,
      status: req.body.status ?? "open",
    }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/election-incidents/:id
router.get("/:id", requireAuth, canViewIncidents, async (req: any, res: any) => {
  try {
    const [row] = await db.select().from(electionIncidentReportsTable)
      .where(eq(electionIncidentReportsTable.id, req.params.id)).limit(1);
    if (!row) return res.status(404).json({ error: "Incident not found" });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/election-incidents/:id
router.patch("/:id", requireAuth, canManageIncidents, async (req: any, res: any) => {
  try {
    const { status, resolution, legalAction, communicationsNote, assignedOfficer } = req.body;
    const updateData: any = {};
    if (status !== undefined) updateData.status = status;
    if (resolution !== undefined) updateData.resolution = resolution;
    if (legalAction !== undefined) updateData.legalAction = legalAction;
    if (communicationsNote !== undefined) updateData.communicationsNote = communicationsNote;
    if (assignedOfficer !== undefined) updateData.assignedOfficer = assignedOfficer;
    if (status === "resolved") updateData.resolvedAt = new Date();

    const [row] = await db.update(electionIncidentReportsTable).set(updateData)
      .where(eq(electionIncidentReportsTable.id, req.params.id)).returning();
    if (!row) return res.status(404).json({ error: "Incident not found" });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/election-incidents/:id/escalate
router.post("/:id/escalate", requireAuth, canManageIncidents, async (req: any, res: any) => {
  try {
    const [existing] = await db.select({ escalationLevel: electionIncidentReportsTable.escalationLevel })
      .from(electionIncidentReportsTable).where(eq(electionIncidentReportsTable.id, req.params.id)).limit(1);
    if (!existing) return res.status(404).json({ error: "Incident not found" });

    const newLevel = Math.min((existing.escalationLevel ?? 1) + 1, 4);
    const [row] = await db.update(electionIncidentReportsTable).set({
      escalationLevel: newLevel,
      status: "escalated",
    }).where(eq(electionIncidentReportsTable.id, req.params.id)).returning();
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
