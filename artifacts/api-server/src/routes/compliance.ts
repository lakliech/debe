/**
 * Data Protection & Compliance API
 * DPIA register, Vendor register, Breach register, Consent audit,
 * Retention policies, Data Subject Requests.
 */
import { Router } from "express";
import { getAuth } from "@clerk/express";
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
    const { status, type, page = "1", limit = "20" } = req.query;
    const pageNum = parseInt(page) || 1;
    const pageSize = Math.min(parseInt(limit) || 20, 100);
    const conditions = [];
    if (status) conditions.push(eq(dataSubjectRequestsTable.status, status));
    if (type) conditions.push(eq(dataSubjectRequestsTable.requestType, type));
    const where = conditions.length ? and(...conditions) : undefined;
    const [rows, [{ total }]] = await Promise.all([
      db.select().from(dataSubjectRequestsTable).where(where)
        .orderBy(desc(dataSubjectRequestsTable.createdAt))
        .limit(pageSize).offset((pageNum - 1) * pageSize),
      db.select({ total: count() }).from(dataSubjectRequestsTable).where(where),
    ]);
    res.json({ data: rows, total: Number(total), page: pageNum, pageSize });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/compliance/data-requests
router.post("/data-requests", requireAuth, canManageCompliance, async (req: any, res: any) => {
  try {
    const actorId = await resolveActorUUID(req.clerkId);
    const { requestType, subjectName, subjectEmail, subjectPhone, description } = req.body;
    // 30-day deadline per GDPR Article 12
    const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const [row] = await db.insert(dataSubjectRequestsTable).values({
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
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/compliance/data-requests/:id
router.patch("/data-requests/:id", requireAuth, canManageCompliance, async (req: any, res: any) => {
  try {
    const { status, completionNotes, assignedTo } = req.body;
    const update: Record<string, any> = {};
    if (status !== undefined) {
      update.status = status;
      if (status === "resolved" || status === "completed") update.completedAt = new Date();
    }
    if (completionNotes !== undefined) update.resolutionNotes = completionNotes;
    if (assignedTo !== undefined) update.assignedTo = assignedTo;
    const [row] = await db.update(dataSubjectRequestsTable).set(update)
      .where(eq(dataSubjectRequestsTable.id, req.params.id)).returning();
    if (!row) return res.status(404).json({ error: "Request not found" });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── DPIA Register ──────────────────────────────────────────────────────────

router.get("/dpia", requireAuth, canViewCompliance, async (req: any, res: any) => {
  try {
    const { page = "1", limit = "20", status } = req.query;
    const pageNum = parseInt(page) || 1;
    const pageSize = Math.min(parseInt(limit) || 20, 100);
    const conditions = status ? [eq(dpiaRegisterTable.status, status)] : [];
    const where = conditions.length ? and(...conditions) : undefined;
    const [rows, [{ total }]] = await Promise.all([
      db.select().from(dpiaRegisterTable).where(where)
        .orderBy(desc(dpiaRegisterTable.createdAt))
        .limit(pageSize).offset((pageNum - 1) * pageSize),
      db.select({ total: count() }).from(dpiaRegisterTable).where(where),
    ]);
    res.json({ data: rows, total: Number(total), page: pageNum, pageSize });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/dpia", requireAuth, canManageCompliance, async (req: any, res: any) => {
  try {
    const actorId = await resolveActorUUID(req.clerkId);
    const [row] = await db.insert(dpiaRegisterTable).values({
      ...req.body, createdBy: actorId ?? undefined,
    }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/dpia/:id", requireAuth, canManageCompliance, async (req: any, res: any) => {
  try {
    const actorId = await resolveActorUUID(req.clerkId);
    const update: Record<string, any> = { ...req.body };
    if (update.status === "approved") { update.approvedAt = new Date(); update.reviewedBy = actorId; update.reviewedAt = new Date(); }
    if (update.status === "under_review") { update.reviewedBy = actorId; update.reviewedAt = new Date(); }
    const [row] = await db.update(dpiaRegisterTable).set(update)
      .where(eq(dpiaRegisterTable.id, req.params.id)).returning();
    if (!row) return res.status(404).json({ error: "DPIA not found" });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Vendor Register ────────────────────────────────────────────────────────

router.get("/vendors", requireAuth, canViewCompliance, async (req: any, res: any) => {
  try {
    const { page = "1", limit = "20" } = req.query;
    const pageNum = parseInt(page) || 1;
    const pageSize = Math.min(parseInt(limit) || 20, 100);
    const [rows, [{ total }]] = await Promise.all([
      db.select().from(vendorRegisterTable)
        .where(eq(vendorRegisterTable.isActive, true))
        .orderBy(vendorRegisterTable.vendorName)
        .limit(pageSize).offset((pageNum - 1) * pageSize),
      db.select({ total: count() }).from(vendorRegisterTable)
        .where(eq(vendorRegisterTable.isActive, true)),
    ]);
    res.json({ data: rows, total: Number(total), page: pageNum, pageSize });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/vendors", requireAuth, canManageCompliance, async (req: any, res: any) => {
  try {
    const actorId = await resolveActorUUID(req.clerkId);
    const { vendorName, vendorType, servicesProvided, dataShared, contractUrl,
      dpaSignedAt, dpaExpiresAt, countryOfOperation, adequacyDecision, transferMechanism, riskRating } = req.body;
    const [row] = await db.insert(vendorRegisterTable).values({
      vendorName, vendorType, servicesProvided, dataShared,
      contractUrl, dpaSignedAt: dpaSignedAt ? new Date(dpaSignedAt) : undefined,
      dpaExpiresAt: dpaExpiresAt ? new Date(dpaExpiresAt) : undefined,
      countryOfOperation, adequacyDecision, transferMechanism, riskRating,
      reviewedBy: actorId ?? undefined, reviewedAt: new Date(),
    }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/vendors/:id", requireAuth, canManageCompliance, async (req: any, res: any) => {
  try {
    const { vendorName, vendorType, servicesProvided, dataShared, contractUrl,
      dpaSignedAt, dpaExpiresAt, countryOfOperation, adequacyDecision, transferMechanism, riskRating, isActive } = req.body;
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
      .where(eq(vendorRegisterTable.id, req.params.id)).returning();
    if (!row) return res.status(404).json({ error: "Vendor not found" });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Data Breach Register ───────────────────────────────────────────────────

router.get("/breaches", requireAuth, canViewCompliance, async (req: any, res: any) => {
  try {
    const { page = "1", limit = "20", status } = req.query;
    const pageNum = parseInt(page) || 1;
    const pageSize = Math.min(parseInt(limit) || 20, 100);
    const conditions = status ? [eq(dataBreachRegisterTable.status, status)] : [];
    const where = conditions.length ? and(...conditions) : undefined;
    const [rows, [{ total }]] = await Promise.all([
      db.select().from(dataBreachRegisterTable).where(where)
        .orderBy(desc(dataBreachRegisterTable.createdAt))
        .limit(pageSize).offset((pageNum - 1) * pageSize),
      db.select({ total: count() }).from(dataBreachRegisterTable).where(where),
    ]);
    res.json({ data: rows, total: Number(total), page: pageNum, pageSize });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/breaches", requireAuth, canManageCompliance, async (req: any, res: any) => {
  try {
    const actorId = await resolveActorUUID(req.clerkId);
    const { title, description, discoveredAt, dataCategories, estimatedRecordsAffected,
      severity, rootCause } = req.body;
    const [row] = await db.insert(dataBreachRegisterTable).values({
      title, description,
      discoveredAt: discoveredAt ? new Date(discoveredAt) : new Date(),
      dataCategories, estimatedRecordsAffected, severity, rootCause,
      reportedBy: actorId ?? undefined,
    }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/breaches/:id", requireAuth, canManageCompliance, async (req: any, res: any) => {
  try {
    const { status, remedialActions, notifiedDpa, notifiedSubjects, containedAt, assignedTo } = req.body;
    const update: Record<string, any> = {};
    if (status !== undefined) update.status = status;
    if (remedialActions !== undefined) update.remedialActions = remedialActions;
    if (notifiedDpa !== undefined) { update.notifiedDpa = notifiedDpa; if (notifiedDpa) update.reportedAt = new Date(); }
    if (notifiedSubjects !== undefined) update.notifiedSubjects = notifiedSubjects;
    if (containedAt !== undefined) update.containedAt = new Date(containedAt);
    if (assignedTo !== undefined) update.assignedTo = assignedTo;
    const [row] = await db.update(dataBreachRegisterTable).set(update)
      .where(eq(dataBreachRegisterTable.id, req.params.id)).returning();
    if (!row) return res.status(404).json({ error: "Breach record not found" });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Data Processing Records ────────────────────────────────────────────────

router.get("/processing-records", requireAuth, canViewCompliance, async (req: any, res: any) => {
  try {
    const rows = await db.select().from(dataProcessingRecordsTable)
      .where(eq(dataProcessingRecordsTable.isActive, true))
      .orderBy(dataProcessingRecordsTable.processName);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/processing-records", requireAuth, canManageCompliance, async (req: any, res: any) => {
  try {
    const actorId = await resolveActorUUID(req.clerkId);
    const [row] = await db.insert(dataProcessingRecordsTable).values({
      ...req.body, createdBy: actorId ?? undefined,
    }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Consent Audit ──────────────────────────────────────────────────────────

router.get("/consent-audit", requireAuth, canViewCompliance, async (req: any, res: any) => {
  try {
    const { email, page = "1", limit = "20" } = req.query;
    const pageNum = parseInt(page) || 1;
    const pageSize = Math.min(parseInt(limit) || 20, 100);
    const conditions = email ? [eq(consentAuditTable.subjectEmail, email)] : [];
    const where = conditions.length ? and(...conditions) : undefined;
    const rows = await db.select().from(consentAuditTable).where(where)
      .orderBy(desc(consentAuditTable.createdAt))
      .limit(pageSize).offset((pageNum - 1) * pageSize);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Retention Policies ─────────────────────────────────────────────────────

router.get("/retention-policies", requireAuth, canViewCompliance, async (req: any, res: any) => {
  try {
    const rows = await db.select().from(dataRetentionPoliciesTable)
      .where(eq(dataRetentionPoliciesTable.isActive, true))
      .orderBy(dataRetentionPoliciesTable.dataCategory);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/retention-policies", requireAuth, canManageCompliance, async (req: any, res: any) => {
  try {
    const actorId = await resolveActorUUID(req.clerkId);
    const { dataCategory, retentionDays, legalBasis, description, autoDelete } = req.body;
    const [row] = await db.insert(dataRetentionPoliciesTable).values({
      dataCategory, retentionDays, legalBasis, description, autoDelete,
      lastReviewedAt: new Date(), reviewedBy: actorId ?? undefined,
    }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/retention-policies/:id", requireAuth, canManageCompliance, async (req: any, res: any) => {
  try {
    const actorId = await resolveActorUUID(req.clerkId);
    const { retentionDays, legalBasis, description, autoDelete, isActive } = req.body;
    const update: Record<string, any> = { lastReviewedAt: new Date(), reviewedBy: actorId };
    if (retentionDays !== undefined) update.retentionDays = retentionDays;
    if (legalBasis !== undefined) update.legalBasis = legalBasis;
    if (description !== undefined) update.description = description;
    if (autoDelete !== undefined) update.autoDelete = autoDelete;
    if (isActive !== undefined) update.isActive = isActive;
    const [row] = await db.update(dataRetentionPoliciesTable).set(update)
      .where(eq(dataRetentionPoliciesTable.id, req.params.id)).returning();
    if (!row) return res.status(404).json({ error: "Policy not found" });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Dashboard summary ──────────────────────────────────────────────────────
router.get("/dashboard", requireAuth, canViewCompliance, async (req: any, res: any) => {
  try {
    const [dsrTotal, dsrPending, dpiaTotal, dpiaOpen, vendorCount, breachOpen, retentionCount] = await Promise.all([
      db.select({ total: count() }).from(dataSubjectRequestsTable),
      db.select({ total: count() }).from(dataSubjectRequestsTable).where(eq(dataSubjectRequestsTable.status, "pending")),
      db.select({ total: count() }).from(dpiaRegisterTable),
      db.select({ total: count() }).from(dpiaRegisterTable).where(eq(dpiaRegisterTable.status, "draft")),
      db.select({ total: count() }).from(vendorRegisterTable).where(eq(vendorRegisterTable.isActive, true)),
      db.select({ total: count() }).from(dataBreachRegisterTable).where(eq(dataBreachRegisterTable.status, "open")),
      db.select({ total: count() }).from(dataRetentionPoliciesTable).where(eq(dataRetentionPoliciesTable.isActive, true)),
    ]);
    res.json({
      dataSubjectRequests: { total: Number(dsrTotal[0].total), pending: Number(dsrPending[0].total) },
      dpias: { total: Number(dpiaTotal[0].total), open: Number(dpiaOpen[0].total) },
      vendors: { active: Number(vendorCount[0].total) },
      breaches: { open: Number(breachOpen[0].total) },
      retentionPolicies: { active: Number(retentionCount[0].total) },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
