"""Delayed CME charts from Yahoo Finance (network mocked)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import httpx
import pytest

from app.core import market_data

CALLS: list[dict] = []


class _Resp:
    def __init__(self, payload, status=200):
        self._payload = payload
        self.status_code = status

    def json(self):
        return self._payload


def _fake_get(url, params=None, headers=None, timeout=None):
    """Minute (or 5-minute) bars across the requested range, with float noise."""
    CALLS.append({"url": url, **(params or {})})
    step = 60 if params["interval"] == "1m" else 300
    ts = list(range(int(params["period1"]) // step * step, int(params["period2"]), step))
    closes = [5000.2499 + (i % 10) * 0.25 for i in range(len(ts))]
    if closes:
        closes[0] = None  # Yahoo leaves gaps as nulls
    quote = {"open": closes, "high": [c + 1 if c else None for c in closes],
             "low": [c - 1 if c else None for c in closes], "close": closes, "volume": [100] * len(ts)}
    return _Resp({"chart": {"result": [{"timestamp": ts, "indicators": {"quote": [quote]}}], "error": None}})


@pytest.fixture(autouse=True)
def fake_network(monkeypatch):
    CALLS.clear()
    monkeypatch.setattr(market_data.httpx, "get", _fake_get)


def _enable(client, auto=False):
    client.put("/api/settings", json={"market_data": {"enabled": True, "auto_fetch_on_save": auto}})


def _setup(client, symbol="ES"):
    acc = client.post("/api/accounts", json={"name": "MD", "currency": "USD"}).json()
    inst = next(i for i in client.get("/api/instruments").json() if i["symbol_root"] == symbol)
    return acc, inst


def _trade(client, acc, inst, days_ago: float):
    start = datetime.now(timezone.utc) - timedelta(days=days_ago)
    iso = lambda d: d.strftime("%Y-%m-%dT%H:%M:00Z")
    return client.post("/api/trades/manual", json={
        "account_id": acc["id"], "instrument_id": inst["id"], "direction": "long",
        "entries": [{"time": iso(start), "price": "5000", "quantity": "1"}],
        "exits": [{"time": iso(start + timedelta(minutes=20)), "price": "5002", "quantity": "1"}],
    }).json()


def test_off_by_default(client):
    acc, es = _setup(client)
    t = _trade(client, acc, es, 1)
    r = client.post(f"/api/trades/{t['id']}/fetch-bars")
    assert r.status_code == 400 and "turned off" in r.json()["detail"]
    assert CALLS == []  # saving a trade made no network call either


def test_fetch_caches_and_snaps_to_tick(client):
    acc, es = _setup(client)
    _enable(client)
    t = _trade(client, acc, es, 1)
    r = client.post(f"/api/trades/{t['id']}/fetch-bars").json()
    assert r["status"] == "fetched" and r["timeframe"] == "1m" and r["symbol"] == "ES=F"
    assert r["added"] > 250  # ~5h window of minutes, minus the null bar
    assert CALLS[0]["url"].endswith("/ES=F")

    replay = client.get(f"/api/trades/{t['id']}/replay").json()
    assert replay["sources"] == ["yahoo"] and replay["can_fetch"] is True
    closes = {c["close"] for c in replay["candles"]}
    assert all(abs(c * 4 - round(c * 4)) < 1e-9 for c in closes)  # on the 0.25 tick grid

    n_calls = len(CALLS)
    again = client.post(f"/api/trades/{t['id']}/fetch-bars").json()
    assert again["status"] == "cached" and len(CALLS) == n_calls


def test_micro_uses_full_size_symbol_and_older_trades_use_5m(client):
    acc, mgc = _setup(client, "MGC")
    _enable(client)
    t = _trade(client, acc, mgc, 40)
    r = client.post(f"/api/trades/{t['id']}/fetch-bars").json()
    assert r["symbol"] == "GC=F" and r["timeframe"] == "5m"
    assert CALLS[-1]["interval"] == "5m"


def test_too_old_and_unsupported(client):
    acc, es = _setup(client)
    _enable(client)
    old = _trade(client, acc, es, 70)
    r = client.post(f"/api/trades/{old['id']}/fetch-bars")
    assert r.status_code == 400 and "60 days" in r.json()["detail"]

    nifty = next(i for i in client.get("/api/instruments").json() if i["symbol_root"] == "NIFTY")
    t = _trade(client, acc, nifty, 1)
    r = client.post(f"/api/trades/{t['id']}/fetch-bars")
    assert r.status_code == 400 and "No Yahoo symbol" in r.json()["detail"]


def test_auto_fetch_on_save(client):
    acc, cl = _setup(client, "CL")
    _enable(client, auto=True)
    t = _trade(client, acc, cl, 2)  # background task runs after the response
    assert any(c["url"].endswith("/CL=F") for c in CALLS)
    assert client.get(f"/api/trades/{t['id']}/replay").json()["candles"]


def test_backfill(client):
    acc, es = _setup(client)
    _trade(client, acc, es, 1)
    _trade(client, acc, es, 3)
    _enable(client)
    res = client.post("/api/market-data/backfill").json()
    assert res["trades"] == 2 and res["fetched"] == 2 and res["failed"] == 0


def test_network_error_is_reported(client, monkeypatch):
    acc, es = _setup(client)
    _enable(client)
    t = _trade(client, acc, es, 1)

    def boom(*a, **k):
        raise httpx.ConnectError("offline")

    monkeypatch.setattr(market_data.httpx, "get", boom)
    r = client.post(f"/api/trades/{t['id']}/fetch-bars")
    assert r.status_code == 400 and "Could not reach Yahoo" in r.json()["detail"]
