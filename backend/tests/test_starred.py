"""Starred trades: star/unstar, filter, review list with media, mark reviewed, kept on rebuild."""

from __future__ import annotations


def _inst(client, symbol):
    return next(i for i in client.get("/api/instruments").json() if i["symbol_root"] == symbol)


def _trade(client, acc, inst, entry, exit_, minute=0):
    r = client.post("/api/trades/manual", json={
        "account_id": acc["id"], "instrument_id": inst["id"], "direction": "long",
        "entries": [{"time": f"2026-11-03T15:{minute:02d}:00Z", "price": entry, "quantity": "1"}],
        "exits": [{"time": f"2026-11-03T15:{minute + 5:02d}:00Z", "price": exit_, "quantity": "1"}],
    })
    assert r.status_code == 201, r.text
    return r.json()


def test_star_filter_review_and_rebuild(client):
    acc = client.post("/api/accounts", json={"name": "A1"}).json()
    es = _inst(client, "ES")
    win = _trade(client, acc, es, "5000", "5004", 0)
    loss = _trade(client, acc, es, "5000", "4998", 20)
    assert win["starred"] is False

    assert client.patch(f"/api/trades/{loss['id']}", json={"starred": True}).json()["starred"] is True
    client.patch(f"/api/trades/{loss['id']}", json={"notes": "Chased the breakout"})

    ids = [t["id"] for t in client.get("/api/trades", params={"starred": "true"}).json()]
    assert ids == [loss["id"]]
    assert len(client.get("/api/trades", params={"starred": "false"}).json()) == 1

    rev = client.get("/api/trades/starred").json()
    assert len(rev) == 1 and rev[0]["notes"] == "Chased the breakout" and rev[0]["attachments"] == []
    assert client.get("/api/trades/starred", params={"result": "win"}).json() == []
    assert client.get("/api/trades/starred", params={"segment": "options"}).json() == []

    r = client.post(f"/api/trades/{loss['id']}/reviewed").json()
    assert r["last_reviewed_at"]
    assert client.get(f"/api/trades/{loss['id']}").json()["last_reviewed_at"]

    # Editing an execution rebuilds the trade with a new id: the star and review date stay.
    ex = next(e for e in client.get(f"/api/trades/{loss['id']}").json()["executions"] if e["side"] == "sell")
    client.patch(f"/api/executions/{ex['id']}", json={"timestamp": ex["timestamp"].replace("Z", "+00:00")})
    starred = client.get("/api/trades", params={"starred": "true"}).json()
    assert len(starred) == 1 and starred[0]["last_reviewed_at"]

    assert client.patch(f"/api/trades/{starred[0]['id']}", json={"starred": False}).json()["starred"] is False
    assert client.get("/api/trades/starred").json() == []
