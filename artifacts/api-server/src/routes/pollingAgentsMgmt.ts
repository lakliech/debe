/**
 * Polling Agents Management API
 */
import { Router } from "express";
import { getAuth } from "@clerk/express";
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
    const { pollingStationId, countyId, status, search, page = "1", limit = "20" } = req.query;
    const pageNum = parseInt(page) || 1;
    const pageSize = Math.min(parseInt(limit) || 20, 100);
    const offset = (pageNum - 1) * pageSize;

    const conditions: any[] = [];
    if (pollingStationId) conditions.push(eq(pollingAgentsTable.pollingStationId, pollingStationId));
    if (status) conditions.push(eq(pollingAgentsTable.status, status));
    if (search) conditions.push(or(
      ilike(pollingAgentsTable.fullName, `%${search}%`),
      ilike(pollingAgentsTable.phoneNumber, `%${search}%`),
      ilike(pollingAgentsTable.nationalId, `%${search}%`),
    ));
    const where = conditions.length ? and(...conditions) : undefined;

    const [rows, [{ total }]] = await Promise.all([
      db.select().from(pollingAgentsTable).where(where).orderBy(desc(pollingAgentsTable.createdAt)).limit(pageSize).offset(offset),
      db.select({ total: count() }).from(pollingAgentsTable).where(where),
    ]);
    res.json({ data: rows, total: Number(total), page: pageNum, pageSize });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/polling-agents/
