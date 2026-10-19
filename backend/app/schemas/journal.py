"""Daily journal (session) schemas: morning plan + evening review."""

from __future__ import annotations

from datetime import date

from pydantic import BaseModel

from app.schemas.common import DecimalStr, ORMModel


class DailySessionBase(BaseModel):
    htf_read: str = ""
    prior_day_type: str | None = None
    prior_profile_shape: str | None = None
    prior_vah: DecimalStr | None = None
    prior_poc: DecimalStr | None = None
    prior_val: DecimalStr | None = None
    on_high: DecimalStr | None = None
    on_low: DecimalStr | None = None
    on_poc: DecimalStr | None = None
    on_vwap: DecimalStr | None = None
    on_range_vs_atr: str | None = None
    on_inventory: str | None = None
    expected_open_location: str | None = None
    levels: list = []
    scenarios: list = []
    news_events: list = []
    actual_opening_type: str | None = None
    actual_day_type: str | None = None
    scenario_played_out: str | None = None
    followed_plan: str | None = None
    what_to_repeat: str = ""
    what_to_change: str = ""
    mood: int | None = None
    sleep: int | None = None


class DailySessionUpsert(DailySessionBase):
    account_id: int | None = None
    instrument_id: int | None = None
    trading_date: date


class DailySessionRead(DailySessionBase, ORMModel):
    id: int
    account_id: int | None
    instrument_id: int | None
    trading_date: date
