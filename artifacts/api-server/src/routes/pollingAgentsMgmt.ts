/**
 * Polling Agents Management API
 */
import { logger } from "../lib/logger";
import { Router } from "express";
import { getAuth } from "@clerk/express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  pollingAgentsTable,
  pollingStationsTable,
  agentTrainingCoursesTable,
  agentTrainingEnrollmentsTable,
  agentQuizQuestionsTable,
  agentQuizAttemptsTable,
  agentElectionDayTable,
  agentAllowancesTable,
  agentReplacementsTable,
  agentSyncStatusTable,
  usersTable,
} from "@workspace/db";
import { eq, desc, and, or, ilike, count, inArray } from "drizzle-orm";
import { requireRoles } from "../middlewares/rbac";
import { validate } from "../lib/validate";
import { tenantFilter, assertTenant } from '../lib/withTenant';

// ─── VALIDATION SCHEMAS ───────────────────────────────────────────────────────

const uuidField = z.string().uuid();
const kenyaPhone = z.string().max(20).optional();

const createAgentSchema = z.object({
  fullName: z.string().min(1).max(255),
  phoneNumber: kenyaPhone,
  nationalId: z.string().max(50).optional(),
  email: z.string().email().optional(),
  pollingStationId: uuidField.optional(),
  isBackup: z.boolean().optional(),
  userId: uuidField.optional(),
  status: z.enum(["active", "inactive", "suspended"]).optional(),
  trainingStatus: z.enum(["not_started", "in_progress", "completed"]).optional(),
  accreditationStatus: z.enum(["pending", "submitted", "approved", "rejected"]).optional(),
});

const patchAgentSchema = createAgentSchema.partial();

const createCourseSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(5000).optional(),
  passingScore: z.number().int().min(0).max(100).optional(),
  isRequired: z.boolean().optional(),
  questions: z.array(z.object({
    questionText: z.string().min(1),
    options: z.array(z.string().min(1)).min(2),
    correctIndex: z.number().int().min(0),
    displayOrder: z.number().int().min(0).optional(),
  })).optional(),
});

const quizAnswersSchema = z.object({
  answers: z.array(z.number().int().min(0)),
});

const allowanceSchema = z.object({
  electionId: uuidField,
  amountKes: z.number().positive(),
  paymentMethod: z.string().max(100).optional(),
  paymentRef: z.string().max(255).optional(),
});

const allowanceApproveSchema = z.object({
  allowanceId: uuidField.optional(),
});

const replacementSchema = z.object({
  originalAgentId: uuidField,
  replacementAgentId: uuidField,
  pollingStationId: uuidField,
  reason: z.string().min(1).max(5000),
  effectiveAt: z.string().datetime({ offset: true }).optional(),
});

const replacementApproveSchema = z.object({
  effectiveAt: z.string().datetime({ offset: true }).optional(),
});

const syncHeartbeatSchema = z.object({
  deviceId: z.string().max(255).optional(),
  syncStatus: z.enum(["synced", "pending", "error"]).optional(),
  pendingSubmissions: z.number().int().min(0).optional(),
  appVersion: z.string().max(50).optional(),
  batteryLevel: z.number().min(0).max(100).optional(),
  networkType: z.string().max(50).optional(),
});

const electionDaySchema = z.object({
  electionId: uuidField,
  pollingStationId: uuidField.optional(),
  arrivedAt: z.string().datetime({ offset: true }).optional(),
  leftAt: z.string().datetime({ offset: true }).optional(),
  attendanceStatus: z.enum(["expected", "present", "absent", "replaced"]).optional(),
  notes: z.string().max(5000).optional(),
});

const router = Router();

