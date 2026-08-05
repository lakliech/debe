/**
 * Election Results & Submission Workflow API
 * Status flow: draft → submitted → auto_validated → exception → polling_centre_review →
 *   polling_centre_queried → constituency_verification → constituency_queried →
 *   county_verification → county_queried → national_verification → legal_review → verified
 */
import { logger } from "../lib/logger";
import { Readable } from "stream";
import { Router } from "express";
import { getAuth } from "@clerk/express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  resultSubmissionsTable,
  submissionCandidateVotesTable,
  submissionFormImagesTable,
  submissionVerificationStepsTable,
  submissionCorrectionsTable,
  submissionOcrSuggestionsTable,
  candidatesTable,
  pollingStationsTable,
  campaignStationProfilesTable,
  pollingAgentsTable,
  usersTable,
} from "@workspace/db";
import { eq, desc, and, or, count, inArray } from "drizzle-orm";
import { requireRoles } from "../middlewares/rbac";
import { validate } from "../lib/validate";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { tenantFilter, assertTenant } from "../lib/withTenant";
import { TALLY_ELIGIBLE_STATUSES } from "../lib/resultStatus";

// ─── VALIDATION SCHEMAS ───────────────────────────────────────────────────────

const uuidField = z.string().uuid();
const nonNegInt = z.number().int().min(0);

const candidateVoteSchema = z.object({
  candidateId: z.string().uuid().optional(),
  candidateName: z.string().min(1).max(255),
  partyAbbreviation: z.string().max(50).optional(),
  voteCount: z.number().int().min(0),
});

/** Fields shared between draft creation and agent-submit */
const submissionBodySchema = z.object({
  pollingStationId: uuidField,
  electionId: uuidField,
  agentId: uuidField,
  registeredVoters: nonNegInt.optional(),
  ballotsIssued: nonNegInt.optional(),
  totalVotesCast: nonNegInt.optional(),
  totalValidVotes: nonNegInt.optional(),
  rejectedBallots: nonNegInt.optional(),
  spoiltBallots: nonNegInt.optional(),
  unusedBallots: nonNegInt.optional(),
  deviceId: z.string().max(255).optional(),
  offlineCapturedAt: z.string().datetime({ offset: true }).optional(),
  forceNew: z.boolean().optional(),
  candidateVotes: z.array(candidateVoteSchema).optional(),
  formPhotoUrl: z.string().max(2000).optional(),
});

const imageUploadSchema = z.object({
  imageType: z.string().min(1).max(100),
  objectPath: z.string().max(1000).optional(),
  imageHash: z.string().max(255).optional(),
  sizeBytes: z.number().int().min(0).optional(),
  mimeType: z.string().max(100).optional(),
  pageNumber: z.number().int().min(1).optional(),
  isRequired: z.boolean().optional(),
  deviceId: z.string().max(255).optional(),
});

const verifySchema = z.object({
  action: z.string().min(1).max(100),
  toStatus: z.string().min(1).max(100),
  notes: z.string().max(5000).optional(),
  queriedFields: z.array(z.string()).nullable().optional(),
});

const correctSchema = z.object({
  fieldName: z.string().min(1).max(100),
  correctionReason: z.string().min(1).max(5000),
  originalValue: z.string().max(5000).optional(),
  correctedValue: z.string().max(5000).optional(),
  evidenceUrl: z.string().url().optional(),
});

const ocrReviewSchema = z.object({
  suggestionId: uuidField,
  accepted: z.boolean(),
});

const router = Router();
const objectStorageService = new ObjectStorageService();

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

const canViewResults = requireRoles([
  "campaign-exec-director", "national-campaign-manager", "returning-officer",
  "county-coordinator", "constituency-coordinator", "polling-agent-supervisor", "result-verifier",
]);
const canVerifyResults = requireRoles([
  "campaign-exec-director", "national-campaign-manager", "returning-officer",
  "county-coordinator", "constituency-coordinator", "result-verifier",
]);
// canSubmitResults: polling agents plus supervisors/verifiers can create submissions
const canSubmitResults = requireRoles([
  "campaign-exec-director", "national-campaign-manager", "returning-officer",
  "county-coordinator", "constituency-coordinator", "polling-agent-supervisor",
  "result-verifier", "polling-agent",
]);

