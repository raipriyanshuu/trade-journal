"""Mistake engine rules and dismissed-flag preservation."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from app.core.mistakes import recompute_for_account
from app.core.trade_builder import rebuild_for
from app.models import Account, DailySession, Execution, Instrument, MistakeFlag, Trade
from app.seeds import seed_all


def _setup(db, **acc_kw):
    seed_all(db)
    acc = Account(name="M", currency="USD", type="prop_eval", starting_balance=Decimal("0"), **acc_kw)
    db.add(acc)
    db.commit()
    return acc


def _es(db):
    return db.query(Instrument).filter_by(symbol_root="ES").first()


def _dt(h, mi, day=14):
    return datetime(2026, 10, day, h, mi, tzinfo=timezone.utc)


def _ex(db, acc, inst, side, qty, price, dt):
    db.add(Execution(account_id=acc.id, instrument_id=inst.id, side=side,
                     quantity=Decimal(qty), price=Decimal(price), timestamp=dt, source="manual"))
    db.commit()


def _round_trip(db, acc, inst, direction, ep, xp, qty, h, day=14):
    es, xs = ("buy", "sell") if direction == "long" else ("sell", "buy")
    _ex(db, acc, inst, es, qty, ep, _dt(h, 0, day))
    _ex(db, acc, inst, xs, qty, xp, _dt(h, 30, day))


def _codes(db, trade_id):
    return {f.rule_code for f in db.query(MistakeFlag).filter_by(trade_id=trade_id).all()}


def test_no_stop(db):
    acc = _setup(db)
    es = _es(db)
    _round_trip(db, acc, es, "long", "5000", "5010", "1", 14)
    rebuild_for(db, acc.id, es.id)
    recompute_for_account(db, acc.id)
    t = db.query(Trade).one()
    assert "NO_STOP" in _codes(db, t.id)


def test_revenge(db):
    acc = _setup(db)
    es = _es(db)
    # Loss closes 14:05, next opens 14:08 (3 min later).
    _ex(db, acc, es, "buy", "1", "5010", _dt(14, 0))
    _ex(db, acc, es, "sell", "1", "5000", _dt(14, 5))
    _ex(db, acc, es, "buy", "1", "5000", _dt(14, 8))
    _ex(db, acc, es, "sell", "1", "5005", _dt(14, 20))
    rebuild_for(db, acc.id, es.id)
    recompute_for_account(db, acc.id)
    trades = db.query(Trade).order_by(Trade.open_time).all()
    assert "REVENGE" in _codes(db, trades[1].id)
    assert "REVENGE" not in _codes(db, trades[0].id)


def test_two_strikes(db):
    acc = _setup(db)
    es = _es(db)
    _round_trip(db, acc, es, "long", "5010", "5000", "1", 14)  # loss
    _round_trip(db, acc, es, "long", "5010", "5000", "1", 15)  # loss
    _round_trip(db, acc, es, "long", "5000", "5010", "1", 16)  # third long
    rebuild_for(db, acc.id, es.id)
    recompute_for_account(db, acc.id)
    trades = db.query(Trade).order_by(Trade.open_time).all()
    assert "TWO_STRIKES" in _codes(db, trades[2].id)
    assert "TWO_STRIKES" not in _codes(db, trades[0].id)


def test_overtrading(db):
    acc = _setup(db)
    es = _es(db)
    for i in range(7):
        _round_trip(db, acc, es, "long", "5000", "5001", "1", 9 + i)
    rebuild_for(db, acc.id, es.id)
    recompute_for_account(db, acc.id)
    flags = db.query(MistakeFlag).filter_by(rule_code="OVERTRADING").all()
    assert len(flags) == 1  # only the 7th


def test_oversize(db):
    acc = _setup(db, max_contracts=2)
    es = _es(db)
    _round_trip(db, acc, es, "long", "5000", "5010", "3", 14)
    rebuild_for(db, acc.id, es.id)
    recompute_for_account(db, acc.id)
    t = db.query(Trade).one()
    assert "OVERSIZE" in _codes(db, t.id)


def test_after_daily_limit(db):
    acc = _setup(db, daily_loss_limit=Decimal("300"))
    es = _es(db)
    _round_trip(db, acc, es, "long", "5010", "5000", "1", 14)  # -500, breaches -300
    _round_trip(db, acc, es, "long", "5000", "5005", "1", 15)  # opened after
    rebuild_for(db, acc.id, es.id)
    recompute_for_account(db, acc.id)
    trades = db.query(Trade).order_by(Trade.open_time).all()
    assert "AFTER_DAILY_LIMIT" in _codes(db, trades[1].id)
    assert "AFTER_DAILY_LIMIT" not in _codes(db, trades[0].id)


def test_added_to_loser(db):
    acc = _setup(db)
    es = _es(db)
    _ex(db, acc, es, "buy", "1", "5000", _dt(14, 0))
    _ex(db, acc, es, "buy", "1", "4990", _dt(14, 5))  # adverse add
    _ex(db, acc, es, "sell", "2", "5005", _dt(14, 30))
    rebuild_for(db, acc.id, es.id)
    recompute_for_account(db, acc.id)
    t = db.query(Trade).one()
    assert "ADDED_TO_LOSER" in _codes(db, t.id)


def test_faded_trend_day(db):
    acc = _setup(db)
    es = _es(db)
    db.add(DailySession(account_id=acc.id, instrument_id=None, trading_date=_dt(14, 0).date(),
                        actual_day_type="Trend Up"))
    db.commit()
    _round_trip(db, acc, es, "short", "5010", "5000", "1", 14)  # short on up-trend day
    rebuild_for(db, acc.id, es.id)
    recompute_for_account(db, acc.id)
    t = db.query(Trade).one()
    assert "FADED_TREND_DAY" in _codes(db, t.id)


def test_dismissed_flag_persists(db):
    acc = _setup(db)
    es = _es(db)
    _round_trip(db, acc, es, "long", "5000", "5010", "1", 14)
    rebuild_for(db, acc.id, es.id)
    recompute_for_account(db, acc.id)
    t = db.query(Trade).one()
    flag = db.query(MistakeFlag).filter_by(trade_id=t.id, rule_code="NO_STOP").one()
    flag.dismissed = True
    db.commit()
    # Recompute should keep it dismissed.
    recompute_for_account(db, acc.id)
    flag2 = db.query(MistakeFlag).filter_by(trade_id=t.id, rule_code="NO_STOP").one()
    assert flag2.dismissed is True
