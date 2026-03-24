"""SQLite storage — schema + helpers."""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from rays_tracker.config import settings

_SCHEMA = """
CREATE TABLE IF NOT EXISTS signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  source TEXT NOT NULL,
  vertical TEXT,
  signal_type TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  value REAL,
  raw_json TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vertical_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  vertical TEXT NOT NULL,
  demand_score REAL,
  authenticity_score REAL,
  displacement_score REAL,
  composite_score REAL,
  score_components TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chicago_fed_indicators (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  release_date TEXT NOT NULL UNIQUE,
  forecast_unemployment REAL,
  layoffs_separations_rate REAL,
  hiring_rate_unemployed REAL,
  forecast_50pct_lower REAL,
  forecast_50pct_upper REAL,
  official_u3 REAL,
  raw_data TEXT,
  fetched_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS job_postings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  source TEXT NOT NULL,
  query TEXT NOT NULL,
  vertical TEXT,
  role_category TEXT,
  count INTEGER,
  wow_delta REAL,
  yoy_delta REAL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS google_trends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  keyword TEXT NOT NULL,
  interest_value INTEGER,
  geo TEXT DEFAULT 'US',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_signals_date ON signals(date);
CREATE INDEX IF NOT EXISTS idx_signals_source ON signals(source);
CREATE INDEX IF NOT EXISTS idx_chicago_release ON chicago_fed_indicators(release_date);
"""


def _db_path() -> Path:
    url = settings.database_url
    if url.startswith("sqlite:///"):
        raw = url.replace("sqlite:///", "", 1)
        p = Path(raw)
        if not p.is_absolute():
            p = Path(__file__).resolve().parent.parent / p
        return p
    raise ValueError("Only sqlite:/// URLs are supported in this build")


def init_db() -> None:
    path = _db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path) as conn:
        conn.executescript(_SCHEMA)
        conn.commit()


@contextmanager
def get_connection() -> Iterator[sqlite3.Connection]:
    path = _db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def insert_signal(
    *,
    date: str,
    source: str,
    signal_type: str,
    metric_name: str,
    value: float | None,
    vertical: str | None = None,
    raw: Any | None = None,
) -> None:
    with get_connection() as conn:
        conn.execute(
            """INSERT INTO signals (date, source, vertical, signal_type, metric_name, value, raw_json)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                date,
                source,
                vertical,
                signal_type,
                metric_name,
                value,
                json.dumps(raw) if raw is not None else None,
            ),
        )


def fetch_chicago_fed_latest() -> dict[str, Any] | None:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM chicago_fed_indicators ORDER BY release_date DESC LIMIT 1"
        ).fetchone()
        return dict(row) if row else None


def fetch_chicago_fed_history(limit: int = 120) -> list[dict[str, Any]]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM chicago_fed_indicators ORDER BY release_date DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]


def fetch_latest_signals_by_source(source: str, limit: int = 200) -> list[dict[str, Any]]:
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT s.* FROM signals s
            INNER JOIN (
              SELECT metric_name, MAX(date) AS d FROM signals WHERE source = ?
              GROUP BY metric_name
            ) t ON s.metric_name = t.metric_name AND s.date = t.d AND s.source = ?
            ORDER BY s.metric_name
            """,
            (source, source),
        ).fetchall()
        if rows:
            return [dict(r) for r in rows]
        rows = conn.execute(
            "SELECT * FROM signals WHERE source = ? ORDER BY date DESC LIMIT ?",
            (source, limit),
        ).fetchall()
        return [dict(r) for r in rows]


def fetch_signal_feed(limit: int = 100) -> list[dict[str, Any]]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM signals ORDER BY date DESC, id DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]


def fetch_vertical_scores_latest() -> list[dict[str, Any]]:
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT v.* FROM vertical_scores v
            INNER JOIN (
              SELECT vertical, MAX(date) AS d FROM vertical_scores GROUP BY vertical
            ) t ON v.vertical = t.vertical AND v.date = t.d
            """
        ).fetchall()
        return [dict(r) for r in rows]


def insert_chicago_fed_row(
    *,
    release_date: str,
    forecast_unemployment: float | None,
    layoffs_separations_rate: float | None,
    hiring_rate_unemployed: float | None,
    forecast_50pct_lower: float | None,
    forecast_50pct_upper: float | None,
    official_u3: float | None,
    raw_data: dict[str, Any],
) -> None:
    with get_connection() as conn:
        conn.execute(
            """INSERT INTO chicago_fed_indicators (
                 release_date, forecast_unemployment, layoffs_separations_rate,
                 hiring_rate_unemployed, forecast_50pct_lower, forecast_50pct_upper,
                 official_u3, raw_data, fetched_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(release_date) DO UPDATE SET
                 forecast_unemployment=excluded.forecast_unemployment,
                 layoffs_separations_rate=excluded.layoffs_separations_rate,
                 hiring_rate_unemployed=excluded.hiring_rate_unemployed,
                 forecast_50pct_lower=excluded.forecast_50pct_lower,
                 forecast_50pct_upper=excluded.forecast_50pct_upper,
                 official_u3=excluded.official_u3,
                 raw_data=excluded.raw_data,
                 fetched_at=excluded.fetched_at
            """,
            (
                release_date,
                forecast_unemployment,
                layoffs_separations_rate,
                hiring_rate_unemployed,
                forecast_50pct_lower,
                forecast_50pct_upper,
                official_u3,
                json.dumps(raw_data, default=str),
                utc_now_iso(),
            ),
        )
