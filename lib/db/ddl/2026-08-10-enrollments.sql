-- New-user onboarding: enrollment applications (volunteer / polling-agent).
CREATE TABLE IF NOT EXISTS enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  clerk_user_id text NOT NULL,
  email text NOT NULL,
  intended_role text NOT NULL,
  full_name text NOT NULL,
  phone_number text NOT NULL,
  national_id text,
  county_id uuid,
  constituency_id uuid,
  ward_id uuid,
  preferred_station_id uuid,
  status text NOT NULL DEFAULT 'pending',
  review_reason text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS enrollments_tenant_status_idx ON enrollments(tenant_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS enrollments_pending_uniq ON enrollments(tenant_id, clerk_user_id) WHERE status = 'pending';
