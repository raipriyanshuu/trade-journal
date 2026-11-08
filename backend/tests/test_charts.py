"""Trade chart extras: saved drawings, session VWAP, full-session fetch, catching up missing charts."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.core import market_data
from app.core.sessions import trading_day_start_utc
from app.db import SessionLocal
from app.models import Bar, Instrument, Trade
from tests.test_market_data import CALLS, _enable, _fake_get, _setup, _trade


@pytest.fixture(autouse=True)
def fake_network(monkeypatch):
    CALLS.clear()
    monkeypatch.setattr(market_data.httpx, "get", _fake_get)


def test_drawings_saved_validated_and_kept_on_rebuild(client):
    acc, es = _setup(client)
    t = _trade(client, acc, es, 1)
    drawings = [
        {"id": "a", "type": "line", "t1": 100, "p1": 5000.5, "t2": 200, "p2": 5003, "color": "#f3b53d"},
        {"id": "b", "type": "box", "t1": 100, "p1": 4999, "t2": 300, "p2": 5004, "junk": "dropped"},
        {"id": "c", "type": "circle", "t1": 150, "p1": 5001, "t2": 180, "p2": 5002},
    ]
    out = client.put(f"/api/trades/{t['id']}/drawings", json={"drawings": drawings}).json()
    assert [d["type"] for d in out["drawings"]] == ["line", "box", "circle"]
    assert "junk" not in out["drawings"][1]
    assert client.get(f"/api/trades/{t['id']}").json()["drawings"][0]["p2"] == 5003
    bad = client.put(f"/api/trades/{t['id']}/drawings", json={"drawings": [{"type": "arrow"}]})
    assert bad.status_code == 422

    # Editing an execution rebuilds the trade (new id); the drawings come along.
    ex = next(e for e in client.get(f"/api/trades/{t['id']}").json()["executions"] if e["side"] == "sell")
    client.patch(f"/api/executions/{ex['id']}", json={"timestamp": ex["timestamp"].replace("Z", "+00:00")})
    rebuilt = client.get("/api/trades", params={"account_id": acc["id"]}).json()[0]
    assert len(client.get(f"/api/trades/{rebuilt['id']}").json()["drawings"]) == 3


def test_fetch_covers_the_whole_session_and_vwap_is_returned(client):
    acc, es = _setup(client)
    _enable(client)
    t = _trade(client, acc, es, 1)
    client.post(f"/api/trades/{t['id']}/fetch-bars")
    with SessionLocal() as db:
        trade = db.get(Trade, t["id"])
        inst = db.get(Instrument, trade.instrument_id)
        start = trading_day_start_utc(trade.trading_date, inst)
        first = min(b.ts for b in db.query(Bar).filter(Bar.instrument_id == inst.id))
        if first.tzinfo is None:
            first = first.replace(tzinfo=timezone.utc)
        assert first <= start + timedelta(minutes=2)  # fetched from the session open
    replay = client.get(f"/api/trades/{t['id']}/replay").json()
    assert replay["vwap"] and replay["vwap_from_session_open"] is True
    times = {c["time"] for c in replay["candles"]}
    assert {v["time"] for v in replay["vwap"]} <= times
    lo = min(c["low"] for c in replay["candles"])
    hi = max(c["high"] for c in replay["candles"])
    assert all(lo - 5 <= v["value"] <= hi + 5 for v in replay["vwap"])


def test_trading_day_start(client):  # client seeds the instruments
    with SessionLocal() as db:
        es = db.query(Instrument).filter_by(symbol_root="ES").one()
        crude = db.query(Instrument).filter_by(symbol_root="CRUDEOIL").one()
        d = datetime(2026, 11, 3).date()
        # CME: 18:00 New York the evening before (EST = UTC-5 -> 23:00 UTC).
        assert trading_day_start_utc(d, es) == datetime(2026, 11, 2, 23, 0, tzinfo=timezone.utc)
        # MCX: 09:00 IST the same day (03:30 UTC).
        assert trading_day_start_utc(d, crude) == datetime(2026, 11, 3, 3, 30, tzinfo=timezone.utc)


def test_startup_catch_up_fetches_only_missing_charts(client):
    acc, es = _setup(client)
    _enable(client)
    a = _trade(client, acc, es, 1)
    client.post(f"/api/trades/{a['id']}/fetch-bars")
    b = _trade(client, acc, es, 3)  # no chart yet
    CALLS.clear()
    with SessionLocal() as db:
        res = market_data.backfill(db, only_missing=True)
    assert res["trades"] == 1 and res["fetched"] == 1
    assert CALLS  # only the missing one was requested
    with SessionLocal() as db:
        assert market_data._has_bars(db, db.get(Trade, b["id"]))


PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


def test_day_plan_per_instrument_with_screenshots(client):
    es = next(i for i in client.get("/api/instruments").json() if i["symbol_root"] == "ES")
    gc = next(i for i in client.get("/api/instruments").json() if i["symbol_root"] == "GC")
    es_plan = client.put("/api/journal", json={"trading_date": "2026-11-09", "instrument_id": es["id"],
                                                "market_context": "ES: hold VAL for longs"}).json()
    client.put("/api/journal", json={"trading_date": "2026-11-09", "instrument_id": gc["id"],
                                     "market_context": "Gold: fade the ON high"})
    got = client.get("/api/journal", params={"trading_date": "2026-11-09", "instrument_id": es["id"]}).json()
    assert got["market_context"] == "ES: hold VAL for longs"
    assert client.get("/api/journal", params={"trading_date": "2026-11-09"}).json() is None  # general plan untouched

    r = client.post(f"/api/journal/{es_plan['id']}/attachments", files={"file": ("levels.png", PNG, "image/png")})
    assert r.status_code == 201
    shots = client.get(f"/api/journal/{es_plan['id']}/attachments").json()
    assert [s["original_name"] for s in shots] == ["levels.png"]


def test_refetch_over_stored_bars_does_not_duplicate(client, monkeypatch):
    acc, es = _setup(client)
    _enable(client)
    t = _trade(client, acc, es, 1)
    client.post(f"/api/trades/{t['id']}/fetch-bars")

    def wider(url, params=None, headers=None, timeout=None):
        # Yahoo sometimes returns bars beyond the requested range.
        p = dict(params)
        p["period1"] = int(p["period1"]) - 3600
        p["period2"] = int(p["period2"]) + 3600
        return _fake_get(url, p, headers, timeout)

    monkeypatch.setattr(market_data.httpx, "get", wider)
    r = client.post(f"/api/trades/{t['id']}/fetch-bars", params={"force": True})
    assert r.status_code == 200, r.text
