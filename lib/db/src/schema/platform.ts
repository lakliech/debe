import { pgTable, text, uuid, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Platform-level enquiries submitted through the Debe landing page.
 * Not tenant-scoped — these are leads for the platform itself.
 */
export const platformEnquiriesTable = pgTable("platform_enquiries", {
  id: uuid("id").defaultRandom().primaryKey(),
  fullName:      text("full_name").notNull(),
  email:         text("email").notNull(),
  organisation:  text("organisation").notNull(),
  electionLevel: text("election_level").notNull(),
  message:       text("message"),
  /** Lifecycle: new → contacted → converted | closed */
  status:        text("status").notNull().default("new"),
  /** Internal notes added by platform admins */
  notes:         text("notes"),
  /**
   * The campaign this enquiry was converted into. Written exactly once, in
   * the same transaction as the tenant insert, and claimed with
   * `WHERE converted_tenant_id IS NULL` — a second conversion of the same
   * enquiry fails instead of creating a duplicate campaign.
   */
  convertedTenantId: uuid("converted_tenant_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Backstop for the transactional claim: an enquiry converts to one campaign, ever.
  uniqueIndex("platform_enquiries_converted_tenant_uq").on(t.convertedTenantId),
]);
