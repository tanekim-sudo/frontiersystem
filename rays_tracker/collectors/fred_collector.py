"""FRED API — free key from https://fred.stlouisfed.org/docs/api/api_key.html"""

from __future__ import annotations

import logging
from typing import Any

import requests

from ..config import settings
from ..database import insert_signal

logger = logging.getLogger(__name__)

FRED_BASE = "https://api.stlouisfed.org/fred/series/observations"

# Keep aligned with lib/labor/fred.js (category → stored as signal_type).
SERIES_MAP: dict[str, dict[str, str]] = {
    "UNRATE": {"name": "Unemployment Rate (U-3)", "type": "labor"},
    "U6RATE": {"name": "U-6 Underemployment", "type": "labor"},
    "EMRATIO": {"name": "Employment-Population Ratio", "type": "labor"},
    "LNS11300000": {"name": "Labor Force Participation", "type": "labor"},
    "PAYEMS": {"name": "Nonfarm Payrolls (000s)", "type": "labor"},
    "CES0500000003": {"name": "Avg Hourly Earnings (private)", "type": "wages"},
    "ICSA": {"name": "Initial Jobless Claims", "type": "labor"},
    "CCSA": {"name": "Continuing Claims", "type": "labor"},
    "JTSJOL": {"name": "JOLTS Job Openings", "type": "jolts"},
    "JTSHIR": {"name": "JOLTS Hires", "type": "jolts"},
    "JTSQUR": {"name": "JOLTS Quit Rate", "type": "jolts"},
    "JTSR": {"name": "Job Openings Rate", "type": "jolts"},
    "GDPC1": {"name": "Real GDP", "type": "growth"},
    "INDPRO": {"name": "Industrial Production", "type": "growth"},
    "RSXFS": {"name": "Retail Sales (ex food)", "type": "growth"},
    "PCEC96": {"name": "Real Personal Consumption", "type": "growth"},
    "HOUST": {"name": "Housing Starts", "type": "housing"},
    "UMCSENT": {"name": "U Michigan Consumer Sentiment", "type": "sentiment"},
    "VIXCLS": {"name": "VIX (close)", "type": "financial_stress"},
    "NFCI": {"name": "Chicago Fed NFCI", "type": "financial_stress"},
    "STLFSI4": {"name": "St. Louis Fed Financial Stress", "type": "financial_stress"},
    "DGS10": {"name": "10Y Treasury Yield", "type": "rates"},
    "DGS2": {"name": "2Y Treasury Yield", "type": "rates"},
    "T10Y2Y": {"name": "10Y–2Y Treasury Spread", "type": "rates"},
    "IPG3341S": {"name": "Computer & Electronic Products IP", "type": "tech_production"},
    "IPG3342S": {"name": "Computer Equipment IP", "type": "tech_production"},
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
