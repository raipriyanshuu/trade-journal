"""Backtest replay: candles without look-ahead, simulated fills, stats, data loading, isolation."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from app.backtest import candles as C
from app.backtest.data import load_symbol
from app.backtest.db import BtSessionLocal
from app.backtest.db import engine as bt_engine
from app.backtest.models import BtBar, BtBase

H = 3600


@pytest.fixture(autouse=True)
def fresh_bt():
    BtBase.metadata.drop_all(bt_engine)
    BtBase.metadata.create_all(bt_engine)
    yield


def _bars(symbol="ES", tf="1h", start=None, n=72, overrides=None, step=H, price=5000.0):
    """n flat bars (o=c=price, +-1 range) with per-index overrides."""
    start = start if start is not None else C.day_start(date(2025, 1, 6))
    overrides = overrides or {}
    with BtSessionLocal() as db:
        for i in range(n):
            o, h, l, c = overrides.get(i, (price, price + 1, price - 1, price))
            db.add(BtBar(symbol=symbol, tf=tf, ts=start + i * step, open=o, high=h, low=l, close=c, volume=100))
        db.commit()
    return start


def _session(client, start="2025-01-07", tf="1h", **kw):
    body = {"strategy": "Breakout", "symbol": "ES", "start_date": start, "timeframe": tf, **kw}
    r = client.post("/api/backtest/sessions", json=body)
    assert r.status_code == 201, r.text
    return r.json()


# ------------------------------------------------------------ time handling
def test_trading_day_and_buckets():
    # Jan 2025 = EST (UTC-5): session for Tue Jan 7 opens Mon Jan 6 18:00 ET = 23:00 UTC.
    jan6_23 = int(datetime(2025, 1, 6, 23, 0, tzinfo=timezone.utc).timestamp())
    assert C.day_start(date(2025, 1, 7)) == jan6_23
    assert C.trading_date(jan6_23 + 1800) == date(2025, 1, 7)
    assert C.trading_date(jan6_23 - 1800) == date(2025, 1, 6)
    # 22:15 ET -> 4h candle that opened 22:00 ET (03:00 UTC).
    t = int(datetime(2025, 1, 7, 3, 15, tzinfo=timezone.utc).timestamp())
    assert C.bucket(t, "4h") == int(datetime(2025, 1, 7, 3, 0, tzinfo=timezone.utc).timestamp())
    assert C.bucket(t, "1D") == jan6_23
    # Summer (EDT): the session opens 22:00 UTC.
    assert C.day_start(date(2025, 7, 8)) == int(datetime(2025, 7, 7, 22, 0, tzinfo=timezone.utc).timestamp())


# ----------------------------------------------------------- no look-ahead
def test_chart_reveals_only_closed_bars_and_partial_candles(client):
    start = _bars(overrides={26: (5000, 5050, 4999, 5040)})  # a big bar 3 hours into Jan 7
    s = _session(client, tf="4h")
    st = client.get(f"/api/backtest/sessions/{s['id']}/state").json()
    assert st["last"]["price"] == 5000
    highs = [c["high"] for c in st["chart"]["candles"]]
    assert max(highs) == 5001  # the 5050 bar is in the future

    # One 1h step: the new 4h candle holds only that one hour.
    st = client.post(f"/api/backtest/sessions/{s['id']}/step", json={"tf": "4h", "mode": "bar"}).json()
    assert st["chart"]["step_base"] == "1h"
    assert st["session"]["revealed_until"] == datetime.fromtimestamp(start + 25 * H, tz=timezone.utc).isoformat()
    # Two more steps reveal the big bar inside the same forming 4h candle.
    for _ in range(2):
        st = client.post(f"/api/backtest/sessions/{s['id']}/step", json={"tf": "4h", "mode": "bar"}).json()
    assert st["chart"]["candles"][-1]["high"] == 5050
    assert st["last"]["price"] == 5040


def test_step_one_candle_completes_or_reveals_whole_candle(client):
    start = _bars()
    s = _session(client, tf="4h")
    st = client.post(f"/api/backtest/sessions/{s['id']}/step", json={"tf": "4h", "mode": "candle"}).json()
    # From the session open, one 4h candle = 4 hourly bars.
    assert st["session"]["revealed_until"] == datetime.fromtimestamp(start + 28 * H, tz=timezone.utc).isoformat()
    client.post(f"/api/backtest/sessions/{s['id']}/step", json={"tf": "4h", "mode": "bar"})  # 1h into the next
    st = client.post(f"/api/backtest/sessions/{s['id']}/step", json={"tf": "4h", "mode": "candle"}).json()
    assert st["session"]["revealed_until"] == datetime.fromtimestamp(start + 32 * H, tz=timezone.utc).isoformat()


def test_incremental_since_returns_tail_only(client):
    _bars()
    s = _session(client)
    full = client.get(f"/api/backtest/sessions/{s['id']}/state", params={"tf": "1h"}).json()
    tail = full["chart"]["tail_from"]
    st = client.post(f"/api/backtest/sessions/{s['id']}/step",
                     json={"tf": "1h", "mode": "bar", "since": tail}).json()
    assert st["incremental"] is True
    assert len(st["chart"]["candles"]) == 2  # the old tail candle + the new one


def test_finest_base_used_where_available(client):
    start = _bars(n=96)  # 1h: Jan 5 18:00 ET .. 4 days
    # 5m bars for the Jan 8 session only (12 * 23 bars)
    _bars(tf="5m", start=C.day_start(date(2025, 1, 8)), n=12 * 23, step=300, price=5000.0)
    s = _session(client, start="2025-01-08", tf="1h")
    st = client.post(f"/api/backtest/sessions/{s['id']}/step", json={"tf": "1h", "mode": "bar"}).json()
    assert st["chart"]["step_base"] == "5m"
    assert st["session"]["revealed_until"] == datetime.fromtimestamp(
        C.day_start(date(2025, 1, 8)) + 300, tz=timezone.utc).isoformat()
    # Earlier days still come from the hourly store.
    assert len(st["chart"]["candles"]) > 40
    assert start  # silence


# --------------------------------------------------------------------- fills
def _go(client, sid, n=1):
    return client.post(f"/api/backtest/sessions/{sid}/step", json={"mode": "bar", "count": n}).json()


def test_long_stopped_out(client):
    _bars(overrides={24: (5000, 5003, 4985, 4990)})
    s = _session(client, fee_per_contract=4.5)
    st = client.post(f"/api/backtest/sessions/{s['id']}/orders",
                     json={"direction": "long", "qty": 2, "stop": 4990, "target": 5020}).json()
    t = st["trades"][0]
    assert t["entry_price"] == 5000 and t["status"] == "open"
    assert {ln["kind"] for ln in st["lines"]} == {"entry", "stop", "target"}
    st = _go(client, s["id"])
    t = st["trades"][0]
    assert t["status"] == "closed" and t["exit_reason"] == "stop"
    assert t["net"] == -10 * 50 * 2 - 9  # 2 contracts x $4.50 round turn
    assert t["r_multiple"] == round(-1009 / 1000, 2)
    assert st["events"][0]["reason"] == "stop"
    assert st["balance"] == 10000 - 1009


def test_stop_and_target_in_same_bar_assumes_stop(client):
    _bars(overrides={24: (5000, 5025, 4985, 5010)})
    s = _session(client, fee_per_contract=0)
    client.post(f"/api/backtest/sessions/{s['id']}/orders",
                json={"direction": "long", "qty": 1, "stop": 4990, "target": 5020})
    t = _go(client, s["id"])["trades"][0]
    assert t["exit_reason"] == "stop" and t["exits"][0]["price"] == 4990


def test_short_target_and_gap_fills_at_open(client):
    _bars(overrides={25: (4975, 4978, 4970, 4972)})  # gaps below the 4980 target
    s = _session(client, fee_per_contract=0)
    client.post(f"/api/backtest/sessions/{s['id']}/orders",
                json={"direction": "short", "qty": 1, "stop": 5010, "target": 4980})
    t = _go(client, s["id"], 2)["trades"][0]
    assert t["exit_reason"] == "target"
    assert t["exits"][0]["price"] == 4975  # better than the target: filled at the gap open
    assert t["net"] == 25 * 50
    assert t["r_multiple"] == 2.5


def test_partial_close_then_target_and_mae_mfe(client):
    _bars(overrides={24: (5000, 5006, 4996, 5005), 26: (5008, 5021, 5007, 5019)})
    s = _session(client, fee_per_contract=0)
    st = client.post(f"/api/backtest/sessions/{s['id']}/orders",
                     json={"direction": "long", "qty": 2, "stop": 4990, "target": 5020}).json()
    tid = st["trades"][0]["id"]
    _go(client, s["id"])  # close is now 5005
    st = client.post(f"/api/backtest/trades/{tid}/close", json={"qty": 1}).json()
    t = st["trades"][0]
    assert t["status"] == "open" and t["remaining"] == 1 and t["net"] == 5 * 50
    st = _go(client, s["id"], 2)
    t = st["trades"][0]
    assert t["status"] == "closed" and t["exit_reason"] == "target"
    assert t["net"] == 5 * 50 + 20 * 50
    assert t["mae"] == 4 and t["mfe"] == 20


def test_levels_validated_and_moving_stop(client):
    _bars()
    s = _session(client)
    r = client.post(f"/api/backtest/sessions/{s['id']}/orders",
                    json={"direction": "long", "qty": 1, "stop": 5005})
    assert r.status_code == 422
    st = client.post(f"/api/backtest/sessions/{s['id']}/orders",
                     json={"direction": "short", "qty": 1, "stop": 5010.13}).json()
    t = st["trades"][0]
    assert t["stop"] == 5010.25  # snapped to the 0.25 tick
    st = client.patch(f"/api/backtest/trades/{t['id']}", json={"stop": 5004, "setup": "VWAP reject"}).json()
    t = st["trades"][0]
    assert t["stop"] == 5004 and t["initial_stop"] == 5010.25 and t["setup"] == "VWAP reject"


def test_cannot_rewind_with_open_trade_but_jump_forward_processes(client):
    _bars(overrides={40: (5000, 5001, 4980, 4985)})
    s = _session(client)
    client.post(f"/api/backtest/sessions/{s['id']}/orders", json={"direction": "long", "qty": 1, "stop": 4990})
    assert client.post(f"/api/backtest/sessions/{s['id']}/jump", json={"to": "2025-01-06"}).status_code == 409
    st = client.post(f"/api/backtest/sessions/{s['id']}/jump", json={"to": "2025-01-09"}).json()
    assert st["trades"][0]["exit_reason"] == "stop"


# ---------------------------------------------------------------------- VWAP
def test_session_vwap(client):
    _bars(overrides={24: (5000, 5010, 4990, 5000), 25: (5010, 5020, 5000, 5010)})
    s = _session(client)
    st = _go(client, s["id"], 2)
    vw = {v["time"]: v for v in st["chart"]["vwap"]}
    last_two = st["chart"]["candles"][-2:]
    assert vw[last_two[0]["time"]]["vwap"] == 5000  # first bar of the day: its typical price
    assert vw[last_two[1]["time"]]["vwap"] == 5005  # equal volume: average of 5000 and 5010
    # No VWAP on daily charts.
    st = client.get(f"/api/backtest/sessions/{s['id']}/state", params={"tf": "1D"}).json()
    assert st["chart"]["vwap"] == []


# --------------------------------------------------------------------- stats
def test_dashboard_by_strategy(client):
    _bars(overrides={24: (5000, 5021, 4999, 5020), 26: (5000, 5001, 4985, 4990)})
    a = _session(client, fee_per_contract=0)
    client.post(f"/api/backtest/sessions/{a['id']}/orders",
                json={"direction": "long", "qty": 1, "stop": 4990, "target": 5020, "setup": "ORB"})
    _go(client, a["id"])  # +20 pts win
    client.post(f"/api/backtest/sessions/{a['id']}/orders",
                json={"direction": "long", "qty": 1, "stop": 4990, "target": 5040, "setup": "ORB"})
    _go(client, a["id"], 2)  # stopped: -30 pts (entry 5020)
    b = _session(client, strategy="VWAP fade", fee_per_contract=0)
    d = client.get("/api/backtest/stats").json()
    k = d["kpis"]
    assert k["trades"] == 2 and k["win_rate"] == 0.5
    assert k["net"] == 20 * 50 - 30 * 50
    assert k["profit_factor"] == round(1000 / 1500, 2)
    assert k["starting_balance"] == 10000  # only sessions with trades count
    assert [r["key"] for r in d["by_strategy"]] == ["Breakout"]
    assert d["by_setup"][0]["key"] == "ORB"
    assert client.get("/api/backtest/stats", params={"strategy": "VWAP fade"}).json()["kpis"]["trades"] == 0
    assert set(client.get("/api/backtest/strategies").json()) == {"Breakout", "VWAP fade"}
    assert b


# ---------------------------------------------------------- isolation + data
def test_backtest_never_touches_the_journal(client):
    _bars(overrides={24: (5000, 5021, 4999, 5020)})
    s = _session(client)
    client.post(f"/api/backtest/sessions/{s['id']}/orders",
                json={"direction": "long", "qty": 1, "stop": 4990, "target": 5020})
    _go(client, s["id"])
    assert client.get("/api/trades").json() == []
    assert client.get("/api/analytics/dashboard").json()["kpis"]["trades"] == 0


def test_load_symbol_normalizes_daily_and_is_idempotent():
    now = datetime(2025, 1, 10, 12, tzinfo=timezone.utc)

    def fake(symbol, start, end, interval, span):
        assert symbol == "CL=F"
        if interval == "1d":
            # Yahoo stamps daily futures bars at midnight New York (05:00 UTC in winter)
            return [{"ts": datetime(2025, 1, d, 5, tzinfo=timezone.utc), "open": 73.111, "high": 74.0,
                     "low": 72.5, "close": 73.5, "volume": 1000} for d in (7, 8, 9)]
        step = timedelta(minutes=5) if interval == "5m" else timedelta(hours=1)
        t0 = datetime(2025, 1, 9, 0, tzinfo=timezone.utc)
        return [{"ts": t0 + i * step, "open": 73, "high": 73.5, "low": 72.8, "close": 73.2, "volume": 10}
                for i in range(5)]

    with BtSessionLocal() as db:
        load_symbol(db, "CL", fetcher=fake, now=now)
        load_symbol(db, "CL", fetcher=fake, now=now)
        daily = db.query(BtBar).filter_by(symbol="CL", tf="1d").order_by(BtBar.ts).all()
        assert [b.ts for b in daily] == [C.day_start(date(2025, 1, d)) for d in (7, 8, 9)]
        assert daily[0].open == 73.11  # snapped to the 0.01 tick
        assert db.query(BtBar).filter_by(symbol="CL", tf="5m").count() == 5
        assert db.query(BtBar).filter_by(symbol="CL", tf="1h").count() == 5


def test_instruments_and_session_contract(client):
    inst = {i["symbol"]: i for i in client.get("/api/backtest/instruments").json()}
    assert set(inst) == {"ES", "NQ", "GC", "CL"}
    s = _session(client, contract="micro")
    assert s["point_value"] == 5 and s["contract_label"] == "MES" and s["fee_per_contract"] == 1.5
    assert client.post("/api/backtest/sessions", json={
        "strategy": "x", "symbol": "ZZ", "start_date": "2025-01-07"}).status_code == 422
