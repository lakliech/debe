/**
 * Communications Command Centre API
 * Templates, Audience Segments, Scheduled Messages, Spokespeople, Statements
 */
import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  messageTemplatesTable, audienceSegmentsTable, scheduledMessagesTable,
  messageDeliveriesTable, spokespersonDirectoryTable, statementsTable,
  statementVersionsTable, usersTable, supportersTable, volunteersTable,
} from "@workspace/db";
import { eq, desc, and, ilike, count, gte, or } from "drizzle-orm";
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

const canViewComms = requireRoles(["campaign-exec-director","communications-officer","national-campaign-manager","national-organising-director","legal-officer"]);
const canManageComms = requireRoles(["campaign-exec-director","communications-officer"]);
const canApproveComms = requireRoles(["campaign-exec-director","national-campaign-manager"]);
const canEmergencySuspend = requireRoles(["campaign-exec-director","national-campaign-manager","communications-officer"]);

// ─── MESSAGE TEMPLATES ────────────────────────────────────────────────────────

router.get("/templates", requireAuth, canViewComms, async (req: any, res: any) => {
  try {
    const { channel, category, status, search } = req.query;
    const conds: any[] = [];
    if (channel) conds.push(eq(messageTemplatesTable.channel, channel));
    if (category) conds.push(eq(messageTemplatesTable.category, category));
    if (status) conds.push(eq(messageTemplatesTable.status, status));
    if (search) conds.push(or(ilike(messageTemplatesTable.name, `%${search}%`), ilike(messageTemplatesTable.bodyEn, `%${search}%`)));
    const where = conds.length ? and(...conds) : undefined;
    const rows = await db.select().from(messageTemplatesTable).where(where).orderBy(desc(messageTemplatesTable.createdAt));
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/templates", requireAuth, canManageComms, async (req: any, res: any) => {
  try {
    const actorId = await resolveActorUUID(req.clerkId);
    if (!actorId) return res.status(403).json({ error: "Actor not found" });
    const [row] = await db.insert(messageTemplatesTable).values({ ...req.body, createdBy: actorId, status: "draft" }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/templates/:id", requireAuth, canViewComms, async (req: any, res: any) => {
  try {
    const [row] = await db.select().from(messageTemplatesTable).where(eq(messageTemplatesTable.id, req.params.id)).limit(1);
    if (!row) return res.status(404).json({ error: "Template not found" });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/templates/:id", requireAuth, canManageComms, async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const [row] = await db.select().from(messageTemplatesTable).where(eq(messageTemplatesTable.id, id)).limit(1);
    if (!row) return res.status(404).json({ error: "Not found" });
    if (row.status === "approved") return res.status(400).json({ error: "Cannot edit an approved template — create a new version" });
    const [updated] = await db.update(messageTemplatesTable).set(req.body).where(eq(messageTemplatesTable.id, id)).returning();
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Submit for approval
router.post("/templates/:id/submit", requireAuth, canManageComms, async (req: any, res: any) => {
  try {
    const [updated] = await db.update(messageTemplatesTable)
      .set({ status: "pending_approval" })
      .where(and(eq(messageTemplatesTable.id, req.params.id), eq(messageTemplatesTable.status, "draft")))
      .returning();
    if (!updated) return res.status(400).json({ error: "Only draft templates can be submitted" });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Approve template
router.post("/templates/:id/approve", requireAuth, canApproveComms, async (req: any, res: any) => {
  try {
    const actorId = await resolveActorUUID(req.clerkId);
    const [updated] = await db.update(messageTemplatesTable)
      .set({ status: "approved", approvedBy: actorId ?? undefined, approvedAt: new Date() })
      .where(and(eq(messageTemplatesTable.id, req.params.id), eq(messageTemplatesTable.status, "pending_approval")))
      .returning();
    if (!updated) return res.status(400).json({ error: "Template not in pending_approval status" });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Emergency suspend template
router.post("/templates/:id/suspend", requireAuth, canEmergencySuspend, async (req: any, res: any) => {
  try {
    const actorId = await resolveActorUUID(req.clerkId);
    const [updated] = await db.update(messageTemplatesTable)
      .set({ status: "suspended", suspendedBy: actorId ?? undefined, suspendedAt: new Date(), suspensionReason: req.body.reason })
      .where(eq(messageTemplatesTable.id, req.params.id))
      .returning();
    if (!updated) return res.status(404).json({ error: "Template not found" });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── AUDIENCE SEGMENTS ────────────────────────────────────────────────────────

router.get("/segments", requireAuth, canViewComms, async (_req: any, res: any) => {
  try {
    const rows = await db.select().from(audienceSegmentsTable).orderBy(desc(audienceSegmentsTable.createdAt));
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/segments", requireAuth, canManageComms, async (req: any, res: any) => {
  try {
    const actorId = await resolveActorUUID(req.clerkId);
    if (!actorId) return res.status(403).json({ error: "Actor not found" });

    const { name, description, filters } = req.body;

    // Estimate reach: count supporters with matching consent channels
    let estimatedReach = 0;
    try {
      const conds: any[] = [];
      if (filters?.consentChannels?.includes("sms")) conds.push(eq(supportersTable.consentSms, true));
      if (filters?.consentChannels?.includes("email")) conds.push(eq(supportersTable.consentEmail, true));
      if (filters?.countyIds?.length) {
        // simplified: just count all consented supporters for now
      }
      const [{ total }] = await db.select({ total: count() }).from(supportersTable);
      estimatedReach = Number(total);
    } catch (_) {}

    const [row] = await db.insert(audienceSegmentsTable).values({
      name, description, filters, estimatedReach, createdBy: actorId, lastBuiltAt: new Date(),
    }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/segments/:id", requireAuth, canViewComms, async (req: any, res: any) => {
  try {
    const [row] = await db.select().from(audienceSegmentsTable).where(eq(audienceSegmentsTable.id, req.params.id)).limit(1);
    if (!row) return res.status(404).json({ error: "Segment not found" });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── SCHEDULED MESSAGES ───────────────────────────────────────────────────────

router.get("/messages", requireAuth, canViewComms, async (req: any, res: any) => {
  try {
    const { status, page = "1", limit = "20" } = req.query;
    const pageNum = parseInt(page) || 1; const pageSize = Math.min(parseInt(limit) || 20, 50);
    const where = status ? eq(scheduledMessagesTable.status, status) : undefined;
    const [rows, [{ total }]] = await Promise.all([
      db.select().from(scheduledMessagesTable).where(where).orderBy(desc(scheduledMessagesTable.scheduledAt)).limit(pageSize).offset((pageNum - 1) * pageSize),
      db.select({ total: count() }).from(scheduledMessagesTable).where(where),
    ]);
    res.json({ data: rows, total: Number(total), page: pageNum, pageSize });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/messages", requireAuth, canManageComms, async (req: any, res: any) => {
  try {
    const actorId = await resolveActorUUID(req.clerkId);
    if (!actorId) return res.status(403).json({ error: "Actor not found" });
    // Validate template is approved
    const [tmpl] = await db.select({ status: messageTemplatesTable.status }).from(messageTemplatesTable)
      .where(eq(messageTemplatesTable.id, req.body.templateId)).limit(1);
    if (!tmpl || tmpl.status !== "approved") return res.status(400).json({ error: "Template must be approved before scheduling" });
    const [row] = await db.insert(scheduledMessagesTable).values({ ...req.body, createdBy: actorId, status: "pending" }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/messages/:id/approve", requireAuth, canApproveComms, async (req: any, res: any) => {
  try {
    const actorId = await resolveActorUUID(req.clerkId);
    const [updated] = await db.update(scheduledMessagesTable)
      .set({ status: "approved", approvedBy: actorId ?? undefined, approvedAt: new Date() })
      .where(and(eq(scheduledMessagesTable.id, req.params.id), eq(scheduledMessagesTable.status, "pending")))
      .returning();
    if (!updated) return res.status(400).json({ error: "Message not in pending status" });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Emergency suspend in-flight message
router.post("/messages/:id/emergency-suspend", requireAuth, canEmergencySuspend, async (req: any, res: any) => {
  try {
    const actorId = await resolveActorUUID(req.clerkId);
    const [updated] = await db.update(scheduledMessagesTable)
      .set({ status: "cancelled", emergencySuspendedBy: actorId ?? undefined, emergencySuspendedAt: new Date(), cancelledAt: new Date() })
      .where(eq(scheduledMessagesTable.id, req.params.id))
      .returning();
    if (!updated) return res.status(404).json({ error: "Message not found" });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET delivery status for a scheduled message
router.get("/messages/:id/deliveries", requireAuth, canViewComms, async (req: any, res: any) => {
  try {
    const { page = "1", limit = "50" } = req.query;
    const pageNum = parseInt(page) || 1; const pageSize = Math.min(parseInt(limit) || 50, 200);
    const [rows, [{ total }]] = await Promise.all([
      db.select().from(messageDeliveriesTable).where(eq(messageDeliveriesTable.scheduledMessageId, req.params.id))
        .orderBy(desc(messageDeliveriesTable.createdAt)).limit(pageSize).offset((pageNum - 1) * pageSize),
      db.select({ total: count() }).from(messageDeliveriesTable).where(eq(messageDeliveriesTable.scheduledMessageId, req.params.id)),
    ]);
    res.json({ data: rows, total: Number(total), page: pageNum, pageSize });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── SPOKESPERSON DIRECTORY ───────────────────────────────────────────────────

router.get("/spokespeople", requireAuth, canViewComms, async (_req: any, res: any) => {
  try {
    const rows = await db.select().from(spokespersonDirectoryTable).where(eq(spokespersonDirectoryTable.isActive, true)).orderBy(spokespersonDirectoryTable.priority);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/spokespeople", requireAuth, canManageComms, async (req: any, res: any) => {
  try {
    const [row] = await db.insert(spokespersonDirectoryTable).values(req.body).returning();
    res.status(201).json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/spokespeople/:id", requireAuth, canManageComms, async (req: any, res: any) => {
  try {
    const [row] = await db.update(spokespersonDirectoryTable).set(req.body).where(eq(spokespersonDirectoryTable.id, req.params.id)).returning();
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── STATEMENTS (version-controlled) ─────────────────────────────────────────

router.get("/statements", requireAuth, canViewComms, async (req: any, res: any) => {
  try {
    const { status, category } = req.query;
    const conds: any[] = [];
    if (status) conds.push(eq(statementsTable.status, status));
    if (category) conds.push(eq(statementsTable.category, category));
    const where = conds.length ? and(...conds) : undefined;
    const rows = await db.select().from(statementsTable).where(where).orderBy(desc(statementsTable.createdAt));
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/statements", requireAuth, canManageComms, async (req: any, res: any) => {
  try {
    const actorId = await resolveActorUUID(req.clerkId);
    if (!actorId) return res.status(403).json({ error: "Actor not found" });
    const { bodyEn, bodySw, bodyLocal, localLanguageName, ...statementData } = req.body;
    const [statement] = await db.insert(statementsTable).values({ ...statementData, createdBy: actorId, status: "draft" }).returning();
    // Create first version
    await db.insert(statementVersionsTable).values({ statementId: statement.id, version: 1, bodyEn, bodySw, bodyLocal, localLanguageName, authorId: actorId });
    res.status(201).json(statement);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/statements/:id", requireAuth, canViewComms, async (req: any, res: any) => {
  try {
    const [statement] = await db.select().from(statementsTable).where(eq(statementsTable.id, req.params.id)).limit(1);
    if (!statement) return res.status(404).json({ error: "Not found" });
    const versions = await db.select().from(statementVersionsTable).where(eq(statementVersionsTable.statementId, req.params.id)).orderBy(desc(statementVersionsTable.version));
    res.json({ ...statement, versions });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Add new version
router.post("/statements/:id/versions", requireAuth, canManageComms, async (req: any, res: any) => {
  try {
    const actorId = await resolveActorUUID(req.clerkId);
    if (!actorId) return res.status(403).json({ error: "Actor not found" });
    const [latest] = await db.select({ version: statementVersionsTable.version }).from(statementVersionsTable)
      .where(eq(statementVersionsTable.statementId, req.params.id)).orderBy(desc(statementVersionsTable.version)).limit(1);
    const newVersion = (latest?.version ?? 0) + 1;
    const [row] = await db.insert(statementVersionsTable).values({ ...req.body, statementId: req.params.id, version: newVersion, authorId: actorId }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Approve & publish statement
router.post("/statements/:id/publish", requireAuth, canApproveComms, async (req: any, res: any) => {
  try {
    const actorId = await resolveActorUUID(req.clerkId);
    const [row] = await db.update(statementsTable)
      .set({ status: "published", approvedBy: actorId ?? undefined, publishedAt: new Date() })
      .where(eq(statementsTable.id, req.params.id)).returning();
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Retract statement
router.post("/statements/:id/retract", requireAuth, canApproveComms, async (req: any, res: any) => {
  try {
    const [row] = await db.update(statementsTable)
      .set({ status: "retracted", retractedAt: new Date(), retractionReason: req.body.reason })
      .where(eq(statementsTable.id, req.params.id)).returning();
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
