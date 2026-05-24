from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class WorkerSettings:
    database_url: str
    worker_id: str = "worker_local"
    poll_seconds: int = 5
    batch_size: int = 8


def load_settings() -> WorkerSettings:
    database_url = (os.getenv("DATABASE_URL") or "").strip()
    if not database_url:
        raise ValueError("DATABASE_URL is required for live workers")
    return WorkerSettings(
        database_url=database_url,
        worker_id=(os.getenv("WORKER_ID") or "worker_local").strip(),
        poll_seconds=max(1, int(os.getenv("WORKER_POLL_SECONDS") or "5")),
        batch_size=max(1, int(os.getenv("WORKER_BATCH_SIZE") or "8")),
    )
