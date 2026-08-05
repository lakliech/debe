/**
 * Election Disputes API
 */
import { logger } from "../lib/logger";
import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  electionDisputesTable,
  disputeEvidenceTable,
  disputeCommunicationsTable,
  submissionFormImagesTable,
  resultSubmissionsTable,
  usersTable,
} from "@workspace/db";
import { eq, desc, and, count } from "drizzle-orm";
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

const canManageDisputes = requireRoles([
  "campaign-exec-director", "national-campaign-manager", "returning-officer", "legal-officer",
]);
const canManageElections = requireRoles([
  "campaign-exec-director", "national-campaign-manager", "returning-officer",
]);

// GET /api/election-disputes/
router.get("/", requireAuth, canManageDisputes, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const { electionId, status, priority, pollingStationId, page = "1", limit = "20" } = req.query;
    const pageNum = parseInt(page) || 1;
    const pageSize = Math.min(parseInt(limit) || 20, 100);
    const offset = (pageNum - 1) * pageSize;

    const conditions: any[] = [tenantFilter(electionDisputesTable, t.id)];
    if (electionId) conditions.push(eq(electionDisputesTable.electionId, electionId));
    if (status) conditions.push(eq(electionDisputesTable.status, status));
    if (priority) conditions.push(eq(electionDisputesTable.priority, priority));
    if (pollingStationId) conditions.push(eq(electionDisputesTable.pollingStationId, pollingStationId));
    const where = and(...conditions);

    const [rows, [{ total }]] = await Promise.all([
      db.select().from(electionDisputesTable).where(where)
        .orderBy(desc(electionDisputesTable.createdAt)).limit(pageSize).offset(offset),
      db.select({ total: count() }).from(electionDisputesTable).where(where),
    ]);
    res.json({ data: rows, total: Number(total), page: pageNum, pageSize });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST /api/election-disputes/
router.post("/", requireAuth, canManageDisputes, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const actorId = await resolveActorUUID(req.clerkId);
    const {
      electionId, pollingStationId, submissionId, disputeType, title, description,
      status, priority, assignedTo, resolutionNotes, deadline, deadlineAt,
    } = req.body;

    // Validate submissionId belongs to this tenant to prevent cross-tenant dispute injection
    if (submissionId) {
      const [sub] = await db.select({ id: resultSubmissionsTable.id }).from(resultSubmissionsTable)
        .where(and(eq(resultSubmissionsTable.id, submissionId), tenantFilter(resultSubmissionsTable, t.id))).limit(1);
      if (!sub) return res.status(400).json({ error: "submissionId not found or not owned by this campaign" });
    }

    const [row] = await db.insert(electionDisputesTable).values({
      tenantId: t.id,
      electionId, pollingStationId, submissionId, disputeType, title, description,
      status: status ?? "open",
      priority: priority ?? "medium",
      assignedTo, resolutionNotes,
      openedBy: actorId ?? undefined,
      deadlineAt: deadlineAt ?? (deadline ? new Date(deadline) : undefined),
    }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/election-disputes/:id
router.get("/:id", requireAuth, canManageDisputes, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [dispute] = await db.select().from(electionDisputesTable)
      .where(and(eq(electionDisputesTable.id, req.params.id), tenantFilter(electionDisputesTable, t.id))).limit(1);
    if (!dispute) return res.status(404).json({ error: "Dispute not found" });

    const [evidence, comms] = await Promise.all([
      db.select().from(disputeEvidenceTable)
        .where(eq(disputeEvidenceTable.disputeId, req.params.id))
        .orderBy(desc(disputeEvidenceTable.createdAt)),
      db.select().from(disputeCommunicationsTable)
        .where(eq(disputeCommunicationsTable.disputeId, req.params.id))
        .orderBy(desc(disputeCommunicationsTable.createdAt)),
    ]);

    res.json({ ...dispute, evidence, communications: comms });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// PATCH /api/election-disputes/:id
router.patch("/:id", requireAuth, canManageDisputes, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    // Map only valid schema columns; frontend sends `deadline` as a date string, schema has `deadlineAt`
    const {
      disputeType, title, description, status, priority, assignedTo,
      resolutionNotes, deadline, deadlineAt,
    } = req.body;
    const updateData: Record<string, any> = {};
    if (disputeType !== undefined) updateData.disputeType = disputeType;
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (status !== undefined) {
      updateData.status = status;
      if (status === "resolved") updateData.resolvedAt = new Date();
    }
    if (priority !== undefined) updateData.priority = priority;
    if (assignedTo !== undefined) updateData.assignedTo = assignedTo;
    if (resolutionNotes !== undefined) updateData.resolutionNotes = resolutionNotes;
    if (deadlineAt !== undefined) updateData.deadlineAt = new Date(deadlineAt);
    else if (deadline !== undefined) updateData.deadlineAt = new Date(deadline);

    const [row] = await db.update(electionDisputesTable).set(updateData)
      .where(and(eq(electionDisputesTable.id, req.params.id), tenantFilter(electionDisputesTable, t.id))).returning();
    if (!row) return res.status(404).json({ error: "Dispute not found" });
    res.json(row);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST /api/election-disputes/:id/evidence
router.post("/:id/evidence", requireAuth, canManageDisputes, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    // Verify parent dispute belongs to this tenant
    const [parentDispute] = await db.select({ id: electionDisputesTable.id }).from(electionDisputesTable)
      .where(and(eq(electionDisputesTable.id, req.params.id), tenantFilter(electionDisputesTable, t.id))).limit(1);
    if (!parentDispute) return res.status(404).json({ error: "Dispute not found" });
    const actorId = await resolveActorUUID(req.clerkId);
    const [row] = await db.insert(disputeEvidenceTable).values({
      ...req.body,
      disputeId: req.params.id,
      uploadedBy: actorId ?? undefined,
    }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST /api/election-disputes/:id/communications
router.post("/:id/communications", requireAuth, canManageDisputes, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    // Verify parent dispute belongs to this tenant
    const [parentDispute] = await db.select({ id: electionDisputesTable.id }).from(electionDisputesTable)
      .where(and(eq(electionDisputesTable.id, req.params.id), tenantFilter(electionDisputesTable, t.id))).limit(1);
    if (!parentDispute) return res.status(404).json({ error: "Dispute not found" });
    const actorId = await resolveActorUUID(req.clerkId);
    const [row] = await db.insert(disputeCommunicationsTable).values({
      ...req.body,
      disputeId: req.params.id,
      authorId: actorId ?? undefined,
    }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/election-disputes/:id/evidence-bundle
router.get("/:id/evidence-bundle", requireAuth, canManageDisputes, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [dispute] = await db.select().from(electionDisputesTable)
      .where(and(eq(electionDisputesTable.id, req.params.id), tenantFilter(electionDisputesTable, t.id))).limit(1);
    if (!dispute) return res.status(404).json({ error: "Dispute not found" });

    const [evidence, comms] = await Promise.all([
      db.select().from(disputeEvidenceTable)
        .where(eq(disputeEvidenceTable.disputeId, req.params.id)),
      db.select().from(disputeCommunicationsTable)
        .where(eq(disputeCommunicationsTable.disputeId, req.params.id)),
    ]);

    let submissionImages: any[] = [];
    if (dispute.submissionId) {
      // Only load images if the referenced submission belongs to this tenant
      const [ownedSub] = await db.select({ id: resultSubmissionsTable.id }).from(resultSubmissionsTable)
        .where(and(eq(resultSubmissionsTable.id, dispute.submissionId), tenantFilter(resultSubmissionsTable, t.id))).limit(1);
      if (ownedSub) {
        submissionImages = await db.select().from(submissionFormImagesTable)
          .where(eq(submissionFormImagesTable.submissionId, dispute.submissionId));
      }
    }

    res.json({
      dispute,
      evidence,
      communications: comms,
      submissionImages,
      exportedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST /api/election-disputes/auto-detect
router.post("/auto-detect", requireAuth, canManageElections, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const { electionId } = req.body;
    if (!electionId) return res.status(400).json({ error: "electionId required" });

    const actorId = await resolveActorUUID(req.clerkId);
    const detected: any[] = [];

    // Scan submissions for arithmetic errors
    const submissions = await db.select().from(resultSubmissionsTable)
      .where(and(tenantFilter(resultSubmissionsTable, t.id), eq(resultSubmissionsTable.electionId, electionId)));

    for (const sub of submissions) {
      const issues: string[] = [];

      // Arithmetic check: ballotsIssued = totalVotesCast + unusedBallots + spoiltBallots + rejectedBallots
      const bal = sub.ballotsIssued ?? 0;
      const rec = (sub.totalVotesCast ?? 0) + (sub.unusedBallots ?? 0)
        + (sub.spoiltBallots ?? 0) + (sub.rejectedBallots ?? 0);
      if (bal !== rec) {
        issues.push(`Ballot reconciliation error: issued=${bal}, sum=${rec}`);
      }

      // Missing signature check
      if (sub.agentSigned === false) {
        issues.push("Missing agent signature");
      }

      if (issues.length > 0) {
        const [dispute] = await db.insert(electionDisputesTable).values({
          tenantId: t.id,
          electionId,
          pollingStationId: sub.pollingStationId,
          submissionId: sub.id,
          disputeType: "figure_discrepancy",
          title: `Auto-detected: ${issues[0]}`,
          description: issues.join("; "),
          status: "open",
          priority: "high",
          openedBy: actorId ?? undefined,
          isAutoDetected: true,
        }).returning();
        detected.push(dispute);
      }
    }

    // Duplicate image hash detection
    const allImages = await db.select({
      submissionId: submissionFormImagesTable.submissionId,
      imageHash: submissionFormImagesTable.imageHash,
    }).from(submissionFormImagesTable)
    .innerJoin(resultSubmissionsTable, eq(submissionFormImagesTable.submissionId, resultSubmissionsTable.id))
.where(and(tenantFilter(resultSubmissionsTable, t.id), eq(resultSubmissionsTable.electionId, electionId)));

    const hashMap: Record<string, string[]> = {};
    for (const img of allImages) {
      if (!img.imageHash) continue;
      if (!hashMap[img.imageHash]) hashMap[img.imageHash] = [];
      if (!hashMap[img.imageHash].includes(img.submissionId)) {
        hashMap[img.imageHash].push(img.submissionId);
      }
    }

    for (const [hash, subIds] of Object.entries(hashMap)) {
      if (subIds.length > 1) {
        const [dispute] = await db.insert(electionDisputesTable).values({
          tenantId: t.id,
          electionId,
          submissionId: subIds[0],
          disputeType: "duplicate_image",
          title: `Duplicate image detected: hash ${hash.substring(0, 12)}...`,
          description: `Same image hash found in ${subIds.length} submissions: ${subIds.join(", ")}`,
          status: "open",
          priority: "high",
          openedBy: actorId ?? undefined,
          isAutoDetected: true,
        }).returning();
        detected.push(dispute);
      }
    }

    res.json({ detected: detected.length, disputes: detected });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

export default router;
