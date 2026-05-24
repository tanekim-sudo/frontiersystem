from __future__ import annotations

import logging

from apscheduler.schedulers.blocking import BlockingScheduler

from .config import WorkerSettings
from .db import connect, enqueue_job, ensure_schema

logger = logging.getLogger(__name__)


def enqueue_layer_batch(settings: WorkerSettings, layer: str) -> None:
    with connect(settings) as conn:
        ensure_schema(conn)
        job_id = enqueue_job(
            conn,
            job_type="collector_run",
            layer=layer,
            company_id=None,
            payload={"layer": layer},
            priority=100,
        )
    logger.info("Scheduled layer job %s for %s", job_id, layer)


def run_scheduler(settings: WorkerSettings) -> None:
    scheduler = BlockingScheduler(timezone="UTC")
    scheduler.add_job(lambda: enqueue_layer_batch(settings, "physical_ai"), "cron", day_of_week="mon", hour=2, minute=5)
    scheduler.add_job(lambda: enqueue_layer_batch(settings, "voice"), "cron", day_of_week="mon", hour=2, minute=15)
    scheduler.add_job(lambda: enqueue_layer_batch(settings, "spatial"), "cron", day_of_week="mon", hour=2, minute=25)
    scheduler.add_job(lambda: enqueue_layer_batch(settings, "agent"), "cron", hour="*/4", minute=10)
    scheduler.add_job(lambda: enqueue_layer_batch(settings, "neural"), "cron", day=1, hour=3, minute=0)
    logger.info("Scheduler started")
    scheduler.start()
