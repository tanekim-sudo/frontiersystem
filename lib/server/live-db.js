import pg from "pg";

const LIVE_SCHEMA_SQL = `
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
create index if not exists idx_jobs_status_sched on public.ingestion_jobs(status, scheduled_at, priority);
create index if not exists idx_companies_layer_active on public.companies(layer, active);
`;

export const SEED_COMPANIES = [
  { id: "formic", name: "Formic", layer: "physical_ai", industry: "Robotics" },
  { id: "agility_robotics", name: "Agility Robotics", layer: "physical_ai", industry: "Robotics" },
  { id: "zipline", name: "Zipline", layer: "physical_ai", industry: "Autonomy logistics" },
  { id: "waymo", name: "Waymo", layer: "physical_ai", industry: "Autonomy mobility" },
  { id: "elevenlabs", name: "ElevenLabs", layer: "voice", industry: "Voice AI" },
  { id: "cartesia", name: "Cartesia", layer: "voice", industry: "Voice infrastructure" },
  { id: "meta_spatial", name: "Meta Spatial Platform", ticker: "META", layer: "spatial", industry: "Spatial computing" },
  { id: "himax", name: "Himax Technologies", ticker: "HIMX", layer: "spatial", industry: "Optics and displays" },
  { id: "osworld", name: "OSWorld Frontier Agents", layer: "agent", industry: "Agentic software" },
  { id: "neuralink", name: "Neuralink", layer: "neural", industry: "BCI" },
  { id: "synchron", name: "Synchron", layer: "neural", industry: "BCI" },
];

export const SEED_METRICS = [
  { id: "physical_production_hours", layer: "physical_ai", name: "Production hours", cadence: "weekly", source_type: "api", unit: "hours" },
  { id: "physical_ur_asp", layer: "physical_ai", name: "Teradyne UR ASP", cadence: "quarterly", source_type: "api", unit: "usd" },
  { id: "voice_arr", layer: "voice", name: "Voice ARR trajectory", cadence: "weekly", source_type: "api", unit: "usd" },
  { id: "voice_dau_mau", layer: "voice", name: "Ambient DAU/MAU", cadence: "weekly", source_type: "api", unit: "ratio" },
  { id: "spatial_units", layer: "spatial", name: "Spatial unit volume", cadence: "quarterly", source_type: "api", unit: "units" },
  { id: "agent_osworld_success", layer: "agent", name: "OSWorld success", cadence: "weekly", source_type: "api", unit: "percent", threshold_value: 80, threshold_direction: "gte" },
  { id: "agent_deployment_ratio", layer: "agent", name: "Deployment/Governance to Research ratio", cadence: "weekly", source_type: "api", unit: "ratio" },
  { id: "neural_implants", layer: "neural", name: "Patient implant count", cadence: "monthly", source_type: "api", unit: "count" },
  { id: "neural_electrode_count", layer: "neural", name: "Electrode count", cadence: "monthly", source_type: "api", unit: "count" },
];

function normalizeDatabaseUrl(url) {
  if (!url || typeof url !== "string") return "";
  const trimmed = url.trim();
  if (!trimmed.includes("supabase.com")) return trimmed;
  try {
    const u = new URL(trimmed);
    if (!u.searchParams.has("sslmode")) u.searchParams.set("sslmode", "require");
    return u.toString();
  } catch {
    return trimmed;
  }
}

export function createLiveDbClient() {
  const rawUrl = process.env.DATABASE_URL || "";
  if (!rawUrl || String(rawUrl).toLowerCase().startsWith("sqlite:")) {
    throw new Error("DATABASE_URL must be a Postgres connection string for live platform APIs.");
  }
  const connectionString = normalizeDatabaseUrl(rawUrl);
  return new pg.Client({
    connectionString,
    ssl: rawUrl.includes("supabase.com") ? { rejectUnauthorized: false } : undefined,
  });
}

export async function ensureLiveSchema(client) {
  await client.query(LIVE_SCHEMA_SQL);
}

export async function seedLiveCatalog(client) {
  for (const c of SEED_COMPANIES) {
    await client.query(
      `insert into public.companies (id, name, ticker, layer, industry, metadata)
       values ($1, $2, $3, $4, $5, '{}'::jsonb)
       on conflict (id) do update set
         name=excluded.name,
         ticker=excluded.ticker,
         layer=excluded.layer,
         industry=excluded.industry,
         updated_at=now()`,
      [c.id, c.name, c.ticker || null, c.layer, c.industry || null],
    );
  }
  for (const m of SEED_METRICS) {
    await client.query(
      `insert into public.metric_definitions
       (id, layer, name, cadence, unit, source_type, threshold_value, threshold_direction, metadata)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'{}'::jsonb)
       on conflict (id) do update set
         layer=excluded.layer,
         name=excluded.name,
         cadence=excluded.cadence,
         unit=excluded.unit,
         source_type=excluded.source_type,
         threshold_value=excluded.threshold_value,
         threshold_direction=excluded.threshold_direction,
         updated_at=now()`,
      [m.id, m.layer, m.name, m.cadence, m.unit || null, m.source_type, m.threshold_value || null, m.threshold_direction || null],
    );
  }
}

export function authorizedLive(req) {
  const secret = process.env.DASHBOARD_STORE_SECRET || "";
  const auth = req.headers.authorization || "";
  return secret && auth === `Bearer ${secret}`;
}

export async function withLiveDb(handler) {
  const client = createLiveDbClient();
  await client.connect();
  try {
    await ensureLiveSchema(client);
    await seedLiveCatalog(client);
    return await handler(client);
  } finally {
    await client.end().catch(() => {});
  }
}

export function makeJobId(prefix = "run") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
