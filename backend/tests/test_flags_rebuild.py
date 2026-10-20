"""Manual + dismissed mistake flags survive rebuilds and show up in the trade list."""

from __future__ import annotations


def _setup(client):
    acc = client.post("/api/accounts", json={"name": "F", "currency": "USD"}).json()
    es = next(i for i in client.get("/api/instruments").json() if i["symbol_root"] == "ES")
    t = client.post("/api/trades/manual", json={
        "account_id": acc["id"], "instrument_id": es["id"], "direction": "short",
        "entries": [{"time": "2026-10-20T13:34:00Z", "price": "7724", "quantity": "5"}],
        "exits": [{"time": "2026-10-20T13:38:00Z", "price": "7729", "quantity": "5"}],
    }).json()  # no stop -> the engine raises NO_STOP
    return acc, t


def test_manual_and_dismissed_flags_survive_execution_edit(client):
    acc, t = _setup(client)
    client.post("/api/mistakes/flags", json={"trade_id": t["id"], "rule_code": "Not gave attention to crude move"})
    no_stop = next(f for f in client.get("/api/mistakes/flags", params={"trade_id": t["id"]}).json()
                   if f["rule_code"] == "NO_STOP")
    client.post(f"/api/mistakes/flags/{no_stop['id']}/dismiss", json={"dismissed": True})

    # Fixing an execution time rebuilds the trade (new trade row, new id).
    exit_exec = next(e for e in client.get(f"/api/trades/{t['id']}").json()["executions"] if e["side"] == "buy")
    client.patch(f"/api/executions/{exit_exec['id']}", json={"timestamp": "2026-10-20T13:50:00Z"})

    trade = client.get("/api/trades", params={"account_id": acc["id"]}).json()[0]
    flags = {f["rule_code"]: f for f in client.get("/api/mistakes/flags", params={"trade_id": trade["id"]}).json()}
    assert flags["Not gave attention to crude move"]["source"] == "manual"
    assert flags["NO_STOP"]["dismissed"] is True
    assert trade["holding_time_seconds"] == 16 * 60  # the edit itself applied


def test_trade_list_shows_manual_flags(client):
    acc, t = _setup(client)
    client.post("/api/mistakes/flags", json={"trade_id": t["id"], "rule_code": "Not gave attention to crude move"})
    row = client.get("/api/trades", params={"account_id": acc["id"]}).json()[0]
    assert row["manual_flags"] == ["Not gave attention to crude move"]
    assert "NO_STOP" in row["auto_flags"]

    # Dismissed manual flags disappear from the list.
    flag = next(f for f in client.get("/api/mistakes/flags", params={"trade_id": t["id"]}).json()
                if f["source"] == "manual")
    client.post(f"/api/mistakes/flags/{flag['id']}/dismiss", json={"dismissed": True})
    assert client.get("/api/trades", params={"account_id": acc["id"]}).json()[0]["manual_flags"] == []


def test_breakdown_counts_manual_mistakes(client):
    acc, t = _setup(client)
    client.post("/api/mistakes/flags", json={"trade_id": t["id"], "rule_code": "Not gave attention to crude move"})
    rows = client.get("/api/analytics/breakdown", params={"dimension": "mistake_tag", "account_id": acc["id"]}).json()
    assert [r["key"] for r in rows] == ["Not gave attention to crude move"]
