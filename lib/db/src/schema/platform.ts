import { pgTable, text, uuid, timestamp } from "drizzle-orm/pg-core";

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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
