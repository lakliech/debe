-- Migration 0023: allow tenant_id to be NULL on user_roles.
-- Platform-level roles (e.g. platform_admin) are cross-tenant and must be
-- assigned with tenant_id = NULL. Migration 0012 incorrectly set NOT NULL
-- on this column; revert it here to match the Drizzle schema definition.
ALTER TABLE user_roles ALTER COLUMN tenant_id DROP NOT NULL;
