"""Central configuration. One source of truth, read from core/.env.

Everything that varies by environment (DB creds, ports) lives here so no other
module hardcodes it. Import `settings` anywhere.
"""
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Anchors for everything that resolves a path relative to the repo. Defined HERE, in a
# module whose own location is stable, so moving a script between packages can't silently
# retarget its state file or its output — the failure mode is a file quietly written to the
# wrong directory, which looks like nothing happening at all.
CORE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = CORE_DIR.parent

_ENV_FILE = CORE_DIR / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_ENV_FILE, env_file_encoding="utf-8", extra="ignore"
    )

    # Postgres
    postgres_user: str = "investing"
    postgres_password: str = "investing"
    postgres_host: str = "localhost"
    postgres_port: int = 5432
    postgres_db: str = "investing"

    # API
    api_host: str = "127.0.0.1"
    api_port: int = 8001

    # The screen spec (config/screens/<id>.yaml) the idea board and backtests run by
    # default. This is the project's main personalisation knob — see docs/CONFIGURATION.md.
    active_screen: str = "quality-value"

    # Nasdaq Data Link / Sharadar
    nasdaq_data_link_api_key: str = ""

    # FRED (St. Louis Fed)
    fred_api_key: str = ""

    # SEC EDGAR requires a descriptive User-Agent with a real contact on every request, or
    # it returns 403. There is deliberately no usable default: put YOUR contact here.
    sec_user_agent: str = ""

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+psycopg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )


settings = Settings()
