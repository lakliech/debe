-- Migration 0011: add tenant_id to scheduled_messages and fact_check_items
-- These tables were missing tenant_id but are now filtered/written by tenant logic.

ALTER TABLE "scheduled_messages"
  ADD COLUMN IF NOT EXISTS "tenant_id" uuid REFERENCES "tenants"("id") ON DELETE CASCADE;

ALTER TABLE "fact_check_items"
  ADD COLUMN IF NOT EXISTS "tenant_id" uuid REFERENCES "tenants"("id") ON DELETE CASCADE;

-- Backfill scheduled_messages from message_templates (via template_id -> tenant_id)
UPDATE "scheduled_messages" sm
  SET "tenant_id" = mt."tenant_id"
  FROM "message_templates" mt
  WHERE sm."template_id" = mt."id"
    AND sm."tenant_id" IS NULL
    AND mt."tenant_id" IS NOT NULL;

-- fact_check_items has no natural parent with tenant_id (standalone content),
-- so no backfill is possible — rows remain NULL until re-inserted under a tenant.
