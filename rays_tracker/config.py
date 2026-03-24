"""Load settings from environment (.env at repo root)."""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_REPO_ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_REPO_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    fred_api_key: str = ""
    bls_api_key: str = ""
    github_token: str = ""
    database_url: str = f"sqlite:///{_REPO_ROOT / 'data' / 'rays_tracker.db'}"


settings = Settings()