const agentsQuerySchema = z.object({
  pollingStationId: z.string().uuid().optional(),
  countyId: z.string().uuid().optional(),
  status: z.string().trim().max(100).optional(),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const replacementsQuerySchema = z.object({
  agentId: z.string().uuid().optional(),
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

const canViewAgents = requireRoles([
  "campaign-exec-director", "national-campaign-manager", "returning-officer",
  "county-coordinator", "constituency-coordinator", "polling-agent-supervisor",
]);
const canManageAgents = requireRoles([
  "campaign-exec-director", "national-campaign-manager", "returning-officer",
  "county-coordinator", "polling-agent-supervisor",
]);
const canApprovePayments = requireRoles([
  "campaign-exec-director", "national-campaign-manager", "finance-manager",
]);
const canManageSupervisor = requireRoles([
  "campaign-exec-director", "national-campaign-manager", "returning-officer",
  "county-coordinator", "polling-agent-supervisor",
]);

// ─── AGENTS ──────────────────────────────────────────────────────────────────

// GET /api/polling-agents/
router.get("/", requireAuth, canViewAgents, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const q = validate(agentsQuerySchema, req.query, res);
    if (!q) return;
    const { pollingStationId, status, search } = q;
    const pageNum = q.page;
    const pageSize = q.limit;
    const offset = (pageNum - 1) * pageSize;

    const conditions: any[] = [tenantFilter(pollingAgentsTable, t.id)];
    if (pollingStationId) conditions.push(eq(pollingAgentsTable.pollingStationId, pollingStationId));
    if (status) conditions.push(eq(pollingAgentsTable.status, status));
    if (search) conditions.push(or(
      ilike(pollingAgentsTable.fullName, `%${search}%`),
      ilike(pollingAgentsTable.phoneNumber, `%${search}%`),
      ilike(pollingAgentsTable.nationalId, `%${search}%`),
    ));
    const where = and(...conditions);

    const [rows, [{ total }]] = await Promise.all([
      db.select().from(pollingAgentsTable).where(where).orderBy(desc(pollingAgentsTable.createdAt)).limit(pageSize).offset(offset),
      db.select({ total: count() }).from(pollingAgentsTable).where(where),
    ]);
    res.json({ data: rows, total: Number(total), page: pageNum, pageSize });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST /api/polling-agents/
router.post("/", requireAuth, canManageAgents, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const parsed = validate(createAgentSchema, req.body, res);
    if (!parsed) return;
    const { pollingStationId, isBackup, ...body } = parsed;

    // Prevent duplicate primary assignment
    if (pollingStationId && !isBackup) {
      const [existing] = await db.select({ id: pollingAgentsTable.id })
        .from(pollingAgentsTable)
        .where(and(
          tenantFilter(pollingAgentsTable, t.id),
          eq(pollingAgentsTable.pollingStationId, pollingStationId),
          eq(pollingAgentsTable.isBackup, false),
        )).limit(1);
      if (existing) return res.status(409).json({ error: "A primary agent is already assigned to this station" });
    }

    const [row] = await db.insert(pollingAgentsTable).values({
      ...body,
      tenantId: t.id,
      pollingStationId,
      isBackup: isBackup ?? false,
    } as any).returning();
    res.status(201).json(row);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/polling-agents/me  (MUST be before /:id) — resolves the current user's agent record
router.get("/me", requireAuth, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    // Look up user by clerkId, then find their agent record
    const [user] = await db.select({ id: usersTable.id })
      .from(usersTable).where(eq(usersTable.clerkId, req.clerkId)).limit(1);
    if (!user) return res.status(404).json({ error: "User not found" });

    const [agent] = await db.select().from(pollingAgentsTable)
      .where(and(eq(pollingAgentsTable.userId, user.id), tenantFilter(pollingAgentsTable, t.id))).limit(1);
    if (!agent) return res.status(404).json({ error: "No agent record found for this user" });

    res.json(agent);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/polling-agents/courses  (MUST be before /:id)
router.get("/courses", requireAuth, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const rows = await db.select().from(agentTrainingCoursesTable)
      .where(tenantFilter(agentTrainingCoursesTable, t.id))
      .orderBy(agentTrainingCoursesTable.createdAt);
    res.json(rows);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/polling-agents/sync-status  (MUST be before /:id)
router.get("/sync-status", requireAuth, canManageSupervisor, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    // agentSyncStatusTable has no tenantId — scope via inner join on pollingAgentsTable
    const rows = await db.select({
      id: agentSyncStatusTable.id,
      agentId: agentSyncStatusTable.agentId,
      deviceId: agentSyncStatusTable.deviceId,
      lastSeenAt: agentSyncStatusTable.lastSeenAt,
      syncStatus: agentSyncStatusTable.syncStatus,
      pendingSubmissions: agentSyncStatusTable.pendingSubmissions,
      appVersion: agentSyncStatusTable.appVersion,
      batteryLevel: agentSyncStatusTable.batteryLevel,
      networkType: agentSyncStatusTable.networkType,
      updatedAt: agentSyncStatusTable.updatedAt,
    })
      .from(agentSyncStatusTable)
      .innerJoin(pollingAgentsTable, and(
        eq(agentSyncStatusTable.agentId, pollingAgentsTable.id),
        tenantFilter(pollingAgentsTable, t.id),
      ))
      .orderBy(desc(agentSyncStatusTable.updatedAt));
    res.json(rows);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/polling-agents/replacements  (MUST be before /:id)
router.get("/replacements", requireAuth, canViewAgents, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const q = validate(replacementsQuerySchema, req.query, res);
    if (!q) return;
    const { agentId } = q;
    const conditions: any[] = [tenantFilter(agentReplacementsTable, t.id)];
    if (agentId) conditions.push(eq(agentReplacementsTable.replacementAgentId, agentId as string));
    const rows = await db.select().from(agentReplacementsTable)
      .where(and(...conditions))
      .orderBy(desc(agentReplacementsTable.createdAt));
    res.json(rows);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/polling-agents/:id
router.get("/:id", requireAuth, canViewAgents, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [agent] = await db.select().from(pollingAgentsTable)
      .where(and(eq(pollingAgentsTable.id, req.params.id), tenantFilter(pollingAgentsTable, t.id))).limit(1);
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    const [enrollments, allowances, electionDay] = await Promise.all([
      db.select().from(agentTrainingEnrollmentsTable)
        .where(eq(agentTrainingEnrollmentsTable.agentId, req.params.id)),
      db.select().from(agentAllowancesTable)
        .where(eq(agentAllowancesTable.agentId, req.params.id)),
      db.select().from(agentElectionDayTable)
        .where(eq(agentElectionDayTable.agentId, req.params.id)),
    ]);

    res.json({ ...agent, enrollments, allowances, electionDay });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// PATCH /api/polling-agents/:id
router.patch("/:id", requireAuth, canManageAgents, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const parsed = validate(patchAgentSchema, req.body, res);
    if (!parsed) return;
    const { pollingStationId, isBackup, ...body } = parsed;

    // Conflict check if reassigning primary
    if (pollingStationId && isBackup === false) {
      const [existing] = await db.select({ id: pollingAgentsTable.id })
        .from(pollingAgentsTable)
        .where(and(
          tenantFilter(pollingAgentsTable, t.id),
          eq(pollingAgentsTable.pollingStationId, pollingStationId),
          eq(pollingAgentsTable.isBackup, false),
        )).limit(1);
      if (existing && existing.id !== req.params.id) {
        return res.status(409).json({ error: "Another primary agent is already assigned to this station" });
      }
    }

    const updateData: any = { ...body };
    if (pollingStationId !== undefined) updateData.pollingStationId = pollingStationId;
    if (isBackup !== undefined) updateData.isBackup = isBackup;

    const [row] = await db.update(pollingAgentsTable).set(updateData)
      .where(and(eq(pollingAgentsTable.id, req.params.id), tenantFilter(pollingAgentsTable, t.id))).returning();
    if (!row) return res.status(404).json({ error: "Agent not found" });
    res.json(row);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST /api/polling-agents/:id/code-of-conduct
router.post("/:id/code-of-conduct", requireAuth, canManageAgents, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [row] = await db.update(pollingAgentsTable).set({
      codeOfConductAccepted: true,
      codeOfConductDate: new Date(),
    }).where(and(eq(pollingAgentsTable.id, req.params.id), tenantFilter(pollingAgentsTable, t.id))).returning();
    if (!row) return res.status(404).json({ error: "Agent not found" });
    res.json(row);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ─── TRAINING ─────────────────────────────────────────────────────────────────

// NOTE: GET /courses and GET /sync-status are registered BEFORE GET /:id to prevent
// the wildcard from shadowing static segment names.

// POST /api/polling-agents/courses
router.post("/courses", requireAuth, canManageAgents, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const parsed = validate(createCourseSchema, req.body, res);
    if (!parsed) return;
    const { questions, ...courseBody } = parsed;
    const [course] = await db.insert(agentTrainingCoursesTable).values({ ...courseBody, tenantId: t.id }).returning();

    if (questions && Array.isArray(questions) && questions.length > 0) {
      await db.insert(agentQuizQuestionsTable).values(
        questions.map((q: any, i: number) => ({
          ...q,
          courseId: course.id,
          displayOrder: q.displayOrder ?? i,
        }))
      );
    }

    res.status(201).json(course);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/polling-agents/:id/training
router.get("/:id/training", requireAuth, canViewAgents, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    // Verify parent agent belongs to this tenant before exposing training records
    const [parentAgent] = await db.select({ id: pollingAgentsTable.id })
      .from(pollingAgentsTable)
      .where(and(eq(pollingAgentsTable.id, req.params.id), tenantFilter(pollingAgentsTable, t.id))).limit(1);
    if (!parentAgent) return res.status(404).json({ error: "Agent not found" });
    const rows = await db.select().from(agentTrainingEnrollmentsTable)
      .where(eq(agentTrainingEnrollmentsTable.agentId, req.params.id))
      .orderBy(desc(agentTrainingEnrollmentsTable.createdAt));
    res.json(rows);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST /api/polling-agents/:id/training/:courseId/enroll
router.post("/:id/training/:courseId/enroll", requireAuth, canManageAgents, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    // Verify both parent agent and course belong to this tenant (prevents cross-tenant IDOR)
    const [[parentAgent], [parentCourse]] = await Promise.all([
      db.select({ id: pollingAgentsTable.id }).from(pollingAgentsTable)
        .where(and(eq(pollingAgentsTable.id, req.params.id), tenantFilter(pollingAgentsTable, t.id))).limit(1),
      db.select({ id: agentTrainingCoursesTable.id }).from(agentTrainingCoursesTable)
        .where(and(eq(agentTrainingCoursesTable.id, req.params.courseId), tenantFilter(agentTrainingCoursesTable, t.id))).limit(1),
    ]);
    if (!parentAgent) return res.status(404).json({ error: "Agent not found" });
    if (!parentCourse) return res.status(404).json({ error: "Course not found" });

    const [existing] = await db.select({ id: agentTrainingEnrollmentsTable.id })
      .from(agentTrainingEnrollmentsTable)
      .where(and(
        eq(agentTrainingEnrollmentsTable.agentId, req.params.id),
        eq(agentTrainingEnrollmentsTable.courseId, req.params.courseId),
      )).limit(1);

    if (existing) return res.status(409).json({ error: "Already enrolled in this course" });

    const [row] = await db.insert(agentTrainingEnrollmentsTable).values({
      tenantId: t.id,
      agentId: req.params.id,
      courseId: req.params.courseId,
      status: "enrolled",
    }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST /api/polling-agents/:id/training/:courseId/quiz
router.post("/:id/training/:courseId/quiz", requireAuth, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const parsed = validate(quizAnswersSchema, req.body, res);
    if (!parsed) return;
    const { answers } = parsed;

    // Verify both parent agent and course belong to this tenant (prevents cross-tenant IDOR)
    const [[parentAgent], [course]] = await Promise.all([
      db.select({ id: pollingAgentsTable.id }).from(pollingAgentsTable)
        .where(and(eq(pollingAgentsTable.id, req.params.id), tenantFilter(pollingAgentsTable, t.id))).limit(1),
      db.select().from(agentTrainingCoursesTable)
        .where(and(eq(agentTrainingCoursesTable.id, req.params.courseId), tenantFilter(agentTrainingCoursesTable, t.id))).limit(1),
    ]);
    if (!parentAgent) return res.status(404).json({ error: "Agent not found" });
    if (!course) return res.status(404).json({ error: "Course not found" });

    const questions = await db.select().from(agentQuizQuestionsTable)
      .where(eq(agentQuizQuestionsTable.courseId, req.params.courseId))
      .orderBy(agentQuizQuestionsTable.displayOrder);

    if (questions.length === 0) return res.status(400).json({ error: "No questions found for this course" });

    let correct = 0;
    for (let i = 0; i < questions.length; i++) {
      if (answers[i] === questions[i].correctIndex) correct++;
    }
    const score = Math.round((correct / questions.length) * 100);
    const passed = score >= course.passingScore;

    const [attempt] = await db.insert(agentQuizAttemptsTable).values({
      agentId: req.params.id,
      courseId: req.params.courseId,
      answers,
      score,
      passed,
    }).returning();

    // Update enrollment
    const [enrollment] = await db.select().from(agentTrainingEnrollmentsTable)
      .where(and(
        eq(agentTrainingEnrollmentsTable.agentId, req.params.id),
        eq(agentTrainingEnrollmentsTable.courseId, req.params.courseId),
      )).limit(1);

    if (enrollment) {
      await db.update(agentTrainingEnrollmentsTable).set({
        attempts: (enrollment.attempts ?? 0) + 1,
        score: passed ? score : (enrollment.score ?? score),
        status: passed ? "passed" : "failed",
        completedAt: passed ? new Date() : enrollment.completedAt,
      }).where(eq(agentTrainingEnrollmentsTable.id, enrollment.id));
    }

    res.status(201).json({ attempt, score, passed });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ─── ALLOWANCES ───────────────────────────────────────────────────────────────

// GET /api/polling-agents/:id/allowance
router.get("/:id/allowance", requireAuth, canViewAgents, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    // Verify agent belongs to this tenant
    const [parentAgent] = await db.select({ id: pollingAgentsTable.id }).from(pollingAgentsTable)
      .where(and(eq(pollingAgentsTable.id, req.params.id), tenantFilter(pollingAgentsTable, t.id))).limit(1);
    if (!parentAgent) return res.status(404).json({ error: "Agent not found" });
    const rows = await db.select().from(agentAllowancesTable)
      .where(eq(agentAllowancesTable.agentId, req.params.id))
      .orderBy(desc(agentAllowancesTable.createdAt));
    res.json(rows);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST /api/polling-agents/:id/allowance
router.post("/:id/allowance", requireAuth, canManageAgents, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    // Verify agent belongs to this tenant
    const [parentAgent] = await db.select({ id: pollingAgentsTable.id }).from(pollingAgentsTable)
      .where(and(eq(pollingAgentsTable.id, req.params.id), tenantFilter(pollingAgentsTable, t.id))).limit(1);
    if (!parentAgent) return res.status(404).json({ error: "Agent not found" });
    const parsed = validate(allowanceSchema, req.body, res);
    if (!parsed) return;
    const { electionId, amountKes, paymentMethod, paymentRef, ...rest } = parsed;

    // Check if exists
    const [existing] = await db.select({ id: agentAllowancesTable.id })
      .from(agentAllowancesTable)
      .where(and(
        eq(agentAllowancesTable.agentId, req.params.id),
        eq(agentAllowancesTable.electionId, electionId),
      )).limit(1);

    let row;
    if (existing) {
      [row] = await db.update(agentAllowancesTable).set({
        amountKes, paymentMethod, paymentRef, ...rest,
      }).where(eq(agentAllowancesTable.id, existing.id)).returning();
    } else {
      [row] = await db.insert(agentAllowancesTable).values({
        agentId: req.params.id, electionId, amountKes, paymentMethod, paymentRef, ...rest,
      }).returning();
    }
    res.status(201).json(row);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST /api/polling-agents/:id/allowance/approve
router.post("/:id/allowance/approve", requireAuth, canApprovePayments, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    // Verify agent belongs to this tenant
    const [parentAgent] = await db.select({ id: pollingAgentsTable.id }).from(pollingAgentsTable)
      .where(and(eq(pollingAgentsTable.id, req.params.id), tenantFilter(pollingAgentsTable, t.id))).limit(1);
    if (!parentAgent) return res.status(404).json({ error: "Agent not found" });
    const actorId = await resolveActorUUID(req.clerkId);
    const parsed = validate(allowanceApproveSchema, req.body, res);
    if (!parsed) return;
    const { allowanceId } = parsed;
    // Always constrain to the verified parent agent (prevents IDOR cross-tenant write)
    const conditions: any[] = [eq(agentAllowancesTable.agentId, req.params.id)];
    if (allowanceId) conditions.push(eq(agentAllowancesTable.id, allowanceId));
    const where = and(...conditions);

    const [row] = await db.update(agentAllowancesTable).set({
      status: "approved",
      approvedBy: actorId ?? undefined,
      approvedAt: new Date(),
    }).where(where).returning();
    if (!row) return res.status(404).json({ error: "Allowance not found" });
    res.json(row);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ─── REPLACEMENTS ─────────────────────────────────────────────────────────────

// POST /api/polling-agents/replacements
router.post("/replacements", requireAuth, canManageAgents, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const actorId = await resolveActorUUID(req.clerkId);
    const parsed = validate(replacementSchema, req.body, res);
    if (!parsed) return;
    const [row] = await db.insert(agentReplacementsTable).values({
      ...parsed,
      tenantId: t.id,
      requestedBy: actorId ?? undefined,
      status: "pending",
    } as any).returning();
    res.status(201).json(row);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// PATCH /api/polling-agents/replacements/:rid/approve
router.patch("/replacements/:rid/approve", requireAuth, canApprovePayments, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const actorId = await resolveActorUUID(req.clerkId);
    const parsed = validate(replacementApproveSchema, req.body, res);
    if (!parsed) return;
    const [row] = await db.update(agentReplacementsTable).set({
      status: "approved",
      approvedBy: actorId ?? undefined,
      effectiveAt: parsed.effectiveAt ? new Date(parsed.effectiveAt) : new Date(),
    }).where(and(eq(agentReplacementsTable.id, req.params.rid), tenantFilter(agentReplacementsTable, t.id))).returning();
    if (!row) return res.status(404).json({ error: "Replacement request not found" });
    res.json(row);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ─── SYNC STATUS ──────────────────────────────────────────────────────────────

// POST /api/polling-agents/:id/sync-heartbeat
router.post("/:id/sync-heartbeat", requireAuth, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    // Verify the target agent belongs to this tenant before writing sync status
    const [parentAgent] = await db.select({ id: pollingAgentsTable.id })
      .from(pollingAgentsTable)
      .where(and(eq(pollingAgentsTable.id, req.params.id), tenantFilter(pollingAgentsTable, t.id))).limit(1);
    if (!parentAgent) return res.status(404).json({ error: "Agent not found" });
    const parsed = validate(syncHeartbeatSchema, req.body, res);
    if (!parsed) return;
    const { deviceId, syncStatus, pendingSubmissions, appVersion, batteryLevel, networkType } = parsed;
    const [row] = await db.insert(agentSyncStatusTable).values({
      agentId: req.params.id,
      deviceId,
      lastSeenAt: new Date(),
      syncStatus: syncStatus ?? "synced",
      pendingSubmissions: pendingSubmissions ?? 0,
      appVersion,
      batteryLevel,
      networkType,
    }).onConflictDoUpdate({
      target: agentSyncStatusTable.agentId,
      set: {
        deviceId,
        lastSeenAt: new Date(),
        syncStatus: syncStatus ?? "synced",
        pendingSubmissions: pendingSubmissions ?? 0,
        appVersion,
        batteryLevel,
        networkType,
      },
    }).returning();
    res.json(row);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ─── ELECTION DAY ─────────────────────────────────────────────────────────────

// GET /api/polling-agents/:id/election-day
router.get("/:id/election-day", requireAuth, canViewAgents, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    // Verify agent belongs to this tenant
    const [parentAgent] = await db.select({ id: pollingAgentsTable.id }).from(pollingAgentsTable)
      .where(and(eq(pollingAgentsTable.id, req.params.id), tenantFilter(pollingAgentsTable, t.id))).limit(1);
    if (!parentAgent) return res.status(404).json({ error: "Agent not found" });
    const rows = await db.select().from(agentElectionDayTable)
      .where(eq(agentElectionDayTable.agentId, req.params.id))
      .orderBy(desc(agentElectionDayTable.createdAt));
    res.json(rows);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// PATCH /api/polling-agents/:id/election-day
router.patch("/:id/election-day", requireAuth, canManageSupervisor, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    // Verify target agent belongs to this tenant before reading/writing election-day records
    const [parentAgent] = await db.select({ id: pollingAgentsTable.id }).from(pollingAgentsTable)
      .where(and(eq(pollingAgentsTable.id, req.params.id), tenantFilter(pollingAgentsTable, t.id))).limit(1);
    if (!parentAgent) return res.status(404).json({ error: "Agent not found" });
    const actorId = await resolveActorUUID(req.clerkId);
    const parsed = validate(electionDaySchema, req.body, res);
    if (!parsed) return;
    const { electionId, pollingStationId, arrivedAt, leftAt, attendanceStatus, notes } = parsed;

    const [existing] = await db.select({ id: agentElectionDayTable.id })
      .from(agentElectionDayTable)
      .where(and(
        eq(agentElectionDayTable.agentId, req.params.id),
        eq(agentElectionDayTable.electionId, electionId),
      )).limit(1);

    let row;
    if (existing) {
      [row] = await db.update(agentElectionDayTable).set({
        arrivedAt: arrivedAt ? new Date(arrivedAt) : undefined,
        leftAt: leftAt ? new Date(leftAt) : undefined,
        attendanceStatus,
        notes,
        recordedBy: actorId ?? undefined,
      }).where(eq(agentElectionDayTable.id, existing.id)).returning();
    } else {
      [row] = await db.insert(agentElectionDayTable).values({
        agentId: req.params.id,
        electionId,
        pollingStationId,
        arrivedAt: arrivedAt ? new Date(arrivedAt) : undefined,
        leftAt: leftAt ? new Date(leftAt) : undefined,
        attendanceStatus: attendanceStatus ?? "expected",
        notes,
        recordedBy: actorId ?? undefined,
      } as any).returning();
    }
    res.json(row);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

export default router;
