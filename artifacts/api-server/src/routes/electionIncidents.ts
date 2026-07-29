/**
 * Election Incidents API
 * Uses electionIncidentReportsTable (NOT the old incidentsTable)
 */
import { Router } from "express";
import { z } from "zod";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  electionIncidentReportsTable,
  usersTable,
} from "@workspace/db";
import { eq, desc, and, count } from "drizzle-orm";
import { requireRoles } from "../middlewares/rbac";
import { validate } from "../lib/validate";
import { tenantFilter, assertTenant } from '../lib/withTenant';

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

// ─── Schemas ──────────────────────────────────────────────────────────────────

const IncidentCreateSchema = z.object({
  electionId: z.string().uuid(),
  incidentType: z.string().min(1),
  title: z.string().min(1),
  severity: z.string().optional(),
  description: z.string().min(1),
  countyId: z.string().uuid().optional(),
  constituencyId: z.string().uuid().optional(),
  pollingStationId: z.string().uuid().optional(),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  gpsLat: z.number().optional(),
  gpsLon: z.number().optional(),
  evidenceUrls: z.array(z.string()).optional(),
  status: z.string().optional(),
});

const IncidentPatchSchema = z.object({
  status: z.string().optional(),
  resolution: z.string().optional(),
  legalAction: z.string().optional(),
  communicationsNote: z.string().optional(),
  assignedOfficer: z.string().optional(),
});

// GET /api/election-incidents/
router.get("/", requireAuth, canViewIncidents, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const {
      electionId, countyId, constituencyId, pollingStationId,
      incidentType, severity, status, page = "1", limit = "20",
    } = req.query;
    const pageNum = parseInt(page) || 1;
    const pageSize = Math.min(parseInt(limit) || 20, 100);
    const offset = (pageNum - 1) * pageSize;

    const conditions: any[] = [tenantFilter(electionIncidentReportsTable, t.id)];
    if (electionId) conditions.push(eq(electionIncidentReportsTable.electionId, electionId));
    if (countyId) conditions.push(eq(electionIncidentReportsTable.countyId, countyId));
    if (constituencyId) conditions.push(eq(electionIncidentReportsTable.constituencyId, constituencyId));
    if (pollingStationId) conditions.push(eq(electionIncidentReportsTable.pollingStationId, pollingStationId));
    if (incidentType) conditions.push(eq(electionIncidentReportsTable.incidentType, incidentType));
    if (severity) conditions.push(eq(electionIncidentReportsTable.severity, severity));
    if (status) conditions.push(eq(electionIncidentReportsTable.status, status));
    const where = and(...conditions);

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
    const t = assertTenant(req);
    const body = validate(IncidentCreateSchema, req.body, res);
    if (!body) return;

    const actorId = await resolveActorUUID(req.clerkId);
    const { occurredAt, ...rest } = body;
    const [row] = await db.insert(electionIncidentReportsTable).values({
      ...rest,
      tenantId: t.id,
      ...(occurredAt ? { occurredAt: new Date(occurredAt) } : {}),
      reportedBy: actorId ?? undefined,
      status: rest.status ?? "open",
    }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/election-incidents/:id
router.get("/:id", requireAuth, canViewIncidents, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [row] = await db.select().from(electionIncidentReportsTable)
      .where(and(eq(electionIncidentReportsTable.id, req.params.id), tenantFilter(electionIncidentReportsTable, t.id))).limit(1);
    if (!row) return res.status(404).json({ error: "Incident not found" });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/election-incidents/:id
router.patch("/:id", requireAuth, canManageIncidents, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const body = validate(IncidentPatchSchema, req.body, res);
    if (!body) return;

    const { status, resolution, legalAction, communicationsNote, assignedOfficer } = body;
    const updateData: any = {};
    if (status !== undefined) updateData.status = status;
    if (resolution !== undefined) updateData.resolution = resolution;
    if (legalAction !== undefined) updateData.legalAction = legalAction;
    if (communicationsNote !== undefined) updateData.communicationsNote = communicationsNote;
    if (assignedOfficer !== undefined) updateData.assignedOfficer = assignedOfficer;
    if (status === "resolved") updateData.resolvedAt = new Date();

    const [row] = await db.update(electionIncidentReportsTable).set(updateData)
      .where(and(eq(electionIncidentReportsTable.id, req.params.id), tenantFilter(electionIncidentReportsTable, t.id))).returning();
    if (!row) return res.status(404).json({ error: "Incident not found" });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/election-incidents/:id/escalate
router.post("/:id/escalate", requireAuth, canManageIncidents, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [existing] = await db.select({ escalationLevel: electionIncidentReportsTable.escalationLevel })
      .from(electionIncidentReportsTable).where(and(eq(electionIncidentReportsTable.id, req.params.id), tenantFilter(electionIncidentReportsTable, t.id))).limit(1);
    if (!existing) return res.status(404).json({ error: "Incident not found" });

    const newLevel = Math.min((existing.escalationLevel ?? 1) + 1, 4);
    const [row] = await db.update(electionIncidentReportsTable).set({
      escalationLevel: newLevel,
      status: "escalated",
    }).where(and(eq(electionIncidentReportsTable.id, req.params.id), tenantFilter(electionIncidentReportsTable, t.id))).returning();
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
