"""Prop Tracker: drawdown floors, daily loss, consistency, resets, payouts, ledger API."""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace as NS

from app.core.prop import evaluate, ledger_totals, level

D = date(2026, 11, 2)
_ids = iter(range(1, 10_000))


def acc(**kw):
    base = dict(starting_balance=Decimal("50000"), account_size=Decimal("50000"), max_drawdown_amount=Decimal("2000"),
                max_drawdown_type="static", daily_loss_limit=None, profit_target=None, drawdown_lock_at=None,
                consistency_pct=None, min_trading_days=None, max_contracts=None, prop_start_date=None,
                prop_status=None, type="prop_eval")
    base.update(kw)
    return NS(**base)


def tr(day: int, pnl, size=1, hour=15):
    t = datetime(2026, 11, day, hour, tzinfo=timezone.utc)
    return NS(id=next(_ids), status="closed", pnl_known=True, trading_date=date(2026, 11, day), open_time=t,
              close_time=t, net_pnl=Decimal(str(pnl)), max_position_size=Decimal(size))


def led(day: int, kind: str, amount):
    return NS(entry_date=date(2026, 11, day), kind=kind, amount=Decimal(str(amount)))


def test_levels():
    assert [level(Decimal(x)) for x in ("0.2", "0.5", "0.8", "0.95", "1")] == ["ok", "caution", "warning", "danger", "breached"]


def test_static_floor_never_moves():
    ev = evaluate(acc(), [tr(2, 1500), tr(3, -500)], [], date(2026, 11, 3))
    assert ev["balance"] == 51000 and ev["floor"] == 48000 and ev["distance_to_floor"] == 3000


def test_trailing_eod_moves_overnight_only():
    a = acc(max_drawdown_type="trailing_eod")
    # Up 1000 then give back 400 the same day: EOD balance 50600, floor follows the close, not the peak.
    ev = evaluate(a, [tr(2, 1000, hour=14), tr(2, -400, hour=15)], [], date(2026, 11, 2))
    assert ev["floor"] == 48600
    # A losing day never lowers it.
    ev = evaluate(a, [tr(2, 1000), tr(3, -700)], [], date(2026, 11, 3))
    assert ev["floor"] == 49000 and ev["balance"] == 50300


def test_trailing_intraday_uses_closed_trade_peak():
    a = acc(max_drawdown_type="trailing_intraday")
    ev = evaluate(a, [tr(2, 1000, hour=14), tr(2, -400, hour=15)], [], date(2026, 11, 2))
    assert ev["floor"] == 49000  # peak 51000 - 2000


def test_trailing_locks_at_breakeven():
    a = acc(max_drawdown_type="trailing_lock_breakeven")
    ev = evaluate(a, [tr(2, 1500), tr(3, 2000), tr(4, 1000)], [], date(2026, 11, 4))
    assert ev["floor"] == 50000  # would be 52500 without the lock
    ev = evaluate(acc(max_drawdown_type="trailing_lock_breakeven", drawdown_lock_at=Decimal("50100")),
                  [tr(2, 5000)], [], date(2026, 11, 2))
    assert ev["floor"] == 50100


def test_drawdown_breach_fails_and_daily_loss_recorded():
    a = acc(daily_loss_limit=Decimal("1000"))
    ev = evaluate(a, [tr(2, -1200), tr(3, -900)], [], date(2026, 11, 3))
    assert ev["suggested_status"] == "failed"
    rules = {b["rule"] for b in ev["breaches"]}
    assert rules == {"daily_loss", "drawdown"}


def test_can_lose_today_is_the_tighter_limit():
    a = acc(daily_loss_limit=Decimal("1000"))
    ev = evaluate(a, [tr(2, -1500), tr(3, -300)], [], date(2026, 11, 3))
    # Daily: 1000 - 300 = 700 left. Floor: 48200 - 48000 = 200 left.
    assert ev["daily_left"] == 700 and ev["distance_to_floor"] == 200 and ev["can_lose_today"] == 200
    ev = evaluate(a, [tr(2, 500), tr(3, -600)], [], date(2026, 11, 3))
    assert ev["can_lose_today"] == 400


