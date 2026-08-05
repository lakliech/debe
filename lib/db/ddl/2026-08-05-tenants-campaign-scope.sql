-- Campaign scope columns + seat↔geography CHECK on tenants.
-- Applied to the dev database 2026-08-05 via direct SQL (drizzle-kit push is
-- unreliable in this repo — journal drift). This file is the tracked record
-- of exactly what was applied; the same constraint is declared in drizzle in
-- lib/db/src/schema/core.ts (tenantsTable extra config), so a future schema
-- push regenerates it identically.
--
-- Rules (mirror api-server/src/lib/campaignScope.ts):
--   presidential                        → national, no geography
--   gubernatorial | senator | women_rep → scope_county_id required
--   mp                                  → scope_constituency_id required
--   mca                                 → scope_ward_id required
-- seat_type NULL is permitted ONLY for campaigns created before this feature;
-- every creation route (register, platform) now requires scope at the API.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS seat_type text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS scope_county_id uuid REFERENCES counties(id);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS scope_constituency_id uuid REFERENCES constituencies(id);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS scope_ward_id uuid REFERENCES wards(id);

ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_scope_valid;
ALTER TABLE tenants ADD CONSTRAINT tenants_scope_valid CHECK (
  seat_type IS NULL OR (
    (seat_type = 'presidential' AND scope_county_id IS NULL AND scope_constituency_id IS NULL AND scope_ward_id IS NULL) OR
    (seat_type IN ('gubernatorial', 'senator', 'women_rep') AND scope_county_id IS NOT NULL AND scope_constituency_id IS NULL AND scope_ward_id IS NULL) OR
    (seat_type = 'mp' AND scope_county_id IS NULL AND scope_constituency_id IS NOT NULL AND scope_ward_id IS NULL) OR
    (seat_type = 'mca' AND scope_county_id IS NULL AND scope_constituency_id IS NULL AND scope_ward_id IS NOT NULL)
  )
);
