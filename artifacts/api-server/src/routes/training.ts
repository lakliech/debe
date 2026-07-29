import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  trainingCoursesTable,
  trainingModulesTable,
  quizQuestionsTable,
  trainingEnrollmentsTable,
  moduleProgressTable,
  volunteersTable,
} from "@workspace/db";
import { eq, desc, and, count } from "drizzle-orm";
import { requireRoles } from "../middlewares/rbac";
import { randomUUID } from "crypto";
import { tenantFilter, assertTenant } from '../lib/withTenant';

const router = Router();

function requireAuth(req: any, res: any, next: any) {
  const auth = getAuth(req);
  if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
  req.clerkId = auth.userId;
  next();
}

const canManageCourses = requireRoles([
  "campaign-exec-director",
  "national-organising-director",
  "communications-officer",
  "content-approver",
  "security-admin",
]);

// GET /api/training/courses
router.get("/courses", requireAuth, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const { status } = req.query;
    const courses = await db
      .select()
      .from(trainingCoursesTable)
      .where(status ? and(tenantFilter(trainingCoursesTable, t.id), eq(trainingCoursesTable.status, status)) : tenantFilter(trainingCoursesTable, t.id))
      .orderBy(trainingCoursesTable.title);
    res.json(courses);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/training/courses
router.post("/courses", requireAuth, canManageCourses, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const { title, titleSw, description, targetRoles, estimatedHours, mandatory, passMark, status } = req.body;
    const [course] = await db
      .insert(trainingCoursesTable)
      .values({ tenantId: t.id, title, titleSw, description, targetRoles, estimatedHours, mandatory, passMark, status: status || "draft" })
      .returning();
    res.status(201).json(course);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/training/courses/:id
router.get("/courses/:id", requireAuth, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [course] = await db
      .select()
      .from(trainingCoursesTable)
      .where(and(eq(trainingCoursesTable.id, req.params.id), tenantFilter(trainingCoursesTable, t.id)))
      .limit(1);

    if (!course) return res.status(404).json({ error: "Course not found" });

    const modules = await db
      .select()
      .from(trainingModulesTable)
      .where(eq(trainingModulesTable.courseId, req.params.id))
      .orderBy(trainingModulesTable.displayOrder);

    const quizzes: Record<string, any[]> = {};
    for (const mod of modules) {
      if (mod.contentType === "quiz") {
        quizzes[mod.id] = await db
          .select()
          .from(quizQuestionsTable)
          .where(eq(quizQuestionsTable.moduleId, mod.id))
          .orderBy(quizQuestionsTable.displayOrder);
      }
    }

    // Scope enrollment count through course (trainingEnrollmentsTable has no tenantId)
    const [enrollmentCount] = await db
      .select({ total: count() })
      .from(trainingEnrollmentsTable)
      .innerJoin(trainingCoursesTable, and(
        eq(trainingEnrollmentsTable.courseId, trainingCoursesTable.id),
        tenantFilter(trainingCoursesTable, t.id),
      ))
      .where(eq(trainingEnrollmentsTable.courseId, req.params.id));

    res.json({ ...course, modules: modules.map((m) => ({ ...m, quiz: quizzes[m.id] || [] })), enrollmentCount: enrollmentCount?.total ?? 0 });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/training/courses/:id
router.patch("/courses/:id", requireAuth, canManageCourses, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const { title, titleSw, description, targetRoles, estimatedHours, mandatory, passMark, status } = req.body;
    const [updated] = await db
      .update(trainingCoursesTable)
      .set({
        ...(title !== undefined && { title }),
        ...(titleSw !== undefined && { titleSw }),
        ...(description !== undefined && { description }),
        ...(targetRoles !== undefined && { targetRoles }),
        ...(estimatedHours !== undefined && { estimatedHours }),
        ...(mandatory !== undefined && { mandatory }),
        ...(passMark !== undefined && { passMark }),
        ...(status !== undefined && { status }),
      })
      .where(and(eq(trainingCoursesTable.id, req.params.id), tenantFilter(trainingCoursesTable, t.id)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Course not found" });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/training/courses/:id/modules
router.post("/courses/:id/modules", requireAuth, canManageCourses, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    // Verify course belongs to this tenant
    const [parentCourse] = await db.select({ id: trainingCoursesTable.id }).from(trainingCoursesTable)
      .where(and(eq(trainingCoursesTable.id, req.params.id), tenantFilter(trainingCoursesTable, t.id))).limit(1);
    if (!parentCourse) return res.status(404).json({ error: "Course not found" });
    const { title, titleSw, contentType, contentEn, contentSw, videoUrl, documentUrl, displayOrder, durationMinutes } = req.body;
    const [module] = await db
      .insert(trainingModulesTable)
      .values({ courseId: req.params.id, title, titleSw, contentType, contentEn, contentSw, videoUrl, documentUrl, displayOrder, durationMinutes })
      .returning();
    res.status(201).json(module);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/training/courses/:id/enroll
router.post("/courses/:id/enroll", requireAuth, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    // Verify course belongs to this tenant
    const [parentCourse] = await db.select({ id: trainingCoursesTable.id }).from(trainingCoursesTable)
      .where(and(eq(trainingCoursesTable.id, req.params.id), tenantFilter(trainingCoursesTable, t.id))).limit(1);
    if (!parentCourse) return res.status(404).json({ error: "Course not found" });
    const { volunteerId, userId } = req.body;

    // Validate volunteerId belongs to this tenant's volunteers before enrolling
    if (volunteerId) {
      const [vol] = await db.select({ id: volunteersTable.id }).from(volunteersTable)
        .where(and(eq(volunteersTable.id, volunteerId), tenantFilter(volunteersTable, t.id))).limit(1);
      if (!vol) return res.status(400).json({ error: "volunteerId not found or not owned by this campaign" });
    }

    const [existing] = await db
      .select({ id: trainingEnrollmentsTable.id })
      .from(trainingEnrollmentsTable)
      .innerJoin(trainingCoursesTable, and(
        eq(trainingEnrollmentsTable.courseId, trainingCoursesTable.id),
        tenantFilter(trainingCoursesTable, t.id),
      ))
      .where(
        and(
          eq(trainingEnrollmentsTable.courseId, req.params.id),
          volunteerId ? eq(trainingEnrollmentsTable.volunteerId, volunteerId) : undefined,
          userId ? eq(trainingEnrollmentsTable.userId, userId) : undefined,
        )
      )
      .limit(1);
    if (existing) return res.status(409).json({ error: "Already enrolled", enrollment: existing });

    const [enrollment] = await db
      .insert(trainingEnrollmentsTable)
      .values({ courseId: req.params.id, volunteerId, userId, status: "enrolled", startedAt: new Date() })
      .returning();
    res.status(201).json(enrollment);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/training/enrollments/:id
router.get("/enrollments/:id", requireAuth, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const [enrollment] = await db
      .select({ enrollment: trainingEnrollmentsTable })
      .from(trainingEnrollmentsTable)
      .innerJoin(trainingCoursesTable, and(
        eq(trainingEnrollmentsTable.courseId, trainingCoursesTable.id),
        tenantFilter(trainingCoursesTable, t.id),
      ))
      .where(eq(trainingEnrollmentsTable.id, req.params.id))
      .limit(1);
    if (!enrollment) return res.status(404).json({ error: "Enrollment not found" });

    const progress = await db
      .select()
      .from(moduleProgressTable)
      .where(eq(moduleProgressTable.enrollmentId, req.params.id));

    res.json({ ...enrollment.enrollment, progress });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/training/enrollments/:id/complete-module
router.post("/enrollments/:id/complete-module", requireAuth, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    const { moduleId, quizScore, quizAnswers } = req.body;
    // Scope enrollment through parent course (trainingEnrollmentsTable has no tenantId)
    const [enrollmentRow] = await db
      .select({ enrollment: trainingEnrollmentsTable, course: trainingCoursesTable })
      .from(trainingEnrollmentsTable)
      .innerJoin(trainingCoursesTable, and(
        eq(trainingEnrollmentsTable.courseId, trainingCoursesTable.id),
        tenantFilter(trainingCoursesTable, t.id),
      ))
      .where(eq(trainingEnrollmentsTable.id, req.params.id))
      .limit(1);
    if (!enrollmentRow) return res.status(404).json({ error: "Enrollment not found" });
    const enrollment = enrollmentRow.enrollment;
    const course = enrollmentRow.course;

    const quizPassed = quizScore !== undefined && course ? quizScore >= (course.passMark ?? 70) : null;

    const [progress] = await db
      .insert(moduleProgressTable)
      .values({
        enrollmentId: req.params.id,
        moduleId,
        completed: true,
        quizScore,
        quizPassed: quizPassed ?? undefined,
        completedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning();

    // Check if all modules in course are completed
    const allModules = await db
      .select({ id: trainingModulesTable.id })
      .from(trainingModulesTable)
      .where(eq(trainingModulesTable.courseId, enrollment.courseId));

    const completedModules = await db
      .select()
      .from(moduleProgressTable)
      .where(and(eq(moduleProgressTable.enrollmentId, req.params.id), eq(moduleProgressTable.completed, true)));

    const allDone = allModules.every((m) => completedModules.some((c) => c.moduleId === m.id));

    if (allDone && enrollment.status !== "completed") {
      const certificateCode = `LM-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`;
      await db
        .update(trainingEnrollmentsTable)
        .set({ status: "completed", completedAt: new Date(), certificateCode, certificateIssuedAt: new Date() })
        // Tenant already verified via inner join at fetch time; update by id only
        .where(eq(trainingEnrollmentsTable.id, req.params.id));
    } else if (enrollment.status === "enrolled") {
      await db
        .update(trainingEnrollmentsTable)
        .set({ status: "in_progress" })
        .where(eq(trainingEnrollmentsTable.id, req.params.id));
    }

    res.json({ progress, allCompleted: allDone });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/training/enrollments/:id/certificate
router.get("/enrollments/:id/certificate", requireAuth, async (req: any, res: any) => {
  try {
    const t = assertTenant(req);
    // Scope enrollment through parent course (trainingEnrollmentsTable has no tenantId)
    const [certRow] = await db
      .select({ enrollment: trainingEnrollmentsTable, course: trainingCoursesTable })
      .from(trainingEnrollmentsTable)
      .innerJoin(trainingCoursesTable, and(
        eq(trainingEnrollmentsTable.courseId, trainingCoursesTable.id),
        tenantFilter(trainingCoursesTable, t.id),
      ))
      .where(and(eq(trainingEnrollmentsTable.id, req.params.id), eq(trainingEnrollmentsTable.status, "completed")))
      .limit(1);
    if (!certRow) return res.status(404).json({ error: "Certificate not issued for this enrollment" });

    res.json({
      certificateCode: certRow.enrollment.certificateCode,
      issuedAt: certRow.enrollment.certificateIssuedAt,
      courseName: certRow.course?.title,
      volunteerId: certRow.enrollment.volunteerId,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
