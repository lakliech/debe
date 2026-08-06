-- WhatsApp Business integration: per-tenant phone number id + two-way support tickets.
-- Idempotent; safe to re-run.

alter table tenants add column if not exists whatsapp_phone_number_id text;
-- Trust boundary: a Meta phone_number_id maps to exactly one tenant
-- (Postgres unique indexes permit multiple NULLs, so unconnected campaigns are fine).
create unique index if not exists tenants_whatsapp_phone_number_id_uniq on tenants(whatsapp_phone_number_id);

create table if not exists support_tickets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  supporter_id uuid references supporters(id) on delete set null,
  channel text not null default 'whatsapp',
  wa_phone text not null,
  contact_name text,
  category text not null default 'supporter',
  subject text,
  status text not null default 'open',
  assigned_to uuid references users(id),
  unread_count integer not null default 0,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists support_tickets_tenant_idx on support_tickets(tenant_id);
create index if not exists support_tickets_phone_idx on support_tickets(tenant_id, wa_phone);

create table if not exists support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references support_tickets(id) on delete cascade,
  direction text not null,
  body text not null,
  sender_name text,
  wa_message_id text,
  created_at timestamptz not null default now()
);
create index if not exists support_ticket_messages_ticket_idx on support_ticket_messages(ticket_id);
-- Idempotency backstop for Meta retries: an inbound wamid is processed at most once.
create unique index if not exists support_ticket_messages_wamid_uniq on support_ticket_messages(wa_message_id) where wa_message_id is not null;
