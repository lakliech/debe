-- Migration: hero copy fields for branding table
-- Adds editable hero sub-tagline and CTA button copy/destination fields.
-- All columns are nullable so existing tenants are unaffected; TenantHome falls
-- back to the existing static defaults when the fields are left empty.

ALTER TABLE "branding"
  ADD COLUMN "hero_subtagline" text,
  ADD COLUMN "primary_cta_label" text,
  ADD COLUMN "primary_cta_url" text,
  ADD COLUMN "secondary_cta_label" text,
  ADD COLUMN "secondary_cta_url" text;
