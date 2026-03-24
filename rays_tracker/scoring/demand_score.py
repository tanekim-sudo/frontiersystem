"""AI demand score — wire when Indeed/HF/Trends collectors land."""

DEMAND_WEIGHTS = {
    "indeed_ai_role_growth": 0.35,
    "hf_download_growth": 0.25,
    "google_trends_ai_vertical": 0.20,
    "github_framework_growth": 0.20,
}


def compute_demand_score(vertical: str, signals: dict) -> float:
    return 0.0
