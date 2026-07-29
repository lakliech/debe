-- Migration 0008: enforce NOT NULL on tenant_id for the highest-risk tables.
-- Run AFTER seed-tenant.sql has been executed to back-fill existing rows.
-- Tables where tenant_id remains nullable are left for a follow-up migration
-- once their seed data is confirmed complete.

-- Core campaign tables
ALTER TABLE aspirants         ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE contact_messages  ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE user_roles        ALTER COLUMN tenant_id SET NOT NULL;

-- Config / election tables
ALTER TABLE elections         ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE candidates        ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE result_submissions ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE polling_agents    ALTER COLUMN tenant_id SET NOT NULL;

-- Volunteer / supporter tables
ALTER TABLE volunteers        ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE supporters        ALTER COLUMN tenant_id SET NOT NULL;

-- Finance tables
ALTER TABLE contributions     ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE budget_categories ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE budget_lines      ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE expenditure_requests ALTER COLUMN tenant_id SET NOT NULL;
