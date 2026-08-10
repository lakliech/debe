/**
 * Finance, Communications, Events (extended), Content Library, and Rapid Response tables.
 * Task #3 — Linda Mwananchi Campaign Management Platform
 */
import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  uuid,
  jsonb,
  numeric,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { countiesTable, constituenciesTable, wardsTable } from "./geography";
import { usersTable, tenantsTable } from "./core";
import { supportersTable } from "./config";
import { eventsTable } from "./config";

// ─────────────────────────────────────────────────────────────────────────────
//  M-PESA TRANSACTIONS
// ─────────────────────────────────────────────────────────────────────────────

export const mpesaTransactionsTable = pgTable("mpesa_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  merchantRequestId: text("merchant_request_id"),
  checkoutRequestId: text("checkout_request_id").unique(),
  phoneNumber: text("phone_number").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  accountReference: text("account_reference"),
  transactionDesc: text("transaction_desc"),
  status: text("status").notNull().default("pending"), // pending | completed | failed | cancelled | timeout
  resultCode: text("result_code"),
  resultDesc: text("result_desc"),
  mpesaReceiptNumber: text("mpesa_receipt_number"),
  transactionDate: text("transaction_date"),
  callbackPayload: jsonb("callback_payload"),
  initiatedAt: timestamp("initiated_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMpesaTransactionSchema = createInsertSchema(mpesaTransactionsTable).omit({ id: true, createdAt: true });
export type InsertMpesaTransaction = z.infer<typeof insertMpesaTransactionSchema>;
export type MpesaTransaction = typeof mpesaTransactionsTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
//  TENANT M-PESA CONFIGS (per-campaign Daraja credentials)
// ─────────────────────────────────────────────────────────────────────────────

export const tenantMpesaConfigsTable = pgTable("tenant_mpesa_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().unique().references(() => tenantsTable.id, { onDelete: "cascade" }),
  shortcode: text("shortcode").notNull(),
  consumerKey: text("consumer_key").notNull(),
  // consumerSecret and passkey are AES-256-GCM encrypted at rest
  // (encryptSecret/decryptSecret in artifacts/api-server/src/lib/mpesa.ts).
  consumerSecret: text("consumer_secret").notNull(),
  passkey: text("passkey").notNull(),
  environment: text("environment").notNull().default("sandbox"), // sandbox | production
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertTenantMpesaConfigSchema = createInsertSchema(tenantMpesaConfigsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTenantMpesaConfig = z.infer<typeof insertTenantMpesaConfigSchema>;
export type TenantMpesaConfig = typeof tenantMpesaConfigsTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
//  CONTRIBUTIONS (all channels)
// ─────────────────────────────────────────────────────────────────────────────

export const contributionsTable = pgTable("contributions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  referenceNumber: text("reference_number").notNull(), // unique per tenant — see table-level constraint below
  donorFullName: text("donor_full_name").notNull(),
  donorEmail: text("donor_email"),
  donorPhone: text("donor_phone"),
  donorIdNumber: text("donor_id_number"), // national ID / passport
  donorEntityType: text("donor_entity_type").notNull().default("individual"), // individual | corporate | group
  donorEntityName: text("donor_entity_name"), // company/group name if applicable

  // Amount and channel
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("KES"),
  channel: text("channel").notNull(), // mpesa | card | bank_transfer | mobile_money | cash | in_kind
  purpose: text("purpose").notNull().default("general"), // general | event | specific_initiative
  contributionType: text("contribution_type").notNull().default("one_off"), // one_off | recurring | in_kind
  ledger: text("ledger").notNull().default("candidate"), // candidate | party

  // M-Pesa linkage
  mpesaTransactionId: uuid("mpesa_transaction_id").references(() => mpesaTransactionsTable.id),
  mpesaReceiptNumber: text("mpesa_receipt_number"),

  // Bank / card
  bankName: text("bank_name"),
  bankBranchCode: text("bank_branch_code"),
  bankTransactionRef: text("bank_transaction_ref"),

  // Compliance
  sourceDeclaration: text("source_declaration"), // declared source of funds
  isPoliticallyExposed: boolean("is_politically_exposed").default(false),
  isForeignDonation: boolean("is_foreign_donation").default(false),
  complianceFlag: text("compliance_flag"), // none | suspect | duplicate | limit_exceeded | concentration
  verificationStatus: text("verification_status").notNull().default("pending"), // pending | verified | rejected
  verifiedBy: uuid("verified_by").references(() => usersTable.id),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  rejectionReason: text("rejection_reason"),

  // Receipt
  receiptSentAt: timestamp("receipt_sent_at", { withTimezone: true }),
  receiptEmail: text("receipt_email"),
  receiptPath: text("receipt_path"), // object storage path

  // Recurring
  recurringFrequency: text("recurring_frequency"), // monthly | weekly | quarterly
  recurringEndsAt: timestamp("recurring_ends_at", { withTimezone: true }),
  parentContributionId: uuid("parent_contribution_id"),

  // Audit
  recordedBy: uuid("recorded_by").references(() => usersTable.id),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  // NOTE: column order matches drizzle-kit's canonical introspection order —
  // declaring it (tenantId, referenceNumber) makes push want to recreate the
  // constraint on every run (truncate prompt). Same constraint either way.
  unique("contributions_tenant_ref_unique").on(t.referenceNumber, t.tenantId),
  index("contributions_donor_phone_idx").on(t.donorPhone),
  index("contributions_channel_idx").on(t.channel),
  index("contributions_compliance_flag_idx").on(t.complianceFlag),
]);

export const insertContributionSchema = createInsertSchema(contributionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertContribution = z.infer<typeof insertContributionSchema>;
export type Contribution = typeof contributionsTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
//  IN-KIND CONTRIBUTIONS
// ─────────────────────────────────────────────────────────────────────────────

export const inKindContributionsTable = pgTable("in_kind_contributions", {
  id: uuid("id").primaryKey().defaultRandom(),
  contributionId: uuid("contribution_id").notNull().references(() => contributionsTable.id, { onDelete: "cascade" }),
  itemDescription: text("item_description").notNull(),
  category: text("category").notNull(), // vehicle | equipment | services | food | venue | other
  quantity: integer("quantity").notNull().default(1),
  unit: text("unit"), // e.g. "units", "hours", "kg"
  estimatedValueKes: numeric("estimated_value_kes", { precision: 14, scale: 2 }),
  valuationMethod: text("valuation_method"), // market_rate | donor_declared | independent_assessment
  valuationNotes: text("valuation_notes"),
  valuedBy: uuid("valued_by").references(() => usersTable.id),
  valuedAt: timestamp("valued_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type InKindContribution = typeof inKindContributionsTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
//  DONOR ALERTS
// ─────────────────────────────────────────────────────────────────────────────

export const donorAlertsTable = pgTable("donor_alerts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  alertType: text("alert_type").notNull(), // duplicate | suspicious | concentration | limit_exceeded | foreign
  severity: text("severity").notNull().default("medium"), // low | medium | high | critical
  contributionId: uuid("contribution_id").references(() => contributionsTable.id),
  donorPhone: text("donor_phone"),
  donorEmail: text("donor_email"),
  description: text("description").notNull(),
  metadata: jsonb("metadata"), // extra context (e.g. list of related contribution IDs)
  status: text("status").notNull().default("open"), // open | reviewing | resolved | dismissed
  resolvedBy: uuid("resolved_by").references(() => usersTable.id),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolutionNotes: text("resolution_notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DonorAlert = typeof donorAlertsTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
//  BUDGET CATEGORIES & LINES
// ─────────────────────────────────────────────────────────────────────────────

export const budgetCategoriesTable = pgTable("budget_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  code: text("code").notNull(), // e.g. STAFF, EVENTS, MEDIA
  description: text("description"),
  ledger: text("ledger").notNull().default("candidate"), // candidate | party
  totalAllocatedKes: numeric("total_allocated_kes", { precision: 16, scale: 2 }).default("0"),
  createdBy: uuid("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type BudgetCategory = typeof budgetCategoriesTable.$inferSelect;

export const budgetLinesTable = pgTable("budget_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  categoryId: uuid("category_id").notNull().references(() => budgetCategoriesTable.id),
  title: text("title").notNull(),
  description: text("description"),
  allocatedAmountKes: numeric("allocated_amount_kes", { precision: 14, scale: 2 }).notNull(),
  spentAmountKes: numeric("spent_amount_kes", { precision: 14, scale: 2 }).notNull().default("0"),
  countyId: uuid("county_id").references(() => countiesTable.id),
  fiscalPeriod: text("fiscal_period").notNull(), // e.g. "2027-Q1"
  status: text("status").notNull().default("active"), // active | frozen | exhausted | closed
  createdBy: uuid("created_by").references(() => usersTable.id),
  approvedBy: uuid("approved_by").references(() => usersTable.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type BudgetLine = typeof budgetLinesTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
//  EXPENDITURE REQUESTS (approval workflow)
// ─────────────────────────────────────────────────────────────────────────────

export const expenditureRequestsTable = pgTable("expenditure_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  referenceNumber: text("reference_number").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  budgetLineId: uuid("budget_line_id").references(() => budgetLinesTable.id),
  categoryId: uuid("category_id").notNull().references(() => budgetCategoriesTable.id),
  requestedAmountKes: numeric("requested_amount_kes", { precision: 14, scale: 2 }).notNull(),
  approvedAmountKes: numeric("approved_amount_kes", { precision: 14, scale: 2 }),
  ledger: text("ledger").notNull().default("candidate"),

  // Payee
  payeeName: text("payee_name").notNull(),
  payeeBank: text("payee_bank"),
  payeeAccountNumber: text("payee_account_number"),
  payeePhone: text("payee_phone"),

  // Approval chain (dual-approval: first approver + final approver)
  requestedBy: uuid("requested_by").notNull().references(() => usersTable.id),
  firstApproverId: uuid("first_approver_id").references(() => usersTable.id),
  firstApprovedAt: timestamp("first_approved_at", { withTimezone: true }),
  finalApproverId: uuid("final_approver_id").references(() => usersTable.id),
  finalApprovedAt: timestamp("final_approved_at", { withTimezone: true }),
  status: text("status").notNull().default("draft"), // draft | pending_first | pending_final | approved | rejected | paid | cancelled
  rejectionReason: text("rejection_reason"),

  // Supporting docs (object storage paths)
  supportingDocPaths: jsonb("supporting_doc_paths").$type<string[]>().default([]),
  paymentVoucherId: uuid("payment_voucher_id"),

  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  unique("expenditure_requests_tenant_ref_unique").on(t.referenceNumber, t.tenantId),
]);

export type ExpenditureRequest = typeof expenditureRequestsTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
//  PAYMENT VOUCHERS (immutable once issued)
// ─────────────────────────────────────────────────────────────────────────────

export const paymentVouchersTable = pgTable("payment_vouchers", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  voucherNumber: text("voucher_number").notNull(),
  expenditureRequestId: uuid("expenditure_request_id").notNull().references(() => expenditureRequestsTable.id),
  paymentDate: timestamp("payment_date", { withTimezone: true }),
  paymentMethod: text("payment_method").notNull(), // bank_transfer | cheque | mpesa | cash
  amountKes: numeric("amount_kes", { precision: 14, scale: 2 }).notNull(),
  payeeSnapshot: jsonb("payee_snapshot").notNull(), // immutable copy of payee details
  ledger: text("ledger").notNull().default("candidate"),
  issuedBy: uuid("issued_by").notNull().references(() => usersTable.id),
  voucherPath: text("voucher_path"), // generated PDF object storage path
  // Immutable audit — once created no fields updated; append-only
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("payment_vouchers_tenant_voucher_unique").on(t.voucherNumber, t.tenantId),
]);

export type PaymentVoucher = typeof paymentVouchersTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
//  FINANCE AUDIT LOG (immutable)
// ─────────────────────────────────────────────────────────────────────────────

export const financeAuditLogTable = pgTable("finance_audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(), // contribution | expenditure | voucher | budget_line | alert
  entityId: uuid("entity_id").notNull(),
  action: text("action").notNull(), // created | updated | approved | rejected | paid | flagged | verified
  actorId: uuid("actor_id").references(() => usersTable.id),
  actorEmail: text("actor_email"),
  changeSnapshot: jsonb("change_snapshot"), // before/after diff
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FinanceAuditLog = typeof financeAuditLogTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
//  COMMUNICATION TEMPLATES
// ─────────────────────────────────────────────────────────────────────────────

export const messageTemplatesTable = pgTable("message_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  channel: text("channel").notNull(), // sms | email | whatsapp
  category: text("category").notNull(), // fundraising | mobilisation | event_invite | training | general | emergency
  subjectEn: text("subject_en"), // email subject
  subjectSw: text("subject_sw"),
  bodyEn: text("body_en").notNull(),
  bodySw: text("body_sw").notNull(),
  bodyLocal: text("body_local"), // third language (e.g. Gikuyu, Dholuo, etc.)
  localLanguageName: text("local_language_name"),
  variables: jsonb("variables").$type<string[]>().default([]), // e.g. ["{{name}}", "{{county}}"]
  maxLengthSms: integer("max_length_sms"), // for SMS templates
  status: text("status").notNull().default("draft"), // draft | pending_approval | approved | suspended
  approvedBy: uuid("approved_by").references(() => usersTable.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  suspendedBy: uuid("suspended_by").references(() => usersTable.id),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  suspensionReason: text("suspension_reason"),
  createdBy: uuid("created_by").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type MessageTemplate = typeof messageTemplatesTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
//  AUDIENCE SEGMENTS
// ─────────────────────────────────────────────────────────────────────────────

export const audienceSegmentsTable = pgTable("audience_segments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  // Filter criteria — stored as structured JSON so the query engine can rebuild the segment dynamically
  filters: jsonb("filters").notNull().$type<{
    consentChannels?: string[]; // sms | email | whatsapp — only audiences with consent
    countyIds?: string[];
    constituencyIds?: string[];
    wardIds?: string[];
    policyInterests?: string[];
    volunteerStatuses?: string[];
    supporterStatuses?: string[];
  }>(),
  estimatedReach: integer("estimated_reach").default(0),
  createdBy: uuid("created_by").notNull().references(() => usersTable.id),
  lastBuiltAt: timestamp("last_built_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type AudienceSegment = typeof audienceSegmentsTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
//  SCHEDULED MESSAGES
// ─────────────────────────────────────────────────────────────────────────────

export const scheduledMessagesTable = pgTable("scheduled_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  templateId: uuid("template_id").notNull().references(() => messageTemplatesTable.id),
  segmentId: uuid("segment_id").notNull().references(() => audienceSegmentsTable.id),
  languageCode: text("language_code").notNull().default("en"), // en | sw | local
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  status: text("status").notNull().default("pending"), // pending | approved | sending | sent | cancelled | failed
  approvedBy: uuid("approved_by").references(() => usersTable.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  emergencySuspendedBy: uuid("emergency_suspended_by").references(() => usersTable.id),
  emergencySuspendedAt: timestamp("emergency_suspended_at", { withTimezone: true }),
  estimatedRecipients: integer("estimated_recipients").default(0),
  actualRecipients: integer("actual_recipients"),
  deliveredCount: integer("delivered_count").default(0),
  failedCount: integer("failed_count").default(0),
  optOutCount: integer("opt_out_count").default(0),
  createdBy: uuid("created_by").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type ScheduledMessage = typeof scheduledMessagesTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
//  MESSAGE DELIVERIES (tracking stubs)
// ─────────────────────────────────────────────────────────────────────────────

export const messageDeliveriesTable = pgTable("message_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  scheduledMessageId: uuid("scheduled_message_id").notNull().references(() => scheduledMessagesTable.id, { onDelete: "cascade" }),
  recipientPhone: text("recipient_phone"),
  recipientEmail: text("recipient_email"),
  channel: text("channel").notNull(),
  status: text("status").notNull().default("pending"), // pending | sent | delivered | failed | opted_out
  providerMessageId: text("provider_message_id"), // external provider reference
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("message_deliveries_scheduled_message_idx").on(t.scheduledMessageId),
]);

export type MessageDelivery = typeof messageDeliveriesTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
//  SPOKESPERSON DIRECTORY
// ─────────────────────────────────────────────────────────────────────────────

export const spokespersonDirectoryTable = pgTable("spokesperson_directory", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => usersTable.id),
  fullName: text("full_name").notNull(),
  title: text("title").notNull(),
  portfolios: jsonb("portfolios").$type<string[]>().default([]), // areas they speak on
  phone: text("phone"),
  email: text("email"),
  photoPath: text("photo_path"), // object storage path
  isActive: boolean("is_active").notNull().default(true),
  priority: integer("priority").default(10), // ordering
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Spokesperson = typeof spokespersonDirectoryTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
//  PRESS STATEMENTS (version-controlled)
// ─────────────────────────────────────────────────────────────────────────────

export const statementsTable = pgTable("statements", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  category: text("category").notNull(), // press_release | speech | op_ed | social_post | correction | retraction
  status: text("status").notNull().default("draft"), // draft | review | approved | published | retracted
  publishedAt: timestamp("published_at", { withTimezone: true }),
  retractedAt: timestamp("retracted_at", { withTimezone: true }),
  retractionReason: text("retraction_reason"),
  correctionOf: uuid("correction_of").references((): any => statementsTable.id),
  spokespersonId: uuid("spokesperson_id").references(() => spokespersonDirectoryTable.id),
  createdBy: uuid("created_by").notNull().references(() => usersTable.id),
  approvedBy: uuid("approved_by").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Statement = typeof statementsTable.$inferSelect;

export const statementVersionsTable = pgTable("statement_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  statementId: uuid("statement_id").notNull().references(() => statementsTable.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  bodyEn: text("body_en").notNull(),
  bodySw: text("body_sw"),
  bodyLocal: text("body_local"),
  localLanguageName: text("local_language_name"),
  changeNote: text("change_note"),
  authorId: uuid("author_id").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type StatementVersion = typeof statementVersionsTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
//  CONTENT LIBRARY
// ─────────────────────────────────────────────────────────────────────────────

export const contentAssetsTable = pgTable("content_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  category: text("category").notNull(), // logo | brand_guidelines | photo | poster | video | template | script | speech | manifesto_summary | translation | other
  tags: jsonb("tags").$type<string[]>().default([]),
  objectPath: text("object_path").notNull(), // GCS path
  mimeType: text("mime_type"),
  fileSizeBytes: integer("file_size_bytes"),

  // Metadata
  owner: uuid("owner").notNull().references(() => usersTable.id),
  countyId: uuid("county_id").references(() => countiesTable.id), // null = national asset
  language: text("language"), // en | sw | local
  publishingRights: text("publishing_rights").notNull().default("internal"), // internal | restricted | public
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  approvalStatus: text("approval_status").notNull().default("pending"), // pending | approved | rejected
  approvedBy: uuid("approved_by").references(() => usersTable.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),

  currentVersion: integer("current_version").notNull().default(1),
  downloadCount: integer("download_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type ContentAsset = typeof contentAssetsTable.$inferSelect;

export const assetVersionsTable = pgTable("asset_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  assetId: uuid("asset_id").notNull().references(() => contentAssetsTable.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  objectPath: text("object_path").notNull(),
  changeNote: text("change_note"),
  uploadedBy: uuid("uploaded_by").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AssetVersion = typeof assetVersionsTable.$inferSelect;

export const downloadRecordsTable = pgTable("download_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  assetId: uuid("asset_id").notNull().references(() => contentAssetsTable.id, { onDelete: "cascade" }),
  downloadedBy: uuid("downloaded_by").references(() => usersTable.id),
  downloadedByEmail: text("downloaded_by_email"),
  ipAddress: text("ip_address"),
  purpose: text("purpose"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("download_records_asset_idx").on(t.assetId),
]);

export type DownloadRecord = typeof downloadRecordsTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
//  EVENT REGISTRATIONS & CHECK-INS
// ─────────────────────────────────────────────────────────────────────────────

export const eventRegistrationsTable = pgTable("event_registrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id").notNull().references(() => eventsTable.id, { onDelete: "cascade" }),
  fullName: text("full_name").notNull(),
  phone: text("phone").notNull(),
  email: text("email"),
  idNumber: text("id_number"), // for security events
  organization: text("organization"),
  registrationType: text("registration_type").notNull().default("general"), // general | media | vip | speaker | security
  qrCode: text("qr_code").notNull().unique(), // generated UUID-based QR payload
  checkedIn: boolean("checked_in").notNull().default(false),
  checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
  checkedInBy: uuid("checked_in_by").references(() => usersTable.id),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("event_registrations_event_idx").on(t.eventId),
  index("event_registrations_qr_idx").on(t.qrCode),
]);

export type EventRegistration = typeof eventRegistrationsTable.$inferSelect;

export const eventIncidentsTable = pgTable("event_incidents", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id").notNull().references(() => eventsTable.id),
  incidentType: text("incident_type").notNull(), // security | medical | logistics | media | other
  severity: text("severity").notNull().default("low"), // low | medium | high | critical
  description: text("description").notNull(),
  location: text("location"),
  reportedBy: uuid("reported_by").notNull().references(() => usersTable.id),
  resolvedBy: uuid("resolved_by").references(() => usersTable.id),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolution: text("resolution"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type EventIncident = typeof eventIncidentsTable.$inferSelect;

export const eventReconciliationsTable = pgTable("event_reconciliations", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id").notNull().unique().references(() => eventsTable.id),
  actualAttendance: integer("actual_attendance"),
  actualCostKes: numeric("actual_cost_kes", { precision: 14, scale: 2 }),
  budgetedCostKes: numeric("budgeted_cost_kes", { precision: 14, scale: 2 }),
  donationsCollectedKes: numeric("donations_collected_kes", { precision: 14, scale: 2 }).default("0"),
  volunteerHours: integer("volunteer_hours").default(0),
  lessonsLearned: text("lessons_learned"),
  mediaImpactNotes: text("media_impact_notes"),
  incidentSummary: text("incident_summary"),
  overallRating: integer("overall_rating"), // 1-5
  submittedBy: uuid("submitted_by").notNull().references(() => usersTable.id),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
});

export type EventReconciliation = typeof eventReconciliationsTable.$inferSelect;

export const eventSpeakersTable = pgTable("event_speakers", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id").notNull().references(() => eventsTable.id, { onDelete: "cascade" }),
  spokespersonId: uuid("spokesperson_id").references(() => spokespersonDirectoryTable.id),
  fullName: text("full_name").notNull(),
  title: text("title"),
  topicEn: text("topic_en"),
  topicSw: text("topic_sw"),
  allocatedMinutes: integer("allocated_minutes"),
  talkOrder: integer("talk_order"),
  confirmed: boolean("confirmed").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type EventSpeaker = typeof eventSpeakersTable.$inferSelect;

export const eventTransportTable = pgTable("event_transport", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id").notNull().references(() => eventsTable.id, { onDelete: "cascade" }),
  // This table is restricted — candidate movement data
  routeDescription: text("route_description"), // intentionally vague for DB; detail in notes
  vehicleCount: integer("vehicle_count"),
  securityBriefing: text("security_briefing"),
  accessRestrictedToRoles: jsonb("access_restricted_to_roles").$type<string[]>().default(["security-officer", "campaign-exec-director", "national-campaign-manager"]),
  coordinatorId: uuid("coordinator_id").references(() => usersTable.id),
  notes: text("notes"), // encrypted/restricted at app layer
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type EventTransport = typeof eventTransportTable.$inferSelect;

export const eventMediaAccreditationsTable = pgTable("event_media_accreditations", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id").notNull().references(() => eventsTable.id, { onDelete: "cascade" }),
  journalistName: text("journalist_name").notNull(),
  mediaHouse: text("media_house").notNull(),
  phone: text("phone").notNull(),
  email: text("email"),
  idNumber: text("id_number"),
  pressPassNumber: text("press_pass_number"),
  coverageType: text("coverage_type").notNull().default("print"), // print | tv | radio | online | photography
  status: text("status").notNull().default("pending"), // pending | approved | rejected
  approvedBy: uuid("approved_by").references(() => usersTable.id),
  qrCode: text("qr_code").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type EventMediaAccreditation = typeof eventMediaAccreditationsTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
//  RAPID RESPONSE / MISINFORMATION
// ─────────────────────────────────────────────────────────────────────────────

export const misinformationClaimsTable = pgTable("misinformation_claims", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  claimText: text("claim_text").notNull(),
  sourceUrl: text("source_url"),
  screenshotPath: text("screenshot_path"), // object storage path
  platform: text("platform"), // twitter | facebook | whatsapp | tiktok | mainstream_media | other
  urgency: text("urgency").notNull().default("medium"), // low | medium | high | critical
  status: text("status").notNull().default("intake"), // intake | assigned | fact_checking | legal_review | approved | published | archived
  assignedTo: uuid("assigned_to").references(() => usersTable.id),
  assignedAt: timestamp("assigned_at", { withTimezone: true }),
  legalReviewerId: uuid("legal_reviewer_id").references(() => usersTable.id),
  legalReviewedAt: timestamp("legal_reviewed_at", { withTimezone: true }),
  legalClearance: boolean("legal_clearance"),
  legalNotes: text("legal_notes"),
  approvedBy: uuid("approved_by").references(() => usersTable.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  intakeBy: uuid("intake_by").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type MisinformationClaim = typeof misinformationClaimsTable.$inferSelect;

export const claimFactChecksTable = pgTable("claim_fact_checks", {
  id: uuid("id").primaryKey().defaultRandom(),
  claimId: uuid("claim_id").notNull().references(() => misinformationClaimsTable.id, { onDelete: "cascade" }),
  factCheckerId: uuid("fact_checker_id").notNull().references(() => usersTable.id),
  verdict: text("verdict"), // true | false | partially_true | misleading | unverifiable
  evidenceSummary: text("evidence_summary"),
  sourcesUsed: jsonb("sources_used").$type<string[]>().default([]), // URLs of evidence
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ClaimFactCheck = typeof claimFactChecksTable.$inferSelect;

export const claimCorrectionsTable = pgTable("claim_corrections", {
  id: uuid("id").primaryKey().defaultRandom(),
  claimId: uuid("claim_id").notNull().references(() => misinformationClaimsTable.id, { onDelete: "cascade" }),
  correctionBodyEn: text("correction_body_en").notNull(),
  correctionBodySw: text("correction_body_sw"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  publishedBy: uuid("published_by").notNull().references(() => usersTable.id),
  distributionChannels: jsonb("distribution_channels").$type<string[]>().default([]), // website | sms | social
  distributionNotes: text("distribution_notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ClaimCorrection = typeof claimCorrectionsTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
//  SUPPORT TICKETS (two-way WhatsApp inbox)
// ─────────────────────────────────────────────────────────────────────────────

export const supportTicketsTable = pgTable("support_tickets", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  supporterId: uuid("supporter_id").references(() => supportersTable.id, { onDelete: "set null" }),
  channel: text("channel").notNull().default("whatsapp"),
  /** E.164 phone the conversation is with — denormalised so tickets survive supporter deletion. */
  waPhone: text("wa_phone").notNull(),
  contactName: text("contact_name"),
  category: text("category").notNull().default("supporter"), // supporter | agent
  subject: text("subject"),
  status: text("status").notNull().default("open"), // open | pending | resolved
  assignedTo: uuid("assigned_to").references(() => usersTable.id),
  unreadCount: integer("unread_count").notNull().default(0),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type SupportTicket = typeof supportTicketsTable.$inferSelect;

export const supportTicketMessagesTable = pgTable("support_ticket_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketId: uuid("ticket_id").notNull().references(() => supportTicketsTable.id, { onDelete: "cascade" }),
  direction: text("direction").notNull(), // inbound | outbound
  body: text("body").notNull(),
  senderName: text("sender_name"),
  waMessageId: text("wa_message_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SupportTicketMessage = typeof supportTicketMessagesTable.$inferSelect;
