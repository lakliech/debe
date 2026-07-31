-- 0024_saas_platform.sql
-- SaaS platform refactor: billing, trials, tenant lifecycle, email audit,
-- domain/deletion requests, and onboarding progress.

-- ── Tenants: billing + lifecycle columns ─────────────────────────────────────
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "plan_override_until" timestamp with time zone;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "trial_used" boolean DEFAULT false NOT NULL;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "stripe_customer_id" text;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "stripe_subscription_id" text;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "stripe_subscription_status" text;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "billing_email" text;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "lifecycle_state" text DEFAULT 'active' NOT NULL;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "scheduled_deletion_at" timestamp with time zone;

-- Backfill lifecycle_state from the existing is_suspended flag.
UPDATE "tenants" SET "lifecycle_state" = 'suspended' WHERE "is_suspended" = true AND "lifecycle_state" = 'active';

CREATE INDEX IF NOT EXISTS "tenants_lifecycle_state_idx" ON "tenants" ("lifecycle_state");
CREATE INDEX IF NOT EXISTS "tenants_scheduled_deletion_idx" ON "tenants" ("scheduled_deletion_at");
CREATE INDEX IF NOT EXISTS "tenants_stripe_customer_idx" ON "tenants" ("stripe_customer_id");

-- ── Email logs ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "email_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid REFERENCES "tenants"("id") ON DELETE CASCADE,
  "recipient" text NOT NULL,
  "template" text NOT NULL,
  "subject" text,
  "status" text NOT NULL,
  "error" text,
  "provider_id" text,
  "sent_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "email_logs_tenant_idx" ON "email_logs" ("tenant_id");
CREATE INDEX IF NOT EXISTS "email_logs_sent_at_idx" ON "email_logs" ("sent_at" DESC);

-- ── Domain change requests ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "domain_change_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "requested_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "kind" text NOT NULL,
  "current_value" text,
  "requested_value" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "review_notes" text,
  "reviewed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "reviewed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "domain_change_requests_tenant_idx" ON "domain_change_requests" ("tenant_id");
CREATE INDEX IF NOT EXISTS "domain_change_requests_status_idx" ON "domain_change_requests" ("status");

-- ── Deletion requests ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "deletion_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "requested_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "reason" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "review_notes" text,
  "reviewed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "reviewed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "deletion_requests_tenant_idx" ON "deletion_requests" ("tenant_id");
CREATE INDEX IF NOT EXISTS "deletion_requests_status_idx" ON "deletion_requests" ("status");

-- ── Onboarding progress ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "onboarding_progress" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL UNIQUE REFERENCES "tenants"("id") ON DELETE CASCADE,
  "logo_uploaded" boolean DEFAULT false NOT NULL,
  "colours_set" boolean DEFAULT false NOT NULL,
  "staff_invited" boolean DEFAULT false NOT NULL,
  "stations_configured" boolean DEFAULT false NOT NULL,
  "profile_completed" boolean DEFAULT false NOT NULL,
  "dismissed" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
