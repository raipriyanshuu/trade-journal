"""Trading-date assignment across time zones and US daylight-saving changes."""

from __future__ import annotations

from datetime import date, datetime, timezone

from app.core.sessions import trading_date_for
from app.models import Instrument
from app.seeds import seed_all


def _inst(db, symbol):
    return db.query(Instrument).filter_by(symbol_root=symbol).first()


def test_cme_overnight_belongs_to_next_trading_day(db):
    seed_all(db)
    es = _inst(db, "ES")
    # 03:30 IST on 2026-10-15 == 22:00 UTC on 2026-10-14 == 18:00 NY (EDT) 10-14.
    dt = datetime(2026, 10, 14, 22, 0, tzinfo=timezone.utc)
    assert trading_date_for(dt, es) == date(2026, 10, 15)


def test_cme_daytime_is_same_day(db):
    seed_all(db)
    es = _inst(db, "ES")
    # 14:00 UTC == 10:00 NY (EDT) -> same trading day.
    dt = datetime(2026, 10, 14, 14, 0, tzinfo=timezone.utc)
    assert trading_date_for(dt, es) == date(2026, 10, 14)


def test_cme_trading_date_stable_across_us_dst():
    # Build a bare ES-like instrument to test the rule directly.
    es = Instrument(
        symbol_root="ESX",
        display_name="x",
        exchange="CME",
        currency="USD",
        point_value="50",
        tick_size="0.25",
        lot_size="1",
        session_timezone="America/New_York",
        session_definitions={"trading_day_start": "18:00", "trading_day_start_offset_days": -1},
    )
    # Winter (EST, UTC-5): 18:30 NY == 23:30 UTC.
    winter = datetime(2026, 1, 15, 23, 30, tzinfo=timezone.utc)
    # Summer (EDT, UTC-4): 18:30 NY == 22:30 UTC.
    summer = datetime(2026, 7, 15, 22, 30, tzinfo=timezone.utc)
    # Same wall-clock 18:30 -> both roll to the next day despite different UTC.
    assert trading_date_for(winter, es) == date(2026, 1, 16)
    assert trading_date_for(summer, es) == date(2026, 7, 16)


def test_nse_is_same_calendar_day(db):
    seed_all(db)
    nifty = _inst(db, "NIFTY")
    # 05:00 UTC == 10:30 IST.
    dt = datetime(2026, 10, 14, 5, 0, tzinfo=timezone.utc)
    assert trading_date_for(dt, nifty) == date(2026, 10, 14)


def test_mcx_evening_is_same_day(db):
    seed_all(db)
    crude = _inst(db, "CRUDEOIL")
    # 17:30 UTC == 23:00 IST (MCX evening) -> still the same trading date.
    dt = datetime(2026, 10, 14, 17, 30, tzinfo=timezone.utc)
    assert trading_date_for(dt, crude) == date(2026, 10, 14)
