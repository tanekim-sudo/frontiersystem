"""Recompute vertical_scores from latest signals (placeholder)."""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def recompute_all_scores() -> None:
    """Called by scheduler after collectors run."""
    logger.info("recompute_all_scores: no-op until job + HF + trends pipelines exist")
