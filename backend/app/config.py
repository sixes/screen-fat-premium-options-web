from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from pydantic import BaseModel


class Settings(BaseModel):
    app_key: str
    app_secret: str
    access_token: str


class ScreenParams(BaseModel):
    symbols: list[str]
    side: str = "both"
    min_annual_return: float = 20.0
    max_dte: int = 70
    min_otm: float = 0.1
    max_abs_delta: float = 100.0
    min_open_interest: int = 1
    max_spread_ratio: float = 100.0
    min_iv_rank: float = 0.0
    min_pop: float = 0.0
    pre_market: bool = False


def load_settings() -> Settings:
    load_dotenv()

    app_key = os.environ.get("LONGPORT_APP_KEY", "")
    app_secret = os.environ.get("LONGPORT_APP_SECRET", "")
    access_token = os.environ.get("LONGPORT_ACCESS_TOKEN", "")

    missing = []
    if not app_key:
        missing.append("LONGPORT_APP_KEY")
    if not app_secret:
        missing.append("LONGPORT_APP_SECRET")
    if not access_token:
        missing.append("LONGPORT_ACCESS_TOKEN")

    if missing:
        raise EnvironmentError(f"Missing required environment variable(s): {', '.join(missing)}")

    return Settings(app_key=app_key, app_secret=app_secret, access_token=access_token)
