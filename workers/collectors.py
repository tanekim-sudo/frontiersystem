from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any


def _iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _seed_number(company_id: str, metric_id: str) -> float:
    # Deterministic baseline for scaffold collectors.
    return float((abs(hash(f"{company_id}:{metric_id}")) % 7000) + 100)


def collect_live_metrics(job: dict[str, Any]) -> list[dict[str, Any]]:
    """
    Scaffold collector for the live runtime.
    Replace each metric branch with true source adapters over time.
    """
    layer = (job.get("layer") or "agent").strip()
    company_id = (job.get("company_id") or "osworld").strip()
    payload = job.get("payload") or {}
    metric_ids: list[str] = payload.get("metric_ids") or []

    if not metric_ids:
        default_by_layer = {
            "physical_ai": ["physical_production_hours", "physical_ur_asp"],
            "voice": ["voice_arr", "voice_dau_mau"],
            "spatial": ["spatial_units"],
            "agent": ["agent_osworld_success", "agent_deployment_ratio"],
            "neural": ["neural_implants", "neural_electrode_count"],
        }
        metric_ids = default_by_layer.get(layer, ["agent_osworld_success"])

    out: list[dict[str, Any]] = []
    now = _iso_now()
    for metric_id in metric_ids:
        base = _seed_number(company_id, metric_id)
        if metric_id == "agent_osworld_success":
            value_numeric = 60 + (base % 22)  # bounded realistic scaffold
        elif metric_id.endswith("_ratio") or metric_id == "voice_dau_mau":
            value_numeric = round(0.8 + (base % 120) / 100.0, 3)
        elif metric_id.endswith("_units") or metric_id.endswith("_implants") or metric_id.endswith("_count"):
            value_numeric = int(base % 50000)
        else:
            value_numeric = round(base * (1 + ((base % 13) / 100.0)), 2)

        if isinstance(value_numeric, float) and not math.isfinite(value_numeric):
            value_numeric = None
        out.append(
            {
                "company_id": company_id,
                "metric_id": metric_id,
                "source_id": f"{layer}_collector_scaffold",
                "observed_at": now,
                "value_numeric": value_numeric,
                "value_text": None,
                "confidence": "medium",
                "raw_json": {"collector": "scaffold", "layer": layer, "payload": payload},
            }
        )
    return out
