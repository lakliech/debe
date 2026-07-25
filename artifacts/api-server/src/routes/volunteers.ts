import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  volunteersTable,
  countiesTable,
  constituenciesTable,
  wardsTable,
  taskAssignmentsTable,
  volunteerTasksTable,
  volunteerAttendanceTable,
  badgeAwardsTable,
  badgeDefinitionsTable,
  trainingEnrollmentsTable,
  trainingCoursesTable,
} from "@workspace/db";
import { eq, desc, and, ilike, or, count, sql } from "drizzle-orm";
import { requireRoles, requireLevel } from "../middlewares/rbac";

const router = Router();

function requireAuth(req: any, res: any, next: any) {
  const auth = getAuth(req);
  if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
  req.clerkId = auth.userId;
  next();
}

const canManageVolunteers = requireRoles([
  "campaign-exec-director",
  "national-organising-director",
  "county-coordinator",
  "constituency-coordinator",
  "ward-coordinator",
  "security-admin",
]);

const canApproveVolunteers = requireRoles([
  "campaign-exec-director",
  "national-organising-director",
  "county-coordinator",
  "constituency-coordinator",
  "ward-coordinator",
]);

// GET /api/volunteers
router.get("/", requireAuth, async (req: any, res: any) => {
  try {
    const {
      status,
      countyId,
      constituencyId,
      wardId,
      search,
      page = "1",
      limit = "20",
    } = req.query;

    const pageNum = parseInt(page) || 1;
    const limitNum = Math.min(parseInt(limit) || 20, 100);
    const offset = (pageNum - 1) * limitNum;

    const rows = await db
      .select({
        id: volunteersTable.id,
        fullName: volunteersTable.fullName,
        phoneNumber: volunteersTable.phoneNumber,
        email: volunteersTable.email,
        preferredRole: volunteersTable.preferredRole,
        status: volunteersTable.status,
        consentGiven: volunteersTable.consentGiven,
        countyId: volunteersTable.countyId,
        constituencyId: volunteersTable.constituencyId,
        wardId: volunteersTable.wardId,
        createdAt: volunteersTable.createdAt,
        countyName: countiesTable.name,
        constituencyName: constituenciesTable.name,
      })
      .from(volunteersTable)
      .leftJoin(countiesTable, eq(volunteersTable.countyId, countiesTable.id))
      .leftJoin(constituenciesTable, eq(volunteersTable.constituencyId, constituenciesTable.id))
      .where(
        and(
          status ? eq(volunteersTable.status, status) : undefined,
          countyId ? eq(volunteersTable.countyId, countyId) : undefined,
          constituencyId ? eq(volunteersTable.constituencyId, constituencyId) : undefined,
          wardId ? eq(volunteersTable.wardId, wardId) : undefined,
          search
            ? or(
                ilike(volunteersTable.fullName, `%${search}%`),
                ilike(volunteersTable.email, `%${search}%`),
                ilike(volunteersTable.phoneNumber, `%${search}%`)
              )
            : undefined
        )
      )
      .orderBy(desc(volunteersTable.createdAt))
      .limit(limitNum)
      .offset(offset);

    const [totalRow] = await db
      .select({ total: count() })
      .from(volunteersTable)
      .where(
        and(
          status ? eq(volunteersTable.status, status) : undefined,
          countyId ? eq(volunteersTable.countyId, countyId) : undefined,
          constituencyId ? eq(volunteersTable.constituencyId, constituencyId) : undefined
        )
      );

    res.json({ data: rows, total: totalRow?.total ?? 0, page: pageNum, limit: limitNum });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/volunteers/stats
router.get("/stats", requireAuth, async (req: any, res: any) => {
  try {
    const statusCounts = await db
      .select({ status: volunteersTable.status, count: count() })
      .from(volunteersTable)
      .groupBy(volunteersTable.status);

    const total = statusCounts.reduce((s, r) => s + Number(r.count), 0);
    const byStatus: Record<string, number> = {};
    for (const row of statusCounts) byStatus[row.status] = Number(row.count);

    res.json({ total, byStatus });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/volunteers/:id
router.get("/:id", requireAuth, async (req: any, res: any) => {
  try {
    const [volunteer] = await db
      .select()
      .from(volunteersTable)
      .where(eq(volunteersTable.id, req.params.id))
      .limit(1);

    if (!volunteer) return res.status(404).json({ error: "Volunteer not found" });
    res.json(volunteer);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/volunteers/:id
router.patch("/:id", requireAuth, canManageVolunteers, async (req: any, res: any) => {
  try {
    const { preferredRole, skills, languages, availability, countyId, constituencyId, wardId } = req.body;
    const [updated] = await db
      .update(volunteersTable)
      .set({
        ...(preferredRole !== undefined && { preferredRole }),
        ...(skills !== undefined && { skills }),
        ...(languages !== undefined && { languages }),
        ...(availability !== undefined && { availability }),
        ...(countyId !== undefined && { countyId }),
        ...(constituencyId !== undefined && { constituencyId }),
        ...(wardId !== undefined && { wardId }),
      })
      .where(eq(volunteersTable.id, req.params.id))
      .returning();
    if (!updated) return res.status(404).json({ error: "Volunteer not found" });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/volunteers/:id/verify
router.post("/:id/verify", requireAuth, canApproveVolunteers, async (req: any, res: any) => {
  try {
    const [updated] = await db
      .update(volunteersTable)
      .set({ status: "verified", verifiedAt: new Date() })
      .where(and(eq(volunteersTable.id, req.params.id), eq(volunteersTable.status, "pending")))
      .returning();
    if (!updated) return res.status(404).json({ error: "Volunteer not found or not in pending status" });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/volunteers/:id/approve
router.post("/:id/approve", requireAuth, canApproveVolunteers, async (req: any, res: any) => {
  try {
    const { assignedRole } = req.body;
    const [updated] = await db
      .update(volunteersTable)
      .set({
        status: "active",
        ...(assignedRole && { preferredRole: assignedRole }),
      })
      .where(eq(volunteersTable.id, req.params.id))
      .returning();
    if (!updated) return res.status(404).json({ error: "Volunteer not found" });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/volunteers/:id/reject
router.post("/:id/reject", requireAuth, canApproveVolunteers, async (req: any, res: any) => {
  try {
    const [updated] = await db
      .update(volunteersTable)
      .set({ status: "rejected" })
      .where(eq(volunteersTable.id, req.params.id))
      .returning();
    if (!updated) return res.status(404).json({ error: "Volunteer not found" });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/volunteers/:id/suspend
router.post("/:id/suspend", requireAuth, canManageVolunteers, async (req: any, res: any) => {
  try {
    const { reason } = req.body;
    const [updated] = await db
      .update(volunteersTable)
      .set({ status: "suspended" })
      .where(eq(volunteersTable.id, req.params.id))
      .returning();
    if (!updated) return res.status(404).json({ error: "Volunteer not found" });
    res.json({ ...updated, suspensionReason: reason });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/volunteers/:id/reactivate
router.post("/:id/reactivate", requireAuth, canManageVolunteers, async (req: any, res: any) => {
  try {
    const [updated] = await db
      .update(volunteersTable)
      .set({ status: "active" })
      .where(eq(volunteersTable.id, req.params.id))
      .returning();
    if (!updated) return res.status(404).json({ error: "Volunteer not found" });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/volunteers/:id/tasks
router.get("/:id/tasks", requireAuth, async (req: any, res: any) => {
  try {
    const assignments = await db
      .select({
        id: taskAssignmentsTable.id,
        status: taskAssignmentsTable.status,
        hoursLogged: taskAssignmentsTable.hoursLogged,
        notes: taskAssignmentsTable.notes,
        completedAt: taskAssignmentsTable.completedAt,
        task: {
          id: volunteerTasksTable.id,
          title: volunteerTasksTable.title,
          description: volunteerTasksTable.description,
          taskType: volunteerTasksTable.taskType,
          status: volunteerTasksTable.status,
          priority: volunteerTasksTable.priority,
          dueDate: volunteerTasksTable.dueDate,
        },
      })
      .from(taskAssignmentsTable)
      .innerJoin(volunteerTasksTable, eq(taskAssignmentsTable.taskId, volunteerTasksTable.id))
      .where(eq(taskAssignmentsTable.volunteerId, req.params.id))
      .orderBy(desc(taskAssignmentsTable.createdAt));
    res.json(assignments);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/volunteers/:id/attendance
router.get("/:id/attendance", requireAuth, async (req: any, res: any) => {
  try {
    const records = await db
      .select()
      .from(volunteerAttendanceTable)
      .where(eq(volunteerAttendanceTable.volunteerId, req.params.id))
      .orderBy(desc(volunteerAttendanceTable.checkInAt));
    res.json(records);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/volunteers/:id/attendance
router.post("/:id/attendance", requireAuth, canManageVolunteers, async (req: any, res: any) => {
  try {
    const { activityType, activityName, activityId, latitude, longitude, notes } = req.body;
    const [record] = await db
      .insert(volunteerAttendanceTable)
      .values({
        volunteerId: req.params.id,
        activityType,
        activityName,
        activityId,
        latitude,
        longitude,
        notes,
      })
      .returning();
    res.status(201).json(record);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/volunteers/:id/badges
router.get("/:id/badges", requireAuth, async (req: any, res: any) => {
  try {
    const badges = await db
      .select({
        id: badgeAwardsTable.id,
        awardedAt: badgeAwardsTable.awardedAt,
        reason: badgeAwardsTable.reason,
        badge: {
          id: badgeDefinitionsTable.id,
          name: badgeDefinitionsTable.name,
          nameSw: badgeDefinitionsTable.nameSw,
          description: badgeDefinitionsTable.description,
          iconUrl: badgeDefinitionsTable.iconUrl,
          level: badgeDefinitionsTable.level,
          category: badgeDefinitionsTable.category,
        },
      })
      .from(badgeAwardsTable)
      .innerJoin(badgeDefinitionsTable, eq(badgeAwardsTable.badgeId, badgeDefinitionsTable.id))
      .where(eq(badgeAwardsTable.volunteerId, req.params.id))
      .orderBy(desc(badgeAwardsTable.awardedAt));
    res.json(badges);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/volunteers/:id/badges
router.post("/:id/badges", requireAuth, canManageVolunteers, async (req: any, res: any) => {
  try {
    const { badgeId, reason } = req.body;
    const [award] = await db
      .insert(badgeAwardsTable)
      .values({ volunteerId: req.params.id, badgeId, reason })
      .returning();
    res.status(201).json(award);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/volunteers/:id/training
router.get("/:id/training", requireAuth, async (req: any, res: any) => {
  try {
    const enrollments = await db
      .select({
        id: trainingEnrollmentsTable.id,
        status: trainingEnrollmentsTable.status,
        score: trainingEnrollmentsTable.score,
        startedAt: trainingEnrollmentsTable.startedAt,
        completedAt: trainingEnrollmentsTable.completedAt,
        certificateCode: trainingEnrollmentsTable.certificateCode,
        course: {
          id: trainingCoursesTable.id,
          title: trainingCoursesTable.title,
          mandatory: trainingCoursesTable.mandatory,
          passMark: trainingCoursesTable.passMark,
        },
      })
      .from(trainingEnrollmentsTable)
      .innerJoin(trainingCoursesTable, eq(trainingEnrollmentsTable.courseId, trainingCoursesTable.id))
      .where(eq(trainingEnrollmentsTable.volunteerId, req.params.id))
      .orderBy(desc(trainingEnrollmentsTable.createdAt));
    res.json(enrollments);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
