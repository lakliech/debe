import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  uuid,
  unique,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { countiesTable, constituenciesTable, wardsTable } from "./geography";

// ── Tenants ───────────────────────────────────────────────────────────────────
// One row per campaign deployment. Membership is owned by the app (user_roles),
// NOT by the identity provider. clerk_org_id is a legacy reference to a Clerk
// Organisation from when membership lived there — nullable and unused for
// access control; kept only so historical rows and external references survive.
export const tenantsTable = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkOrgId: text("clerk_org_id").unique(),
  name: text("name").notNull(),
  /** URL-safe identifier used in subdomains / public links */
  slug: text("slug").notNull().unique(),
  /** Billing tier — free | pro | enterprise */
  plan: text("plan").notNull().default("free"),
  /**
   * When set and in the future, the tenant retains `plan` access regardless of
   * subscription status. Used for trials and manual platform-admin grants.
   */
  planOverrideUntil: timestamp("plan_override_until", { withTimezone: true }),
  /** True once this tenant has consumed its one-time trial. */
  trialUsed: boolean("trial_used").notNull().default(false),
  /** Stripe customer handle — created lazily on first checkout. */
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  /** active | trialing | past_due | canceled | incomplete | null */
  stripeSubscriptionStatus: text("stripe_subscription_status"),
  /** Billing contact — may differ from the campaign admin's login email. */
  billingEmail: text("billing_email"),
  /**
   * Lifecycle state machine:
   *   active | suspended | deletion_scheduled | purged
   * `isSuspended` is kept in sync for backward compatibility with existing
   * middleware that reads it directly.
   */
  lifecycleState: text("lifecycle_state").notNull().default("active"),
  /** When set, the purge cron deletes this tenant after this timestamp. */
  scheduledDeletionAt: timestamp("scheduled_deletion_at", { withTimezone: true }),
  isSuspended: boolean("is_suspended").notNull().default(false),
  /**
   * Optional fully-qualified custom domain (e.g. vote.amina.ke).
   * When set, the subdomain middleware matches inbound requests by this hostname
   * in addition to the default <slug>.ushindi.app subdomain.
   */
  customDomain: text("custom_domain").unique(),
  /**
   * Meta WhatsApp Business phone_number_id for this campaign's WhatsApp
   * number. Routes inbound webhook events (tickets, delivery callbacks) to
   * the owning tenant. Null = campaign has no WhatsApp number connected.
   * UNIQUE: this id is the tenant trust boundary for signed webhook traffic —
   * two campaigns must never claim the same Meta number.
   */
  whatsappPhoneNumberId: text("whatsapp_phone_number_id").unique(),
  /**
   * TLS certificate status for the custom domain.
   * null    → no domain set or provisioning never triggered
   * pending → HTTPS check in progress
   * active  → HTTPS/TLS confirmed working
   * error   → last check failed (see tlsCertError)
   */
  tlsStatus: text("tls_status"),
  /** Human-readable error from the last failed TLS check. */
  tlsCertError: text("tls_cert_error"),
  /** Timestamp when TLS was last confirmed active. */
  tlsProvisionedAt: timestamp("tls_provisioned_at", { withTimezone: true }),
  /**
   * Campaign scope — the seat this campaign contests:
   *   presidential | gubernatorial | senator | women_rep | mp | mca
   * Exactly one geography FK is stored, at the level the seat requires
   * (county seats → scopeCountyId, mp → scopeConstituencyId, mca → scopeWardId,
   * presidential → none). The tenants_scope_valid CHECK constraint enforces
   * the seat/geography pairing; api-server/src/lib/campaignScope.ts enforces
   * it at the API layer. Nullable only so pre-scope campaigns can exist until
   * they define their scope.
   */
  seatType: text("seat_type"),
  scopeCountyId: uuid("scope_county_id").references(() => countiesTable.id),
  scopeConstituencyId: uuid("scope_constituency_id").references(() => constituenciesTable.id),
  scopeWardId: uuid("scope_ward_id").references(() => wardsTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  // Seat → geography pairing, mirroring api-server/src/lib/campaignScope.ts.
  // Applied out-of-band as tenants_scope_valid (see lib/db/ddl/). seat_type
  // NULL is allowed only for campaigns created before scope existed — they
  // define it in Settings; all creation routes now require it at the API.
  check(
    "tenants_scope_valid",
    sql`seat_type IS NULL OR (
      (seat_type = 'presidential' AND scope_county_id IS NULL AND scope_constituency_id IS NULL AND scope_ward_id IS NULL) OR
      (seat_type IN ('gubernatorial', 'senator', 'women_rep') AND scope_county_id IS NOT NULL AND scope_constituency_id IS NULL AND scope_ward_id IS NULL) OR
      (seat_type = 'mp' AND scope_county_id IS NULL AND scope_constituency_id IS NOT NULL AND scope_ward_id IS NULL) OR
      (seat_type = 'mca' AND scope_county_id IS NULL AND scope_constituency_id IS NULL AND scope_ward_id IS NOT NULL)
    )`,
  ),
]);

