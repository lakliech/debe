-- Tenant-provisioned WhatsApp Business credentials (Settings → Integrations).
-- access_token is AES-256-GCM encrypted at rest; never returned by the API.
CREATE TABLE IF NOT EXISTS tenant_whatsapp_configs (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  phone_number_id text NOT NULL,
  business_account_id text,
  access_token text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
