"""CSV import, Notion migration, duplicate detection and batch undo."""

from __future__ import annotations

from decimal import Decimal

from app.core.importing import resolve_symbol, run_import, undo_batch
from app.models import Account, Execution, Instrument, Tag, Trade
from app.seeds import seed_all


def _setup(db):
    seed_all(db)
    acc = Account(name="Imp", currency="USD", type="personal", starting_balance=Decimal("0"))
    db.add(acc)
    db.commit()
    return acc


def _instruments(db):
    return list(db.query(Instrument).all())


def test_symbol_resolution(db):
    seed_all(db)
    insts = _instruments(db)
    assert resolve_symbol("ESZ6", insts, {}).symbol_root == "ES"
    assert resolve_symbol("MESZ6", insts, {}).symbol_root == "MES"
    assert resolve_symbol("NIFTY26OCTFUT", insts, {}).symbol_root == "NIFTY"
    assert resolve_symbol("ES 12-26", insts, {}).symbol_root == "ES"
    assert resolve_symbol("XYZ", insts, {}) is None
    assert resolve_symbol("WEIRD", insts, {"WEIRD": "ES"}).symbol_root == "ES"


def test_import_fills(db):
    acc = _setup(db)
    content = (
        "time,sym,side,qty,price,fee\n"
        "2026-10-14 14:00:00,ES,buy,1,5000,2\n"
        "2026-10-14 14:30:00,ES,sell,1,5010,2\n"
    ).encode()
    cfg = {
        "source": "import", "account_id": acc.id, "format": "fills",
        "column_map": {"timestamp": "time", "symbol": "sym", "side": "side",
                       "quantity": "qty", "price": "price", "fees": "fee"},
        "datetime_format": "%Y-%m-%d %H:%M:%S", "file_timezone": "America/New_York",
        "quantity_unit": "lots",
    }
    res = run_import(db, content=content, config=cfg)
    assert res["imported"] == 2
    assert res["failed"] == 0
    trades = db.query(Trade).all()
    assert len(trades) == 1
    assert trades[0].net_pnl == Decimal("496")


def test_import_roundtrip_units_to_lots(db):
    acc = _setup(db)
    content = (
        "sym,dir,etime,eprice,xtime,xprice,qty\n"
        "NIFTY,long,2026-10-14 10:00,20000,2026-10-14 10:30,20010,75\n"
    ).encode()
    cfg = {
        "source": "import", "account_id": acc.id, "format": "roundtrip",
        "column_map": {"symbol": "sym", "direction": "dir", "entry_time": "etime",
                       "entry_price": "eprice", "exit_time": "xtime", "exit_price": "xprice",
                       "quantity": "qty"},
        "datetime_format": "%Y-%m-%d %H:%M", "file_timezone": "Asia/Kolkata",
        "quantity_unit": "units",
    }
    res = run_import(db, content=content, config=cfg)
    assert res["imported"] == 2  # two executions
    t = db.query(Trade).one()
    assert t.max_position_size == Decimal("1")  # 75 units / 75 lot size
    assert t.net_pnl == Decimal("750")  # 10 pts * 75 * 1 lot


def test_duplicate_import_skipped(db):
    acc = _setup(db)
    content = (
        "time,sym,side,qty,price\n"
        "2026-10-14 14:00:00,ES,buy,1,5000\n"
        "2026-10-14 14:30:00,ES,sell,1,5010\n"
    ).encode()
    cfg = {
        "source": "import", "account_id": acc.id, "format": "fills",
        "column_map": {"timestamp": "time", "symbol": "sym", "side": "side",
                       "quantity": "qty", "price": "price"},
        "datetime_format": "%Y-%m-%d %H:%M:%S", "file_timezone": "UTC", "quantity_unit": "lots",
    }
    run_import(db, content=content, config=dict(cfg))
    res2 = run_import(db, content=content, config=dict(cfg))
    assert res2["imported"] == 0
    assert res2["skipped"] == 2
    assert db.query(Execution).count() == 2


def test_batch_undo(db):
    acc = _setup(db)
    content = (
        "time,sym,side,qty,price\n"
        "2026-10-14 14:00:00,ES,buy,1,5000\n"
        "2026-10-14 14:30:00,ES,sell,1,5010\n"
    ).encode()
    cfg = {
        "source": "import", "account_id": acc.id, "format": "fills",
        "column_map": {"timestamp": "time", "symbol": "sym", "side": "side",
                       "quantity": "qty", "price": "price"},
        "datetime_format": "%Y-%m-%d %H:%M:%S", "file_timezone": "UTC", "quantity_unit": "lots",
    }
    res = run_import(db, content=content, config=cfg)
    assert db.query(Trade).count() == 1
    undo_batch(db, res["batch_id"])
    assert db.query(Execution).count() == 0
    assert db.query(Trade).count() == 0


def test_notion_pnl_only_and_tags(db):
    acc = _setup(db)
    content = (
        "sym,dir,pnl,tags\n"
        "ES,long,250,FOMO;revenge\n"
    ).encode()
    cfg = {
        "source": "notion", "account_id": acc.id, "format": "roundtrip",
        "column_map": {"symbol": "sym", "direction": "dir", "pnl": "pnl"},
        "tag_columns": ["tags"], "file_timezone": "Asia/Kolkata", "datetime_format": "auto",
        "quantity_unit": "lots",
    }
    res = run_import(db, content=content, config=cfg)
    assert res["imported"] == 1
    t = db.query(Trade).one()
    assert t.pnl_only is True
    assert t.points_known is False
    assert t.net_pnl == Decimal("250")
    assert t.source == "notion"
    assert {tag.name for tag in t.tags} == {"FOMO", "revenge"}


def test_pnl_only_survives_rebuild(db):
    # A P&L-only import trade must not be deleted when the pair is rebuilt.
    acc = _setup(db)
    content = b"sym,dir,pnl\nES,long,250\n"
    cfg = {
        "source": "notion", "account_id": acc.id, "format": "roundtrip",
        "column_map": {"symbol": "sym", "direction": "dir", "pnl": "pnl"},
        "file_timezone": "UTC", "datetime_format": "auto", "quantity_unit": "lots",
    }
    run_import(db, content=content, config=cfg)
    from app.core.trade_builder import rebuild_all
    rebuild_all(db)
    assert db.query(Trade).count() == 1
