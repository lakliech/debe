-- Migration 0014: campaign_station_profiles
-- Stores per-tenant, per-station campaign state (accreditation, training, etc.)
-- so multiple campaigns deploying to the same physical station never overwrite each other.

CREATE TABLE IF NOT EXISTS "campaign_station_profiles" (
  "id"                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"            uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "station_id"           uuid NOT NULL REFERENCES "polling_stations"("id") ON DELETE CASCADE,
  "accreditation_status" text DEFAULT 'pending',
  "training_status"      text DEFAULT 'pending',
  "contact_status"       text DEFAULT 'pending',
  "reporting_status"     text DEFAULT 'not_reported',
  "primary_agent_id"     uuid,
  "backup_agent_id"      uuid,
  "created_at"           timestamptz NOT NULL DEFAULT now(),
  "updated_at"           timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("tenant_id", "station_id")
);

CREATE INDEX IF NOT EXISTS "csp_tenant_id_idx" ON "campaign_station_profiles" ("tenant_id");
CREATE INDEX IF NOT EXISTS "csp_station_id_idx" ON "campaign_station_profiles" ("station_id");
