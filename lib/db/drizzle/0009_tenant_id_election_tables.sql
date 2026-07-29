-- Migration 0009: add tenant_id to election dispute, incident, and transparency tables
ALTER TABLE election_disputes           ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE transparency_publications   ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE election_incident_reports   ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;

-- Back-fill from parent election row where possible
UPDATE election_disputes d
SET tenant_id = e.tenant_id
FROM elections e WHERE d.election_id = e.id AND d.tenant_id IS NULL;

UPDATE transparency_publications tp
SET tenant_id = e.tenant_id
FROM elections e WHERE tp.election_id = e.id AND tp.tenant_id IS NULL;

UPDATE election_incident_reports ir
SET tenant_id = e.tenant_id
FROM elections e WHERE ir.election_id = e.id AND ir.tenant_id IS NULL;
