# Live Worker Runtime

This service runs always-on ingestion for the live interface-transition platform.

## Responsibilities

- Scheduler: enqueue jobs by cadence and priority.
- Worker: lease queued jobs, run collectors, upsert observations, and write run logs.
- Reliability: retries with backoff, stale job recovery, and ingestion run telemetry.

## Environment

- `DATABASE_URL` (required, Postgres)
- `WORKER_ID` (optional, default `worker_local`)
- `WORKER_POLL_SECONDS` (optional, default `5`)
- `WORKER_BATCH_SIZE` (optional, default `8`)

## Run locally

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r workers/requirements.txt
python -m workers.main --mode both
```

Modes:

- `scheduler`: only enqueue cadenced jobs
- `worker`: only process jobs
- `both`: run both loops concurrently
