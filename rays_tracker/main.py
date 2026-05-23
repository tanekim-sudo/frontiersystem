"""FastAPI entry — run: uvicorn <python_package>.main:app --reload --port 8765 (from repo root, PYTHONPATH=.)"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.routes import router
from .database import init_db

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    try:
        from .scheduler import start_scheduler

        start_scheduler()
    except Exception as e:
        logger.warning("Scheduler not started: %s", e)
    yield


app = FastAPI(title="Labor & AI Demand Tracker", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
