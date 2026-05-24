from __future__ import annotations

import json
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator

import psycopg

from .config import WorkerSettings


SCHEMA_SQL = """
create table if not exists public.ingestion_runs (
  id text primary key,
  collector_id text not null,
  company_id text,
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
  company_id text,
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

create table if not exists public.observations (
  id bigserial primary key,
  company_id text not null,
  metric_id text not null,
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
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


@contextmanager
def connect(settings: WorkerSettings) -> Iterator[psycopg.Connection]:
    conn = psycopg.connect(settings.database_url)
    conn.autocommit = False
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def ensure_schema(conn: psycopg.Connection) -> None:
    with conn.cursor() as cur:
        cur.execute(SCHEMA_SQL)


def enqueue_job(
    conn: psycopg.Connection,
    *,
    job_type: str,
    layer: str,
    company_id: str | None,
    payload: dict[str, Any] | None = None,
    priority: int = 100,
) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into public.ingestion_jobs (job_type, layer, company_id, payload, priority, status, scheduled_at)
            values (%s,%s,%s,%s::jsonb,%s,'queued',now())
            returning id
            """,
            (job_type, layer, company_id, json.dumps(payload or {}), priority),
        )
        return int(cur.fetchone()[0])


def lease_jobs(conn: psycopg.Connection, *, worker_id: str, batch_size: int) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            with picked as (
              select id
              from public.ingestion_jobs
              where status = 'queued'
                and scheduled_at <= now()
              order by priority asc, scheduled_at asc, id asc
              for update skip locked
              limit %s
            )
            update public.ingestion_jobs j
              set status = 'leased',
                  leased_at = now(),
                  lease_owner = %s,
                  attempts = attempts + 1,
                  updated_at = now()
            from picked
            where j.id = picked.id
            returning j.id, j.job_type, j.layer, j.company_id, j.payload, j.attempts, j.max_attempts
            """,
            (batch_size, worker_id),
        )
        cols = [c.name for c in cur.description]
        rows = [dict(zip(cols, row)) for row in cur.fetchall()]
    return rows


def create_run(conn: psycopg.Connection, *, run_id: str, collector_id: str, company_id: str | None, layer: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into public.ingestion_runs (id, collector_id, company_id, layer, status, started_at, metadata)
            values (%s,%s,%s,%s,'running',now(), '{}'::jsonb)
            """,
            (run_id, collector_id, company_id, layer),
        )


def complete_run(conn: psycopg.Connection, *, run_id: str, status: str, records_written: int, error_message: str | None = None) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            update public.ingestion_runs
            set status = %s, records_written = %s, error_message = %s, finished_at = now()
            where id = %s
            """,
            (status, records_written, error_message, run_id),
        )


def complete_job(conn: psycopg.Connection, *, job_id: int) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "update public.ingestion_jobs set status='done', updated_at=now() where id=%s",
            (job_id,),
        )


def fail_job(conn: psycopg.Connection, *, job_id: int, error_message: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            update public.ingestion_jobs
            set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
                last_error = %s,
                scheduled_at = case when attempts >= max_attempts then scheduled_at else now() + (attempts * interval '1 minute') end,
                updated_at = now()
            where id = %s
            """,
            (error_message[:2000], job_id),
        )


def upsert_observation(
    conn: psycopg.Connection,
    *,
    company_id: str,
    metric_id: str,
    source_id: str,
    observed_at: str,
    value_numeric: float | None,
    value_text: str | None,
    confidence: str | None,
    raw_json: dict[str, Any] | None,
    run_id: str,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into public.observations
              (company_id, metric_id, source_id, observed_at, value_numeric, value_text, confidence, raw_json, ingestion_run_id)
            values (%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s)
            on conflict (company_id, metric_id, source_id, observed_at)
            do update set
              value_numeric = excluded.value_numeric,
              value_text = excluded.value_text,
              confidence = excluded.confidence,
              raw_json = excluded.raw_json,
              ingestion_run_id = excluded.ingestion_run_id
            """,
            (
                company_id,
                metric_id,
                source_id,
                observed_at,
                value_numeric,
                value_text,
                confidence,
                json.dumps(raw_json or {}),
                run_id,
            ),
        )
