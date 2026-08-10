-- Enforce the panic->incident pair invariant at the DB boundary (architect
-- review round 2). Backfill in 2026-08-10-logistics-panic-link.sql already ran;
-- dev had zero pre-existing panic rows, so NOT NULL is safe. VERIFY before
-- running in production: SELECT count(*) FROM panic_alerts WHERE incident_id IS NULL;
ALTER TABLE panic_alerts ALTER COLUMN incident_id SET NOT NULL;
ALTER TABLE panic_alerts DROP CONSTRAINT IF EXISTS panic_alerts_incident_id_fkey;
ALTER TABLE panic_alerts ADD CONSTRAINT panic_alerts_incident_id_fkey
  FOREIGN KEY (incident_id) REFERENCES security_incidents(id) ON DELETE RESTRICT;

-- Expression index so the logistics monitor's left(election_date,10) = :today
-- filter can use an index instead of scanning elections.
CREATE INDEX IF NOT EXISTS elections_date_day_idx ON elections (left(election_date, 10));
