-- Agent geofencing + live tracking
-- Append-only GPS heartbeats from the agent app; presence status is derived at
-- query time. agent_tracking_alerts enforces the missing-agent alert cooldown.

CREATE TABLE IF NOT EXISTS agent_location_pings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES polling_agents(id) ON DELETE CASCADE,
  election_id uuid REFERENCES elections(id),
  lat double precision NOT NULL,
  lon double precision NOT NULL,
  accuracy_m double precision,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Latest-ping-per-agent lookup (live map + monitor sweep)
CREATE INDEX IF NOT EXISTS agent_location_pings_agent_latest_idx
  ON agent_location_pings (tenant_id, agent_id, recorded_at);
CREATE INDEX IF NOT EXISTS agent_location_pings_tenant_time_idx
  ON agent_location_pings (tenant_id, recorded_at);

CREATE TABLE IF NOT EXISTS agent_tracking_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES polling_agents(id) ON DELETE CASCADE,
  election_id uuid REFERENCES elections(id),
  kind text NOT NULL, -- missing | away
  sent_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_tracking_alerts_agent_kind_idx
  ON agent_tracking_alerts (tenant_id, agent_id, kind, sent_at);
