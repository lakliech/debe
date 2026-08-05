/**
 * Rapid Response / Misinformation Tracking API
 * Claim intake, fact-checker assignment, legal review, correction publishing
 */
import { logger } from "../lib/logger";
import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  misinformationClaimsTable, claimFactChecksTable, claimCorrectionsTable, usersTable,
} from "@workspace/db";
import { eq, desc, and, count, ilike, or } from "drizzle-orm";
import { requireRoles } from "../middlewares/rbac";
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

const canViewRR = requireRoles(["campaign-exec-director","national-campaign-manager","communications-officer","legal-officer","media-officer","fact-checker"]);
const canManageRR = requireRoles(["campaign-exec-director","communications-officer","media-officer"]);
const canFactCheck = requireRoles(["campaign-exec-director","communications-officer","fact-checker"]);
const canLegalReview = requireRoles(["campaign-exec-director","legal-officer"]);
const canPublish = requireRoles(["campaign-exec-director","national-campaign-manager","communications-officer"]);

// ─── CLAIMS ──────────────────────────────────────────────────────────────────

// GET /api/rapid-response/claims
router.get("/claims", requireAuth, canViewRR, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const { status, urgency, search, page = "1", limit = "20" } = req.query;
    const pageNum = parseInt(page) || 1; const pageSize = Math.min(parseInt(limit) || 20, 100);
    const conds: any[] = [tenantFilter(misinformationClaimsTable, t.id)];
    if (status) conds.push(eq(misinformationClaimsTable.status, status));
    if (urgency) conds.push(eq(misinformationClaimsTable.urgency, urgency));
    if (search) conds.push(or(ilike(misinformationClaimsTable.claimText, `%${search}%`), ilike(misinformationClaimsTable.platform, `%${search}%`)));
    const where = and(...conds);
    const [rows, [{ total }]] = await Promise.all([
      db.select().from(misinformationClaimsTable).where(where).orderBy(desc(misinformationClaimsTable.createdAt)).limit(pageSize).offset((pageNum - 1) * pageSize),
      db.select({ total: count() }).from(misinformationClaimsTable).where(where),
    ]);
    res.json({ data: rows, total: Number(total), page: pageNum, pageSize });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST /api/rapid-response/claims — intake (any logged-in user can report)
router.post("/claims", requireAuth, canManageRR, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const actorId = await resolveActorUUID(req.clerkId);
    if (!actorId) return res.status(403).json({ error: "Actor not found" });
    const [claim] = await db.insert(misinformationClaimsTable).values({ ...req.body, tenantId: t.id, intakeBy: actorId, status: "intake" }).returning();
    res.status(201).json(claim);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/rapid-response/claims/:id
router.get("/claims/:id", requireAuth, canViewRR, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [claim] = await db.select().from(misinformationClaimsTable).where(and(eq(misinformationClaimsTable.id, req.params.id), tenantFilter(misinformationClaimsTable, t.id))).limit(1);
    if (!claim) return res.status(404).json({ error: "Claim not found" });
    const [factChecks, corrections] = await Promise.all([
      db.select().from(claimFactChecksTable).where(eq(claimFactChecksTable.claimId, req.params.id)).orderBy(desc(claimFactChecksTable.createdAt)),
      db.select().from(claimCorrectionsTable).where(eq(claimCorrectionsTable.claimId, req.params.id)).orderBy(desc(claimCorrectionsTable.createdAt)),
    ]);
    res.json({ ...claim, factChecks, corrections });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// PATCH /api/rapid-response/claims/:id — update urgency, platform, screenshot
router.patch("/claims/:id", requireAuth, canManageRR, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [updated] = await db.update(misinformationClaimsTable).set(req.body).where(and(eq(misinformationClaimsTable.id, req.params.id), tenantFilter(misinformationClaimsTable, t.id))).returning();
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST /api/rapid-response/claims/:id/assign — assign to fact-checker
router.post("/claims/:id/assign", requireAuth, canManageRR, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const { assignedTo } = req.body;
    const [updated] = await db.update(misinformationClaimsTable)
      .set({ assignedTo, assignedAt: new Date(), status: "assigned" })
      .where(and(eq(misinformationClaimsTable.id, req.params.id), tenantFilter(misinformationClaimsTable, t.id))).returning();
    if (!updated) return res.status(404).json({ error: "Claim not found" });
    res.json(updated);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ─── FACT CHECKS ──────────────────────────────────────────────────────────────

// POST /api/rapid-response/claims/:id/fact-checks
router.post("/claims/:id/fact-checks", requireAuth, canFactCheck, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    // Verify parent claim belongs to this tenant
    const [parentClaim] = await db.select({ id: misinformationClaimsTable.id }).from(misinformationClaimsTable)
      .where(and(eq(misinformationClaimsTable.id, req.params.id), tenantFilter(misinformationClaimsTable, t.id))).limit(1);
    if (!parentClaim) return res.status(404).json({ error: "Claim not found" });
    const actorId = await resolveActorUUID(req.clerkId);
    if (!actorId) return res.status(403).json({ error: "Actor not found" });
    const [row] = await db.insert(claimFactChecksTable).values({
      ...req.body, claimId: req.params.id, factCheckerId: actorId,
      completedAt: req.body.verdict ? new Date() : undefined,
    }).returning();

    if (req.body.verdict) {
      await db.update(misinformationClaimsTable)
        .set({ status: "fact_checking" })
        .where(and(eq(misinformationClaimsTable.id, req.params.id), tenantFilter(misinformationClaimsTable, t.id), eq(misinformationClaimsTable.status, "assigned")));
    }
    res.status(201).json(row);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// PATCH /api/rapid-response/claims/:id/fact-checks/:fcId — update verdict
router.patch("/claims/:id/fact-checks/:fcId", requireAuth, canFactCheck, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    // Verify parent claim belongs to this tenant
    const [parentClaim] = await db.select({ id: misinformationClaimsTable.id }).from(misinformationClaimsTable)
      .where(and(eq(misinformationClaimsTable.id, req.params.id), tenantFilter(misinformationClaimsTable, t.id))).limit(1);
    if (!parentClaim) return res.status(404).json({ error: "Claim not found" });
    const [updated] = await db.update(claimFactChecksTable)
      .set({ ...req.body, completedAt: req.body.verdict ? new Date() : undefined })
      .where(and(eq(claimFactChecksTable.id, req.params.fcId), eq(claimFactChecksTable.claimId, req.params.id)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Fact check not found" });
    res.json(updated);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ─── LEGAL REVIEW ─────────────────────────────────────────────────────────────

// POST /api/rapid-response/claims/:id/legal-review
router.post("/claims/:id/legal-review", requireAuth, canLegalReview, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const actorId = await resolveActorUUID(req.clerkId);
    const { legalClearance, legalNotes } = req.body;
    const [updated] = await db.update(misinformationClaimsTable)
      .set({
        legalReviewerId: actorId ?? undefined, legalReviewedAt: new Date(),
        legalClearance, legalNotes, status: "legal_review",
      })
      .where(and(eq(misinformationClaimsTable.id, req.params.id), tenantFilter(misinformationClaimsTable, t.id))).returning();
    if (!updated) return res.status(404).json({ error: "Claim not found" });
    res.json(updated);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST /api/rapid-response/claims/:id/approve — approve for correction publishing
router.post("/claims/:id/approve", requireAuth, canPublish, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const actorId = await resolveActorUUID(req.clerkId);
    const [updated] = await db.update(misinformationClaimsTable)
      .set({ approvedBy: actorId ?? undefined, approvedAt: new Date(), status: "approved" })
      .where(and(eq(misinformationClaimsTable.id, req.params.id), tenantFilter(misinformationClaimsTable, t.id))).returning();
    if (!updated) return res.status(404).json({ error: "Claim not found" });
    res.json(updated);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ─── CORRECTIONS ──────────────────────────────────────────────────────────────

// POST /api/rapid-response/claims/:id/corrections
router.post("/claims/:id/corrections", requireAuth, canPublish, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    // Verify parent claim belongs to this tenant
    const [parentClaim] = await db.select({ id: misinformationClaimsTable.id }).from(misinformationClaimsTable)
      .where(and(eq(misinformationClaimsTable.id, req.params.id), tenantFilter(misinformationClaimsTable, t.id))).limit(1);
    if (!parentClaim) return res.status(404).json({ error: "Claim not found" });
    const actorId = await resolveActorUUID(req.clerkId);
    if (!actorId) return res.status(403).json({ error: "Actor not found" });
    const [correction] = await db.insert(claimCorrectionsTable).values({
      ...req.body, claimId: req.params.id, publishedBy: actorId, publishedAt: new Date(),
    }).returning();
    // Mark claim as published — scoped to tenant
    await db.update(misinformationClaimsTable).set({ status: "published" })
      .where(and(eq(misinformationClaimsTable.id, req.params.id), tenantFilter(misinformationClaimsTable, t.id)));
    res.status(201).json(correction);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// Archive claim
router.post("/claims/:id/archive", requireAuth, canManageRR, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [updated] = await db.update(misinformationClaimsTable)
      .set({ status: "archived" })
      .where(and(eq(misinformationClaimsTable.id, req.params.id), tenantFilter(misinformationClaimsTable, t.id))).returning();
    if (!updated) return res.status(404).json({ error: "Claim not found" });
    res.json(updated);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

export default router;
