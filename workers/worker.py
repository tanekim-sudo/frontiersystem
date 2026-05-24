from __future__ import annotations

import logging
import time
from typing import Any

from .collectors import collect_live_metrics
from .config import WorkerSettings
from .db import (
    complete_job,
    complete_run,
    connect,
    create_run,
    ensure_schema,
    fail_job,
    lease_jobs,
    now_iso,
    upsert_observation,
)

logger = logging.getLogger(__name__)


def _run_id(job_id: int) -> str:
    return f"run_{job_id}_{int(time.time())}"


def process_job(settings: WorkerSettings, job: dict[str, Any]) -> None:
    job_id = int(job["id"])
    run_id = _run_id(job_id)
    collector_id = str(job.get("job_type") or "collector_run")
    layer = str(job.get("layer") or "agent")
    company_id = job.get("company_id")
    with connect(settings) as conn:
        create_run(conn, run_id=run_id, collector_id=collector_id, company_id=company_id, layer=layer)

    records_written = 0
    try:
        observations = collect_live_metrics(job)
        with connect(settings) as conn:
            for obs in observations:
                upsert_observation(conn, run_id=run_id, **obs)
                records_written += 1
            complete_run(conn, run_id=run_id, status="success", records_written=records_written)
            complete_job(conn, job_id=job_id)
        logger.info("Processed job %s (%s) with %s observations", job_id, layer, records_written)
    except Exception as exc:
        with connect(settings) as conn:
            complete_run(conn, run_id=run_id, status="failed", records_written=records_written, error_message=str(exc))
            fail_job(conn, job_id=job_id, error_message=str(exc))
        logger.exception("Job %s failed", job_id)


def run_worker_loop(settings: WorkerSettings) -> None:
    logger.info("Worker loop started id=%s poll=%ss batch=%s", settings.worker_id, settings.poll_seconds, settings.batch_size)
    while True:
        jobs: list[dict[str, Any]] = []
        with connect(settings) as conn:
            ensure_schema(conn)
            jobs = lease_jobs(conn, worker_id=settings.worker_id, batch_size=settings.batch_size)
        if not jobs:
            time.sleep(settings.poll_seconds)
            continue
        for job in jobs:
            process_job(settings, job)
