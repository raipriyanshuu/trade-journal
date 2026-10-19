"""Seeds: instrument master (verify-badged), default settings, mistake tags."""

from __future__ import annotations

from app.seeds import INSTRUMENT_SEEDS, MISTAKE_TAG_SEEDS, seed_all
from app.models import Instrument, Setting, Tag


def test_seed_counts(db):
    result = seed_all(db)
    assert result["instruments"] == len(INSTRUMENT_SEEDS) == 16
    assert result["mistake_tags"] == len(MISTAKE_TAG_SEEDS) == 13
    assert result["settings"] >= 5


def test_seed_is_idempotent(db):
    seed_all(db)
    second = seed_all(db)
    assert second == {"instruments": 0, "settings": 0, "mistake_tags": 0}
    assert db.query(Instrument).count() == 16


def test_seeded_instruments_are_unverified(db):
    seed_all(db)
    insts = db.query(Instrument).all()
    assert all(not i.verified for i in insts), "seeded specs must need verification"


def test_key_instrument_specs(db):
    seed_all(db)
    by_symbol = {i.symbol_root: i for i in db.query(Instrument).all()}
    assert str(by_symbol["ES"].point_value) == "50"
    assert str(by_symbol["ES"].tick_size) == "0.25"
    assert str(by_symbol["NIFTY"].lot_size) == "75"
    assert by_symbol["NIFTY"].quantity_unit == "units"
    assert by_symbol["NIFTY"].currency == "INR"
    assert by_symbol["CRUDEOIL"].exchange == "MCX"
    # CME index trading day starts the previous evening.
    assert by_symbol["ES"].session_definitions["trading_day_start_offset_days"] == -1


def test_default_settings_present(db):
    seed_all(db)
    settings = {s.key: s.value for s in db.query(Setting).all()}
    assert settings["display_timezone"] == "Asia/Kolkata"
    assert "usd_inr_rate" in settings
    assert "mistake_rules" in settings
    assert settings["breakeven_threshold"]["USD"]


def test_mistake_tags_seeded(db):
    seed_all(db)
    names = {t.name for t in db.query(Tag).filter(Tag.category == "mistake").all()}
    assert "revenge" in names
    assert "moved stop" in names
    assert len(names) == 13
