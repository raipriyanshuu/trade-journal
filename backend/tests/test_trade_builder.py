"""Trade builder: position tracking, P&L, flips, R-multiple, metadata preservation."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from app.core.trade_builder import compute_r, rebuild_for
from app.models import Account, Execution, Instrument, Tag, Trade
from app.seeds import seed_all


def _setup(db):
    seed_all(db)
    acc = Account(name="T", currency="USD", type="personal", starting_balance=Decimal("0"))
    db.add(acc)
    db.commit()
    return acc


def _inst(db, symbol):
    return db.query(Instrument).filter_by(symbol_root=symbol).first()


def _dt(h, mi, day=14):
    return datetime(2026, 10, day, h, mi, tzinfo=timezone.utc)


def _ex(db, acc, inst, side, qty, price, dt, fee="0"):
    e = Execution(
        account_id=acc.id,
        instrument_id=inst.id,
        side=side,
        quantity=Decimal(qty),
        price=Decimal(price),
        timestamp=dt,
        fees=Decimal(fee),
        source="manual",
    )
    db.add(e)
    db.commit()
    return e


def _trades(db, acc, inst):
    return db.query(Trade).filter_by(account_id=acc.id, instrument_id=inst.id).order_by(Trade.open_time).all()


def test_simple_long(db):
    acc = _setup(db)
    es = _inst(db, "ES")
    _ex(db, acc, es, "buy", "1", "5000", _dt(14, 0))
    _ex(db, acc, es, "sell", "1", "5010", _dt(14, 30))
    rebuild_for(db, acc.id, es.id)
    trades = _trades(db, acc, es)
    assert len(trades) == 1
    t = trades[0]
    assert t.direction == "long"
    assert t.status == "closed"
    assert t.points == Decimal("10")
    assert t.gross_pnl == Decimal("500")
    assert t.net_pnl == Decimal("500")
    assert t.avg_entry == Decimal("5000")
    assert t.avg_exit == Decimal("5010")
    assert t.holding_time_seconds == 1800


def test_simple_short(db):
    acc = _setup(db)
    es = _inst(db, "ES")
    _ex(db, acc, es, "sell", "1", "5010", _dt(14, 0))
    _ex(db, acc, es, "buy", "1", "5000", _dt(14, 30))
    rebuild_for(db, acc.id, es.id)
    t = _trades(db, acc, es)[0]
    assert t.direction == "short"
    assert t.points == Decimal("10")
    assert t.net_pnl == Decimal("500")


def test_scale_in(db):
    acc = _setup(db)
    es = _inst(db, "ES")
    _ex(db, acc, es, "buy", "1", "5000", _dt(14, 0))
    _ex(db, acc, es, "buy", "1", "5004", _dt(14, 5))
    _ex(db, acc, es, "sell", "2", "5010", _dt(14, 30))
    rebuild_for(db, acc.id, es.id)
    t = _trades(db, acc, es)[0]
    assert t.max_position_size == Decimal("2")
    assert t.avg_entry == Decimal("5002")
    assert t.points == Decimal("8")
    assert t.gross_pnl == Decimal("800")


def test_scale_out(db):
    acc = _setup(db)
    es = _inst(db, "ES")
    _ex(db, acc, es, "buy", "2", "5000", _dt(14, 0))
    _ex(db, acc, es, "sell", "1", "5006", _dt(14, 20))
    _ex(db, acc, es, "sell", "1", "5010", _dt(14, 40))
    rebuild_for(db, acc.id, es.id)
    t = _trades(db, acc, es)[0]
    assert t.avg_exit == Decimal("5008")
    assert t.points == Decimal("8")
    assert t.gross_pnl == Decimal("800")
    assert t.status == "closed"


def test_partial_fills_same_price(db):
    acc = _setup(db)
    es = _inst(db, "ES")
    _ex(db, acc, es, "buy", "1", "5000", _dt(14, 0))
    _ex(db, acc, es, "buy", "1", "5000", _dt(14, 1))
    _ex(db, acc, es, "sell", "2", "5005", _dt(14, 30))
    rebuild_for(db, acc.id, es.id)
    trades = _trades(db, acc, es)
    assert len(trades) == 1
    assert trades[0].max_position_size == Decimal("2")
    assert trades[0].points == Decimal("5")
    assert trades[0].net_pnl == Decimal("500")


def test_position_flip(db):
    acc = _setup(db)
    es = _inst(db, "ES")
    _ex(db, acc, es, "buy", "2", "5000", _dt(14, 0))
    _ex(db, acc, es, "sell", "3", "5010", _dt(14, 10))  # flips long 2 -> short 1
    _ex(db, acc, es, "buy", "1", "5012", _dt(14, 20))  # closes the short
    rebuild_for(db, acc.id, es.id)
    trades = _trades(db, acc, es)
    assert len(trades) == 2
    long_t, short_t = trades
    assert long_t.direction == "long"
    assert long_t.net_pnl == Decimal("1000")  # (5010-5000)*50*2
    assert short_t.direction == "short"
    assert short_t.net_pnl == Decimal("-100")  # (5010-5012)*50*1


def test_two_trades_one_day(db):
    acc = _setup(db)
    es = _inst(db, "ES")
    _ex(db, acc, es, "buy", "1", "5000", _dt(14, 0))
    _ex(db, acc, es, "sell", "1", "5005", _dt(14, 10))
    _ex(db, acc, es, "buy", "1", "5006", _dt(15, 0))
    _ex(db, acc, es, "sell", "1", "5009", _dt(15, 10))
    rebuild_for(db, acc.id, es.id)
    trades = _trades(db, acc, es)
    assert len(trades) == 2
    assert trades[0].trading_date == trades[1].trading_date


def test_open_position_at_end(db):
    acc = _setup(db)
    es = _inst(db, "ES")
    _ex(db, acc, es, "buy", "1", "5000", _dt(14, 0))
    rebuild_for(db, acc.id, es.id)
    t = _trades(db, acc, es)[0]
    assert t.status == "open"
    assert t.close_time is None
    assert t.points is None
    assert t.net_pnl == Decimal("0")


def test_fees_reduce_net(db):
    acc = _setup(db)
    es = _inst(db, "ES")
    _ex(db, acc, es, "buy", "1", "5000", _dt(14, 0), fee="2")
    _ex(db, acc, es, "sell", "1", "5010", _dt(14, 30), fee="2")
    rebuild_for(db, acc.id, es.id)
    t = _trades(db, acc, es)[0]
    assert t.gross_pnl == Decimal("500")
    assert t.fees == Decimal("4")
    assert t.net_pnl == Decimal("496")


def test_nifty_point_value(db):
    acc = _setup(db)
    nifty = _inst(db, "NIFTY")
    _ex(db, acc, nifty, "buy", "1", "20000", _dt(5, 0))
    _ex(db, acc, nifty, "sell", "1", "20010", _dt(5, 30))
    rebuild_for(db, acc.id, nifty.id)
    t = _trades(db, acc, nifty)[0]
    assert t.currency == "INR"
    assert t.points == Decimal("10")
    assert t.net_pnl == Decimal("750")  # 10 * 75 * 1


def test_mcx_crude_point_value(db):
    acc = _setup(db)
    crude = _inst(db, "CRUDEOIL")
    _ex(db, acc, crude, "buy", "1", "6000", _dt(6, 0))
    _ex(db, acc, crude, "sell", "1", "6050", _dt(8, 0))
    rebuild_for(db, acc.id, crude.id)
    t = _trades(db, acc, crude)[0]
    assert t.net_pnl == Decimal("5000")  # 50 * 100


def test_r_multiple_from_stop(db):
    acc = _setup(db)
    es = _inst(db, "ES")
    _ex(db, acc, es, "buy", "1", "5000", _dt(14, 0))
    _ex(db, acc, es, "sell", "1", "5010", _dt(14, 30))
    rebuild_for(db, acc.id, es.id)
    t = _trades(db, acc, es)[0]
    assert t.r_multiple is None  # no stop yet

    t.initial_stop = Decimal("4990")  # risk = 10 * 1 * 50 = 500
    db.commit()
    rebuild_for(db, acc.id, es.id)  # metadata preserved by anchor
    t = _trades(db, acc, es)[0]
    assert t.initial_stop == Decimal("4990")
    assert t.r_multiple == Decimal("1")


def test_r_multiple_from_planned_risk(db):
    acc = _setup(db)
    es = _inst(db, "ES")
    _ex(db, acc, es, "buy", "1", "5000", _dt(14, 0))
    _ex(db, acc, es, "sell", "1", "5010", _dt(14, 30))
    rebuild_for(db, acc.id, es.id)
    t = _trades(db, acc, es)[0]
    t.planned_risk_amount = Decimal("250")
    db.commit()
    rebuild_for(db, acc.id, es.id)
    t = _trades(db, acc, es)[0]
    assert t.r_multiple == Decimal("2")  # 500 / 250


def test_metadata_and_tags_preserved_across_rebuild(db):
    acc = _setup(db)
    es = _inst(db, "ES")
    _ex(db, acc, es, "buy", "1", "5000", _dt(14, 0))
    _ex(db, acc, es, "sell", "1", "5010", _dt(14, 30))
    rebuild_for(db, acc.id, es.id)
    t = _trades(db, acc, es)[0]

    tag = Tag(name="opening drive", category="setup")
    db.add(tag)
    db.commit()
    t.notes = "clean trade"
    t.scenario = "A"
    t.self_rating = 5
    t.tags.append(tag)
    db.commit()

    rebuild_for(db, acc.id, es.id)
    t = _trades(db, acc, es)[0]
    assert t.notes == "clean trade"
    assert t.scenario == "A"
    assert t.self_rating == 5
    assert [tag.name for tag in t.tags] == ["opening drive"]


def test_compute_r_unit():
    # Direct unit check of the R formula.
    r = compute_r(
        net_pnl=Decimal("500"),
        status="closed",
        pnl_only=False,
        first_entry_price=Decimal("5000"),
        initial_stop=Decimal("4990"),
        planned_risk_amount=None,
        max_position_size=Decimal("1"),
        point_value=Decimal("50"),
    )
    assert r == Decimal("1")
