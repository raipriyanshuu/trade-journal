"""Seed data: instrument master (verify-badged), default settings, mistake tags.

Contract specifications and Indian lot sizes change over time, so every seeded
instrument is created with ``verified = False`` -- the UI shows a "verify" badge
until the user confirms it in Settings.
"""

from __future__ import annotations

from decimal import Decimal

from sqlalchemy.orm import Session

from app.models import Instrument, Setting, Tag

# --- Session definition templates (times are in the instrument's session tz) ---

CME_INDEX_SESSION = {
    "regular_start": "09:30",
    "regular_end": "16:00",
    "trading_day_start": "18:00",
    "trading_day_start_offset_days": -1,  # trading day opens the previous evening
    "ib_minutes": 60,
    "reference_open": "09:30",
}

COMEX_GOLD_SESSION = {
    "regular_start": "08:20",
    "regular_end": "13:30",
    "trading_day_start": "18:00",
    "trading_day_start_offset_days": -1,
    "ib_minutes": 60,
    "reference_open": "08:20",
}

NYMEX_CRUDE_SESSION = {
    "regular_start": "09:00",
    "regular_end": "14:30",
    "trading_day_start": "18:00",
    "trading_day_start_offset_days": -1,
    "ib_minutes": 60,
    "reference_open": "09:00",
}

NSE_SESSION = {
    "regular_start": "09:15",
    "regular_end": "15:30",
    "trading_day_start": "09:15",
    "trading_day_start_offset_days": 0,
    "ib_minutes": 60,
    "reference_open": "09:15",
}

MCX_SESSION = {
    "regular_start": "09:00",
    "regular_end": "23:30",
    "close_standard_time": "23:55",  # when the US is on standard time
    "trading_day_start": "09:00",
    "trading_day_start_offset_days": 0,
    "ib_minutes": 60,
    "reference_open": "09:00",
}


def _inst(
    symbol, name, exchange, currency, pv, tick, lot, asset, qty_unit, tz, session
) -> dict:
    return dict(
        symbol_root=symbol,
        display_name=name,
        exchange=exchange,
        currency=currency,
        point_value=Decimal(pv),
        tick_size=Decimal(tick),
        lot_size=Decimal(lot),
        asset_class=asset,
        quantity_unit=qty_unit,
        session_timezone=tz,
        session_definitions=session,
        verified=False,
        active=True,
    )


INSTRUMENT_SEEDS = [
    # symbol, name, exchange, ccy, point_value, tick, lot_size, asset, qty_unit, tz, session
    _inst("ES", "E-mini S&P 500", "CME", "USD", "50", "0.25", "1", "equity_index", "lots", "America/New_York", CME_INDEX_SESSION),
    _inst("MES", "Micro E-mini S&P 500", "CME", "USD", "5", "0.25", "1", "equity_index", "lots", "America/New_York", CME_INDEX_SESSION),
    _inst("NQ", "E-mini Nasdaq 100", "CME", "USD", "20", "0.25", "1", "equity_index", "lots", "America/New_York", CME_INDEX_SESSION),
    _inst("MNQ", "Micro E-mini Nasdaq 100", "CME", "USD", "2", "0.25", "1", "equity_index", "lots", "America/New_York", CME_INDEX_SESSION),
    _inst("GC", "Gold", "COMEX", "USD", "100", "0.10", "1", "metal", "lots", "America/New_York", COMEX_GOLD_SESSION),
    _inst("MGC", "Micro Gold", "COMEX", "USD", "10", "0.10", "1", "metal", "lots", "America/New_York", COMEX_GOLD_SESSION),
    _inst("CL", "Crude Oil", "NYMEX", "USD", "1000", "0.01", "1", "energy", "lots", "America/New_York", NYMEX_CRUDE_SESSION),
    _inst("MCL", "Micro Crude Oil", "NYMEX", "USD", "100", "0.01", "1", "energy", "lots", "America/New_York", NYMEX_CRUDE_SESSION),
    # Nifty: point value per 1.0 move per lot = lot size. Broker exports usually in units.
    _inst("NIFTY", "Nifty 50 Futures", "NSE", "INR", "75", "0.05", "75", "equity_index", "units", "Asia/Kolkata", NSE_SESSION),
    _inst("CRUDEOIL", "MCX Crude Oil", "MCX", "INR", "100", "1", "100", "energy", "lots", "Asia/Kolkata", MCX_SESSION),
    _inst("CRUDEOILM", "MCX Crude Oil Mini", "MCX", "INR", "10", "1", "10", "energy", "lots", "Asia/Kolkata", MCX_SESSION),
    _inst("GOLD", "MCX Gold (1 kg)", "MCX", "INR", "100", "1", "100", "metal", "lots", "Asia/Kolkata", MCX_SESSION),
    _inst("GOLDM", "MCX Gold Mini", "MCX", "INR", "10", "1", "10", "metal", "lots", "Asia/Kolkata", MCX_SESSION),
    _inst("SILVER", "MCX Silver (30 kg)", "MCX", "INR", "30", "1", "30", "metal", "lots", "Asia/Kolkata", MCX_SESSION),
    _inst("SILVERM", "MCX Silver Mini", "MCX", "INR", "5", "1", "5", "metal", "lots", "Asia/Kolkata", MCX_SESSION),
    _inst("NATURALGAS", "MCX Natural Gas", "MCX", "INR", "1250", "0.10", "1250", "energy", "lots", "Asia/Kolkata", MCX_SESSION),
]