// ─── AUTO-VALIDATION ──────────────────────────────────────────────────────────

async function runAutoValidation(submissionId: string, tenantId: string): Promise<{ valid: boolean; flags: string[] }> {
  const flags: string[] = [];

  // Always scope submission lookup to the active tenant — prevents cross-tenant validation
  const [submission] = await db.select().from(resultSubmissionsTable)
    .where(and(eq(resultSubmissionsTable.id, submissionId), tenantFilter(resultSubmissionsTable, tenantId))).limit(1);
  if (!submission) return { valid: false, flags: ["Submission not found"] };

  // Child tables carry no tenantId column of their own — their tenant
  // boundary is the submissionId, which the query above already proved
  // belongs to this tenant. Never query them by any other caller input.
  const votes = await db.select().from(submissionCandidateVotesTable)
    .where(eq(submissionCandidateVotesTable.submissionId, submissionId));

  const images = await db.select().from(submissionFormImagesTable)
    .where(eq(submissionFormImagesTable.submissionId, submissionId));

  // Rule 1: candidate totals == totalValidVotes
  const candidateTotal = votes.reduce((s, v) => s + (v.voteCount ?? 0), 0);
  if (submission.totalValidVotes !== null && candidateTotal !== submission.totalValidVotes) {
    flags.push(`Candidate vote total (${candidateTotal}) != totalValidVotes (${submission.totalValidVotes})`);
  }

  // Rule 2: ballot reconciliation
  const bal = (submission.ballotsIssued ?? 0);
  const rec = (submission.totalVotesCast ?? 0) + (submission.unusedBallots ?? 0)
    + (submission.spoiltBallots ?? 0) + (submission.rejectedBallots ?? 0);
  if (bal !== rec) {
    flags.push(`Ballot reconciliation failed: ballotsIssued(${bal}) != votesCast+unused+spoilt+rejected(${rec})`);
  }

  // Rule 3: totalVotesCast <= registeredVoters
  if ((submission.totalVotesCast ?? 0) > (submission.registeredVoters ?? 0)) {
    flags.push("totalVotesCast exceeds registeredVoters");
  }

  // Rule 4: candidateId exists in election — scoped to this tenant, since
  // candidatesTable is tenant-owned (a UUID from another campaign must never
  // validate here)
  for (const v of votes) {
    if (v.candidateId) {
      const [cand] = await db.select({ id: candidatesTable.id, electionId: candidatesTable.electionId })
        .from(candidatesTable)
        .where(and(eq(candidatesTable.id, v.candidateId), tenantFilter(candidatesTable, tenantId)))
        .limit(1);
      if (!cand || cand.electionId !== submission.electionId) {
        flags.push(`Candidate ${v.candidateId} not found in election`);
      }
    }
  }

  // Rule 5: pollingStationId valid
  const [station] = await db.select({ id: pollingStationsTable.id })
    .from(pollingStationsTable).where(eq(pollingStationsTable.id, submission.pollingStationId)).limit(1);
  if (!station) flags.push("Invalid pollingStationId");

  // Rule 6: agentId assigned to station — assignments are per-campaign and
  // live in campaignStationProfilesTable, NOT the shared geography table
  // (reading it from pollingStationsTable failed EVERY submission).
  if (station) {
    const [profile] = await db.select({ primaryAgentId: campaignStationProfilesTable.primaryAgentId, backupAgentId: campaignStationProfilesTable.backupAgentId })
      .from(campaignStationProfilesTable)
      .where(and(
        eq(campaignStationProfilesTable.stationId, submission.pollingStationId),
        tenantFilter(campaignStationProfilesTable, tenantId),
      ))
      .limit(1);
    const validAgents = [profile?.primaryAgentId, profile?.backupAgentId].filter(Boolean);
    if (!validAgents.includes(submission.agentId)) {
      flags.push("Agent is not assigned to this polling station");
    }
  }

  // Rule 7: At least 1 form image (form_page_1)
  const hasFormPage1 = images.some(img => img.imageType === "form_page_1");
  if (!hasFormPage1) flags.push("Missing required form image: form_page_1");

  // Rule 8: Duplicate submission check (same station+election+agent, same version)
  // (handled at submission creation — skip here)

  // Rule 9: Flag unusual — any candidate > 95% of votes
  const totalVotes = submission.totalValidVotes ?? 0;
  for (const v of votes) {
    if (totalVotes > 0 && (v.voteCount / totalVotes) > 0.95) {
      flags.push(`Unusual: candidate ${v.candidateName} has >95% of votes`);
    }
  }

  // Rule 10: rejectedBallots > 5% of totalVotesCast
  const rejected = submission.rejectedBallots ?? 0;
  const cast = submission.totalVotesCast ?? 0;
  if (cast > 0 && (rejected / cast) > 0.05) {
    flags.push(`Unusual: rejectedBallots (${rejected}) > 5% of totalVotesCast (${cast})`);
  }

  return { valid: flags.length === 0, flags };
}