export const insertTenantSchema = createInsertSchema(tenantsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTenant = z.infer<typeof insertTenantSchema>;
export type Tenant = typeof tenantsTable.$inferSelect;

// ── Roles ────────────────────────────────────────────────────────────────────
// Role definitions are global (shared across tenants).
export const rolesTable = pgTable("roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  level: integer("level").notNull().default(10),
  color: text("color"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertRoleSchema = createInsertSchema(rolesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRole = z.infer<typeof insertRoleSchema>;
export type Role = typeof rolesTable.$inferSelect;

// ── Permissions ──────────────────────────────────────────────────────────────
export const permissionsTable = pgTable("permissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  resource: text("resource").notNull(),
  action: text("action").notNull(),
  scope: text("scope"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Permission = typeof permissionsTable.$inferSelect;

// ── Role Permissions ─────────────────────────────────────────────────────────
export const rolePermissionsTable = pgTable("role_permissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  roleId: uuid("role_id").notNull().references(() => rolesTable.id, { onDelete: "cascade" }),
  permissionId: uuid("permission_id").notNull().references(() => permissionsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Users ─────────────────────────────────────────────────────────────────────
// Users are global — one row per Clerk account. A user can belong to multiple
// tenants via user_roles (which IS tenant-scoped).
export const usersTable = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkId: text("clerk_id").notNull().unique(),
  email: text("email").notNull().unique(),
  fullName: text("full_name").notNull(),
  phoneNumber: text("phone_number"),
  photoUrl: text("photo_url"),
  status: text("status").notNull().default("active"),
  /**
   * Global admins bypass all tenant-scoped RBAC checks and are granted
   * platform_admin (level 0) + super-admin equivalence on every route.
   * This flag must only be changed via direct DB access or a dedicated
   * platform-level API — it is intentionally excluded from insertUserSchema.
   */
  isGlobalAdmin: boolean("is_global_admin").notNull().default(false),
  /**
   * The campaign a platform operator has explicitly entered.
   *
   * Platform operators (global admins) intentionally have NO tenant of their
   * own — they administer every campaign from the platform surface. When they
   * want to make changes inside a specific campaign they "enter" it, which
   * records the tenant here. Nothing is inferred: an operator with a NULL
   * value has no campaign context at all, and campaign-scoped routes reject
   * the request rather than silently picking a tenant for them.
   *
   * Deliberately untyped as a FK reference in Drizzle (the tenants table lives
   * in schema/platform.ts and importing it here would create a cycle); the FK
   * with ON DELETE SET NULL is declared in the migration.
   */
  activeTenantId: uuid("active_tenant_id"),
  countyId: uuid("county_id").references(() => countiesTable.id),
  constituencyId: uuid("constituency_id"),
  wardId: uuid("ward_id"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  isGlobalAdmin: true, // must never be set via the API
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;

// ── User Roles (junction) ─────────────────────────────────────────────────────
// Role assignments are tenant-scoped: a user can be a county-coordinator in
// tenant A and a volunteer-coordinator in tenant B.
export const userRolesTable = pgTable("user_roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  roleId: uuid("role_id").notNull().references(() => rolesTable.id, { onDelete: "cascade" }),
  countyId: uuid("county_id"),
  constituencyId: uuid("constituency_id"),
  wardId: uuid("ward_id"),
  assignedBy: uuid("assigned_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  /**
   * Platform-level grants (tenant_id IS NULL) are unique per user+role, so the
   * startup bootstrap's grant is idempotent even if two instances boot at once.
   * Campaign roles are excluded: the same role is legitimately held in several
   * counties or wards.
   */
  platformGrantUnique: uniqueIndex("user_roles_platform_grant_unique")
    .on(t.userId, t.roleId)
    .where(sql`${t.tenantId} IS NULL`),
}));

export type UserRole = typeof userRolesTable.$inferSelect;

// ── Aspirants ────────────────────────────────────────────────────────────────
export const aspirantsTable = pgTable("aspirants", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  fullName: text("full_name").notNull(),
  email: text("email"),
  phoneNumber: text("phone_number").notNull(),
  nationalId: text("national_id").notNull(),
  /** parliamentary | gubernatorial | senatorial | women_rep | mca */
  position: text("position").notNull(),
  countyId: uuid("county_id").references(() => countiesTable.id),
  countyName: text("county_name"),
  constituency: text("constituency"),
  ward: text("ward"),
  partyAffiliation: text("party_affiliation"),
  isIndependent: boolean("is_independent").notNull().default(false),
  statementOfIntent: text("statement_of_intent"),
  /** pending | approved | rejected */
  status: text("status").notNull().default("pending"),
  reviewNotes: text("review_notes"),
  reviewedBy: uuid("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  consentGiven: boolean("consent_given").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  // One declaration per national ID per seat per tenant.
  unique("aspirants_national_id_position_unique").on(table.nationalId, table.position, table.tenantId),
]);

export const insertAspirantSchema = createInsertSchema(aspirantsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAspirant = z.infer<typeof insertAspirantSchema>;
export type Aspirant = typeof aspirantsTable.$inferSelect;

// ── Contact Messages ─────────────────────────────────────────────────────────
export const contactMessagesTable = pgTable("contact_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  fullName: text("full_name").notNull(),
  email: text("email").notNull(),
  subject: text("subject").notNull(),
  message: text("message").notNull(),
  /** open | read | replied | archived */
  status: text("status").notNull().default("open"),
  replyNote: text("reply_note"),
  repliedAt: timestamp("replied_at", { withTimezone: true }),
  repliedBy: uuid("replied_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type ContactMessage = typeof contactMessagesTable.$inferSelect;

// ── User Suspensions ─────────────────────────────────────────────────────────
export const userSuspensionsTable = pgTable("user_suspensions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  suspendedBy: uuid("suspended_by").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Email Logs ───────────────────────────────────────────────────────────────
// Audit trail of every transactional email the platform attempts to send.
// Writes here must never throw — email failures are logged, not propagated.
export const emailLogsTable = pgTable("email_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  recipient: text("recipient").notNull(),
  /** Template key, e.g. campaign_welcome | trial_expiring | payment_receipt */
  template: text("template").notNull(),
  subject: text("subject"),
  /** sent | failed | skipped */
  status: text("status").notNull(),
  error: text("error"),
  /** Provider message id, when the provider returns one. */
  providerId: text("provider_id"),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
});
export type EmailLog = typeof emailLogsTable.$inferSelect;

// ── Processed Webhook Events ─────────────────────────────────────────────────
// Idempotency ledger for inbound billing webhooks. Stripe retries on any non-2xx
// (and can deliver the same event more than once regardless), so every handler
// must claim the event id here before it mutates state or sends mail.
export const processedWebhookEventsTable = pgTable("processed_webhook_events", {
  /** The provider's event id, e.g. Stripe "evt_...". Primary key = the claim. */
  eventId: text("event_id").primaryKey(),
  provider: text("provider").notNull().default("stripe"),
  eventType: text("event_type"),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});
export type ProcessedWebhookEvent = typeof processedWebhookEventsTable.$inferSelect;

// ── Domain Change Requests ───────────────────────────────────────────────────
// Campaign admins request a slug or custom-domain change; platform admins action it.
export const domainChangeRequestsTable = pgTable("domain_change_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  requestedBy: uuid("requested_by").references(() => usersTable.id, { onDelete: "set null" }),
  /** slug | custom_domain */
  kind: text("kind").notNull(),
  currentValue: text("current_value"),
  requestedValue: text("requested_value").notNull(),
  /** pending | approved | rejected */
  status: text("status").notNull().default("pending"),
  reviewNotes: text("review_notes"),
  reviewedBy: uuid("reviewed_by").references(() => usersTable.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type DomainChangeRequest = typeof domainChangeRequestsTable.$inferSelect;

// ── Deletion Requests ────────────────────────────────────────────────────────
// Campaign admins request account deletion; platform admins approve before purge.
export const deletionRequestsTable = pgTable("deletion_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  requestedBy: uuid("requested_by").references(() => usersTable.id, { onDelete: "set null" }),
  reason: text("reason"),
  /** pending | approved | rejected | completed */
  status: text("status").notNull().default("pending"),
  reviewNotes: text("review_notes"),
  reviewedBy: uuid("reviewed_by").references(() => usersTable.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type DeletionRequest = typeof deletionRequestsTable.$inferSelect;

// ── Onboarding Progress ──────────────────────────────────────────────────────
// One row per tenant, tracking the 5-step first-run setup checklist.
export const onboardingProgressTable = pgTable("onboarding_progress", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().unique().references(() => tenantsTable.id, { onDelete: "cascade" }),
  logoUploaded: boolean("logo_uploaded").notNull().default(false),
  coloursSet: boolean("colours_set").notNull().default(false),
  staffInvited: boolean("staff_invited").notNull().default(false),
  stationsConfigured: boolean("stations_configured").notNull().default(false),
  profileCompleted: boolean("profile_completed").notNull().default(false),
  /** Admin dismissed the checklist panel — stop showing it. */
  dismissed: boolean("dismissed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
export type OnboardingProgress = typeof onboardingProgressTable.$inferSelect;
