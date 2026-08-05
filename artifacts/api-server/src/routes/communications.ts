/**
 * Communications Command Centre API
 * Templates, Audience Segments, Scheduled Messages, Spokespeople, Statements
 */
import { logger } from "../lib/logger";
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
import { tenantFilter, assertTenant } from '../lib/withTenant';
import { z } from "zod";
import { validate } from "../lib/validate";

const router = Router();

const templatesQuerySchema = z.object({
  channel: z.string().trim().max(100).optional(),
  category: z.string().trim().max(100).optional(),
  status: z.string().trim().max(100).optional(),
  search: z.string().trim().max(200).optional(),
});
const messagesQuerySchema = z.object({
  status: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const deliveriesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
const statementsQuerySchema = z.object({
  status: z.string().trim().max(100).optional(),
  category: z.string().trim().max(100).optional(),
});

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
    const t = assertTenant(req);
    const q = validate(templatesQuerySchema, req.query, res);
    if (!q) return;
    const { channel, category, status, search } = q;
    const conds: any[] = [tenantFilter(messageTemplatesTable, t.id)];
    if (channel) conds.push(eq(messageTemplatesTable.channel, channel));
    if (category) conds.push(eq(messageTemplatesTable.category, category));
    if (status) conds.push(eq(messageTemplatesTable.status, status));
    if (search) conds.push(or(ilike(messageTemplatesTable.name, `%${search}%`), ilike(messageTemplatesTable.bodyEn, `%${search}%`)));
    const where = and(...conds);
    const rows = await db.select().from(messageTemplatesTable).where(where).orderBy(desc(messageTemplatesTable.createdAt));
    res.json(rows);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.post("/templates", requireAuth, canManageComms, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const actorId = await resolveActorUUID(req.clerkId);
    if (!actorId) return res.status(403).json({ error: "Actor not found" });
    const [row] = await db.insert(messageTemplatesTable).values({ ...req.body, tenantId: t.id, createdBy: actorId, status: "draft" }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.get("/templates/:id", requireAuth, canViewComms, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [row] = await db.select().from(messageTemplatesTable).where(and(eq(messageTemplatesTable.id, req.params.id), tenantFilter(messageTemplatesTable, t.id))).limit(1);
    if (!row) return res.status(404).json({ error: "Template not found" });
    res.json(row);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.patch("/templates/:id", requireAuth, canManageComms, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const { id } = req.params;
    const [row] = await db.select().from(messageTemplatesTable).where(and(eq(messageTemplatesTable.id, id), tenantFilter(messageTemplatesTable, t.id))).limit(1);
    if (!row) return res.status(404).json({ error: "Not found" });
    if (row.status === "approved") return res.status(400).json({ error: "Cannot edit an approved template — create a new version" });
    const [updated] = await db.update(messageTemplatesTable).set(req.body).where(and(eq(messageTemplatesTable.id, id), tenantFilter(messageTemplatesTable, t.id))).returning();
    res.json(updated);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// Submit for approval
router.post("/templates/:id/submit", requireAuth, canManageComms, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [updated] = await db.update(messageTemplatesTable)
      .set({ status: "pending_approval" })
      .where(and(tenantFilter(messageTemplatesTable, t.id), eq(messageTemplatesTable.id, req.params.id), eq(messageTemplatesTable.status, "draft")))
      .returning();
    if (!updated) return res.status(400).json({ error: "Only draft templates can be submitted" });
    res.json(updated);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// Approve template
router.post("/templates/:id/approve", requireAuth, canApproveComms, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const actorId = await resolveActorUUID(req.clerkId);
    const [updated] = await db.update(messageTemplatesTable)
      .set({ status: "approved", approvedBy: actorId ?? undefined, approvedAt: new Date() })
      .where(and(tenantFilter(messageTemplatesTable, t.id), eq(messageTemplatesTable.id, req.params.id), eq(messageTemplatesTable.status, "pending_approval")))
      .returning();
    if (!updated) return res.status(400).json({ error: "Template not in pending_approval status" });
    res.json(updated);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// Emergency suspend template
router.post("/templates/:id/suspend", requireAuth, canEmergencySuspend, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const actorId = await resolveActorUUID(req.clerkId);
    const [updated] = await db.update(messageTemplatesTable)
      .set({ status: "suspended", suspendedBy: actorId ?? undefined, suspendedAt: new Date(), suspensionReason: req.body.reason })
      .where(and(tenantFilter(messageTemplatesTable, t.id), eq(messageTemplatesTable.id, req.params.id)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Template not found" });
    res.json(updated);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ─── AUDIENCE SEGMENTS ────────────────────────────────────────────────────────

router.get("/segments", requireAuth, canViewComms, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const rows = await db.select().from(audienceSegmentsTable).where(tenantFilter(audienceSegmentsTable, t.id)).orderBy(desc(audienceSegmentsTable.createdAt));
    res.json(rows);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.post("/segments", requireAuth, canManageComms, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
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
      const [{ total }] = await db.select({ total: count() }).from(supportersTable).where(tenantFilter(supportersTable, t.id));
      estimatedReach = Number(total);
    } catch (_) {}

    const [row] = await db.insert(audienceSegmentsTable).values({
      tenantId: t.id, name, description, filters, estimatedReach, createdBy: actorId, lastBuiltAt: new Date(),
    }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.get("/segments/:id", requireAuth, canViewComms, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [row] = await db.select().from(audienceSegmentsTable).where(and(eq(audienceSegmentsTable.id, req.params.id), tenantFilter(audienceSegmentsTable, t.id))).limit(1);
    if (!row) return res.status(404).json({ error: "Segment not found" });
    res.json(row);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ─── SCHEDULED MESSAGES ───────────────────────────────────────────────────────

router.get("/messages", requireAuth, canViewComms, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const q = validate(messagesQuerySchema, req.query, res);
    if (!q) return;
    const { status } = q;
    const pageNum = q.page; const pageSize = q.limit;
    const msgConds: any[] = [tenantFilter(scheduledMessagesTable, t.id)];
    if (status) msgConds.push(eq(scheduledMessagesTable.status, status));
    const where = and(...msgConds);
    const [rows, [{ total }]] = await Promise.all([
      db.select().from(scheduledMessagesTable).where(where).orderBy(desc(scheduledMessagesTable.scheduledAt)).limit(pageSize).offset((pageNum - 1) * pageSize),
      db.select({ total: count() }).from(scheduledMessagesTable).where(where),
    ]);
    res.json({ data: rows, total: Number(total), page: pageNum, pageSize });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.post("/messages", requireAuth, canManageComms, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const actorId = await resolveActorUUID(req.clerkId);
    if (!actorId) return res.status(403).json({ error: "Actor not found" });
    // Validate template is approved
    const [tmpl] = await db.select({ status: messageTemplatesTable.status }).from(messageTemplatesTable)
      .where(and(eq(messageTemplatesTable.id, req.body.templateId), tenantFilter(messageTemplatesTable, t.id))).limit(1);
    if (!tmpl || tmpl.status !== "approved") return res.status(400).json({ error: "Template must be approved before scheduling" });
    const [row] = await db.insert(scheduledMessagesTable).values({ ...req.body, tenantId: t.id, createdBy: actorId, status: "pending" }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.post("/messages/:id/approve", requireAuth, canApproveComms, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const actorId = await resolveActorUUID(req.clerkId);
    const [updated] = await db.update(scheduledMessagesTable)
      .set({ status: "approved", approvedBy: actorId ?? undefined, approvedAt: new Date() })
      .where(and(tenantFilter(scheduledMessagesTable, t.id), eq(scheduledMessagesTable.id, req.params.id), eq(scheduledMessagesTable.status, "pending")))
      .returning();
    if (!updated) return res.status(400).json({ error: "Message not in pending status" });
    res.json(updated);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// Emergency suspend in-flight message
router.post("/messages/:id/emergency-suspend", requireAuth, canEmergencySuspend, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const actorId = await resolveActorUUID(req.clerkId);
    const [updated] = await db.update(scheduledMessagesTable)
      .set({ status: "cancelled", emergencySuspendedBy: actorId ?? undefined, emergencySuspendedAt: new Date(), cancelledAt: new Date() })
      .where(and(tenantFilter(scheduledMessagesTable, t.id), eq(scheduledMessagesTable.id, req.params.id)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Message not found" });
    res.json(updated);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET delivery status for a scheduled message
router.get("/messages/:id/deliveries", requireAuth, canViewComms, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    // Verify parent message belongs to this tenant
    const [parentMsg] = await db.select({ id: scheduledMessagesTable.id }).from(scheduledMessagesTable)
      .where(and(eq(scheduledMessagesTable.id, req.params.id), tenantFilter(scheduledMessagesTable, t.id))).limit(1);
    if (!parentMsg) return res.status(404).json({ error: "Message not found" });
    const q = validate(deliveriesQuerySchema, req.query, res);
    if (!q) return;
    const pageNum = q.page; const pageSize = q.limit;
    const [rows, [{ total }]] = await Promise.all([
      db.select().from(messageDeliveriesTable).where(eq(messageDeliveriesTable.scheduledMessageId, req.params.id))
        .orderBy(desc(messageDeliveriesTable.createdAt)).limit(pageSize).offset((pageNum - 1) * pageSize),
      db.select({ total: count() }).from(messageDeliveriesTable).where(eq(messageDeliveriesTable.scheduledMessageId, req.params.id)),
    ]);
    res.json({ data: rows, total: Number(total), page: pageNum, pageSize });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ─── SPOKESPERSON DIRECTORY ───────────────────────────────────────────────────

router.get("/spokespeople", requireAuth, canViewComms, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const rows = await db.select().from(spokespersonDirectoryTable).where(and(tenantFilter(spokespersonDirectoryTable, t.id), eq(spokespersonDirectoryTable.isActive, true))).orderBy(spokespersonDirectoryTable.priority);
    res.json(rows);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.post("/spokespeople", requireAuth, canManageComms, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [row] = await db.insert(spokespersonDirectoryTable).values({ ...req.body, tenantId: t.id }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.patch("/spokespeople/:id", requireAuth, canManageComms, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [row] = await db.update(spokespersonDirectoryTable).set(req.body).where(and(eq(spokespersonDirectoryTable.id, req.params.id), tenantFilter(spokespersonDirectoryTable, t.id))).returning();
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ─── STATEMENTS (version-controlled) ─────────────────────────────────────────

router.get("/statements", requireAuth, canViewComms, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const q = validate(statementsQuerySchema, req.query, res);
    if (!q) return;
    const { status, category } = q;
    const conds: any[] = [tenantFilter(statementsTable, t.id)];
    if (status) conds.push(eq(statementsTable.status, status));
    if (category) conds.push(eq(statementsTable.category, category));
    const where = and(...conds);
    const rows = await db.select().from(statementsTable).where(where).orderBy(desc(statementsTable.createdAt));
    res.json(rows);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.post("/statements", requireAuth, canManageComms, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const actorId = await resolveActorUUID(req.clerkId);
    if (!actorId) return res.status(403).json({ error: "Actor not found" });
    const { bodyEn, bodySw, bodyLocal, localLanguageName, ...statementData } = req.body;
    const [statement] = await db.insert(statementsTable).values({ ...statementData, tenantId: t.id, createdBy: actorId, status: "draft" }).returning();
    // Create first version
    await db.insert(statementVersionsTable).values({ statementId: statement.id, version: 1, bodyEn, bodySw, bodyLocal, localLanguageName, authorId: actorId });
    res.status(201).json(statement);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.get("/statements/:id", requireAuth, canViewComms, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [statement] = await db.select().from(statementsTable).where(and(eq(statementsTable.id, req.params.id), tenantFilter(statementsTable, t.id))).limit(1);
    if (!statement) return res.status(404).json({ error: "Not found" });
    const versions = await db.select().from(statementVersionsTable).where(eq(statementVersionsTable.statementId, req.params.id)).orderBy(desc(statementVersionsTable.version));
    res.json({ ...statement, versions });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// Add new version
router.post("/statements/:id/versions", requireAuth, canManageComms, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const actorId = await resolveActorUUID(req.clerkId);
    if (!actorId) return res.status(403).json({ error: "Actor not found" });
    // Verify parent statement belongs to this tenant
    const [parentStmt] = await db.select({ id: statementsTable.id }).from(statementsTable)
      .where(and(eq(statementsTable.id, req.params.id), tenantFilter(statementsTable, t.id))).limit(1);
    if (!parentStmt) return res.status(404).json({ error: "Statement not found" });
    const [latest] = await db.select({ version: statementVersionsTable.version }).from(statementVersionsTable)
      .where(eq(statementVersionsTable.statementId, req.params.id)).orderBy(desc(statementVersionsTable.version)).limit(1);
    const newVersion = (latest?.version ?? 0) + 1;
    const [row] = await db.insert(statementVersionsTable).values({ ...req.body, statementId: req.params.id, version: newVersion, authorId: actorId }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// Approve & publish statement
router.post("/statements/:id/publish", requireAuth, canApproveComms, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const actorId = await resolveActorUUID(req.clerkId);
    const [row] = await db.update(statementsTable)
      .set({ status: "published", approvedBy: actorId ?? undefined, publishedAt: new Date() })
      .where(and(tenantFilter(statementsTable, t.id), eq(statementsTable.id, req.params.id))).returning();
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// Retract statement
router.post("/statements/:id/retract", requireAuth, canApproveComms, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [row] = await db.update(statementsTable)
      .set({ status: "retracted", retractedAt: new Date(), retractionReason: req.body.reason })
      .where(and(tenantFilter(statementsTable, t.id), eq(statementsTable.id, req.params.id))).returning();
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

export default router;
