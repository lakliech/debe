/**
 * Data Protection & Compliance API
 * DPIA register, Vendor register, Breach register, Consent audit,
 * Retention policies, Data Subject Requests.
 */
import { logger } from "../lib/logger";
import { Router } from "express";
import { getAuth } from "@clerk/express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  dataSubjectRequestsTable,
  dataProcessingRecordsTable,
  dpiaRegisterTable,
  vendorRegisterTable,
  dataBreachRegisterTable,
  consentAuditTable,
  dataRetentionPoliciesTable,
  usersTable,
} from "@workspace/db";
import { eq, desc, and, count, gte, lte } from "drizzle-orm";
import { requireRoles, resolveActor } from "../middlewares/rbac";
import { validate } from "../lib/validate";
import { tenantFilter, assertTenant } from '../lib/withTenant';

// ─── VALIDATION SCHEMAS ───────────────────────────────────────────────────────

const uuidField = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD date");

const dataRequestsQuerySchema = z.object({
  status: z.string().trim().max(100).optional(),
  type: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const dpiaQuerySchema = z.object({
  status: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const vendorsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const breachesQuerySchema = z.object({
  status: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const consentAuditQuerySchema = z.object({
  email: z.string().trim().max(320).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const createDataRequestSchema = z.object({
  requestType: z.enum(["access", "erasure", "rectification", "restriction", "portability", "objection"]),
  subjectName: z.string().min(1).max(255),
  subjectEmail: z.string().email().optional(),
  subjectPhone: z.string().max(30).optional(),
  description: z.string().max(5000).optional(),
});

const patchDataRequestSchema = z.object({
  status: z.enum(["pending", "in_progress", "resolved", "completed", "rejected"]).optional(),
  completionNotes: z.string().max(5000).optional(),
  assignedTo: uuidField.optional(),
});

const createDpiaSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(10000).optional(),
  processingActivity: z.string().max(5000).optional(),
  dataController: z.string().max(255).optional(),
  riskLevel: z.enum(["low", "medium", "high", "critical"]).optional(),
  status: z.enum(["draft", "under_review", "approved", "rejected"]).optional(),
  reviewedAt: isoDate.optional(),
}).passthrough(); // allow extra DPIA fields

const patchDpiaSchema = createDpiaSchema.partial();

const createVendorSchema = z.object({
  vendorName: z.string().min(1).max(255),
  vendorType: z.string().max(100).optional(),
  servicesProvided: z.string().max(5000).optional(),
  dataShared: z.string().max(5000).optional(),
  contractUrl: z.string().url().optional(),
  dpaSignedAt: z.string().datetime({ offset: true }).optional(),
  dpaExpiresAt: z.string().datetime({ offset: true }).optional(),
  countryOfOperation: z.string().max(100).optional(),
  adequacyDecision: z.boolean().optional(),
  transferMechanism: z.string().max(255).optional(),
  riskRating: z.enum(["low", "medium", "high", "critical"]).optional(),
});

const patchVendorSchema = createVendorSchema.extend({ isActive: z.boolean().optional() }).partial();

const createBreachSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(10000).optional(),
  discoveredAt: z.string().datetime({ offset: true }).optional(),
  dataCategories: z.array(z.string()).optional(),
  estimatedRecordsAffected: z.number().int().min(0).optional(),
  severity: z.enum(["low", "medium", "high", "critical"]).optional(),
  rootCause: z.string().max(5000).optional(),
});

const patchBreachSchema = z.object({
  status: z.enum(["open", "contained", "resolved", "closed"]).optional(),
  remedialActions: z.string().max(5000).optional(),
  notifiedDpa: z.boolean().optional(),
  notifiedSubjects: z.boolean().optional(),
  containedAt: z.string().datetime({ offset: true }).optional(),
  assignedTo: uuidField.optional(),
});

const createProcessingRecordSchema = z.object({
  processName: z.string().min(1).max(255),
  legalBasis: z.string().max(255).optional(),
  dataCategories: z.array(z.string()).optional(),
  purposes: z.string().max(5000).optional(),
  retentionPeriod: z.string().max(255).optional(),
}).passthrough();

const createRetentionPolicySchema = z.object({
  dataCategory: z.string().min(1).max(255),
  retentionDays: z.number().int().positive(),
  legalBasis: z.string().max(255).optional(),
  description: z.string().max(5000).optional(),
  autoDelete: z.boolean().optional(),
});

const patchRetentionPolicySchema = z.object({
  retentionDays: z.number().int().positive().optional(),
  legalBasis: z.string().max(255).optional(),
  description: z.string().max(5000).optional(),
  autoDelete: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

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

const canViewCompliance = requireRoles([
  "campaign-exec-director", "national-campaign-manager", "data-officer", "legal-officer",
]);
const canManageCompliance = requireRoles([
  "campaign-exec-director", "data-officer", "legal-officer",
]);

// ── Data Subject Requests ──────────────────────────────────────────────────

// GET /api/compliance/data-requests
router.get("/data-requests", requireAuth, canViewCompliance, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const q = validate(dataRequestsQuerySchema, req.query, res);
    if (!q) return;
    const { status, type } = q;
    const pageNum = q.page;
    const pageSize = q.limit;
    const conditions: any[] = [tenantFilter(dataSubjectRequestsTable, t.id)];
    if (status) conditions.push(eq(dataSubjectRequestsTable.status, status));
    if (type) conditions.push(eq(dataSubjectRequestsTable.requestType, type));
    const where = and(...conditions);
    const [rows, [{ total }]] = await Promise.all([
      db.select().from(dataSubjectRequestsTable).where(where)
        .orderBy(desc(dataSubjectRequestsTable.createdAt))
        .limit(pageSize).offset((pageNum - 1) * pageSize),
      db.select({ total: count() }).from(dataSubjectRequestsTable).where(where),
    ]);
    res.json({ data: rows, total: Number(total), page: pageNum, pageSize });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST /api/compliance/data-requests
router.post("/data-requests", requireAuth, canManageCompliance, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const actorId = await resolveActorUUID(req.clerkId);
    const parsed = validate(createDataRequestSchema, req.body, res);
    if (!parsed) return;
    const { requestType, subjectName, subjectEmail, subjectPhone, description } = parsed;
    // 30-day deadline per GDPR Article 12
    const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const [row] = await db.insert(dataSubjectRequestsTable).values({
      tenantId: t.id,
      requestType,
      subjectName,
      subjectEmail,
      phoneNumber: subjectPhone,
      description,
      dueDate,
      assignedTo: actorId ?? undefined,
    }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// PATCH /api/compliance/data-requests/:id
router.patch("/data-requests/:id", requireAuth, canManageCompliance, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const parsed = validate(patchDataRequestSchema, req.body, res);
    if (!parsed) return;
    const { status, completionNotes, assignedTo } = parsed;
    const update: Record<string, any> = {};
    if (status !== undefined) {
      update.status = status;
      if (status === "resolved" || status === "completed") update.completedAt = new Date();
    }
    if (completionNotes !== undefined) update.resolutionNotes = completionNotes;
    if (assignedTo !== undefined) update.assignedTo = assignedTo;
    const [row] = await db.update(dataSubjectRequestsTable).set(update)
      .where(and(eq(dataSubjectRequestsTable.id, req.params.id), tenantFilter(dataSubjectRequestsTable, t.id))).returning();
    if (!row) return res.status(404).json({ error: "Request not found" });
    res.json(row);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ── DPIA Register ──────────────────────────────────────────────────────────

router.get("/dpia", requireAuth, canViewCompliance, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const q = validate(dpiaQuerySchema, req.query, res);
    if (!q) return;
    const { status } = q;
    const pageNum = q.page;
    const pageSize = q.limit;
    const conditions: any[] = [tenantFilter(dpiaRegisterTable, t.id)];
    if (status) conditions.push(eq(dpiaRegisterTable.status, status));
    const where = and(...conditions);
    const [rows, [{ total }]] = await Promise.all([
      db.select().from(dpiaRegisterTable).where(where)
        .orderBy(desc(dpiaRegisterTable.createdAt))
        .limit(pageSize).offset((pageNum - 1) * pageSize),
      db.select({ total: count() }).from(dpiaRegisterTable).where(where),
    ]);
    res.json({ data: rows, total: Number(total), page: pageNum, pageSize });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.post("/dpia", requireAuth, canManageCompliance, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const actorId = await resolveActorUUID(req.clerkId);
    const parsed = validate(createDpiaSchema, req.body, res);
    if (!parsed) return;
    const [row] = await db.insert(dpiaRegisterTable).values({
      ...parsed, tenantId: t.id, createdBy: actorId ?? undefined,
    } as any).returning();
    res.status(201).json(row);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.patch("/dpia/:id", requireAuth, canManageCompliance, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const actorId = await resolveActorUUID(req.clerkId);
    const parsed = validate(patchDpiaSchema, req.body, res);
    if (!parsed) return;
    const update: Record<string, any> = { ...parsed };
    if (update.status === "approved") { update.approvedAt = new Date(); update.reviewedBy = actorId; update.reviewedAt = new Date(); }
    if (update.status === "under_review") { update.reviewedBy = actorId; update.reviewedAt = new Date(); }
    const [row] = await db.update(dpiaRegisterTable).set(update)
      .where(and(eq(dpiaRegisterTable.id, req.params.id), tenantFilter(dpiaRegisterTable, t.id))).returning();
    if (!row) return res.status(404).json({ error: "DPIA not found" });
    res.json(row);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ── Vendor Register ────────────────────────────────────────────────────────

router.get("/vendors", requireAuth, canViewCompliance, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const q = validate(vendorsQuerySchema, req.query, res);
    if (!q) return;
    const pageNum = q.page;
    const pageSize = q.limit;
    const [rows, [{ total }]] = await Promise.all([
      db.select().from(vendorRegisterTable)
        .where(and(tenantFilter(vendorRegisterTable, t.id), eq(vendorRegisterTable.isActive, true)))
        .orderBy(vendorRegisterTable.vendorName)
        .limit(pageSize).offset((pageNum - 1) * pageSize),
      db.select({ total: count() }).from(vendorRegisterTable)
        .where(and(tenantFilter(vendorRegisterTable, t.id), eq(vendorRegisterTable.isActive, true))),
    ]);
    res.json({ data: rows, total: Number(total), page: pageNum, pageSize });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.post("/vendors", requireAuth, canManageCompliance, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const actorId = await resolveActorUUID(req.clerkId);
    const parsed = validate(createVendorSchema, req.body, res);
    if (!parsed) return;
    const { vendorName, vendorType, servicesProvided, dataShared, contractUrl,
      dpaSignedAt, dpaExpiresAt, countryOfOperation, adequacyDecision, transferMechanism, riskRating } = parsed;
    const [row] = await db.insert(vendorRegisterTable).values({
      tenantId: t.id,
      vendorName, vendorType, servicesProvided, dataShared,
      contractUrl, dpaSignedAt: dpaSignedAt ? new Date(dpaSignedAt) : undefined,
      dpaExpiresAt: dpaExpiresAt ? new Date(dpaExpiresAt) : undefined,
      countryOfOperation, adequacyDecision, transferMechanism, riskRating,
      reviewedBy: actorId ?? undefined, reviewedAt: new Date(),
    } as any).returning();
    res.status(201).json(row);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.patch("/vendors/:id", requireAuth, canManageCompliance, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const parsed = validate(patchVendorSchema, req.body, res);
    if (!parsed) return;
    const { vendorName, vendorType, servicesProvided, dataShared, contractUrl,
      dpaSignedAt, dpaExpiresAt, countryOfOperation, adequacyDecision, transferMechanism, riskRating, isActive } = parsed;
    const update: Record<string, any> = {};
    if (vendorName !== undefined) update.vendorName = vendorName;
    if (vendorType !== undefined) update.vendorType = vendorType;
    if (servicesProvided !== undefined) update.servicesProvided = servicesProvided;
    if (dataShared !== undefined) update.dataShared = dataShared;
    if (contractUrl !== undefined) update.contractUrl = contractUrl;
    if (dpaSignedAt !== undefined) update.dpaSignedAt = new Date(dpaSignedAt);
    if (dpaExpiresAt !== undefined) update.dpaExpiresAt = new Date(dpaExpiresAt);
    if (countryOfOperation !== undefined) update.countryOfOperation = countryOfOperation;
    if (adequacyDecision !== undefined) update.adequacyDecision = adequacyDecision;
    if (transferMechanism !== undefined) update.transferMechanism = transferMechanism;
    if (riskRating !== undefined) update.riskRating = riskRating;
    if (isActive !== undefined) update.isActive = isActive;
    const [row] = await db.update(vendorRegisterTable).set(update)
      .where(and(eq(vendorRegisterTable.id, req.params.id), tenantFilter(vendorRegisterTable, t.id))).returning();
    if (!row) return res.status(404).json({ error: "Vendor not found" });
    res.json(row);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ── Data Breach Register ───────────────────────────────────────────────────

router.get("/breaches", requireAuth, canViewCompliance, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const q = validate(breachesQuerySchema, req.query, res);
    if (!q) return;
    const { status } = q;
    const pageNum = q.page;
    const pageSize = q.limit;
    const conditions: any[] = [tenantFilter(dataBreachRegisterTable, t.id)];
    if (status) conditions.push(eq(dataBreachRegisterTable.status, status));
    const where = and(...conditions);
    const [rows, [{ total }]] = await Promise.all([
      db.select().from(dataBreachRegisterTable).where(where)
        .orderBy(desc(dataBreachRegisterTable.createdAt))
        .limit(pageSize).offset((pageNum - 1) * pageSize),
      db.select({ total: count() }).from(dataBreachRegisterTable).where(where),
    ]);
    res.json({ data: rows, total: Number(total), page: pageNum, pageSize });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.post("/breaches", requireAuth, canManageCompliance, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const actorId = await resolveActorUUID(req.clerkId);
    const parsed = validate(createBreachSchema, req.body, res);
    if (!parsed) return;
    const { title, description, discoveredAt, dataCategories, estimatedRecordsAffected,
      severity, rootCause } = parsed;
    const [row] = await db.insert(dataBreachRegisterTable).values({
      tenantId: t.id,
      title, description,
      discoveredAt: discoveredAt ? new Date(discoveredAt) : new Date(),
      dataCategories, estimatedRecordsAffected, severity, rootCause,
      reportedBy: actorId ?? undefined,
    } as any).returning();
    res.status(201).json(row);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.patch("/breaches/:id", requireAuth, canManageCompliance, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const parsed = validate(patchBreachSchema, req.body, res);
    if (!parsed) return;
    const { status, remedialActions, notifiedDpa, notifiedSubjects, containedAt, assignedTo } = parsed;
    const update: Record<string, any> = {};
    if (status !== undefined) update.status = status;
    if (remedialActions !== undefined) update.remedialActions = remedialActions;
    if (notifiedDpa !== undefined) { update.notifiedDpa = notifiedDpa; if (notifiedDpa) update.reportedAt = new Date(); }
    if (notifiedSubjects !== undefined) update.notifiedSubjects = notifiedSubjects;
    if (containedAt !== undefined) update.containedAt = new Date(containedAt);
    if (assignedTo !== undefined) update.assignedTo = assignedTo;
    const [row] = await db.update(dataBreachRegisterTable).set(update)
      .where(and(eq(dataBreachRegisterTable.id, req.params.id), tenantFilter(dataBreachRegisterTable, t.id))).returning();
    if (!row) return res.status(404).json({ error: "Breach record not found" });
    res.json(row);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ── Data Processing Records ────────────────────────────────────────────────

router.get("/processing-records", requireAuth, canViewCompliance, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const rows = await db.select().from(dataProcessingRecordsTable)
      .where(and(tenantFilter(dataProcessingRecordsTable, t.id), eq(dataProcessingRecordsTable.isActive, true)))
      .orderBy(dataProcessingRecordsTable.processName);
    res.json(rows);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.post("/processing-records", requireAuth, canManageCompliance, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const actorId = await resolveActorUUID(req.clerkId);
    const parsed = validate(createProcessingRecordSchema, req.body, res);
    if (!parsed) return;
    const [row] = await db.insert(dataProcessingRecordsTable).values({
      ...parsed, tenantId: t.id, createdBy: actorId ?? undefined,
    } as any).returning();
    res.status(201).json(row);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ── Consent Audit ──────────────────────────────────────────────────────────

router.get("/consent-audit", requireAuth, canViewCompliance, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const q = validate(consentAuditQuerySchema, req.query, res);
    if (!q) return;
    const { email } = q;
    const pageNum = q.page;
    const pageSize = q.limit;
    const conditions: any[] = [tenantFilter(consentAuditTable, t.id)];
    if (email) conditions.push(eq(consentAuditTable.subjectEmail, email));
    const where = and(...conditions);
    const rows = await db.select().from(consentAuditTable).where(where)
      .orderBy(desc(consentAuditTable.createdAt))
      .limit(pageSize).offset((pageNum - 1) * pageSize);
    res.json(rows);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ── Retention Policies ─────────────────────────────────────────────────────

router.get("/retention-policies", requireAuth, canViewCompliance, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const rows = await db.select().from(dataRetentionPoliciesTable)
      .where(and(tenantFilter(dataRetentionPoliciesTable, t.id), eq(dataRetentionPoliciesTable.isActive, true)))
      .orderBy(dataRetentionPoliciesTable.dataCategory);
    res.json(rows);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.post("/retention-policies", requireAuth, canManageCompliance, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const actorId = await resolveActorUUID(req.clerkId);
    const parsed = validate(createRetentionPolicySchema, req.body, res);
    if (!parsed) return;
    const { dataCategory, retentionDays, legalBasis, description, autoDelete } = parsed;
    const [row] = await db.insert(dataRetentionPoliciesTable).values({
      tenantId: t.id,
      dataCategory, retentionDays, legalBasis, description, autoDelete,
      lastReviewedAt: new Date(), reviewedBy: actorId ?? undefined,
    } as any).returning();
    res.status(201).json(row);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.patch("/retention-policies/:id", requireAuth, canManageCompliance, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const actorId = await resolveActorUUID(req.clerkId);
    const parsed = validate(patchRetentionPolicySchema, req.body, res);
    if (!parsed) return;
    const { retentionDays, legalBasis, description, autoDelete, isActive } = parsed;
    const update: Record<string, any> = { lastReviewedAt: new Date(), reviewedBy: actorId };
    if (retentionDays !== undefined) update.retentionDays = retentionDays;
    if (legalBasis !== undefined) update.legalBasis = legalBasis;
    if (description !== undefined) update.description = description;
    if (autoDelete !== undefined) update.autoDelete = autoDelete;
    if (isActive !== undefined) update.isActive = isActive;
    const [row] = await db.update(dataRetentionPoliciesTable).set(update)
      .where(and(eq(dataRetentionPoliciesTable.id, req.params.id), tenantFilter(dataRetentionPoliciesTable, t.id))).returning();
    if (!row) return res.status(404).json({ error: "Policy not found" });
    res.json(row);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ── Dashboard summary ──────────────────────────────────────────────────────
router.get("/dashboard", requireAuth, canViewCompliance, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [dsrTotal, dsrPending, dpiaTotal, dpiaOpen, vendorCount, breachOpen, retentionCount] = await Promise.all([
      db.select({ total: count() }).from(dataSubjectRequestsTable).where(tenantFilter(dataSubjectRequestsTable, t.id)),
      db.select({ total: count() }).from(dataSubjectRequestsTable).where(and(tenantFilter(dataSubjectRequestsTable, t.id), eq(dataSubjectRequestsTable.status, "pending"))),
      db.select({ total: count() }).from(dpiaRegisterTable).where(tenantFilter(dpiaRegisterTable, t.id)),
      db.select({ total: count() }).from(dpiaRegisterTable).where(and(tenantFilter(dpiaRegisterTable, t.id), eq(dpiaRegisterTable.status, "draft"))),
      db.select({ total: count() }).from(vendorRegisterTable).where(and(tenantFilter(vendorRegisterTable, t.id), eq(vendorRegisterTable.isActive, true))),
      db.select({ total: count() }).from(dataBreachRegisterTable).where(and(tenantFilter(dataBreachRegisterTable, t.id), eq(dataBreachRegisterTable.status, "open"))),
      db.select({ total: count() }).from(dataRetentionPoliciesTable).where(and(tenantFilter(dataRetentionPoliciesTable, t.id), eq(dataRetentionPoliciesTable.isActive, true))),
    ]);
    res.json({
      dataSubjectRequests: { total: Number(dsrTotal[0].total), pending: Number(dsrPending[0].total) },
      dpias: { total: Number(dpiaTotal[0].total), open: Number(dpiaOpen[0].total) },
      vendors: { active: Number(vendorCount[0].total) },
      breaches: { open: Number(breachOpen[0].total) },
      retentionPolicies: { active: Number(retentionCount[0].total) },
    });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

export default router;
