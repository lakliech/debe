-- Task #208: one-click enquiry → campaign conversion.
-- converted_tenant_id links an enquiry to the campaign it became. The
-- conversion claim is transactional (UPDATE ... WHERE converted_tenant_id IS
-- NULL); this unique index is the backstop so an enquiry can convert to at
-- most one campaign. Postgres unique indexes allow any number of NULLs, so
-- unconverted enquiries are unaffected.
ALTER TABLE platform_enquiries ADD COLUMN IF NOT EXISTS converted_tenant_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS platform_enquiries_converted_tenant_uq
  ON platform_enquiries (converted_tenant_id);
