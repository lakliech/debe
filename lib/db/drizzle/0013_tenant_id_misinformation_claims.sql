-- Migration 0013: add tenant_id to misinformation_claims
-- Child tables (claim_fact_checks, claim_corrections) scope through parent ownership.

ALTER TABLE "misinformation_claims"
  ADD COLUMN IF NOT EXISTS "tenant_id" uuid REFERENCES "tenants"("id") ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS "misinformation_claims_tenant_id_idx"
  ON "misinformation_claims" ("tenant_id");
