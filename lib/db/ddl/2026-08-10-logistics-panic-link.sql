-- Panic alert -> paired incident FK (architect review: ack/resolve must target
-- exactly one incident, not every open panic incident for the agent/election).
ALTER TABLE panic_alerts ADD COLUMN IF NOT EXISTS incident_id uuid REFERENCES security_incidents(id) ON DELETE SET NULL;

-- Backfill: link each panic alert to its matching panic incident (same tenant,
-- agent, election, panic flag, nearest in time).
UPDATE panic_alerts p
SET incident_id = (
  SELECT i.id FROM security_incidents i
  WHERE i.tenant_id = p.tenant_id AND i.reported_by_agent_id = p.agent_id
    AND i.election_id = p.election_id AND i.is_panic_button = true
  ORDER BY abs(extract(epoch from (i.created_at - p.created_at)))
  LIMIT 1
)
WHERE p.incident_id IS NULL;

CREATE INDEX IF NOT EXISTS panic_alerts_incident_idx ON panic_alerts(incident_id);
