-- Billing tier becomes a first-class enum.
--
-- `tenants.plan` was free text with a 'free' default, so a typo ('Pro',
-- 'premium') would store cleanly and then resolve to the free tier at read
-- time — a silent downgrade for a paying campaign. The enum makes the three
-- sellable tiers the only writable values.
--
-- Any legacy value outside the enum is normalised to 'free' first; the plan
-- resolver already treated those rows as free, so this changes nothing about
-- what a campaign is entitled to.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'plan_tier') THEN
    CREATE TYPE plan_tier AS ENUM ('free', 'pro', 'enterprise');
  END IF;
END
$$;

UPDATE tenants
   SET plan = 'free'
 WHERE plan IS NULL OR plan NOT IN ('free', 'pro', 'enterprise');

ALTER TABLE tenants ALTER COLUMN plan DROP DEFAULT;

ALTER TABLE tenants
  ALTER COLUMN plan TYPE plan_tier USING plan::plan_tier;

ALTER TABLE tenants ALTER COLUMN plan SET DEFAULT 'free';
ALTER TABLE tenants ALTER COLUMN plan SET NOT NULL;
