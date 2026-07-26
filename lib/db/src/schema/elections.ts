/**
 * Election system tables — polling agents, result submissions, tally, disputes, incidents,
 * transparency, and command centre.
 *
 * NOTE: Basic tables (pollingStationsTable, pollingAgentsTable, electionsTable,
 * candidatesTable, resultSubmissionsTable, incidentsTable) live in geography.ts / config.ts.
 * This file adds the EXTENDED election workflow tables.
 */
import {
  pgTable,
  text,
  uuid,
  integer,
  boolean,
  timestamp,
  doublePrecision,
  jsonb,
} from "drizzle-orm/pg-core";

import { electionsTable, candidatesTable, resultSubmissionsTable } from "./config";
import { pollingStationsTable, pollingCentresTable, wardsTable, constituenciesTable, countiesTable } from "./geography";
import { usersTable } from "./core";

// ── Agent Training Courses ────────────────────────────────────────────────────
export const agentTrainingCoursesTable = pgTable("agent_training_courses", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  description: text("description"),
  durationMinutes: integer("duration_minutes").notNull().default(60),
  passingScore: integer("passing_score").notNull().default(70), // percentage
  isRequired: boolean("is_required").notNull().default(true),
  electionId: uuid("election_id").references(() => electionsTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type AgentTrainingCourse = typeof agentTrainingCoursesTable.$inferSelect;

// ── Agent Training Enrollments ────────────────────────────────────────────────
export const agentTrainingEnrollmentsTable = pgTable("agent_training_enrollments", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id").notNull(), // references pollingAgentsTable
  courseId: uuid("course_id").notNull().references(() => agentTrainingCoursesTable.id),
  status: text("status").notNull().default("enrolled"), // enrolled|in_progress|passed|failed
  score: integer("score"),
  attempts: integer("attempts").notNull().default(0),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  certificateUrl: text("certificate_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
export type AgentTrainingEnrollment = typeof agentTrainingEnrollmentsTable.$inferSelect;

// ── Agent Quiz Questions ───────────────────────────────────────────────────────
export const agentQuizQuestionsTable = pgTable("agent_quiz_questions", {
  id: uuid("id").primaryKey().defaultRandom(),
  courseId: uuid("course_id").notNull().references(() => agentTrainingCoursesTable.id),
  question: text("question").notNull(),
  options: jsonb("options").notNull().$type<string[]>(), // array of answer strings
  correctIndex: integer("correct_index").notNull(), // 0-based index of correct option
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type AgentQuizQuestion = typeof agentQuizQuestionsTable.$inferSelect;

// ── Agent Quiz Attempts ───────────────────────────────────────────────────────
export const agentQuizAttemptsTable = pgTable("agent_quiz_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id").notNull(),
  courseId: uuid("course_id").notNull().references(() => agentTrainingCoursesTable.id),
  answers: jsonb("answers").notNull().$type<number[]>(), // selected indices per question
  score: integer("score").notNull(),
  passed: boolean("passed").notNull(),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
});
export type AgentQuizAttempt = typeof agentQuizAttemptsTable.$inferSelect;

// ── Agent Election-Day Attendance ─────────────────────────────────────────────
export const agentElectionDayTable = pgTable("agent_election_day", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id").notNull(),
  pollingStationId: uuid("polling_station_id").notNull().references(() => pollingStationsTable.id),
  electionId: uuid("election_id").notNull().references(() => electionsTable.id),
  arrivedAt: timestamp("arrived_at", { withTimezone: true }),
  leftAt: timestamp("left_at", { withTimezone: true }),
  attendanceStatus: text("attendance_status").notNull().default("expected"), // expected|present|absent|replaced
  notes: text("notes"),
  recordedBy: uuid("recorded_by").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
export type AgentElectionDay = typeof agentElectionDayTable.$inferSelect;

// ── Agent Allowances ──────────────────────────────────────────────────────────
export const agentAllowancesTable = pgTable("agent_allowances", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id").notNull(),
  electionId: uuid("election_id").notNull().references(() => electionsTable.id),
  amountKes: integer("amount_kes").notNull(),
  status: text("status").notNull().default("pending"), // pending|approved|paid|failed
  paymentMethod: text("payment_method"), // mpesa|bank|cash
  paymentRef: text("payment_ref"),
  approvedBy: uuid("approved_by").references(() => usersTable.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type AgentAllowance = typeof agentAllowancesTable.$inferSelect;

// ── Agent Replacements ────────────────────────────────────────────────────────
export const agentReplacementsTable = pgTable("agent_replacements", {
  id: uuid("id").primaryKey().defaultRandom(),
  originalAgentId: uuid("original_agent_id").notNull(),
  replacementAgentId: uuid("replacement_agent_id"),
  pollingStationId: uuid("polling_station_id").notNull().references(() => pollingStationsTable.id),
  electionId: uuid("election_id").notNull().references(() => electionsTable.id),
  reason: text("reason").notNull(),
  requestedBy: uuid("requested_by").references(() => usersTable.id),
  approvedBy: uuid("approved_by").references(() => usersTable.id),
  status: text("status").notNull().default("pending"), // pending|approved|rejected|completed
  effectiveAt: timestamp("effective_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
export type AgentReplacement = typeof agentReplacementsTable.$inferSelect;

// ── Agent Sync Status (supervisor tracking) ───────────────────────────────────
export const agentSyncStatusTable = pgTable("agent_sync_status", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id").notNull().unique(),
  deviceId: text("device_id"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  syncStatus: text("sync_status").notNull().default("unknown"), // synced|pending|offline|error
  pendingSubmissions: integer("pending_submissions").notNull().default(0),
  appVersion: text("app_version"),
  batteryLevel: integer("battery_level"),
  networkType: text("network_type"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
export type AgentSyncStatus = typeof agentSyncStatusTable.$inferSelect;

// ── Submission Candidate Votes ────────────────────────────────────────────────
export const submissionCandidateVotesTable = pgTable("submission_candidate_votes", {
  id: uuid("id").primaryKey().defaultRandom(),
  submissionId: uuid("submission_id").notNull().references(() => resultSubmissionsTable.id, { onDelete: "cascade" }),
  candidateId: uuid("candidate_id").references(() => candidatesTable.id),
  candidateName: text("candidate_name").notNull(), // denormalized for immutability
  partyAbbreviation: text("party_abbreviation"),
  voteCount: integer("vote_count").notNull().default(0),
  isVerified: boolean("is_verified").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type SubmissionCandidateVote = typeof submissionCandidateVotesTable.$inferSelect;

// ── Submission Form Images ────────────────────────────────────────────────────
export const submissionFormImagesTable = pgTable("submission_form_images", {
  id: uuid("id").primaryKey().defaultRandom(),
  submissionId: uuid("submission_id").notNull().references(() => resultSubmissionsTable.id, { onDelete: "cascade" }),
  imageType: text("image_type").notNull(), // form_page_1..4|station_notice|incident_evidence|video|other
  objectPath: text("object_path"),
  imageHash: text("image_hash"), // SHA-256 of file
  sizeBytes: integer("size_bytes"),
  mimeType: text("mime_type"),
  pageNumber: integer("page_number"),
  isRequired: boolean("is_required").notNull().default(false),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  deviceId: text("device_id"),
});
export type SubmissionFormImage = typeof submissionFormImagesTable.$inferSelect;

// ── Submission Verification Steps ────────────────────────────────────────────
// Immutable audit trail — one row per status transition
export const submissionVerificationStepsTable = pgTable("submission_verification_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  submissionId: uuid("submission_id").notNull().references(() => resultSubmissionsTable.id, { onDelete: "cascade" }),
  fromStatus: text("from_status").notNull(),
  toStatus: text("to_status").notNull(),
  reviewerId: uuid("reviewer_id").references(() => usersTable.id),
  action: text("action").notNull(), // approved|queried|escalated|rejected|corrected
  notes: text("notes"),
  queriedFields: text("queried_fields").array(), // list of field names with issues
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type SubmissionVerificationStep = typeof submissionVerificationStepsTable.$inferSelect;

// ── Submission Corrections ────────────────────────────────────────────────────
// Original value NEVER overwritten — always preserved here
export const submissionCorrectionsTable = pgTable("submission_corrections", {
  id: uuid("id").primaryKey().defaultRandom(),
  submissionId: uuid("submission_id").notNull().references(() => resultSubmissionsTable.id, { onDelete: "cascade" }),
  fieldName: text("field_name").notNull(),
  originalValue: text("original_value"),
  correctedValue: text("corrected_value"),
  correctedBy: uuid("corrected_by").references(() => usersTable.id),
  correctionReason: text("correction_reason").notNull(),
  evidenceUrl: text("evidence_url"),
  approvedBy: uuid("approved_by").references(() => usersTable.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type SubmissionCorrection = typeof submissionCorrectionsTable.$inferSelect;

// ── Submission OCR Suggestions ────────────────────────────────────────────────
// OCR suggestions — never auto-approved, always require human review
export const submissionOcrSuggestionsTable = pgTable("submission_ocr_suggestions", {
  id: uuid("id").primaryKey().defaultRandom(),
  submissionId: uuid("submission_id").notNull().references(() => resultSubmissionsTable.id, { onDelete: "cascade" }),
  fieldName: text("field_name").notNull(),
  suggestedValue: text("suggested_value").notNull(),
  confidence: doublePrecision("confidence"), // 0.0 - 1.0
  reviewedBy: uuid("reviewed_by").references(() => usersTable.id),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  accepted: boolean("accepted"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type SubmissionOcrSuggestion = typeof submissionOcrSuggestionsTable.$inferSelect;

// ── Tally Snapshots ────────────────────────────────────────────────────────────
// One row per (election, level, entity, candidate) snapshot
export const tallySnapshotsTable = pgTable("tally_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  electionId: uuid("election_id").notNull().references(() => electionsTable.id),
  level: text("level").notNull(), // station|centre|ward|constituency|county|national
  entityId: uuid("entity_id"), // null for national
  entityName: text("entity_name"),
  candidateId: uuid("candidate_id").references(() => candidatesTable.id),
  candidateName: text("candidate_name").notNull(),
  partyAbbreviation: text("party_abbreviation"),
  votes: integer("votes").notNull().default(0),
  validVotes: integer("valid_votes").notNull().default(0),
  registeredVoters: integer("registered_voters").notNull().default(0),
  totalStations: integer("total_stations").notNull().default(0),
  stationsReporting: integer("stations_reporting").notNull().default(0),
  stationsVerified: integer("stations_verified").notNull().default(0),
  stationsPending: integer("stations_pending").notNull().default(0),
  stationsDisputed: integer("stations_disputed").notNull().default(0),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
});
export type TallySnapshot = typeof tallySnapshotsTable.$inferSelect;

// ── Election Disputes ──────────────────────────────────────────────────────────
export const electionDisputesTable = pgTable("election_disputes", {
  id: uuid("id").primaryKey().defaultRandom(),
  electionId: uuid("election_id").notNull().references(() => electionsTable.id),
  pollingStationId: uuid("polling_station_id").references(() => pollingStationsTable.id),
  submissionId: uuid("submission_id").references(() => resultSubmissionsTable.id),
  disputeType: text("dispute_type").notNull(), // figure_discrepancy|duplicate_image|missing_signature|missing_page|unclear_form|ballot_overage|code_mismatch|other
  title: text("title").notNull(),
  description: text("description").notNull(),
  status: text("status").notNull().default("open"), // open|investigating|resolved|escalated|closed
  priority: text("priority").notNull().default("medium"), // low|medium|high|critical
  openedBy: uuid("opened_by").references(() => usersTable.id),
  assignedTo: uuid("assigned_to").references(() => usersTable.id),
  deadlineAt: timestamp("deadline_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolutionNotes: text("resolution_notes"),
  isAutoDetected: boolean("is_auto_detected").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
export type ElectionDispute = typeof electionDisputesTable.$inferSelect;

// ── Dispute Evidence ──────────────────────────────────────────────────────────
export const disputeEvidenceTable = pgTable("dispute_evidence", {
  id: uuid("id").primaryKey().defaultRandom(),
  disputeId: uuid("dispute_id").notNull().references(() => electionDisputesTable.id, { onDelete: "cascade" }),
  evidenceType: text("evidence_type").notNull(), // document|image|video|form_copy|affidavit|other
  objectPath: text("object_path"),
  hash: text("hash"),
  description: text("description"),
  uploadedBy: uuid("uploaded_by").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type DisputeEvidence = typeof disputeEvidenceTable.$inferSelect;

// ── Dispute Communications ────────────────────────────────────────────────────
export const disputeCommunicationsTable = pgTable("dispute_communications", {
  id: uuid("id").primaryKey().defaultRandom(),
  disputeId: uuid("dispute_id").notNull().references(() => electionDisputesTable.id, { onDelete: "cascade" }),
  authorId: uuid("author_id").references(() => usersTable.id),
  message: text("message").notNull(),
  isInternal: boolean("is_internal").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type DisputeCommunication = typeof disputeCommunicationsTable.$inferSelect;

// ── Transparency Publications ──────────────────────────────────────────────────
export const transparencyPublicationsTable = pgTable("transparency_publications", {
  id: uuid("id").primaryKey().defaultRandom(),
  electionId: uuid("election_id").notNull().references(() => electionsTable.id),
  pollingStationId: uuid("polling_station_id").references(() => pollingStationsTable.id),
  submissionId: uuid("submission_id").references(() => resultSubmissionsTable.id),
  legalApprovedBy: uuid("legal_approved_by").references(() => usersTable.id),
  legalApprovedAt: timestamp("legal_approved_at", { withTimezone: true }),
  commsApprovedBy: uuid("comms_approved_by").references(() => usersTable.id),
  commsApprovedAt: timestamp("comms_approved_at", { withTimezone: true }),
  publishedBy: uuid("published_by").references(() => usersTable.id),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  redactionNotes: text("redaction_notes"),
  isPublic: boolean("is_public").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type TransparencyPublication = typeof transparencyPublicationsTable.$inferSelect;

// ── Command Centre Tasks ──────────────────────────────────────────────────────
export const commandCentreTasksTable = pgTable("command_centre_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  electionId: uuid("election_id").references(() => electionsTable.id),
  title: text("title").notNull(),
  description: text("description"),
  assignedTo: uuid("assigned_to").references(() => usersTable.id),
  createdBy: uuid("created_by").notNull().references(() => usersTable.id),
  priority: text("priority").notNull().default("medium"), // low|medium|high|critical
  status: text("status").notNull().default("open"), // open|in_progress|completed|cancelled
  relatedStationId: uuid("related_station_id").references(() => pollingStationsTable.id),
  relatedDisputeId: uuid("related_dispute_id"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
export type CommandCentreTask = typeof commandCentreTasksTable.$inferSelect;

// ── Election Incident Reports (extended) ──────────────────────────────────────
// Full extended incident table for election day (16 category types, officer workflow)
export const electionIncidentReportsTable = pgTable("election_incident_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  electionId: uuid("election_id").notNull().references(() => electionsTable.id),
  pollingStationId: uuid("polling_station_id").references(() => pollingStationsTable.id),
  countyId: uuid("county_id").references(() => countiesTable.id),
  constituencyId: uuid("constituency_id").references(() => constituenciesTable.id),
  // 16 incident categories
  incidentType: text("incident_type").notNull(), // voter_intimidation|ballot_stuffing|agent_ejection|presiding_officer_misconduct|bribery|violence|equipment_failure|missing_ballot_papers|unauthorized_person|unlawful_campaigning|voter_impersonation|delay_in_opening|early_closure|counting_irregularity|tallying_dispute|other
  severity: text("severity").notNull().default("medium"), // low|medium|high|critical
  title: text("title").notNull(),
  description: text("description").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }),
  gpsLat: doublePrecision("gps_lat"),
  gpsLon: doublePrecision("gps_lon"),
  evidenceUrls: text("evidence_urls").array(),
  reportedBy: uuid("reported_by").references(() => usersTable.id),
  assignedOfficer: uuid("assigned_officer").references(() => usersTable.id),
  escalationLevel: integer("escalation_level").notNull().default(1), // 1=agent, 2=supervisor, 3=legal, 4=national
  status: text("status").notNull().default("open"), // open|assigned|investigating|resolved|escalated|legal_action
  resolution: text("resolution"),
  legalAction: text("legal_action"),
  communicationsNote: text("communications_note"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
export type ElectionIncidentReport = typeof electionIncidentReportsTable.$inferSelect;
