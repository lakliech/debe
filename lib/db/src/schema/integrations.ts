import { pgTable, uuid, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { tenantsTable } from "./core";

// ── Tenant-provisioned external integrations ────────────────────────────────
// Campaign admins connect their own WhatsApp Business sender. The access
// token is stored AES-256-GCM encrypted (v1:iv:tag:data, same scheme as
// tenant_mpesa_configs) and is never returned by the API — write-only.
// M-PESA tenant credentials live in tenant_mpesa_configs (schema/finance.ts).
export const tenantWhatsappConfigsTable = pgTable("tenant_whatsapp_configs", {
  tenantId: uuid("tenant_id").primaryKey().references(() => tenantsTable.id, { onDelete: "cascade" }),
  phoneNumberId: text("phone_number_id").notNull(),
  businessAccountId: text("business_account_id"),
  accessToken: text("access_token").notNull(), // encrypted at rest
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
