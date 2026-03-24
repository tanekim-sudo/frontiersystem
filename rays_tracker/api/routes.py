from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException

from rays_tracker.collectors import chicago_fed_collector, fred_collector
from rays_tracker.database import (
    fetch_chicago_fed_history,
    fetch_chicago_fed_latest,
    fetch_latest_signals_by_source,
    fetch_signal_feed,
    fetch_vertical_scores_latest,
)

from .schemas import LaborOverview, RefreshResult

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")


@router.get("/scores/current")
def scores_current() -> list[dict[str, Any]]:
    return fetch_vertical_scores_latest()


@router.get("/scores/history/{vertical}")
def scores_history(vertical: str) -> dict[str, Any]:
    return {"vertical": vertical, "series": [], "note": "Populate after scoring engine lands."}


@router.get("/labor/overview", response_model=LaborOverview)
def labor_overview() -> LaborOverview:
    notes: list[str] = []
    chi = fetch_chicago_fed_latest()
    if not chi:
        notes.append("No Chicago Fed rows in DB yet — POST /api/refresh/chicago_fed")
    try:
        fred = fetch_latest_signals_by_source("fred")
    except Exception as e:
        logger.exception(e)
        fred = []
        notes.append(f"FRED read error: {e}")
    return LaborOverview(
        chicago_fed=dict(chi) if chi else None,
        fred_latest=fred,
        source_notes=notes,
    )


@router.get("/chicago-fed/latest")
def chicago_fed_latest() -> dict[str, Any] | None:
    return fetch_chicago_fed_latest()


@router.get("/chicago-fed/history")
def chicago_fed_history(limit: int = 120) -> list[dict[str, Any]]:
    return fetch_chicago_fed_history(limit)


@router.get("/jobs/postings/{vertical}")
def jobs_postings(vertical: str) -> dict[str, Any]:
    return {"vertical": vertical, "postings": [], "note": "Indeed/LinkedIn collectors not wired yet."}


@router.get("/jobs/displacement")
def jobs_displacement() -> dict[str, Any]:
    return {"displacement_proxies": [], "note": "Not wired yet."}


@router.get("/trends/google")
def trends_google() -> dict[str, Any]:
    return {"status": "not_implemented"}


@router.get("/trends/huggingface")
def trends_hf() -> dict[str, Any]:
    return {"status": "not_implemented"}


@router.get("/signals/feed")
def signals_feed(limit: int = 100) -> list[dict[str, Any]]:
    return fetch_signal_feed(limit)


_COLLECTORS = {
    "chicago_fed": lambda: chicago_fed_collector.fetch_chicago_fed(persist=True),
    "fred": lambda: fred_collector.fetch_all_fred_series(persist_latest=True),
}


@router.post("/refresh/{collector}", response_model=RefreshResult)
def refresh_collector(collector: str) -> RefreshResult:
    key = collector.strip().lower()
    if key == "all":
        out: dict[str, Any] = {}
        for name, fn in _COLLECTORS.items():
            try:
                out[name] = fn()
            except Exception as e:
                out[name] = {"error": str(e)}
        return RefreshResult(collector="all", ok=True, payload=out)
    fn = _COLLECTORS.get(key)
    if not fn:
        raise HTTPException(404, f"Unknown collector: {collector}")
    try:
        payload = fn()
        return RefreshResult(collector=key, ok=True, payload=payload if isinstance(payload, dict) else {"result": payload})
    except Exception as e:
        logger.exception("refresh %s", key)
        return RefreshResult(collector=key, ok=False, detail=str(e))
