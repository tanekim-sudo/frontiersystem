-- Live Interface-Transition Platform: normalized market data schema
-- Run this in Supabase SQL editor (or any Postgres target for the live platform).

create table if not exists public.companies (
  id text primary key,
  name text not null,
  ticker text,
  layer text not null,
  industry text,
  website text,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.metric_definitions (
  id text primary key,
  layer text not null,
  name text not null,
  cadence text not null,
  unit text,
  source_type text not null,
  description text,
  threshold_value numeric,
  threshold_direction text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.company_sources (
  id bigserial primary key,
  company_id text not null references public.companies(id) on delete cascade,
  source_id text not null,
  cadence text not null,
  config jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, source_id)
);

create table if not exists public.observations (
  id bigserial primary key,
  company_id text not null references public.companies(id) on delete cascade,
  metric_id text not null references public.metric_definitions(id) on delete cascade,
  source_id text not null,
  observed_at timestamptz not null,
  value_numeric numeric,
  value_text text,
  confidence text,
  raw_json jsonb not null default '{}'::jsonb,
  ingestion_run_id text,
  created_at timestamptz not null default now(),
  unique (company_id, metric_id, source_id, observed_at)
);

create table if not exists public.catalyst_events (
  id bigserial primary key,
  layer text not null,
  company_id text references public.companies(id) on delete set null,
  title text not null,
  event_type text not null,
  event_date date not null,
  importance smallint not null default 2,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.alert_rules_live (
  id text primary key,
  layer text not null,
  metric_id text references public.metric_definitions(id) on delete cascade,
  rule_type text not null,
  rule_params jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.watchlists (
  id bigserial primary key,
  watchlist_name text not null,
  company_id text not null references public.companies(id) on delete cascade,
  added_at timestamptz not null default now(),
  unique (watchlist_name, company_id)
);

create table if not exists public.ingestion_runs (
  id text primary key,
  collector_id text not null,
  company_id text references public.companies(id) on delete set null,
  layer text not null,
  status text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  records_written integer not null default 0,
  error_message text,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.ingestion_jobs (
  id bigserial primary key,
  job_type text not null,
  layer text not null,
  company_id text references public.companies(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  priority integer not null default 100,
  status text not null default 'queued',
  scheduled_at timestamptz not null default now(),
  leased_at timestamptz,
  lease_owner text,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_obs_company_metric_time on public.observations(company_id, metric_id, observed_at desc);
create index if not exists idx_obs_layer_time on public.observations(metric_id, observed_at desc);
create index if not exists idx_jobs_status_sched on public.ingestion_jobs(status, scheduled_at, priority);
create index if not exists idx_runs_collector_started on public.ingestion_runs(collector_id, started_at desc);
create index if not exists idx_companies_layer_active on public.companies(layer, active);

-- Keep legacy dashboard_state for user prefs and brief artifacts.
create table if not exists public.dashboard_state (
  id text primary key default 'default',
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
