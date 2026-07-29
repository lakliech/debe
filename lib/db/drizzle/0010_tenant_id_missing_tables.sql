-- Migration 0010: add tenant_id to tables that were missing it.
ALTER TABLE tally_snapshots              ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE command_centre_tasks         ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE agent_training_enrollments   ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE vendor_register              ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE data_breach_register         ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE consent_audit                ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;

-- Back-fill tally_snapshots from parent election
UPDATE tally_snapshots ts SET tenant_id = e.tenant_id FROM elections e WHERE ts.election_id = e.id AND ts.tenant_id IS NULL;

-- Back-fill command_centre_tasks from parent election
UPDATE command_centre_tasks ct SET tenant_id = e.tenant_id FROM elections e WHERE ct.election_id = e.id AND ct.tenant_id IS NULL;

-- Back-fill agent_training_enrollments from parent course (which has tenant_id)
UPDATE agent_training_enrollments ate SET tenant_id = atc.tenant_id FROM agent_training_courses atc WHERE ate.course_id = atc.id AND ate.tenant_id IS NULL;

-- New columns found during review
ALTER TABLE export_audit_log    ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE agent_replacements  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
