-- Idempotency ledger for inbound billing webhooks.
-- Stripe retries any non-2xx response and may deliver the same event more than
-- once, so handlers claim the event id here before mutating state or sending
-- mail. The primary key IS the claim: a conflicting insert means "already done".
CREATE TABLE IF NOT EXISTS processed_webhook_events (
  event_id     text PRIMARY KEY,
  provider     text NOT NULL DEFAULT 'stripe',
  event_type   text,
  processed_at timestamptz NOT NULL DEFAULT now()
);

-- Lets the retention sweep find old rows cheaply.
CREATE INDEX IF NOT EXISTS processed_webhook_events_processed_at_idx
  ON processed_webhook_events (processed_at);