DEFAULT_SETTINGS = {
    "display_timezone": "Asia/Kolkata",
    "usd_inr_rate": "88.0",
    "breakeven_threshold": {"USD": "1", "INR": "50"},
    "big_win_threshold_r": 2,
    "mistake_rules": {
        "REVENGE": {"enabled": True, "minutes": 5},
        "TWO_STRIKES": {"enabled": True, "losses": 2},
        "OVERTRADING": {"enabled": True, "max_trades": 6},
        "AFTER_DAILY_LIMIT": {"enabled": True},
        "LOSS_EXCEEDS_PLAN": {"enabled": True, "tolerance_pct": 20},
        "NO_STOP": {"enabled": True},
        "OVERSIZE": {"enabled": True},
        "ADDED_TO_LOSER": {"enabled": True},
        "FIRST_MINUTES": {"enabled": True, "minutes": 5},
        "NEWS_WINDOW": {"enabled": True, "minutes": 5},
        "UNPLANNED": {"enabled": True},
        "FADED_TREND_DAY": {"enabled": True},
        "HELD_LOSERS": {"enabled": True, "ratio": 1.5},
    },
}


MISTAKE_TAG_SEEDS = [
    "moved stop",
    "no stop",
    "chased entry",
    "early exit",
    "late exit",
    "oversized",
    "revenge",
    "FOMO",
    "ignored plan",
    "traded against VWAP",
    "faded trend day",
    "traded middle of range",
    "broke two-strikes rule",
]


def seed_instruments(db: Session) -> int:
    existing = {i.symbol_root for i in db.query(Instrument).all()}
    added = 0
    for data in INSTRUMENT_SEEDS:
        if data["symbol_root"] in existing:
            continue
        db.add(Instrument(**data))
        added += 1
    db.commit()
    return added


def seed_default_settings(db: Session) -> int:
    existing = {s.key for s in db.query(Setting).all()}
    added = 0
    for key, value in DEFAULT_SETTINGS.items():
        if key in existing:
            continue
        db.add(Setting(key=key, value=value))
        added += 1
    db.commit()
    return added


def seed_mistake_tags(db: Session) -> int:
    existing = {(t.name, t.category) for t in db.query(Tag).all()}
    added = 0
    for name in MISTAKE_TAG_SEEDS:
        if (name, "mistake") in existing:
            continue
        db.add(Tag(name=name, category="mistake"))
        added += 1
    db.commit()
    return added


def seed_all(db: Session) -> dict[str, int]:
    return {
        "instruments": seed_instruments(db),
        "settings": seed_default_settings(db),
        "mistake_tags": seed_mistake_tags(db),
    }
