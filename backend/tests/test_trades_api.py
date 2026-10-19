"""API tests for manual entry, trade list/detail/edit/delete and execution edit."""

from __future__ import annotations


def _account(client):
    return client.post("/api/accounts", json={"name": "A", "currency": "USD"}).json()


def _es(client):
    return next(i for i in client.get("/api/instruments").json() if i["symbol_root"] == "ES")


def _manual_long(client, acc, es, **over):
    body = {
        "account_id": acc["id"],
        "instrument_id": es["id"],
        "direction": "long",
        "entries": [{"time": "2026-10-14T14:00:00Z", "price": "5000", "quantity": "1"}],
        "exits": [{"time": "2026-10-14T14:30:00Z", "price": "5010", "quantity": "1"}],
        "fees": "4",
        "initial_stop": "4990",
        "scenario": "A",
    }
    body.update(over)
    return client.post("/api/trades/manual", json=body)


def test_manual_entry_builds_trade(client):
    acc, es = _account(client), _es(client)
    r = _manual_long(client, acc, es)
    assert r.status_code == 201
    t = r.json()
    assert t["direction"] == "long"
    assert t["status"] == "closed"
    assert t["net_pnl"] == "496.00"  # 500 gross - 4 fees
    assert t["result"] == "win"
    assert t["scenario"] == "A"
    assert len(t["executions"]) == 2
    # R: risk = |5000-4990| * 1 * 50 = 500; net 496 -> 0.992
    assert t["r_multiple"] == "0.992"


def test_manual_entry_creates_executions_via_pipeline(client):
    acc, es = _account(client), _es(client)
    _manual_long(client, acc, es)
    # Both fills exist as executions, sourced 'manual'.
    listed = client.get("/api/trades").json()
    assert len(listed) == 1
    assert listed[0]["source"] == "manual"


def test_naive_time_treated_as_utc(client):
    acc, es = _account(client), _es(client)
    r = _manual_long(
        client, acc, es,
        entries=[{"time": "2026-10-14T22:00:00", "price": "5000", "quantity": "1"}],
        exits=[{"time": "2026-10-14T22:30:00", "price": "5010", "quantity": "1"}],
    )
    # 22:00 UTC on 10-14 -> CME trading date 10-15.
    assert r.json()["trading_date"] == "2026-10-15"


def test_edit_trade_fields(client):
    acc, es = _account(client), _es(client)
    t = _manual_long(client, acc, es).json()
    r = client.patch(f"/api/trades/{t['id']}", json={"self_rating": 4, "notes": "good"})
    assert r.status_code == 200
    assert r.json()["self_rating"] == 4
    assert r.json()["notes"] == "good"


def test_edit_planned_risk_updates_r(client):
    acc, es = _account(client), _es(client)
    t = _manual_long(client, acc, es).json()
    r = client.patch(f"/api/trades/{t['id']}", json={"planned_risk_amount": "248"})
    # net 496 / 248 = 2
    assert r.json()["r_multiple"] == "2"


def test_delete_trade(client):
    acc, es = _account(client), _es(client)
    t = _manual_long(client, acc, es).json()
    assert client.delete(f"/api/trades/{t['id']}").status_code == 204
    assert client.get("/api/trades").json() == []
    # Underlying executions were removed too.


def test_edit_execution_rebuilds(client):
    acc, es = _account(client), _es(client)
    t = _manual_long(client, acc, es).json()
    exit_exec = next(e for e in t["executions"] if e["side"] == "sell")
    client.patch(f"/api/executions/{exit_exec['id']}", json={"price": "5020"})
    updated = client.get(f"/api/trades/{t['id']}").json()
    assert updated["points"] == "20"
    assert updated["gross_pnl"] == "1000.00"


def test_filter_by_result_and_direction(client):
    acc, es = _account(client), _es(client)
    _manual_long(client, acc, es)  # win
    # A losing short.
    client.post("/api/trades/manual", json={
        "account_id": acc["id"], "instrument_id": es["id"], "direction": "short",
        "entries": [{"time": "2026-10-15T14:00:00Z", "price": "5000", "quantity": "1"}],
        "exits": [{"time": "2026-10-15T14:30:00Z", "price": "5010", "quantity": "1"}],
    })
    wins = client.get("/api/trades", params={"result": "win"}).json()
    losses = client.get("/api/trades", params={"result": "loss"}).json()
    shorts = client.get("/api/trades", params={"direction": "short"}).json()
    assert len(wins) == 1
    assert len(losses) == 1
    assert len(shorts) == 1
