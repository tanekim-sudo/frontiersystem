from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ChicagoFedRow(BaseModel):
    id: int | None = None
    release_date: str
    forecast_unemployment: float | None = None
    layoffs_separations_rate: float | None = None
    hiring_rate_unemployed: float | None = None
    forecast_50pct_lower: float | None = None
    forecast_50pct_upper: float | None = None
    official_u3: float | None = None
    fetched_at: str | None = None


class SignalRow(BaseModel):
    model_config = {"extra": "allow"}

    date: str
    source: str
    signal_type: str
    metric_name: str
    value: float | None = None
    vertical: str | None = None


class LaborOverview(BaseModel):
    chicago_fed: dict[str, Any] | None = None
    fred_latest: list[dict[str, Any]] = Field(default_factory=list)
    source_notes: list[str] = Field(default_factory=list)


class RefreshResult(BaseModel):
    collector: str
    ok: bool
    detail: str | None = None
    payload: dict[str, Any] | None = None
