"""APScheduler — optional automated pulls (Chicago Fed + FRED)."""

from __future__ import annotations

import logging

from apscheduler.schedulers.background import BackgroundScheduler

from rays_tracker.collectors import chicago_fed_collector, fred_collector
from rays_tracker.scoring.composite import recompute_all_scores

logger = logging.getLogger(__name__)

_scheduler: BackgroundScheduler | None = None


def start_scheduler() -> BackgroundScheduler:
    global _scheduler
    if _scheduler and _scheduler.running:
        return _scheduler

    sched = BackgroundScheduler(timezone="America/Chicago")

    def safe_chi():
        try:
            chicago_fed_collector.fetch_chicago_fed(persist=True)
        except Exception as e:
            logger.exception("scheduled chicago_fed: %s", e)

    def safe_fred():
        try:
            fred_collector.fetch_all_fred_series(persist_latest=True)
        except Exception as e:
            logger.exception("scheduled fred: %s", e)

    def safe_scores():
        try:
            recompute_all_scores()
        except Exception as e:
            logger.exception("scheduled scores: %s", e)

    # Chicago Fed file updates ~twice monthly; 1st/3rd Thu is typical — APScheduler uses ordinal day.
    try:
        sched.add_job(safe_chi, "cron", day="1st thu", hour=10, minute=5, id="chicago_fed_1st_thu")
        sched.add_job(safe_chi, "cron", day="3rd thu", hour=10, minute=5, id="chicago_fed_3rd_thu")
    except ValueError:
        logger.warning("Ordinal cron not supported; using weekly Chicago Fed job only")
    sched.add_job(safe_chi, "cron", day_of_week="sun", hour=6, minute=0, id="chicago_fed_weekly_backstop")
    sched.add_job(safe_fred, "cron", day_of_week="sun", hour=6, minute=30, id="fred_weekly")
    sched.add_job(safe_fred, "cron", day_of_week="thu", hour=9, minute=15, id="fred_icsa_thu")
    sched.add_job(safe_scores, "cron", hour=11, minute=0, id="scores_daily")

    sched.start()
    _scheduler = sched
    logger.info("APScheduler started")
    return sched
