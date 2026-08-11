import { pgTable, text, uuid, timestamp, boolean, uniqueIndex } from "drizzle-orm/pg-core";

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

/**
 * The platform's OWN outbound messaging channels (Debe → campaign owners),
 * independent of any tenant's connected sender. One row per channel
 * ('whatsapp' | 'sms'). Secrets are AES-256-GCM encrypted (same scheme as
 * tenant_whatsapp_configs / tenant_mpesa_configs) and are never returned by
 * the API — write-only. SMS goes through the generic webhook relay, same as
 * tenant comms (Africa's Talking / Twilio sit behind the relay).
 */
export const platformMessagingConfigsTable = pgTable("platform_messaging_configs", {
  channel: text("channel").primaryKey(), // 'whatsapp' | 'sms'
  enabled: boolean("enabled").notNull().default(true),
  // WhatsApp Cloud (Meta) sender identity
  phoneNumberId: text("phone_number_id"),
  businessAccountId: text("business_account_id"),
  accessToken: text("access_token"), // encrypted at rest, write-only
  // SMS relay
  senderId: text("sender_id"),
  webhookUrl: text("webhook_url"),
  webhookToken: text("webhook_token"), // encrypted at rest, write-only
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
