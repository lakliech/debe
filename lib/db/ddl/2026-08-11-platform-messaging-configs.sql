-- Platform-owned messaging channels (WhatsApp / SMS) configured by platform
-- admins. One row per channel; secrets are AES-256-GCM encrypted by the API.
CREATE TABLE IF NOT EXISTS platform_messaging_configs (
  channel text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  phone_number_id text,
  business_account_id text,
  access_token text,
  sender_id text,
  webhook_url text,
  webhook_token text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
