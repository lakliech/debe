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
    const { status } = req.query;
    const courses = await db
      .select()
      .from(trainingCoursesTable)
      .where(status ? eq(trainingCoursesTable.status, status) : undefined)
      .orderBy(trainingCoursesTable.title);
    res.json(courses);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/training/courses
router.post("/courses", requireAuth, canManageCourses, async (req: any, res: any) => {
  try {
    const { title, titleSw, description, targetRoles, estimatedHours, mandatory, passMark, status } = req.body;
    const [course] = await db
      .insert(trainingCoursesTable)
      .values({ title, titleSw, description, targetRoles, estimatedHours, mandatory, passMark, status: status || "draft" })
      .returning();
    res.status(201).json(course);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/training/courses/:id
router.get("/courses/:id", requireAuth, async (req: any, res: any) => {
  try {
    const [course] = await db
      .select()
      .from(trainingCoursesTable)
      .where(eq(trainingCoursesTable.id, req.params.id))
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

    const [enrollmentCount] = await db
      .select({ total: count() })
      .from(trainingEnrollmentsTable)
      .where(eq(trainingEnrollmentsTable.courseId, req.params.id));

    res.json({ ...course, modules: modules.map((m) => ({ ...m, quiz: quizzes[m.id] || [] })), enrollmentCount: enrollmentCount?.total ?? 0 });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/training/courses/:id
router.patch("/courses/:id", requireAuth, canManageCourses, async (req: any, res: any) => {
  try {
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
      .where(eq(trainingCoursesTable.id, req.params.id))
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
    const { volunteerId, userId } = req.body;
    const [existing] = await db
      .select()
      .from(trainingEnrollmentsTable)
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
    const [enrollment] = await db
      .select()
      .from(trainingEnrollmentsTable)
      .where(eq(trainingEnrollmentsTable.id, req.params.id))
      .limit(1);
    if (!enrollment) return res.status(404).json({ error: "Enrollment not found" });

    const progress = await db
      .select()
      .from(moduleProgressTable)
      .where(eq(moduleProgressTable.enrollmentId, req.params.id));

    res.json({ ...enrollment, progress });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/training/enrollments/:id/complete-module
router.post("/enrollments/:id/complete-module", requireAuth, async (req: any, res: any) => {
  try {
    const { moduleId, quizScore, quizAnswers } = req.body;
    const [enrollment] = await db
      .select()
      .from(trainingEnrollmentsTable)
      .where(eq(trainingEnrollmentsTable.id, req.params.id))
      .limit(1);
    if (!enrollment) return res.status(404).json({ error: "Enrollment not found" });

    const [course] = await db
      .select()
      .from(trainingCoursesTable)
      .where(eq(trainingCoursesTable.id, enrollment.courseId))
      .limit(1);

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
    const [enrollment] = await db
      .select()
      .from(trainingEnrollmentsTable)
      .where(and(eq(trainingEnrollmentsTable.id, req.params.id), eq(trainingEnrollmentsTable.status, "completed")))
      .limit(1);
    if (!enrollment) return res.status(404).json({ error: "Certificate not issued for this enrollment" });

    const [course] = await db.select().from(trainingCoursesTable).where(eq(trainingCoursesTable.id, enrollment.courseId)).limit(1);

    res.json({
      certificateCode: enrollment.certificateCode,
      issuedAt: enrollment.certificateIssuedAt,
      courseName: course?.title,
      volunteerId: enrollment.volunteerId,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
