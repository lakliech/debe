-- Platform-level role grants (tenant_id IS NULL) must be unique per user+role.
--
-- The startup bootstrap grants the platform_admin role, and two instances
-- booting at once would otherwise each pass a check-then-insert and create
-- duplicate grants. A partial unique index makes the grant idempotent in the
-- database rather than relying on application timing.
--
-- Scoped to tenant_id IS NULL on purpose: campaign roles are legitimately held
-- more than once (the same role in different counties/wards), but a
-- platform-level role has no such scoping.
CREATE UNIQUE INDEX IF NOT EXISTS user_roles_platform_grant_unique
  ON user_roles (user_id, role_id)
  WHERE tenant_id IS NULL;