router.post("/", requireAuth, canManageAgents, async (req: any, res: any) => {
  try {
    const { pollingStationId, isBackup, ...body } = req.body;

    // Prevent duplicate primary assignment
    if (pollingStationId && !isBackup) {
      const [existing] = await db.select({ id: pollingAgentsTable.id })
        .from(pollingAgentsTable)
        .where(and(
          eq(pollingAgentsTable.pollingStationId, pollingStationId),
          eq(pollingAgentsTable.isBackup, false),
        )).limit(1);
      if (existing) return res.status(409).json({ error: "A primary agent is already assigned to this station" });
    }

    const [row] = await db.insert(pollingAgentsTable).values({
      ...body,
      pollingStationId,
      isBackup: isBackup ?? false,
    }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/polling-agents/me  (MUST be before /:id) — resolves the current user's agent record
router.get("/me", requireAuth, async (req: any, res: any) => {
  try {
    // Look up user by clerkId, then find their agent record
    const [user] = await db.select({ id: usersTable.id })
      .from(usersTable).where(eq(usersTable.clerkId, req.clerkId)).limit(1);
    if (!user) return res.status(404).json({ error: "User not found" });

    const [agent] = await db.select().from(pollingAgentsTable)
      .where(eq(pollingAgentsTable.userId, user.id)).limit(1);
    if (!agent) return res.status(404).json({ error: "No agent record found for this user" });

    res.json(agent);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/polling-agents/courses  (MUST be before /:id)
router.get("/courses", requireAuth, async (_req: any, res: any) => {
  try {
    const rows = await db.select().from(agentTrainingCoursesTable)
      .orderBy(agentTrainingCoursesTable.createdAt);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/polling-agents/sync-status  (MUST be before /:id)
router.get("/sync-status", requireAuth, canManageSupervisor, async (_req: any, res: any) => {
  try {
    const rows = await db.select().from(agentSyncStatusTable)
      .orderBy(desc(agentSyncStatusTable.updatedAt));
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/polling-agents/replacements  (MUST be before /:id)
router.get("/replacements", requireAuth, canViewAgents, async (req: any, res: any) => {
  try {
    const { agentId } = req.query;
    const where = agentId ? eq(agentReplacementsTable.replacementAgentId, agentId as string) : undefined;
    const rows = await db.select().from(agentReplacementsTable)
      .where(where)
      .orderBy(desc(agentReplacementsTable.createdAt));
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/polling-agents/:id
router.get("/:id", requireAuth, canViewAgents, async (req: any, res: any) => {
  try {
    const [agent] = await db.select().from(pollingAgentsTable)
      .where(eq(pollingAgentsTable.id, req.params.id)).limit(1);
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
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/polling-agents/:id
router.patch("/:id", requireAuth, canManageAgents, async (req: any, res: any) => {
  try {
    const { pollingStationId, isBackup, ...body } = req.body;

    // Conflict check if reassigning primary
    if (pollingStationId && isBackup === false) {
      const [existing] = await db.select({ id: pollingAgentsTable.id })
        .from(pollingAgentsTable)
        .where(and(
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
      .where(eq(pollingAgentsTable.id, req.params.id)).returning();
    if (!row) return res.status(404).json({ error: "Agent not found" });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/polling-agents/:id/code-of-conduct
router.post("/:id/code-of-conduct", requireAuth, canManageAgents, async (req: any, res: any) => {
  try {
    const [row] = await db.update(pollingAgentsTable).set({
      codeOfConductAccepted: true,
      codeOfConductDate: new Date(),
    }).where(eq(pollingAgentsTable.id, req.params.id)).returning();
    if (!row) return res.status(404).json({ error: "Agent not found" });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── TRAINING ─────────────────────────────────────────────────────────────────

// NOTE: GET /courses and GET /sync-status are registered BEFORE GET /:id to prevent
// the wildcard from shadowing static segment names.

// POST /api/polling-agents/courses
router.post("/courses", requireAuth, canManageAgents, async (req: any, res: any) => {
  try {
    const { questions, ...courseBody } = req.body;
    const [course] = await db.insert(agentTrainingCoursesTable).values(courseBody).returning();

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
    res.status(500).json({ error: err.message });
  }
});

// GET /api/polling-agents/:id/training
router.get("/:id/training", requireAuth, canViewAgents, async (req: any, res: any) => {
  try {
    const rows = await db.select().from(agentTrainingEnrollmentsTable)
      .where(eq(agentTrainingEnrollmentsTable.agentId, req.params.id))
      .orderBy(desc(agentTrainingEnrollmentsTable.createdAt));
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/polling-agents/:id/training/:courseId/enroll
router.post("/:id/training/:courseId/enroll", requireAuth, canManageAgents, async (req: any, res: any) => {
  try {
    const [existing] = await db.select({ id: agentTrainingEnrollmentsTable.id })
      .from(agentTrainingEnrollmentsTable)
      .where(and(
        eq(agentTrainingEnrollmentsTable.agentId, req.params.id),
        eq(agentTrainingEnrollmentsTable.courseId, req.params.courseId),
      )).limit(1);

    if (existing) return res.status(409).json({ error: "Already enrolled in this course" });

    const [row] = await db.insert(agentTrainingEnrollmentsTable).values({
      agentId: req.params.id,
      courseId: req.params.courseId,
      status: "enrolled",
    }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/polling-agents/:id/training/:courseId/quiz
router.post("/:id/training/:courseId/quiz", requireAuth, async (req: any, res: any) => {
  try {
    const { answers } = req.body; // number[] — selected answer indices
    if (!Array.isArray(answers)) return res.status(400).json({ error: "answers array required" });

    const [course] = await db.select().from(agentTrainingCoursesTable)
      .where(eq(agentTrainingCoursesTable.id, req.params.courseId)).limit(1);
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
    res.status(500).json({ error: err.message });
  }
});

// ─── ALLOWANCES ───────────────────────────────────────────────────────────────

// GET /api/polling-agents/:id/allowance
router.get("/:id/allowance", requireAuth, canViewAgents, async (req: any, res: any) => {
  try {
    const rows = await db.select().from(agentAllowancesTable)
      .where(eq(agentAllowancesTable.agentId, req.params.id))
      .orderBy(desc(agentAllowancesTable.createdAt));
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/polling-agents/:id/allowance
router.post("/:id/allowance", requireAuth, canManageAgents, async (req: any, res: any) => {
  try {
    const { electionId, amountKes, paymentMethod, paymentRef, ...rest } = req.body;
    if (!electionId || !amountKes) return res.status(400).json({ error: "electionId and amountKes required" });

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
    res.status(500).json({ error: err.message });
  }
});

// POST /api/polling-agents/:id/allowance/approve
router.post("/:id/allowance/approve", requireAuth, canApprovePayments, async (req: any, res: any) => {
  try {
    const actorId = await resolveActorUUID(req.clerkId);
    const { allowanceId } = req.body;
    const where = allowanceId
      ? eq(agentAllowancesTable.id, allowanceId)
      : eq(agentAllowancesTable.agentId, req.params.id);

    const [row] = await db.update(agentAllowancesTable).set({
      status: "approved",
      approvedBy: actorId ?? undefined,
      approvedAt: new Date(),
    }).where(where).returning();
    if (!row) return res.status(404).json({ error: "Allowance not found" });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── REPLACEMENTS ─────────────────────────────────────────────────────────────

// POST /api/polling-agents/replacements
router.post("/replacements", requireAuth, canManageAgents, async (req: any, res: any) => {
  try {
    const actorId = await resolveActorUUID(req.clerkId);
    const [row] = await db.insert(agentReplacementsTable).values({
      ...req.body,
      requestedBy: actorId ?? undefined,
      status: "pending",
    }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/polling-agents/replacements/:rid/approve
router.patch("/replacements/:rid/approve", requireAuth, canApprovePayments, async (req: any, res: any) => {
  try {
    const actorId = await resolveActorUUID(req.clerkId);
    const [row] = await db.update(agentReplacementsTable).set({
      status: "approved",
      approvedBy: actorId ?? undefined,
      effectiveAt: req.body.effectiveAt ? new Date(req.body.effectiveAt) : new Date(),
    }).where(eq(agentReplacementsTable.id, req.params.rid)).returning();
    if (!row) return res.status(404).json({ error: "Replacement request not found" });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── SYNC STATUS ──────────────────────────────────────────────────────────────

// POST /api/polling-agents/:id/sync-heartbeat
router.post("/:id/sync-heartbeat", requireAuth, async (req: any, res: any) => {
  try {
    const { deviceId, syncStatus, pendingSubmissions, appVersion, batteryLevel, networkType } = req.body;
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
    res.status(500).json({ error: err.message });
  }
});

// ─── ELECTION DAY ─────────────────────────────────────────────────────────────

// GET /api/polling-agents/:id/election-day
router.get("/:id/election-day", requireAuth, canViewAgents, async (req: any, res: any) => {
  try {
    const rows = await db.select().from(agentElectionDayTable)
      .where(eq(agentElectionDayTable.agentId, req.params.id))
      .orderBy(desc(agentElectionDayTable.createdAt));
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/polling-agents/:id/election-day
router.patch("/:id/election-day", requireAuth, canManageSupervisor, async (req: any, res: any) => {
  try {
    const actorId = await resolveActorUUID(req.clerkId);
    const { electionId, pollingStationId, arrivedAt, leftAt, attendanceStatus, notes } = req.body;

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
      }).returning();
    }
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
