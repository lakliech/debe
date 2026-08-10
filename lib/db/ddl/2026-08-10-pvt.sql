-- PVT (Parallel Vote Tabulation) module tables
CREATE TABLE IF NOT EXISTS pvt_sample_designs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  election_id uuid NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  stratum_level text NOT NULL,
  target_sample_size integer NOT NULL,
  confidence_level double precision NOT NULL DEFAULT 0.95,
  margin_of_error double precision NOT NULL DEFAULT 0.015,
  selection_method text NOT NULL DEFAULT 'pps',
  status text NOT NULL DEFAULT 'draft',
  generated_by text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pvt_designs_tenant_election_idx ON pvt_sample_designs (tenant_id, election_id);
CREATE INDEX IF NOT EXISTS pvt_designs_status_idx ON pvt_sample_designs (tenant_id, status);

CREATE TABLE IF NOT EXISTS pvt_sampled_stations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sample_design_id uuid NOT NULL REFERENCES pvt_sample_designs(id) ON DELETE CASCADE,
  election_id uuid NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  polling_station_id uuid NOT NULL REFERENCES polling_stations(id) ON DELETE CASCADE,
  county_id uuid REFERENCES counties(id),
  constituency_id uuid REFERENCES constituencies(id),
  stratum_id uuid NOT NULL,
  stratum_name text NOT NULL,
  registered_voters integer NOT NULL DEFAULT 0,
  -- Registered voters of the whole campaign-universe stratum (sampling frame)
  stratum_voters integer NOT NULL DEFAULT 0,
  selection_probability double precision NOT NULL,
  design_weight double precision NOT NULL,
  report_status text NOT NULL DEFAULT 'pending',
  quick_reported_at timestamptz,
  full_reported_at timestamptz,
  assigned_agent_id uuid REFERENCES polling_agents(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pvt_sampled_station_uniq ON pvt_sampled_stations (sample_design_id, polling_station_id);
CREATE INDEX IF NOT EXISTS pvt_sampled_design_idx ON pvt_sampled_stations (sample_design_id, report_status);
CREATE INDEX IF NOT EXISTS pvt_sampled_stratum_idx ON pvt_sampled_stations (sample_design_id, stratum_id);
CREATE INDEX IF NOT EXISTS pvt_sampled_tenant_idx ON pvt_sampled_stations (tenant_id, election_id);

CREATE TABLE IF NOT EXISTS pvt_quick_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sample_design_id uuid NOT NULL REFERENCES pvt_sample_designs(id) ON DELETE CASCADE,
  sampled_station_id uuid NOT NULL REFERENCES pvt_sampled_stations(id) ON DELETE CASCADE,
  election_id uuid NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  agent_id uuid REFERENCES polling_agents(id),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  total_votes_cast integer NOT NULL,
  registered_voters integer NOT NULL,
  rejected_ballots integer NOT NULL DEFAULT 0,
  candidate_votes jsonb NOT NULL,
  is_valid boolean NOT NULL DEFAULT true,
  validation_notes text,
  source text NOT NULL DEFAULT 'mobile',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pvt_quick_report_station_uniq ON pvt_quick_reports (sampled_station_id);
CREATE INDEX IF NOT EXISTS pvt_quick_reports_design_idx ON pvt_quick_reports (sample_design_id, submitted_at);
CREATE INDEX IF NOT EXISTS pvt_quick_reports_tenant_idx ON pvt_quick_reports (tenant_id, election_id);

CREATE TABLE IF NOT EXISTS pvt_projections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sample_design_id uuid NOT NULL REFERENCES pvt_sample_designs(id) ON DELETE CASCADE,
  election_id uuid NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  computed_at timestamptz NOT NULL DEFAULT now(),
  total_sampled_stations integer NOT NULL DEFAULT 0,
  reported_stations integer NOT NULL DEFAULT 0,
  reporting_rate double precision NOT NULL DEFAULT 0,
  projected_total_votes double precision NOT NULL DEFAULT 0,
  projected_turnout_percent double precision NOT NULL DEFAULT 0,
  candidate_projections jsonb NOT NULL,
  projected_margin double precision NOT NULL DEFAULT 0,
  margin_lower double precision NOT NULL DEFAULT 0,
  margin_upper double precision NOT NULL DEFAULT 0,
  is_within_recount_territory boolean NOT NULL DEFAULT false,
  effective_sample_size double precision NOT NULL DEFAULT 0,
  design_effect double precision NOT NULL DEFAULT 1,
  methodology text NOT NULL DEFAULT 'stratified-pps-bootstrap-2000',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pvt_projections_design_idx ON pvt_projections (sample_design_id, computed_at);
CREATE INDEX IF NOT EXISTS pvt_projections_tenant_idx ON pvt_projections (tenant_id, election_id);

CREATE TABLE IF NOT EXISTS pvt_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sample_design_id uuid NOT NULL REFERENCES pvt_sample_designs(id) ON DELETE CASCADE,
  projection_id uuid REFERENCES pvt_projections(id) ON DELETE SET NULL,
  alert_type text NOT NULL,
  severity text NOT NULL DEFAULT 'medium',
  title text NOT NULL,
  description text NOT NULL,
  context_data jsonb,
  status text NOT NULL DEFAULT 'active',
  acknowledged_by text,
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pvt_alerts_design_idx ON pvt_alerts (sample_design_id, status);
CREATE INDEX IF NOT EXISTS pvt_alerts_tenant_idx ON pvt_alerts (tenant_id, severity);

CREATE TABLE IF NOT EXISTS pvt_stratum_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sample_design_id uuid NOT NULL REFERENCES pvt_sample_designs(id) ON DELETE CASCADE,
  stratum_id uuid NOT NULL,
  stratum_name text NOT NULL,
  total_stations integer NOT NULL DEFAULT 0,
  sampled_stations integer NOT NULL DEFAULT 0,
  reported_stations integer NOT NULL DEFAULT 0,
  registered_voters integer NOT NULL DEFAULT 0,
  total_votes_cast integer NOT NULL DEFAULT 0,
  candidate_vote_shares jsonb,
  turnout_percent double precision NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pvt_stratum_summary_uniq ON pvt_stratum_summaries (sample_design_id, stratum_id);
CREATE INDEX IF NOT EXISTS pvt_stratum_summaries_tenant_idx ON pvt_stratum_summaries (tenant_id, sample_design_id);

-- Universe-consistent stratum population on each sampled station
ALTER TABLE pvt_sampled_stations ADD COLUMN IF NOT EXISTS stratum_voters integer NOT NULL DEFAULT 0;
