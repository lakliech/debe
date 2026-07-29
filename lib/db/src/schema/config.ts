import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  uuid,
  doublePrecision,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./core";

// ── System Configuration ──────────────────────────────────────────────────────
export const systemConfigTable = pgTable("system_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  value: text("value").notNull(),
  description: text("description"),
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  unique("system_config_tenant_key_unique").on(t.tenantId, t.key),
]);

export type SystemConfig = typeof systemConfigTable.$inferSelect;

// ── Campaign Branding ─────────────────────────────────────────────────────────
export const brandingTable = pgTable("branding", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  campaignName: text("campaign_name").notNull().default("Your Campaign"),
  candidateName: text("candidate_name").notNull().default("Your Candidate"),
  positionTitle: text("position_title").notNull().default("Your Position"),
  partyName: text("party_name").notNull().default("Your Party"),
  primaryColor: text("primary_color").notNull().default("209 88% 50%"),
  secondaryColor: text("secondary_color").notNull().default("0 0% 8%"),
  accentColor: text("accent_color").default("0 0% 8%"),
  logoUrl: text("logo_url"),
  faviconUrl: text("favicon_url"),
  tagline: text("tagline").notNull().default("Your Campaign Tagline"),
  electionYear: integer("election_year").notNull().default(2027),
  mpesaPaybill: text("mpesa_paybill").default(""),
  electionLevel: text("election_level").notNull().default("Presidential"),
  websiteUrl: text("website_url"),
  socialTwitter: text("social_twitter"),
  socialFacebook: text("social_facebook"),
  socialInstagram: text("social_instagram"),
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertBrandingSchema = createInsertSchema(brandingTable).omit({ id: true, updatedAt: true });
export type InsertBranding = z.infer<typeof insertBrandingSchema>;
export type Branding = typeof brandingTable.$inferSelect;

// ── Audit Logs ────────────────────────────────────────────────────────────────
export const auditLogsTable = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull(),
  userEmail: text("user_email").notNull(),
  userFullName: text("user_full_name"),
  action: text("action").notNull(),
  resource: text("resource").notNull(),
  resourceId: text("resource_id"),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAuditLogSchema = createInsertSchema(auditLogsTable).omit({ id: true, createdAt: true });
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogsTable.$inferSelect;

// ── Activity Feed ─────────────────────────────────────────────────────────────
export const activityFeedTable = pgTable("activity_feed", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  description: text("description").notNull(),
  userId: uuid("user_id").notNull(),
  userName: text("user_name").notNull(),
  resource: text("resource"),
  resourceId: text("resource_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertActivityFeedSchema = createInsertSchema(activityFeedTable).omit({ id: true, createdAt: true });
export type InsertActivityFeed = z.infer<typeof insertActivityFeedSchema>;
export type ActivityFeed = typeof activityFeedTable.$inferSelect;

// ── Volunteers ────────────────────────────────────────────────────────────────
export const volunteersTable = pgTable("volunteers", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  userId: uuid("user_id"),
  fullName: text("full_name").notNull(),
  phoneNumber: text("phone_number").notNull(),
  email: text("email"),
  countyId: uuid("county_id"),
  constituencyId: uuid("constituency_id"),
  wardId: uuid("ward_id"),
  pollingCentreId: uuid("polling_centre_id"),
  preferredRole: text("preferred_role"),
  skills: text("skills").array(),
  languages: text("languages").array(),
  availability: text("availability"),
  status: text("status").notNull().default("pending"),
  consentGiven: boolean("consent_given").notNull().default(false),
  consentDate: timestamp("consent_date", { withTimezone: true }),
  verifiedBy: uuid("verified_by"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Volunteer = typeof volunteersTable.$inferSelect;

// ── Supporters ────────────────────────────────────────────────────────────────
export const supportersTable = pgTable("supporters", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  fullName: text("full_name").notNull(),
  email: text("email"),
  phoneNumber: text("phone_number"),
  countyId: uuid("county_id"),
  constituencyId: uuid("constituency_id"),
  wardId: uuid("ward_id"),
  membershipStatus: text("membership_status").default("supporter"),
  consentMarketing: boolean("consent_marketing").default(false),
  consentSms: boolean("consent_sms").default(false),
  consentEmail: boolean("consent_email").default(false),
  optedOut: boolean("opted_out").default(false),
  optedOutAt: timestamp("opted_out_at", { withTimezone: true }),
  policyInterests: text("policy_interests").array(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Supporter = typeof supportersTable.$inferSelect;

// ── Polling Agents ────────────────────────────────────────────────────────────
export const pollingAgentsTable = pgTable("polling_agents", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  userId: uuid("user_id"),
  fullName: text("full_name").notNull(),
  phoneNumber: text("phone_number").notNull(),
  nationalId: text("national_id"),
  photoUrl: text("photo_url"),
  pollingStationId: uuid("polling_station_id"),
  isBackup: boolean("is_backup").notNull().default(false),
  accreditationStatus: text("accreditation_status").default("pending"),
  trainingStatus: text("training_status").default("pending"),
  codeOfConductAccepted: boolean("code_of_conduct_accepted").default(false),
  codeOfConductDate: timestamp("code_of_conduct_date", { withTimezone: true }),
  deploymentConfirmed: boolean("deployment_confirmed").default(false),
  allowancePaid: boolean("allowance_paid").default(false),
  status: text("status").notNull().default("registered"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type PollingAgent = typeof pollingAgentsTable.$inferSelect;

// ── Elections ─────────────────────────────────────────────────────────────────
export const electionsTable = pgTable("elections", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  year: integer("year").notNull(),
  electionDate: text("election_date"),
  status: text("status").notNull().default("upcoming"),
  isActive: boolean("is_active").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("elections_tenant_name_year_unique").on(t.tenantId, t.name, t.year),
]);

export type Election = typeof electionsTable.$inferSelect;

// ── Candidates ────────────────────────────────────────────────────────────────
export const candidatesTable = pgTable("candidates", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  electionId: uuid("election_id").references(() => electionsTable.id),
  fullName: text("full_name").notNull(),
  partyName: text("party_name"),
  partyAbbreviation: text("party_abbreviation"),
  isOurCandidate: boolean("is_our_candidate").notNull().default(false),
  displayOrder: integer("display_order").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Candidate = typeof candidatesTable.$inferSelect;

// ── Polling Station Submissions ───────────────────────────────────────────────
export const resultSubmissionsTable = pgTable("result_submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  pollingStationId: uuid("polling_station_id").notNull(),
  electionId: uuid("election_id").notNull(),
  agentId: uuid("agent_id").notNull(),
  status: text("status").notNull().default("draft"),
  registeredVoters: integer("registered_voters"),
  ballotsReceived: integer("ballots_received"),
  ballotsIssued: integer("ballots_issued"),
  unusedBallots: integer("unused_ballots"),
  spoiltBallots: integer("spoilt_ballots"),
  rejectedBallots: integer("rejected_ballots"),
  totalValidVotes: integer("total_valid_votes"),
  totalVotesCast: integer("total_votes_cast"),
  agentSigned: boolean("agent_signed"),
  agentReceivedCopy: boolean("agent_received_copy"),
  resultsDisplayed: boolean("results_displayed"),
  objectionRaised: boolean("objection_raised"),
  agentComments: text("agent_comments"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  offlineCapturedAt: timestamp("offline_captured_at", { withTimezone: true }),
  syncedAt: timestamp("synced_at", { withTimezone: true }),
  deviceId: text("device_id"),
  gpsLat: doublePrecision("gps_lat"),
  gpsLon: doublePrecision("gps_lon"),
  fileHashes: text("file_hashes").array(),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type ResultSubmission = typeof resultSubmissionsTable.$inferSelect;

// ── Incidents ─────────────────────────────────────────────────────────────────
export const incidentsTable = pgTable("incidents", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  category: text("category").notNull(),
  severity: text("severity").notNull().default("medium"),
  description: text("description").notNull(),
  pollingStationId: uuid("polling_station_id"),
  countyId: uuid("county_id"),
  reportedBy: uuid("reported_by").notNull(),
  assignedTo: uuid("assigned_to"),
  escalationLevel: integer("escalation_level").default(1),
  status: text("status").notNull().default("open"),
  resolution: text("resolution"),
  legalAction: text("legal_action"),
  communicationsAction: text("communications_action"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Incident = typeof incidentsTable.$inferSelect;

// ── Donations ─────────────────────────────────────────────────────────────────
export const donationsTable = pgTable("donations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  donorId: uuid("donor_id"),
  donorFullName: text("donor_full_name").notNull(),
  donorEmail: text("donor_email"),
  donorPhone: text("donor_phone"),
  amount: integer("amount").notNull(),
  currency: text("currency").notNull().default("KES"),
  paymentChannel: text("payment_channel").notNull(),
  transactionRef: text("transaction_ref").unique(),
  campaignPurpose: text("campaign_purpose"),
  contributionType: text("contribution_type").default("monetary"),
  verificationStatus: text("verification_status").default("pending"),
  complianceFlag: boolean("compliance_flag").default(false),
  refundStatus: text("refund_status"),
  receiptNumber: text("receipt_number").unique(),
  receiptSentAt: timestamp("receipt_sent_at", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Donation = typeof donationsTable.$inferSelect;

// ── Events ────────────────────────────────────────────────────────────────────
export const eventsTable = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  eventType: text("event_type").notNull().default("rally"),
  venue: text("venue"),
  countyId: uuid("county_id"),
  constituencyId: uuid("constituency_id"),
  wardId: uuid("ward_id"),
  eventDate: text("event_date"),
  startTime: text("start_time"),
  endTime: text("end_time"),
  expectedAttendance: integer("expected_attendance"),
  actualAttendance: integer("actual_attendance"),
  status: text("status").notNull().default("proposed"),
  budgetKes: integer("budget_kes"),
  organizedBy: uuid("organized_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Event = typeof eventsTable.$inferSelect;

// ── Data Subject Requests ─────────────────────────────────────────────────────
export const dataSubjectRequestsTable = pgTable("data_subject_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  requestType: text("request_type").notNull(),
  subjectEmail: text("subject_email"),
  subjectName: text("subject_name"),
  fullName: text("full_name"),
  phoneNumber: text("phone_number"),
  description: text("description"),
  resolutionNotes: text("resolution_notes"),
  subjectType: text("subject_type"),
  subjectId: uuid("subject_id"),
  status: text("status").notNull().default("pending"),
  assignedTo: uuid("assigned_to"),
  dueDate: text("due_date"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type DataSubjectRequest = typeof dataSubjectRequestsTable.$inferSelect;

// ── Communications ────────────────────────────────────────────────────────────
export const communicationsTable = pgTable("communications", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  channel: text("channel").notNull(),
  templateId: uuid("template_id"),
  audience: text("audience"),
  contentEn: text("content_en"),
  contentSw: text("content_sw"),
  status: text("status").notNull().default("draft"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  approvedBy: uuid("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  recipientCount: integer("recipient_count").default(0),
  deliveredCount: integer("delivered_count").default(0),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Communication = typeof communicationsTable.$inferSelect;

// ── Policy Submissions ────────────────────────────────────────────────────────
export const policySubmissionsTable = pgTable("policy_submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  title: text("title"),
  sector: text("sector"),
  sectorId: uuid("sector_id"),
  submissionType: text("submission_type").notNull().default("problem"),
  content: text("content").notNull(),
  countyId: uuid("county_id"),
  anonymousId: text("anonymous_id"),
  submitterName: text("submitter_name"),
  submitterEmail: text("submitter_email"),
  status: text("status").default("pending"),
  publicDisplay: boolean("public_display").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PolicySubmission = typeof policySubmissionsTable.$inferSelect;
