-- Platform operators have no tenant of their own. When one explicitly "enters"
-- a campaign we record it here so the choice survives page loads and restarts.
-- NULL means "no campaign context" — campaign-scoped routes must then reject
-- the request instead of inventing a tenant.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "active_tenant_id" uuid;

DO $$
BEGIN
  ALTER TABLE "users"
    ADD CONSTRAINT "users_active_tenant_id_tenants_id_fk"
    FOREIGN KEY ("active_tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
