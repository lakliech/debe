import { logger } from "../lib/logger";
import { Router } from "express";
import { z } from "zod";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  volunteersTable,
  countiesTable,
  constituenciesTable,
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
import { resolveTenant } from "../middlewares/resolveTenant";
import { tenantFilter, assertTenant } from "../lib/withTenant";
import { validate } from "../lib/validate";

const router = Router();

const volunteersListQuerySchema = z.object({
  status: z.string().trim().max(100).optional(),
  countyId: z.string().uuid().optional(),
  constituencyId: z.string().uuid().optional(),
  wardId: z.string().uuid().optional(),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

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

// ─── Schemas ──────────────────────────────────────────────────────────────────

const VolunteerPatchSchema = z.object({
  preferredRole: z.string().optional(),
  skills: z.array(z.string()).optional(),
  languages: z.array(z.string()).optional(),
  availability: z.string().optional(),
  countyId: z.string().uuid().optional(),
  constituencyId: z.string().uuid().optional(),
  wardId: z.string().uuid().optional(),
}).strict();

const ApproveSchema = z.object({
  assignedRole: z.string().optional(),
});

const SuspendSchema = z.object({
  reason: z.string().optional(),
});

const AttendanceSchema = z.object({
  activityType: z.string().min(1),
  activityName: z.string().optional(),
  activityId: z.string().uuid().optional(),
  latitude: z.string().optional(),
  longitude: z.string().optional(),
  notes: z.string().optional(),
});

const BadgeAwardSchema = z.object({
  badgeId: z.string().uuid(),
  reason: z.string().optional(),
});

// GET /api/volunteers
router.get("/", requireAuth, resolveTenant, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const q = validate(volunteersListQuerySchema, req.query, res);
    if (!q) return;
    const { status, countyId, constituencyId, wardId, search } = q;

    const pageNum = q.page;
    const limitNum = q.limit;
    const offset = (pageNum - 1) * limitNum;

    const conditions: any[] = [tenantFilter(volunteersTable, t.id)];
    if (status) conditions.push(eq(volunteersTable.status, status));
    if (countyId) conditions.push(eq(volunteersTable.countyId, countyId));
    if (constituencyId) conditions.push(eq(volunteersTable.constituencyId, constituencyId));
    if (wardId) conditions.push(eq(volunteersTable.wardId, wardId));
    if (search) conditions.push(or(
      ilike(volunteersTable.fullName, `%${search}%`),
      ilike(volunteersTable.email, `%${search}%`),
      ilike(volunteersTable.phoneNumber, `%${search}%`),
    ));

    const where = and(...conditions);

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
      .where(where)
      .orderBy(desc(volunteersTable.createdAt))
      .limit(limitNum)
      .offset(offset);

    const [totalRow] = await db
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(volunteersTable)
      .where(where);

    res.json({ data: rows, total: totalRow?.total ?? 0, page: pageNum, limit: limitNum });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/volunteers/:id
router.get("/:id", requireAuth, resolveTenant, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [volunteer] = await db
      .select()
      .from(volunteersTable)
      .where(and(eq(volunteersTable.id, req.params.id), tenantFilter(volunteersTable, t.id)))
      .limit(1);
    if (!volunteer) return res.status(404).json({ error: "Volunteer not found" });
    res.json(volunteer);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// PATCH /api/volunteers/:id
router.patch("/:id", requireAuth, resolveTenant, canManageVolunteers, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const parsed = VolunteerPatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    const [updated] = await db
      .update(volunteersTable)
      .set(parsed.data)
      .where(and(eq(volunteersTable.id, req.params.id), tenantFilter(volunteersTable, t.id)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Volunteer not found" });
    res.json(updated);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST /api/volunteers/:id/approve
router.post("/:id/approve", requireAuth, resolveTenant, canApproveVolunteers, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [updated] = await db
      .update(volunteersTable)
      .set({ status: "active", verifiedAt: new Date() })
      .where(and(eq(volunteersTable.id, req.params.id), tenantFilter(volunteersTable, t.id)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Volunteer not found" });
    res.json(updated);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST /api/volunteers/:id/suspend
router.post("/:id/suspend", requireAuth, resolveTenant, canManageVolunteers, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const parsed = SuspendSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    const [updated] = await db
      .update(volunteersTable)
      .set({ status: "suspended" })
      .where(and(eq(volunteersTable.id, req.params.id), tenantFilter(volunteersTable, t.id)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Volunteer not found" });
    res.json(updated);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/volunteers/:id/attendance
router.get("/:id/attendance", requireAuth, resolveTenant, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    // Verify volunteer belongs to tenant first
    const [volunteer] = await db.select({ id: volunteersTable.id })
      .from(volunteersTable)
      .where(and(eq(volunteersTable.id, req.params.id), tenantFilter(volunteersTable, t.id)))
      .limit(1);
    if (!volunteer) return res.status(404).json({ error: "Volunteer not found" });

    const rows = await db
      .select()
      .from(volunteerAttendanceTable)
      .where(eq(volunteerAttendanceTable.volunteerId, req.params.id))
      .orderBy(desc(volunteerAttendanceTable.checkInAt));
    res.json(rows);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST /api/volunteers/:id/attendance
router.post("/:id/attendance", requireAuth, resolveTenant, canManageVolunteers, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const parsed = AttendanceSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    const [volunteer] = await db.select({ id: volunteersTable.id })
      .from(volunteersTable)
      .where(and(eq(volunteersTable.id, req.params.id), tenantFilter(volunteersTable, t.id)))
      .limit(1);
    if (!volunteer) return res.status(404).json({ error: "Volunteer not found" });

    const [row] = await db
      .insert(volunteerAttendanceTable)
      .values({ volunteerId: req.params.id, ...parsed.data })
      .returning();
    res.status(201).json(row);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/volunteers/:id/badges
router.get("/:id/badges", requireAuth, resolveTenant, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [volunteer] = await db.select({ id: volunteersTable.id })
      .from(volunteersTable)
      .where(and(eq(volunteersTable.id, req.params.id), tenantFilter(volunteersTable, t.id)))
      .limit(1);
    if (!volunteer) return res.status(404).json({ error: "Volunteer not found" });

    const rows = await db
      .select({ award: badgeAwardsTable, badge: badgeDefinitionsTable })
      .from(badgeAwardsTable)
      .innerJoin(badgeDefinitionsTable, eq(badgeAwardsTable.badgeId, badgeDefinitionsTable.id))
      .where(eq(badgeAwardsTable.volunteerId, req.params.id))
      .orderBy(desc(badgeAwardsTable.awardedAt));
    res.json(rows);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST /api/volunteers/:id/badges
router.post("/:id/badges", requireAuth, resolveTenant, canManageVolunteers, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const parsed = BadgeAwardSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    const [volunteer] = await db.select({ id: volunteersTable.id })
      .from(volunteersTable)
      .where(and(eq(volunteersTable.id, req.params.id), tenantFilter(volunteersTable, t.id)))
      .limit(1);
    if (!volunteer) return res.status(404).json({ error: "Volunteer not found" });

    const [row] = await db
      .insert(badgeAwardsTable)
      .values({ volunteerId: req.params.id, badgeId: parsed.data.badgeId, reason: parsed.data.reason })
      .returning();
    res.status(201).json(row);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/volunteers/:id/training
router.get("/:id/training", requireAuth, resolveTenant, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [volunteer] = await db.select({ id: volunteersTable.id })
      .from(volunteersTable)
      .where(and(eq(volunteersTable.id, req.params.id), tenantFilter(volunteersTable, t.id)))
      .limit(1);
    if (!volunteer) return res.status(404).json({ error: "Volunteer not found" });

    const rows = await db
      .select({ enrollment: trainingEnrollmentsTable, course: trainingCoursesTable })
      .from(trainingEnrollmentsTable)
      .innerJoin(trainingCoursesTable, eq(trainingEnrollmentsTable.courseId, trainingCoursesTable.id))
      .where(eq(trainingEnrollmentsTable.volunteerId, req.params.id))
      .orderBy(desc(trainingEnrollmentsTable.createdAt));
    res.json(rows);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/volunteers/stats — counts by status for the tenant
router.get("/stats", requireAuth, resolveTenant, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const rows = await db
      .select({ status: volunteersTable.status, count: count() })
      .from(volunteersTable)
      .where(tenantFilter(volunteersTable, t.id))
      .groupBy(volunteersTable.status);

    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      byStatus[r.status] = Number(r.count);
      total += Number(r.count);
    }
    res.json({ total, byStatus });
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST /api/volunteers/:id/verify — verify identity and activate (alias for approve)
router.post("/:id/verify", requireAuth, resolveTenant, canApproveVolunteers, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [updated] = await db
      .update(volunteersTable)
      .set({ status: "active", verifiedAt: new Date() })
      .where(and(eq(volunteersTable.id, req.params.id), tenantFilter(volunteersTable, t.id)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Volunteer not found" });
    res.json(updated);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST /api/volunteers/:id/reject — reject an application
router.post("/:id/reject", requireAuth, resolveTenant, canApproveVolunteers, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [updated] = await db
      .update(volunteersTable)
      .set({ status: "rejected" })
      .where(and(eq(volunteersTable.id, req.params.id), tenantFilter(volunteersTable, t.id)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Volunteer not found" });
    res.json(updated);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST /api/volunteers/:id/reactivate — reactivate a suspended volunteer
router.post("/:id/reactivate", requireAuth, resolveTenant, canApproveVolunteers, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [updated] = await db
      .update(volunteersTable)
      .set({ status: "active" })
      .where(and(eq(volunteersTable.id, req.params.id), tenantFilter(volunteersTable, t.id)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Volunteer not found" });
    res.json(updated);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/volunteers/:id/tasks — task assignments for this volunteer
router.get("/:id/tasks", requireAuth, resolveTenant, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [volunteer] = await db.select({ id: volunteersTable.id })
      .from(volunteersTable)
      .where(and(eq(volunteersTable.id, req.params.id), tenantFilter(volunteersTable, t.id)))
      .limit(1);
    if (!volunteer) return res.status(404).json({ error: "Volunteer not found" });

    const rows = await db
      .select({ assignment: taskAssignmentsTable, task: volunteerTasksTable })
      .from(taskAssignmentsTable)
      .innerJoin(volunteerTasksTable, eq(taskAssignmentsTable.taskId, volunteerTasksTable.id))
      .where(and(
        eq(taskAssignmentsTable.volunteerId, req.params.id),
        tenantFilter(volunteerTasksTable, t.id),
      ))
      .orderBy(desc(taskAssignmentsTable.createdAt));
    res.json(rows);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// PATCH /api/volunteers/:id/tasks/:assignmentId — log hours / mark complete
router.patch("/:id/tasks/:assignmentId", requireAuth, resolveTenant, canManageVolunteers, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [volunteer] = await db.select({ id: volunteersTable.id })
      .from(volunteersTable)
      .where(and(eq(volunteersTable.id, req.params.id), tenantFilter(volunteersTable, t.id)))
      .limit(1);
    if (!volunteer) return res.status(404).json({ error: "Volunteer not found" });

    const { status, hoursLogged, notes } = req.body;
    const updates: Record<string, any> = {};
    if (status) updates.status = status;
    if (hoursLogged !== undefined) updates.hoursLogged = hoursLogged;
    if (notes !== undefined) updates.notes = notes;
    if (status === "completed") updates.completedAt = new Date();

    const [updated] = await db
      .update(taskAssignmentsTable)
      .set(updates)
      .where(and(
        eq(taskAssignmentsTable.id, req.params.assignmentId),
        eq(taskAssignmentsTable.volunteerId, req.params.id),
      ))
      .returning();
    if (!updated) return res.status(404).json({ error: "Assignment not found" });
    res.json(updated);
  } catch (err: any) {
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

export default router;
