/**
 * Public portal, manifesto, volunteer tasks/badges/attendance,
 * training system, consent records, and news/FAQ content.
 */
import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  uuid,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { countiesTable, constituenciesTable, wardsTable } from "./geography";
import { usersTable } from "./core";
import { volunteersTable } from "./config";

// ── Manifesto Sectors (20 sectors) ───────────────────────────────────────────
export const manifestoSectorsTable = pgTable("manifesto_sectors", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  titleEn: text("title_en").notNull(),
  titleSw: text("title_sw").notNull(),
  descriptionEn: text("description_en"),
  descriptionSw: text("description_sw"),
  iconName: text("icon_name"),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertManifestoSectorSchema = createInsertSchema(manifestoSectorsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertManifestoSector = z.infer<typeof insertManifestoSectorSchema>;
export type ManifestoSector = typeof manifestoSectorsTable.$inferSelect;

// ── Manifesto Items (pledges/commitments per sector) ─────────────────────────
export const manifestoItemsTable = pgTable("manifesto_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  sectorId: uuid("sector_id").notNull().references(() => manifestoSectorsTable.id, { onDelete: "cascade" }),
  titleEn: text("title_en").notNull(),
  titleSw: text("title_sw").notNull(),
  bodyEn: text("body_en"),
  bodySw: text("body_sw"),
  priority: integer("priority").default(0),
  status: text("status").default("committed"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ManifestoItem = typeof manifestoItemsTable.$inferSelect;

// ── County Priorities ─────────────────────────────────────────────────────────
export const countyPrioritiesTable = pgTable("county_priorities", {
  id: uuid("id").primaryKey().defaultRandom(),
  countyId: uuid("county_id").notNull().references(() => countiesTable.id),
  sectorId: uuid("sector_id").references(() => manifestoSectorsTable.id),
  titleEn: text("title_en").notNull(),
  titleSw: text("title_sw").notNull(),
  bodyEn: text("body_en"),
  bodySw: text("body_sw"),
  priority: integer("priority").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CountyPriority = typeof countyPrioritiesTable.$inferSelect;

// ── News Articles / Speeches / Statements ────────────────────────────────────
export const newsArticlesTable = pgTable("news_articles", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  category: text("category").notNull().default("news"), // news | speech | statement | press-release
  titleEn: text("title_en").notNull(),
  titleSw: text("title_sw"),
  bodyEn: text("body_en"),
  bodySw: text("body_sw"),
  excerptEn: text("excerpt_en"),
  excerptSw: text("excerpt_sw"),
  imageUrl: text("image_url"),
  videoUrl: text("video_url"),
  authorId: uuid("author_id"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  status: text("status").notNull().default("draft"), // draft | published | archived
  countyId: uuid("county_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type NewsArticle = typeof newsArticlesTable.$inferSelect;

// ── FAQ Items ─────────────────────────────────────────────────────────────────
export const faqItemsTable = pgTable("faq_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  category: text("category").default("general"),
  questionEn: text("question_en").notNull(),
  questionSw: text("question_sw"),
  answerEn: text("answer_en").notNull(),
  answerSw: text("answer_sw"),
  displayOrder: integer("display_order").default(0),
  published: boolean("published").default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FaqItem = typeof faqItemsTable.$inferSelect;

// ── Fact Check Entries ────────────────────────────────────────────────────────
export const factCheckItemsTable = pgTable("fact_check_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  claimEn: text("claim_en").notNull(),
  claimSw: text("claim_sw"),
  verdictEn: text("verdict_en").notNull(),
  verdictSw: text("verdict_sw"),
  rating: text("rating").notNull().default("false"), // true | false | misleading | unverified
  sourceUrl: text("source_url"),
  checkedBy: uuid("checked_by"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FactCheckItem = typeof factCheckItemsTable.$inferSelect;

// ── Consent Records ───────────────────────────────────────────────────────────
export const consentRecordsTable = pgTable("consent_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  subjectType: text("subject_type").notNull(), // volunteer | supporter | user
  subjectId: uuid("subject_id").notNull(),
  consentType: text("consent_type").notNull(), // marketing | sms | email | data_processing | code_of_conduct
  granted: boolean("granted").notNull().default(false),
  grantedAt: timestamp("granted_at", { withTimezone: true }),
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  collectedBy: uuid("collected_by"),
  withdrawnBy: uuid("withdrawn_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ConsentRecord = typeof consentRecordsTable.$inferSelect;

// ── Training Courses ──────────────────────────────────────────────────────────
export const trainingCoursesTable = pgTable("training_courses", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  titleSw: text("title_sw"),
  description: text("description"),
  targetRoles: text("target_roles").array(),
  estimatedHours: integer("estimated_hours").default(1),
  mandatory: boolean("mandatory").default(false),
  passMark: integer("pass_mark").default(70),
  certificateTemplate: text("certificate_template"),
  status: text("status").notNull().default("draft"), // draft | published | archived
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type TrainingCourse = typeof trainingCoursesTable.$inferSelect;

// ── Training Modules ──────────────────────────────────────────────────────────
export const trainingModulesTable = pgTable("training_modules", {
  id: uuid("id").primaryKey().defaultRandom(),
  courseId: uuid("course_id").notNull().references(() => trainingCoursesTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  titleSw: text("title_sw"),
  contentType: text("content_type").notNull().default("text"), // text | video | document | quiz
  contentEn: text("content_en"),
  contentSw: text("content_sw"),
  videoUrl: text("video_url"),
  documentUrl: text("document_url"),
  displayOrder: integer("display_order").default(0),
  durationMinutes: integer("duration_minutes").default(15),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TrainingModule = typeof trainingModulesTable.$inferSelect;

// ── Training Quiz Questions ───────────────────────────────────────────────────
export const quizQuestionsTable = pgTable("quiz_questions", {
  id: uuid("id").primaryKey().defaultRandom(),
  moduleId: uuid("module_id").notNull().references(() => trainingModulesTable.id, { onDelete: "cascade" }),
  questionEn: text("question_en").notNull(),
  questionSw: text("question_sw"),
  options: jsonb("options").notNull(), // [{ id, textEn, textSw }]
  correctOptionId: text("correct_option_id").notNull(),
  explanationEn: text("explanation_en"),
  explanationSw: text("explanation_sw"),
  displayOrder: integer("display_order").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type QuizQuestion = typeof quizQuestionsTable.$inferSelect;

// ── Training Enrollments ──────────────────────────────────────────────────────
export const trainingEnrollmentsTable = pgTable("training_enrollments", {
  id: uuid("id").primaryKey().defaultRandom(),
  courseId: uuid("course_id").notNull().references(() => trainingCoursesTable.id),
  volunteerId: uuid("volunteer_id").references(() => volunteersTable.id),
  userId: uuid("user_id"),
  status: text("status").notNull().default("enrolled"), // enrolled | in_progress | completed | failed
  score: integer("score"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  certificateIssuedAt: timestamp("certificate_issued_at", { withTimezone: true }),
  certificateCode: text("certificate_code").unique(),
  enrolledBy: uuid("enrolled_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type TrainingEnrollment = typeof trainingEnrollmentsTable.$inferSelect;

// ── Training Module Progress ──────────────────────────────────────────────────
export const moduleProgressTable = pgTable("module_progress", {
  id: uuid("id").primaryKey().defaultRandom(),
  enrollmentId: uuid("enrollment_id").notNull().references(() => trainingEnrollmentsTable.id, { onDelete: "cascade" }),
  moduleId: uuid("module_id").notNull().references(() => trainingModulesTable.id),
  completed: boolean("completed").default(false),
  quizScore: integer("quiz_score"),
  quizPassed: boolean("quiz_passed"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ModuleProgress = typeof moduleProgressTable.$inferSelect;

// ── Volunteer Badge Definitions ───────────────────────────────────────────────
export const badgeDefinitionsTable = pgTable("badge_definitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  nameSw: text("name_sw"),
  description: text("description"),
  iconUrl: text("icon_url"),
  criteria: text("criteria"),
  level: text("level").default("bronze"), // bronze | silver | gold | platinum
  category: text("category").default("participation"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BadgeDefinition = typeof badgeDefinitionsTable.$inferSelect;

// ── Volunteer Badge Awards ────────────────────────────────────────────────────
export const badgeAwardsTable = pgTable("badge_awards", {
  id: uuid("id").primaryKey().defaultRandom(),
  volunteerId: uuid("volunteer_id").notNull().references(() => volunteersTable.id, { onDelete: "cascade" }),
  badgeId: uuid("badge_id").notNull().references(() => badgeDefinitionsTable.id),
  awardedBy: uuid("awarded_by"),
  awardedAt: timestamp("awarded_at", { withTimezone: true }).notNull().defaultNow(),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BadgeAward = typeof badgeAwardsTable.$inferSelect;

// ── Volunteer Tasks ───────────────────────────────────────────────────────────
export const volunteerTasksTable = pgTable("volunteer_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  description: text("description"),
  taskType: text("task_type").default("fieldwork"), // fieldwork | digital | logistics | outreach
  countyId: uuid("county_id"),
  constituencyId: uuid("constituency_id"),
  wardId: uuid("ward_id"),
  dueDate: text("due_date"),
  estimatedHours: integer("estimated_hours"),
  maxAssignees: integer("max_assignees").default(1),
  status: text("status").notNull().default("open"), // open | in_progress | completed | cancelled
  createdBy: uuid("created_by").notNull(),
  supervisorId: uuid("supervisor_id"),
  priority: text("priority").default("normal"), // low | normal | high | urgent
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type VolunteerTask = typeof volunteerTasksTable.$inferSelect;

// ── Volunteer Task Assignments ────────────────────────────────────────────────
export const taskAssignmentsTable = pgTable("task_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").notNull().references(() => volunteerTasksTable.id, { onDelete: "cascade" }),
  volunteerId: uuid("volunteer_id").notNull().references(() => volunteersTable.id),
  assignedBy: uuid("assigned_by").notNull(),
  approvedBy: uuid("approved_by"),
  status: text("status").notNull().default("pending"), // pending | approved | in_progress | completed | declined
  hoursLogged: integer("hours_logged").default(0),
  notes: text("notes"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type TaskAssignment = typeof taskAssignmentsTable.$inferSelect;

// ── Volunteer Attendance ──────────────────────────────────────────────────────
export const volunteerAttendanceTable = pgTable("volunteer_attendance", {
  id: uuid("id").primaryKey().defaultRandom(),
  volunteerId: uuid("volunteer_id").notNull().references(() => volunteersTable.id),
  activityType: text("activity_type").notNull(), // training | rally | meetup | canvassing | polling_duty
  activityId: uuid("activity_id"),
  activityName: text("activity_name"),
  checkInAt: timestamp("check_in_at", { withTimezone: true }).notNull().defaultNow(),
  checkOutAt: timestamp("check_out_at", { withTimezone: true }),
  markedBy: uuid("marked_by"),
  latitude: text("latitude"),
  longitude: text("longitude"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type VolunteerAttendance = typeof volunteerAttendanceTable.$inferSelect;

// ── Supporter Access Logs (for DPO) ──────────────────────────────────────────
export const supporterAccessLogsTable = pgTable("supporter_access_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  supporterId: uuid("supporter_id").notNull(),
  accessedBy: uuid("accessed_by").notNull(),
  accessedByEmail: text("accessed_by_email"),
  action: text("action").notNull(), // view | export | edit | delete
  reason: text("reason"),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SupporterAccessLog = typeof supporterAccessLogsTable.$inferSelect;
