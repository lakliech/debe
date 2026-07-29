import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  uuid,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { countiesTable } from "./geography";

// ── Tenants ───────────────────────────────────────────────────────────────────
// One row per campaign deployment. clerk_org_id ties it to a Clerk Organisation.
export const tenantsTable = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkOrgId: text("clerk_org_id").notNull().unique(),
  name: text("name").notNull(),
  /** URL-safe identifier used in subdomains / public links */
  slug: text("slug").notNull().unique(),
  /** Billing tier stub — free | pro */
  plan: text("plan").notNull().default("free"),
  isSuspended: boolean("is_suspended").notNull().default(false),
  /**
   * Optional fully-qualified custom domain (e.g. vote.amina.ke).
   * When set, the subdomain middleware matches inbound requests by this hostname
   * in addition to the default <slug>.ushindi.app subdomain.
   */
  customDomain: text("custom_domain").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

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
  countyId: uuid("county_id").references(() => countiesTable.id),
  constituencyId: uuid("constituency_id"),
  wardId: uuid("ward_id"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
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
});

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
  unique("aspirants_national_id_position_unique").on(table.tenantId, table.nationalId, table.position),
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
