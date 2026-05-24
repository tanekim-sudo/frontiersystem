# Live Interface-Transition Platform — Operations Manual

## Mission

Operate a live, multi-company intelligence system for interface-layer transitions across:

- `physical_ai`
- `voice`
- `spatial`
- `agent`
- `neural`

The production target is always-on ingestion with external workers, normalized storage, and a dense PM-grade dashboard for ranking and timing transitions.

## Runtime Architecture

- Frontend and read APIs run on Vercel.
- Live ingestion runs in external workers (`workers/`).
- Canonical data lives in Postgres/Supabase using normalized tables (`migrations/001_live_interface_platform.sql`).
- `dashboard_state` remains for user state and UI preferences; it is no longer the primary signal store.

## Live Data Model

Core entities:

- `companies`
- `metric_definitions`
- `observations`
- `ingestion_jobs`
- `ingestion_runs`
- `catalyst_events`

### Data quality rules

- Every observation must include:
  - `company_id`
  - `metric_id`
  - `source_id`
  - `observed_at`
- Upserts are idempotent on `(company_id, metric_id, source_id, observed_at)`.
- Use `ingestion_run_id` for full traceability.

## Ingestion Operations

### Scheduler

- Enqueue by cadence and priority.
- Never scrape inside web request paths.
- Use `ingestion_jobs` for orchestration and retries.

### Worker loop

- Lease queued jobs with skip-locked semantics.
- Execute collector pipeline: fetch -> normalize -> validate -> upsert.
- Record run status and counts in `ingestion_runs`.
- Requeue failed jobs with bounded attempts and backoff.

## API Contract (Live)

Single live surface: `/api/live`

- `GET ?resource=companies`
- `GET ?resource=layer_overview&layer=<layer>`
- `GET ?resource=company_signals&company_id=<id>&days=<n>`
- `GET ?resource=alerts`
- `GET ?resource=jobs`
- `POST ?resource=enqueue` (requires `Authorization: Bearer DASHBOARD_STORE_SECRET`)

## Dashboard Usage

The new shell is live-first:

- Layer overview
- Leader/laggard ranking
- Catalyst rail
- Company trajectory charts
- Live alerts and run-health
- Live brief workspace

Automatic fallback to legacy dashboard occurs if live backend is unavailable.

## Environment

Required for live platform:

- `DATABASE_URL`
- `DASHBOARD_STORE_SECRET`

Worker controls:

- `WORKER_ID`
- `WORKER_POLL_SECONDS`
- `WORKER_BATCH_SIZE`

Keep browser-exposed secrets (`VITE_*`) for client-only features only.

## Migration and Cutover

- Dual-read mode is active:
  - New shell reads normalized `/api/live`.
  - Legacy dashboard remains fallback-safe.
- Gradually retire manual-primary flows as collectors go live per source.
- Keep stale-data and degraded-mode indicators visible during source outages.
