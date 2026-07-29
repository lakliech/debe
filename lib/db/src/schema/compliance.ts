/**
 * Compliance & Data Protection Schema.
 * Note: dataSubjectRequestsTable lives in config.ts.
 */
import { pgTable, uuid, text, boolean, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { tenantsTable } from "./core";

// ── Data Processing Records (Article 30 GDPR) ─────────────────────────────
export const dataProcessingRecordsTable = pgTable("data_processing_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  processName: text("process_name").notNull(),
  purpose: text("purpose").notNull(),
  legalBasis: text("legal_basis").notNull(),
  dataCategories: text("data_categories").array(),
  dataSubjectCategories: text("data_subject_categories").array(),
  recipients: text("recipients").array(),
  retentionPeriodDays: integer("retention_period_days"),
  crossBorderTransfer: boolean("cross_border_transfer").default(false),
  safeguards: text("safeguards"),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
export type DataProcessingRecord = typeof dataProcessingRecordsTable.$inferSelect;

// ── DPIA Register ──────────────────────────────────────────────────────────
export const dpiaRegisterTable = pgTable("dpia_register", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull(),
  processId: uuid("process_id"),
  riskLevel: text("risk_level").notNull().default("medium"),
  riskDescription: text("risk_description"),
  mitigationMeasures: text("mitigation_measures"),
  status: text("status").notNull().default("draft"),
  reviewedBy: uuid("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  nextReviewAt: timestamp("next_review_at", { withTimezone: true }),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
export type DpiaRegister = typeof dpiaRegisterTable.$inferSelect;

// ── Vendor Register ────────────────────────────────────────────────────────
export const vendorRegisterTable = pgTable("vendor_register", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  vendorName: text("vendor_name").notNull(),
  vendorType: text("vendor_type").notNull(),
  servicesProvided: text("services_provided").notNull(),
  dataShared: text("data_shared").array(),
  contractUrl: text("contract_url"),
  dpaSignedAt: timestamp("dpa_signed_at", { withTimezone: true }),
  dpaExpiresAt: timestamp("dpa_expires_at", { withTimezone: true }),
  countryOfOperation: text("country_of_operation"),
  adequacyDecision: boolean("adequacy_decision").default(true),
  transferMechanism: text("transfer_mechanism"),
  riskRating: text("risk_rating").default("low"),
  reviewedBy: uuid("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
export type VendorRegister = typeof vendorRegisterTable.$inferSelect;

// ── Data Breach Register ───────────────────────────────────────────────────
export const dataBreachRegisterTable = pgTable("data_breach_register", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull(),
  discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull(),
  reportedAt: timestamp("reported_at", { withTimezone: true }),
  containedAt: timestamp("contained_at", { withTimezone: true }),
  dataCategories: text("data_categories").array(),
  estimatedRecordsAffected: integer("estimated_records_affected"),
  severity: text("severity").notNull().default("low"),
  status: text("status").notNull().default("open"),
  rootCause: text("root_cause"),
  remedialActions: text("remedial_actions"),
  notifiedDpa: boolean("notified_dpa").default(false),
  notifiedSubjects: boolean("notified_subjects").default(false),
  reportedBy: uuid("reported_by"),
  assignedTo: uuid("assigned_to"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
export type DataBreachRegister = typeof dataBreachRegisterTable.$inferSelect;

// ── Consent Audit Trail ────────────────────────────────────────────────────
export const consentAuditTable = pgTable("consent_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  subjectEmail: text("subject_email").notNull(),
  subjectName: text("subject_name"),
  consentType: text("consent_type").notNull(),
  action: text("action").notNull(),
  purpose: text("purpose"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  evidenceText: text("evidence_text"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type ConsentAudit = typeof consentAuditTable.$inferSelect;

// ── Data Retention Policies ────────────────────────────────────────────────
export const dataRetentionPoliciesTable = pgTable("data_retention_policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  dataCategory: text("data_category").notNull(),
  retentionDays: integer("retention_days").notNull(),
  legalBasis: text("legal_basis").notNull(),
  description: text("description"),
  autoDelete: boolean("auto_delete").notNull().default(false),
  lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }),
  reviewedBy: uuid("reviewed_by"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
export type DataRetentionPolicy = typeof dataRetentionPoliciesTable.$inferSelect;

// ── Export Audit Log ───────────────────────────────────────────────────────
export const exportAuditLogTable = pgTable("export_audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  exportedBy: uuid("exported_by"),
  reportType: text("report_type").notNull(),
  format: text("format").notNull().default("csv"),
  filters: jsonb("filters"),
  rowCount: integer("row_count"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  downloadedAt: timestamp("downloaded_at", { withTimezone: true }).notNull().defaultNow(),
});
export type ExportAuditLog = typeof exportAuditLogTable.$inferSelect;