def test_consistency_and_pass():
    a = acc(profit_target=Decimal("3000"), consistency_pct=Decimal("50"), min_trading_days=3)
    ev = evaluate(a, [tr(2, 2500), tr(3, 300), tr(4, 300)], [], date(2026, 11, 4))
    assert round(ev["consistency_pct"]) == 81 and ev["suggested_status"] == "in_progress"
    assert next(r for r in ev["rules"] if r["key"] == "consistency")["level"] == "warning"
    ev = evaluate(a, [tr(2, 1400), tr(3, 1000), tr(4, 1000)], [], date(2026, 11, 4))
    assert ev["consistency_pct"] < 50 and ev["suggested_status"] == "passed"
    assert ev["target_remaining"] == 0


def test_payout_lowers_balance_and_reset_restarts():
    a = acc(type="prop_funded")
    ev = evaluate(a, [tr(2, 3000)], [led(3, "payout", 1000)], date(2026, 11, 3))
    assert ev["balance"] == 52000 and ev["profit"] == 3000 and ev["suggested_status"] == "funded"
    ev = evaluate(acc(), [tr(2, -2500), tr(5, 400)], [led(4, "reset", 80)], date(2026, 11, 5))
    assert ev["balance"] == 50400 and ev["suggested_status"] == "in_progress" and ev["trades"] == 1


def test_max_contracts_breach():
    ev = evaluate(acc(max_contracts=3), [tr(2, 100, size=5)], [], date(2026, 11, 2))
    assert any(b["rule"] == "max_contracts" for b in ev["breaches"])


def test_ledger_totals():
    t = ledger_totals([led(1, "eval_fee", 150), led(2, "reset", 80), led(9, "payout", 1000)])
    assert t == {"costs": 230, "payouts": 1000, "net": 770}


def test_api_ledger_duplicate_and_list(client):
    r = client.post("/api/accounts", json={"name": "Apex 50K", "type": "prop_eval", "starting_balance": "50000",
                                           "max_drawdown_type": "trailing_eod", "max_drawdown_amount": "2500",
                                           "profit_target": "3000", "firm": "Apex"})
    assert r.status_code == 201, r.text
    aid = r.json()["id"]
    assert client.post("/api/accounts", json={"name": "Bad", "prop_status": "nope"}).status_code == 422

    r = client.post(f"/api/prop/accounts/{aid}/ledger", json={"entry_date": "2026-11-01", "kind": "eval_fee", "amount": "147"})
    assert r.status_code == 201
    assert client.post(f"/api/prop/accounts/{aid}/ledger",
                       json={"entry_date": "2026-11-01", "kind": "lunch", "amount": "5"}).status_code == 422
    assert client.post(f"/api/prop/accounts/{aid}/ledger",
                       json={"entry_date": "2026-11-01", "kind": "payout", "amount": "-5"}).status_code == 422

    d = client.get(f"/api/prop/accounts/{aid}").json()
    assert d["status"]["floor"] == 47500 and d["ledger_totals"]["costs"] == 147 and len(d["ledger"]) == 1

    dup = client.post(f"/api/accounts/{aid}/duplicate").json()
    assert dup["name"] == "Apex 50K (2)" and dup["firm"] == "Apex" and dup["max_drawdown_amount"] in ("2500", 2500, "2500.00")

    lst = client.get("/api/prop/accounts").json()
    names = [r["account"]["name"] for r in lst["accounts"]]
    assert "Apex 50K" in names and "Apex 50K (2)" in names
    assert lst["totals"]["costs"] == 147 and "history" not in lst["accounts"][0]["status"]

    assert client.delete(f"/api/prop/ledger/{d['ledger'][0]['id']}").status_code == 204
    assert client.get(f"/api/prop/accounts/{aid}").json()["ledger"] == []
