-- Add TLS certificate status tracking to tenants.
-- tlsStatus: null | 'pending' | 'active' | 'error'
-- Populated after a custom domain is saved and DNS-verified.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "tls_status" TEXT;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "tls_cert_error" TEXT;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "tls_provisioned_at" TIMESTAMPTZ;