// ─── ROUTES ───────────────────────────────────────────────────────────────────

// POST /api/election-results/photo-upload-url
// Returns a short-lived presigned PUT URL so mobile agents can upload Form 34A photos
// directly to object storage without routing megabytes through the API server.
router.post("/photo-upload-url", requireAuth, canSubmitResults, async (req: any, res: any) => {
  try {
    // Reject before issuing a presigned URL when the caller hints the photo
    // is already over the hard cap. This saves both upload bandwidth and
    // storage quota without requiring the client to transfer a single byte.
    const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
    const { sizeBytes } = (req.body ?? {}) as { sizeBytes?: unknown };
    if (typeof sizeBytes === "number" && sizeBytes > MAX_UPLOAD_BYTES) {
      return res.status(413).json({
        error: `Photo is too large (${(sizeBytes / (1024 * 1024)).toFixed(1)} MB). Maximum allowed size is 10 MB. Please retake with a lower resolution.`,
      });
    }

    const uploadUrl = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadUrl);
    res.json({ uploadUrl, objectPath });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/election-results/submissions
router.get("/submissions", requireAuth, canViewResults, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const { status, pollingStationId, countyId, constituencyId, electionId, page = "1", limit = "20" } = req.query;
    const pageNum = parseInt(page) || 1;
    const pageSize = Math.min(parseInt(limit) || 20, 100);
    const offset = (pageNum - 1) * pageSize;

    const conditions: any[] = [tenantFilter(resultSubmissionsTable, t.id)];
    // Support both single status= and repeated status= (from URLSearchParams.append)
    const statusValues = Array.isArray(status) ? status : (status ? [status] : []);
    if (statusValues.length === 1) {
      conditions.push(eq(resultSubmissionsTable.status, statusValues[0] as string));
    } else if (statusValues.length > 1) {
      conditions.push(inArray(resultSubmissionsTable.status, statusValues as string[]));
    }
    if (pollingStationId) conditions.push(eq(resultSubmissionsTable.pollingStationId, pollingStationId));
    if (electionId) conditions.push(eq(resultSubmissionsTable.electionId, electionId));

    // For countyId/constituencyId — join via pollingStationsTable
    // For simplicity, filter via subquery by fetching station IDs
    if (countyId) {
      const stations = await db.select({ id: pollingStationsTable.id })
        .from(pollingStationsTable).where(eq(pollingStationsTable.countyId, countyId));
      const ids = stations.map(s => s.id);
      if (ids.length) conditions.push(inArray(resultSubmissionsTable.pollingStationId, ids));
      else return res.json({ data: [], total: 0, page: pageNum, pageSize });
    }
    if (constituencyId) {
      const stations = await db.select({ id: pollingStationsTable.id })
        .from(pollingStationsTable).where(eq(pollingStationsTable.constituencyId, constituencyId));
      const ids = stations.map(s => s.id);
      if (ids.length) conditions.push(inArray(resultSubmissionsTable.pollingStationId, ids));
      else return res.json({ data: [], total: 0, page: pageNum, pageSize });
    }

    const where = conditions.length ? and(...conditions) : undefined;

    const [rows, [{ total }]] = await Promise.all([
      db.select().from(resultSubmissionsTable).where(where)
        .orderBy(desc(resultSubmissionsTable.createdAt)).limit(pageSize).offset(offset),
      db.select({ total: count() }).from(resultSubmissionsTable).where(where),
    ]);
    res.json({ data: rows, total: Number(total), page: pageNum, pageSize });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST /api/election-results/submissions/agent-submit — atomic create+submit for offline PWA agents
// MUST be before POST /submissions/:id/* routes to avoid :id shadowing
router.post("/submissions/agent-submit", requireAuth, canSubmitResults, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const parsed = validate(submissionBodySchema, req.body, res);
    if (!parsed) return;
    const { candidateVotes, ...body } = parsed;

    // Validate foreign-key inputs belong to this tenant before creating any submission record
    if (body.agentId) {
      const [ownedAgent] = await db.select({ id: pollingAgentsTable.id }).from(pollingAgentsTable)
        .where(and(eq(pollingAgentsTable.id, body.agentId), tenantFilter(pollingAgentsTable, t.id))).limit(1);
      if (!ownedAgent) return res.status(400).json({ error: "agentId not found or not owned by this campaign" });
    }

    // Station must be registered to THIS campaign (a campaign_station_profiles
    // row). polling_stations is shared global geography — without this check an
    // agent could submit results for any station in the country, including
    // stations the campaign does not operate.
    const [ownedStation] = await db.select({ id: campaignStationProfilesTable.id }).from(campaignStationProfilesTable)
      .where(and(
        eq(campaignStationProfilesTable.stationId, body.pollingStationId),
        tenantFilter(campaignStationProfilesTable, t.id),
      )).limit(1);
    if (!ownedStation) return res.status(400).json({ error: "pollingStationId not registered to this campaign" });

    // Idempotency: check for existing submission by deviceId + offlineCapturedAt
    if (body.deviceId && body.offlineCapturedAt) {
      const [dup] = await db.select({ id: resultSubmissionsTable.id, status: resultSubmissionsTable.status })
        .from(resultSubmissionsTable)
        .where(and(
          tenantFilter(resultSubmissionsTable, t.id),
          eq(resultSubmissionsTable.deviceId, body.deviceId),
          eq(resultSubmissionsTable.offlineCapturedAt, new Date(body.offlineCapturedAt)),
        )).limit(1);
      if (dup && dup.status !== "draft") {
        return res.status(200).json({ submissionId: dup.id, status: dup.status, alreadySubmitted: true });
      }
    }

    // Create draft — scoped to this tenant
    const [existing] = await db.select().from(resultSubmissionsTable)
      .where(and(
        tenantFilter(resultSubmissionsTable, t.id),
        eq(resultSubmissionsTable.pollingStationId, body.pollingStationId),
        eq(resultSubmissionsTable.electionId, body.electionId),
        eq(resultSubmissionsTable.agentId, body.agentId),
      )).limit(1);

    let submissionId: string;
    // Convert offlineCapturedAt string → Date for DB
    const dbBody: any = { ...body, offlineCapturedAt: body.offlineCapturedAt ? new Date(body.offlineCapturedAt) : undefined };

    if (existing && existing.status === "draft") {
      await db.update(resultSubmissionsTable).set({ ...dbBody, status: "draft" })
        .where(and(eq(resultSubmissionsTable.id, existing.id), tenantFilter(resultSubmissionsTable, t.id)));
      submissionId = existing.id;
    } else {
      const version = existing ? (existing.version ?? 1) + 1 : 1;
      const [created] = await db.insert(resultSubmissionsTable).values({ ...dbBody, tenantId: t.id, status: "draft", version }).returning();
      submissionId = created.id;
    }

    // Upsert candidate votes
    if (candidateVotes && Array.isArray(candidateVotes) && candidateVotes.length > 0) {
      await db.delete(submissionCandidateVotesTable)
        .where(eq(submissionCandidateVotesTable.submissionId, submissionId));
      await db.insert(submissionCandidateVotesTable).values(
        candidateVotes.map((v: any) => ({ ...v, submissionId }))
      );
    }

    // Auto-register form photo when the agent uploaded one before submitting
    if (body.formPhotoUrl) {
      await db.insert(submissionFormImagesTable).values({
        submissionId,
        imageType: "form_page_1",
        objectPath: body.formPhotoUrl,
        mimeType: "image/jpeg",
        isRequired: true,
        deviceId: body.deviceId ?? undefined,
      }).onConflictDoNothing();
    }

    // Submit
    await db.update(resultSubmissionsTable).set({ status: "submitted", submittedAt: new Date() })
      .where(and(eq(resultSubmissionsTable.id, submissionId), tenantFilter(resultSubmissionsTable, t.id)));

    // Auto-validation — pass tenantId so cross-tenant submissions are never consulted
    const { valid, flags } = await runAutoValidation(submissionId, t.id);
    const newStatus = valid ? "auto_validated" : "exception";

    // Status, per-vote flag sync, and audit step commit together. The votes
    // become tally-eligible exactly when the status does (auto_validated),
    // and drop out on exception — see TALLY_ELIGIBLE_STATUSES.
    const [final] = await db.transaction(async (tx) => {
      const [f] = await tx.update(resultSubmissionsTable).set({ status: newStatus })
        .where(and(eq(resultSubmissionsTable.id, submissionId), tenantFilter(resultSubmissionsTable, t.id))).returning();

      await tx.update(submissionCandidateVotesTable)
        .set({ isVerified: valid })
        .where(eq(submissionCandidateVotesTable.submissionId, submissionId));

      await tx.insert(submissionVerificationStepsTable).values({
        submissionId,
        fromStatus: "submitted",
        toStatus: newStatus,
        action: valid ? "approved" : "queried",
        notes: valid ? "Auto-validation passed (agent PWA)" : `Auto-validation flags: ${flags.join("; ")}`,
      });

      return [f];
    });

    res.status(201).json({ submission: final, autoValidation: { valid, flags } });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST /api/election-results/submissions — create/update draft
// canSubmitResults includes polling agents and supervisors
router.post("/submissions", requireAuth, canSubmitResults, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const parsed = validate(submissionBodySchema, req.body, res);
    if (!parsed) return;
    const { candidateVotes, forceNew, ...body } = parsed;

    // Duplicate check — scoped to this tenant
    const [existing] = await db.select()
      .from(resultSubmissionsTable)
      .where(and(
        tenantFilter(resultSubmissionsTable, t.id),
        eq(resultSubmissionsTable.pollingStationId, body.pollingStationId),
        eq(resultSubmissionsTable.electionId, body.electionId),
        eq(resultSubmissionsTable.agentId, body.agentId),
      )).limit(1);

    if (existing && !forceNew) {
      if (existing.status !== "draft") {
        return res.status(409).json({
          error: "A submission already exists for this station/election/agent",
          existing,
          hint: "Pass forceNew:true to create a new version",
        });
      }
      // Update draft
      const dbBody: any = { ...body, offlineCapturedAt: body.offlineCapturedAt ? new Date(body.offlineCapturedAt) : undefined };
      const [updated] = await db.update(resultSubmissionsTable).set({
        ...dbBody,
        status: "draft",
      }).where(and(eq(resultSubmissionsTable.id, existing.id), tenantFilter(resultSubmissionsTable, t.id))).returning();

      // Upsert candidate votes
      if (candidateVotes && Array.isArray(candidateVotes)) {
        await db.delete(submissionCandidateVotesTable)
          .where(eq(submissionCandidateVotesTable.submissionId, existing.id));
        if (candidateVotes.length > 0) {
          await db.insert(submissionCandidateVotesTable).values(
            candidateVotes.map((v: any) => ({ ...v, submissionId: existing.id }))
          );
        }
      }
      return res.json(updated);
    }

    // New submission
    const version = existing ? (existing.version ?? 1) + 1 : 1;
    const dbBody: any = { ...body, offlineCapturedAt: body.offlineCapturedAt ? new Date(body.offlineCapturedAt) : undefined };
    const [submission] = await db.insert(resultSubmissionsTable).values({
      ...dbBody,
      tenantId: t.id,
      status: "draft",
      version,
    }).returning();

    if (candidateVotes && Array.isArray(candidateVotes) && candidateVotes.length > 0) {
      await db.insert(submissionCandidateVotesTable).values(
        candidateVotes.map((v: any) => ({ ...v, submissionId: submission.id }))
      );
    }

    res.status(201).json(submission);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/election-results/submissions/:id
router.get("/submissions/:id", requireAuth, canViewResults, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [submission] = await db.select().from(resultSubmissionsTable)
      .where(and(eq(resultSubmissionsTable.id, req.params.id), tenantFilter(resultSubmissionsTable, t.id))).limit(1);
    if (!submission) return res.status(404).json({ error: "Submission not found" });

    const [votes, images, steps, corrections] = await Promise.all([
      db.select().from(submissionCandidateVotesTable)
        .where(eq(submissionCandidateVotesTable.submissionId, req.params.id)),
      db.select().from(submissionFormImagesTable)
        .where(eq(submissionFormImagesTable.submissionId, req.params.id)),
      db.select().from(submissionVerificationStepsTable)
        .where(eq(submissionVerificationStepsTable.submissionId, req.params.id))
        .orderBy(desc(submissionVerificationStepsTable.createdAt)),
      db.select().from(submissionCorrectionsTable)
        .where(eq(submissionCorrectionsTable.submissionId, req.params.id))
        .orderBy(desc(submissionCorrectionsTable.createdAt)),
    ]);

    res.json({ ...submission, candidateVotes: votes, images, verificationSteps: steps, corrections });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST /api/election-results/submissions/:id/submit
router.post("/submissions/:id/submit", requireAuth, canSubmitResults, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [submission] = await db.select().from(resultSubmissionsTable)
      .where(and(eq(resultSubmissionsTable.id, req.params.id), tenantFilter(resultSubmissionsTable, t.id))).limit(1);
    if (!submission) return res.status(404).json({ error: "Submission not found" });
    if (submission.status !== "draft") {
      return res.status(400).json({ error: `Cannot submit from status: ${submission.status}` });
    }

    // Set to submitted
    await db.update(resultSubmissionsTable).set({
      status: "submitted",
      submittedAt: new Date(),
    }).where(and(eq(resultSubmissionsTable.id, req.params.id), tenantFilter(resultSubmissionsTable, t.id)));

    // Run auto-validation — pass tenantId so cross-tenant submissions are never consulted
    const { valid, flags } = await runAutoValidation(req.params.id, t.id);
    const newStatus = valid ? "auto_validated" : "exception";

    // Status, per-vote flag sync, and audit step commit together — votes
    // become tally-eligible exactly when the status does (auto_validated).
    const [updated] = await db.transaction(async (tx) => {
      const [u] = await tx.update(resultSubmissionsTable).set({
        status: newStatus,
      }).where(and(eq(resultSubmissionsTable.id, req.params.id), tenantFilter(resultSubmissionsTable, t.id))).returning();

      await tx.update(submissionCandidateVotesTable)
        .set({ isVerified: valid })
        .where(eq(submissionCandidateVotesTable.submissionId, req.params.id));

      await tx.insert(submissionVerificationStepsTable).values({
        submissionId: req.params.id,
        fromStatus: "submitted",
        toStatus: newStatus,
        action: valid ? "approved" : "queried",
        notes: valid ? "Auto-validation passed" : `Auto-validation flags: ${flags.join("; ")}`,
      });

      return [u];
    });

    res.json({ submission: updated, autoValidation: { valid, flags } });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST /api/election-results/submissions/:id/images
router.post("/submissions/:id/images", requireAuth, canSubmitResults, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    // Verify parent submission belongs to this tenant
    const [parentSub] = await db.select({ id: resultSubmissionsTable.id }).from(resultSubmissionsTable)
      .where(and(eq(resultSubmissionsTable.id, req.params.id), tenantFilter(resultSubmissionsTable, t.id))).limit(1);
    if (!parentSub) return res.status(404).json({ error: "Submission not found" });

    const parsed = validate(imageUploadSchema, req.body, res);
    if (!parsed) return;
    const { imageType, objectPath, imageHash, sizeBytes, mimeType, pageNumber, isRequired, deviceId } = parsed;

    const [row] = await db.insert(submissionFormImagesTable).values({
      submissionId: req.params.id,
      imageType,
      objectPath,
      imageHash,
      sizeBytes,
      mimeType,
      pageNumber,
      isRequired: isRequired ?? false,
      deviceId,
    }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/election-results/submissions/:id/images/:imageId/file
// Serves the raw bytes of a Form 34A photo, authorized by canViewResults roles.
// This bypasses the content_assets catalogue used by the general /storage route,
// so result-verifier / returning-officer roles can view submission evidence.
router.get("/submissions/:id/images/:imageId/file", requireAuth, canViewResults, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    // Verify the parent submission belongs to this tenant first
    const [parentSub] = await db.select({ id: resultSubmissionsTable.id }).from(resultSubmissionsTable)
      .where(and(eq(resultSubmissionsTable.id, req.params.id), tenantFilter(resultSubmissionsTable, t.id))).limit(1);
    if (!parentSub) return res.status(404).json({ error: "Submission not found" });
    // Verify the image row exists and belongs to this submission
    const [img] = await db
      .select({ id: submissionFormImagesTable.id, objectPath: submissionFormImagesTable.objectPath, mimeType: submissionFormImagesTable.mimeType })
      .from(submissionFormImagesTable)
      .where(and(
        eq(submissionFormImagesTable.id, req.params.imageId),
        eq(submissionFormImagesTable.submissionId, req.params.id),
      ))
      .limit(1);

    if (!img) {
      res.status(404).json({ error: "Image not found" });
      return;
    }

    const objectFile = await objectStorageService.getObjectEntityFile(img.objectPath!);
    const response = await objectStorageService.downloadObject(objectFile);

    res.status(response.status);
    response.headers.forEach((value: string, key: string) => res.setHeader(key, value));
    if (img.mimeType) res.setHeader("Content-Type", img.mimeType);
    res.setHeader("Cache-Control", "private, max-age=3600");

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (err: any) {
    if (err instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Object not found in storage" });
      return;
    }
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST /api/election-results/submissions/:id/verify
router.post("/submissions/:id/verify", requireAuth, canVerifyResults, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const actorId = await resolveActorUUID(req.clerkId);
    const parsed = validate(verifySchema, req.body, res);
    if (!parsed) return;
    const { action, notes, queriedFields, toStatus } = parsed;

    const [submission] = await db.select({ id: resultSubmissionsTable.id, status: resultSubmissionsTable.status })
      .from(resultSubmissionsTable)
      .where(and(eq(resultSubmissionsTable.id, req.params.id), tenantFilter(resultSubmissionsTable, t.id))).limit(1);
    if (!submission) return res.status(404).json({ error: "Submission not found" });

    // Status change, per-vote flag sync, and audit step commit together.
    // The tally aggregates only isVerified votes, and this endpoint is the
    // ONLY writer of a submission's status — so the votes must flip in
    // lockstep here, in both directions (verify AND un-verify/reject/query).
    const [updated] = await db.transaction(async (tx) => {
      const [u] = await tx.update(resultSubmissionsTable).set({ status: toStatus })
        .where(and(eq(resultSubmissionsTable.id, req.params.id), tenantFilter(resultSubmissionsTable, t.id))).returning();

      await tx.update(submissionCandidateVotesTable)
        .set({ isVerified: TALLY_ELIGIBLE_STATUSES.includes(toStatus) })
        .where(eq(submissionCandidateVotesTable.submissionId, req.params.id));

      await tx.insert(submissionVerificationStepsTable).values({
        submissionId: req.params.id,
        fromStatus: submission.status,
        toStatus,
        reviewerId: actorId ?? undefined,
        action,
        notes,
        queriedFields: queriedFields ?? null,
      });

      return [u];
    });

    res.json(updated);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST /api/election-results/submissions/:id/correct
router.post("/submissions/:id/correct", requireAuth, canVerifyResults, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const actorId = await resolveActorUUID(req.clerkId);
    const parsed = validate(correctSchema, req.body, res);
    if (!parsed) return;
    const { fieldName, originalValue, correctedValue, correctionReason, evidenceUrl } = parsed;
    // Verify parent submission belongs to this tenant
    const [parentSub] = await db.select({ id: resultSubmissionsTable.id }).from(resultSubmissionsTable)
      .where(and(eq(resultSubmissionsTable.id, req.params.id), tenantFilter(resultSubmissionsTable, t.id))).limit(1);
    if (!parentSub) return res.status(404).json({ error: "Submission not found" });

    const [row] = await db.insert(submissionCorrectionsTable).values({
      submissionId: req.params.id,
      fieldName,
      originalValue,
      correctedValue,
      correctedBy: actorId ?? undefined,
      correctionReason,
      evidenceUrl,
    }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/election-results/submissions/:id/corrections
router.get("/submissions/:id/corrections", requireAuth, canViewResults, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    // Verify the parent submission belongs to this tenant
    const [parentSub] = await db.select({ id: resultSubmissionsTable.id }).from(resultSubmissionsTable)
      .where(and(eq(resultSubmissionsTable.id, req.params.id), tenantFilter(resultSubmissionsTable, t.id))).limit(1);
    if (!parentSub) return res.status(404).json({ error: "Submission not found" });
    const rows = await db.select().from(submissionCorrectionsTable)
      .where(eq(submissionCorrectionsTable.submissionId, req.params.id))
      .orderBy(desc(submissionCorrectionsTable.createdAt));
    res.json(rows);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/election-results/submissions/:id/ocr
router.get("/submissions/:id/ocr", requireAuth, canViewResults, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    // Verify the parent submission belongs to this tenant
    const [parentSub] = await db.select({ id: resultSubmissionsTable.id }).from(resultSubmissionsTable)
      .where(and(eq(resultSubmissionsTable.id, req.params.id), tenantFilter(resultSubmissionsTable, t.id))).limit(1);
    if (!parentSub) return res.status(404).json({ error: "Submission not found" });
    const rows = await db.select().from(submissionOcrSuggestionsTable)
      .where(eq(submissionOcrSuggestionsTable.submissionId, req.params.id))
      .orderBy(desc(submissionOcrSuggestionsTable.createdAt));
    res.json(rows);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST /api/election-results/submissions/:id/ocr/review
router.post("/submissions/:id/ocr/review", requireAuth, canVerifyResults, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const actorId = await resolveActorUUID(req.clerkId);
    const parsed = validate(ocrReviewSchema, req.body, res);
    if (!parsed) return;
    const { suggestionId, accepted } = parsed;
    // Verify parent submission belongs to this tenant
    const [parentSub] = await db.select({ id: resultSubmissionsTable.id }).from(resultSubmissionsTable)
      .where(and(eq(resultSubmissionsTable.id, req.params.id), tenantFilter(resultSubmissionsTable, t.id))).limit(1);
    if (!parentSub) return res.status(404).json({ error: "Submission not found" });

    const [row] = await db.update(submissionOcrSuggestionsTable).set({
      accepted,
      reviewedBy: actorId ?? undefined,
      reviewedAt: new Date(),
    }).where(and(
      eq(submissionOcrSuggestionsTable.id, suggestionId),
      eq(submissionOcrSuggestionsTable.submissionId, req.params.id),
    )).returning();
    if (!row) return res.status(404).json({ error: "OCR suggestion not found" });
    res.json(row);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

export default router;
