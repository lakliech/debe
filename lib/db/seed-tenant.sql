-- Seed the initial tenant record.
-- Run once after migration 0007 if no tenants exist.
-- Set SEED_CLERK_ORG_ID to the Clerk Organisation ID of the first campaign.
-- If SEED_CLERK_ORG_ID is not set we use a placeholder that can be updated later.

DO $$
DECLARE
  v_org_id text := coalesce(current_setting('app.seed_clerk_org_id', true), 'org_placeholder_update_me');
  v_tenant_id uuid;
BEGIN
  -- Insert only if this org_id does not already exist
  INSERT INTO tenants (clerk_org_id, name, slug, plan)
  VALUES (v_org_id, 'Default Campaign', 'default', 'free')
  ON CONFLICT (clerk_org_id) DO NOTHING;

  -- Back-fill tenant_id on all campaign tables for rows that have NULL tenant_id
  SELECT id INTO v_tenant_id FROM tenants WHERE clerk_org_id = v_org_id LIMIT 1;

  -- Core tables
  UPDATE aspirants        SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE contact_messages SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE user_roles       SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE user_suspensions SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE activity_feed    SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE audit_logs       SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;

  -- Config tables
  UPDATE branding           SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE system_config      SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE candidates         SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE elections          SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE polling_agents     SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE result_submissions SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE incidents          SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE donations          SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE events             SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE communications     SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE policy_submissions SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE data_subject_requests SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;

  -- Supporters and volunteers
  UPDATE supporters SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE volunteers SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;

  -- Portal tables
  UPDATE manifesto_sectors SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE county_priorities SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE news_articles     SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE faq_items         SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE training_courses  SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE volunteer_tasks   SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;

  -- Finance tables
  UPDATE contributions       SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE donor_alerts        SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE budget_categories   SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE budget_lines        SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE expenditure_requests SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE payment_vouchers    SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE finance_audit_log   SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE mpesa_transactions  SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE message_templates   SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE audience_segments   SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE content_assets      SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE spokesperson_directory SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE statements          SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;

  RAISE NOTICE 'Seed tenant backfill complete for tenant %', v_tenant_id;
END;
$$;
