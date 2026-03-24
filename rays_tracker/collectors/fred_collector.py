"""FRED API — free key from https://fred.stlouisfed.org/docs/api/api_key.html"""

from __future__ import annotations

import logging
from typing import Any

import requests

from rays_tracker.config import settings
from rays_tracker.database import insert_signal

logger = logging.getLogger(__name__)

FRED_BASE = "https://api.stlouisfed.org/fred/series/observations"

SERIES_MAP: dict[str, dict[str, str]] = {
    "UNRATE": {"name": "Unemployment Rate U-3", "type": "unemployment"},
    "U6RATE": {"name": "Broad Unemployment U-6", "type": "unemployment"},
    "ICSA": {"name": "Initial UI Claims Weekly", "type": "unemployment"},
    "CCSA": {"name": "Continuing UI Claims", "type": "unemployment"},
    "JTSJOL": {"name": "JOLTS Job Openings", "type": "labor_demand"},
    "JTSQUR": {"name": "JOLTS Quit Rate", "type": "worker_confidence"},
    "PAYEMS": {"name": "Total Nonfarm Payrolls", "type": "employment"},
    "CES0500000003": {"name": "Average Hourly Earnings", "type": "wages"},
    "LNS11300000": {"name": "Labor Force Participation Rate", "type": "labor_supply"},
}


def fetch_series(
    series_id: str,
    *,
    observation_start: str = "2022-01-01",
    limit: int = 52,
) -> list[dict[str, Any]]:
    key = settings.fred_api_key.strip()
    if not key:
        raise ValueError("FRED_API_KEY / fred_api_key missing — set in .env")

    params = {
        "series_id": series_id,
        "api_key": key,
        "file_type": "json",
        "observation_start": observation_start,
        "sort_order": "desc",
        "limit": limit,
    }
    r = requests.get(FRED_BASE, params=params, timeout=45)
    r.raise_for_status()
    data = r.json()
    return data.get("observations") or []


def fetch_all_fred_series(persist_latest: bool = True) -> dict[str, Any]:
    """Pull configured series; optionally persist latest observation per series to signals."""
    results: dict[str, Any] = {}
    for series_id, meta in SERIES_MAP.items():
        try:
            obs = fetch_series(series_id)
            results[series_id] = {"meta": meta, "observations": obs, "error": None}
            if persist_latest and obs:
                latest = obs[0]
                val = latest.get("value")
                if val not in (".", "", None):
                    insert_signal(
                        date=str(latest.get("date", ""))[:10],
                        source="fred",
                        signal_type=meta["type"],
                        metric_name=series_id,
                        value=float(val),
                        raw={"series_name": meta["name"], "realtime_start": latest.get("realtime_start")},
                    )
        except Exception as e:
            logger.warning("FRED %s failed: %s", series_id, e)
            results[series_id] = {"meta": meta, "observations": [], "error": str(e)}
    return results


def fetch_single_series(series_id: str) -> list[dict[str, Any]]:
    return fetch_series(series_id)
