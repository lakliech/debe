-- Anomaly detection engine: risk score on submissions + per-detector flags.
alter table result_submissions add column if not exists anomaly_score integer;
alter table result_submissions add column if not exists anomaly_evaluated_at timestamptz;
alter table result_submissions add column if not exists vote_vector_hash text;

create table if not exists result_anomaly_flags (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references result_submissions(id) on delete cascade,
  tenant_id uuid references tenants(id) on delete cascade,
  type text not null,
  weight integer not null default 0,
  details jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists result_anomaly_flags_sub_type_uniq on result_anomaly_flags(submission_id, type);
create index if not exists result_anomaly_flags_tenant_idx on result_anomaly_flags(tenant_id);
-- Worker scan: unevaluated submissions sitting in the pre-verification queue.
create index if not exists result_submissions_anomaly_pending_idx
  on result_submissions(status) where anomaly_evaluated_at is null;
-- Peer/duplicate sweep: per-evaluation query filters tenant+election+status.
create index if not exists result_submissions_tenant_election_status_idx
  on result_submissions(tenant_id, election_id, status);
-- O(1) duplicate-pattern lookup by vote-vector hash.
create index if not exists result_submissions_vector_hash_idx
  on result_submissions(tenant_id, election_id, vote_vector_hash) where vote_vector_hash is not null;
