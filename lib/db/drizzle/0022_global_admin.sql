-- Migration: global admin flag on users table
-- Adds is_global_admin boolean to users. When true, the RBAC middleware
-- grants the user platform_admin (level 0) + super-admin equivalence on
-- every route, regardless of which tenant is active.
--
-- The flag must only be changed via direct DB access or a dedicated
-- platform-level endpoint — it is intentionally excluded from the
-- user insert/update API surface.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "is_global_admin" BOOLEAN NOT NULL DEFAULT false;

-- Seed the first global admin
UPDATE "users"
  SET "is_global_admin" = true
  WHERE email = 'jaredkoyier@gmail.com';
