-- Add platform_admin role (level 0 — above all campaign roles)
-- This role is cross-tenant: assigned with tenant_id = NULL in user_roles.
INSERT INTO "roles" ("name", "slug", "description", "level", "color")
VALUES (
  'Platform Administrator',
  'platform_admin',
  'Cross-tenant platform operator — can create and manage campaign tenants. Assigned with NULL tenant_id.',
  0,
  '#0f172a'
)
ON CONFLICT ("slug") DO UPDATE SET
  "name"        = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "level"       = EXCLUDED."level",
  "color"       = EXCLUDED."color";
