/**
 * Transparency Portal API
 * Public result publication with dual-approval workflow
 */
import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  transparencyPublicationsTable,
  usersTable,
} from "@workspace/db";
import { eq, desc, and, count } from "drizzle-orm";
import { requireRoles, resolveActor } from "../middlewares/rbac";
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

const canPublishTransparency = requireRoles([
  "campaign-exec-director", "national-campaign-manager",
]);
const canLegalApprove = requireRoles([
  "campaign-exec-director", "legal-officer",
]);
const canCommsApprove = requireRoles([
  "campaign-exec-director", "communications-officer",
]);

/** Derive a status string from timestamp fields so the frontend can filter/badge */
function derivePublicationStatus(pub: Record<string, any>): string {
  if (pub.isPublic) return "published";
  if (pub.legalApprovedAt && pub.commsApprovedAt) return "comms_approved";
  if (pub.legalApprovedAt) return "pending_comms";
  return "pending_legal";
}

// GET /api/transparency/publications — admin + public
// requireAuth + resolveActor ensure actorRoles is populated before the admin check
router.get("/publications", requireAuth, resolveActor, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    // Only users with transparency-management roles see unpublished items
    const adminRoles = ["campaign-exec-director", "national-campaign-manager", "communications-officer", "legal-officer", "super-admin"];
    // actorRoles is now always populated by resolveActor above
    const userRoles: string[] = (req as any).actorRoles ?? [];
    const isAdmin = userRoles.length > 0 && adminRoles.some(r => userRoles.includes(r));

    const { electionId, status, page = "1", limit = "20" } = req.query;
    const pageNum = parseInt(page) || 1;
    const pageSize = Math.min(parseInt(limit) || 20, 100);
    const offset = (pageNum - 1) * pageSize;

    const conditions: any[] = [tenantFilter(transparencyPublicationsTable, t.id)];
    // Non-admins only see published
    if (!isAdmin) conditions.push(eq(transparencyPublicationsTable.isPublic, true));
    if (electionId) conditions.push(eq(transparencyPublicationsTable.electionId, electionId));
    const where = and(...conditions);

    const [rows, [{ total }]] = await Promise.all([
      db.select().from(transparencyPublicationsTable).where(where)
        .orderBy(desc(transparencyPublicationsTable.createdAt)).limit(pageSize).offset(offset),
      db.select({ total: count() }).from(transparencyPublicationsTable).where(where),
    ]);

    // Add derived status field + apply optional status filter post-query
    const enriched = rows.map(r => ({ ...r, status: derivePublicationStatus(r) }));
    const filtered = status && status !== "all"
      ? enriched.filter(r => r.status === status)
      : enriched;

    res.json({ data: filtered, total: Number(total), page: pageNum, pageSize });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/transparency/publications/:id — public (no auth required)
router.get("/publications/:id", async (req: any, res: any) => {
  try {
    const tenantId = req.tenant?.id;
    // Require tenant context — public callers must supply X-Tenant-Slug / ?tenant=
    if (!tenantId) return res.status(404).json({ error: "Publication not found" });
    const [row] = await db.select().from(transparencyPublicationsTable)
      .where(and(eq(transparencyPublicationsTable.id, req.params.id), eq(transparencyPublicationsTable.isPublic, true), tenantFilter(transparencyPublicationsTable, tenantId)))
      .limit(1);
    if (!row) return res.status(404).json({ error: "Publication not found" });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/transparency/publications — create draft
router.post("/publications", requireAuth, canPublishTransparency, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    // Only pick columns that exist in transparencyPublicationsTable schema
    // Frontend may send title/description/stationId — map stationId→pollingStationId, discard others
    const { electionId, stationId, pollingStationId, submissionId, redactionNotes } = req.body;
    const [row] = await db.insert(transparencyPublicationsTable).values({
      tenantId: t.id,
      electionId,
      pollingStationId: pollingStationId ?? stationId ?? undefined,
      submissionId: submissionId ?? undefined,
      redactionNotes: redactionNotes ?? undefined,
      isPublic: false,
    }).returning();
    res.status(201).json({ ...row, status: derivePublicationStatus(row) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/transparency/publications/:id/legal-approve
router.post("/publications/:id/legal-approve", requireAuth, canLegalApprove, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const actorId = await resolveActorUUID(req.clerkId);
    const [row] = await db.update(transparencyPublicationsTable).set({
      legalApprovedBy: actorId ?? undefined,
      legalApprovedAt: new Date(),
    }).where(and(eq(transparencyPublicationsTable.id, req.params.id), tenantFilter(transparencyPublicationsTable, t.id))).returning();
    if (!row) return res.status(404).json({ error: "Publication not found" });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/transparency/publications/:id/comms-approve
router.post("/publications/:id/comms-approve", requireAuth, canCommsApprove, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const actorId = await resolveActorUUID(req.clerkId);
    const [row] = await db.update(transparencyPublicationsTable).set({
      commsApprovedBy: actorId ?? undefined,
      commsApprovedAt: new Date(),
    }).where(and(eq(transparencyPublicationsTable.id, req.params.id), tenantFilter(transparencyPublicationsTable, t.id))).returning();
    if (!row) return res.status(404).json({ error: "Publication not found" });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/transparency/publications/:id/publish
router.post("/publications/:id/publish", requireAuth, canPublishTransparency, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const actorId = await resolveActorUUID(req.clerkId);

    // Verify both approvals
    const [pub] = await db.select().from(transparencyPublicationsTable)
      .where(and(eq(transparencyPublicationsTable.id, req.params.id), tenantFilter(transparencyPublicationsTable, t.id))).limit(1);
    if (!pub) return res.status(404).json({ error: "Publication not found" });
    if (!pub.legalApprovedAt) return res.status(400).json({ error: "Legal approval required before publishing" });
    if (!pub.commsApprovedAt) return res.status(400).json({ error: "Comms approval required before publishing" });

    const [row] = await db.update(transparencyPublicationsTable).set({
      isPublic: true,
      publishedBy: actorId ?? undefined,
      publishedAt: new Date(),
      redactionNotes: req.body.redactionNotes,
    }).where(and(eq(transparencyPublicationsTable.id, req.params.id), tenantFilter(transparencyPublicationsTable, t.id))).returning();
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
