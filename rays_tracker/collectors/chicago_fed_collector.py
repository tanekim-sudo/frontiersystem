"""
Chicago Fed Labor Market Indicators (public xlsx, no API key).
https://www.chicagofed.org/publications/chicago-fed-labor-market-indicators/index
"""

from __future__ import annotations

import logging
from io import BytesIO
from typing import Any

import pandas as pd
import requests

from rays_tracker.database import insert_chicago_fed_row, insert_signal, utc_now_iso

logger = logging.getLogger(__name__)

CHICAGO_FED_URL = (
    "https://www.chicagofed.org/-/media/publications/chicago-fed-labor-market-indicators/"
    "chi-labor-market-indicators.xlsx"
)
USER_AGENT = "RaysCapital-Research/1.0 (+https://github.com)"


def _find_sheet(names: list[str], predicate) -> str | None:
    for n in names:
        if predicate(n):
            return n
    return None


def download_chicago_fed_xlsx(timeout: int = 60) -> bytes:
    r = requests.get(
        CHICAGO_FED_URL,
        headers={"User-Agent": USER_AGENT},
        timeout=timeout,
    )
    r.raise_for_status()
    return r.content


def parse_chicago_fed_excel(content: bytes) -> dict[str, Any]:
    xl = pd.ExcelFile(BytesIO(content))
    sheet_names = list(xl.sheet_names)
    rates_name = _find_sheet(sheet_names, lambda s: s.strip().startswith("1.") and "Rates" in s)
    rt_name = _find_sheet(
        sheet_names,
        lambda s: "Real-Time UR" in s and "Contributions" not in s and "Probs" not in s,
    )
    if not rates_name or not rt_name:
        raise ValueError(f"Unexpected workbook structure. Sheets: {sheet_names}")

    rates = pd.read_excel(xl, rates_name)
    rates["date"] = pd.to_datetime(rates["date"], errors="coerce").dt.normalize()
    rates = rates.dropna(subset=["date"])

    rt = pd.read_excel(xl, rt_name, header=1)
    rt["date"] = pd.to_datetime(rt["date"], errors="coerce").dt.normalize()
    rt = rt.dropna(subset=["date"])

    merged = rt.merge(rates, on="date", how="left", suffixes=("", "_r"))
    merged = merged.sort_values("date")
    def _clean_cell(v):
        if v is None:
            return None
        if isinstance(v, float) and pd.isna(v):
            return None
        if hasattr(v, "isoformat"):
            return v.isoformat()
        return v

    latest = {k: _clean_cell(v) for k, v in merged.iloc[-1].to_dict().items()}

    # Last row with non-null layoffs (latest file sometimes has partial rates row)
    rates_clean = rates.dropna(subset=["layoffs_other_seps"], how="any")
    last_rates = rates_clean.iloc[-1].to_dict() if len(rates_clean) else {}

    def _num(x) -> float | None:
        if x is None or (isinstance(x, float) and pd.isna(x)):
            return None
        try:
            return float(x)
        except (TypeError, ValueError):
            return None

    release = latest["date"]
    if hasattr(release, "strftime"):
        release_s = release.strftime("%Y-%m-%d")
    else:
        release_s = (str(release)[:10] if release else "")[:10]

    lo = _num(latest.get("forecast25f"))
    if lo is None:
        lo = _num(latest.get("forecast25a"))
    hi = _num(latest.get("forecast75f"))
    if hi is None:
        hi = _num(latest.get("forecast75a"))
    fc50f = _num(latest.get("forecast50f"))
    fc50a = _num(latest.get("forecast50a"))
    forecast_u = fc50f if fc50f is not None else fc50a

    lay = _num(latest.get("layoffs_other_seps"))
    hire = _num(latest.get("hiring_rate_uw"))
    if lay is None and last_rates:
        lay = _num(last_rates.get("layoffs_other_seps"))
    if hire is None and last_rates:
        hire = _num(last_rates.get("hiring_rate_uw"))

    official = _num(latest.get("official_u3"))

    raw = {
        "sheet_names": sheet_names,
        "latest_release_date": release_s,
        "latest_row": latest,
        "source_url": CHICAGO_FED_URL,
    }

    return {
        "release_date": release_s,
        "forecast_unemployment": forecast_u,
        "forecast_50pct_lower": lo,
        "forecast_50pct_upper": hi,
        "layoffs_separations_rate": lay,
        "hiring_rate_unemployed": hire,
        "official_u3": official,
        "raw": raw,
    }


def fetch_chicago_fed(persist: bool = True) -> dict[str, Any]:
    """Download, parse, optionally store Chicago Fed indicators + signal rows."""
    content = download_chicago_fed_xlsx()
    parsed = parse_chicago_fed_excel(content)

    if persist:
        insert_chicago_fed_row(
            release_date=parsed["release_date"],
            forecast_unemployment=parsed["forecast_unemployment"],
            layoffs_separations_rate=parsed["layoffs_separations_rate"],
            hiring_rate_unemployed=parsed["hiring_rate_unemployed"],
            forecast_50pct_lower=parsed["forecast_50pct_lower"],
            forecast_50pct_upper=parsed["forecast_50pct_upper"],
            official_u3=parsed["official_u3"],
            raw_data=parsed["raw"],
        )
        now = utc_now_iso()[:10]
        base = parsed["release_date"]
        if parsed["forecast_unemployment"] is not None:
            insert_signal(
                date=base,
                source="chicago_fed",
                vertical=None,
                signal_type="unemployment",
                metric_name="realtime_ur_forecast_50",
                value=parsed["forecast_unemployment"],
                raw={"interval": [parsed["forecast_50pct_lower"], parsed["forecast_50pct_upper"]]},
            )
        if parsed["layoffs_separations_rate"] is not None:
            insert_signal(
                date=base,
                source="chicago_fed",
                signal_type="labor_turnover",
                metric_name="layoffs_other_separations_rate",
                value=parsed["layoffs_separations_rate"],
            )
        if parsed["hiring_rate_unemployed"] is not None:
            insert_signal(
                date=base,
                source="chicago_fed",
                signal_type="labor_turnover",
                metric_name="hiring_rate_unemployed_workers",
                value=parsed["hiring_rate_unemployed"],
            )
        if parsed["official_u3"] is not None:
            insert_signal(
                date=base,
                source="chicago_fed",
                signal_type="unemployment",
                metric_name="official_u3_bls",
                value=parsed["official_u3"],
            )
        logger.info("Chicago Fed stored for release_date=%s", parsed["release_date"])

    return parsed
