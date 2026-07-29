-- Add optional custom domain to tenants.
-- Campaigns can point their own hostname (e.g. vote.amina.ke) at this platform.
-- The unique constraint prevents two campaigns from claiming the same domain.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "custom_domain" TEXT;
ALTER TABLE "tenants" DROP CONSTRAINT IF EXISTS "tenants_custom_domain_unique";
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_custom_domain_unique" UNIQUE ("custom_domain");
