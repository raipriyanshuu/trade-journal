"""Demo data loads, is clearly marked, and clears without touching real data."""

from __future__ import annotations


def test_demo_load_and_clear(client):
    assert client.get("/api/demo").json()["present"] is False

    loaded = client.post("/api/demo/load").json()
    assert loaded["status"] == "loaded"

    status = client.get("/api/demo").json()
    assert status["present"] is True
    assert status["accounts"] == 2
    assert status["executions"] == 6

    # Loading again is a no-op.
    assert client.post("/api/demo/load").json()["status"] == "exists"

    client.post("/api/demo/clear")
    after = client.get("/api/demo").json()
    assert after["present"] is False
    assert after["accounts"] == 0


def test_demo_showcases_review_features(client):
    client.post("/api/demo/load")
    status = client.get("/api/demo").json()
    assert status["bars"] > 100
    assert status["trades"] == 4  # 3 built trades + 1 missed setup

    trades = client.get("/api/trades").json()
    assert any(t["status"] == "missed" for t in trades)
    winner = next(t for t in trades if t["symbol"] == "ES" and t["result"] == "win")
    assert winner["entry_quality"] == "A"
    assert {g["name"] for g in winner["tags"]} >= {"Pullback", "Continuation (Thesis Held)"}

    loser = next(t for t in trades if t["result"] == "loss")
    assert any(g["category"] == "mistake" and g["name"].lower() == "chased entry" for g in loser["tags"])

    # Bars make replay and MAE/MFE work out of the box.
    replay = client.get(f"/api/trades/{winner['id']}/replay").json()
    assert replay["candles"] and replay["excursion"]["mfe_points"] > 0

    client.post("/api/demo/clear")
    assert client.get("/api/demo").json()["bars"] == 0
    assert client.get("/api/bars/coverage").json() == []


def test_clear_demo_keeps_trades_logged_on_a_demo_account(client):
    """A trade the user logs on a DEMO account must survive 'clear demo data'."""
    client.post("/api/demo/load")
    demo_acc = next(a for a in client.get("/api/accounts").json() if a["name"].startswith("DEMO Apex"))
    es = next(i for i in client.get("/api/instruments").json() if i["symbol_root"] == "ES")
    mine = client.post("/api/trades/manual", json={
        "account_id": demo_acc["id"], "instrument_id": es["id"], "direction": "long",
        "entries": [{"time": "2026-10-19T14:00:00Z", "price": "5100", "quantity": "1"}],
        "exits": [{"time": "2026-10-19T14:20:00Z", "price": "5104", "quantity": "1"}],
    }).json()
    assert mine["is_demo"] is False

    res = client.post("/api/demo/clear").json()
    assert res["kept_accounts"] == [demo_acc["name"]]

    trades = client.get("/api/trades").json()
    assert len(trades) == 1  # only the user's trade; all demo trades are gone
    assert trades[0]["net_pnl"] == "200.00" and trades[0]["is_demo"] is False
    kept = client.get("/api/accounts").json()
    assert [a["id"] for a in kept] == [demo_acc["id"]] and kept[0]["is_demo"] is False


def test_autobackup_snapshot_and_prune(client):
    from app.core.autobackup import backups_dir, snapshot

    client.post("/api/accounts", json={"name": "Snap"})
    for f in backups_dir().glob("journal-*.db") if backups_dir().exists() else []:
        f.unlink()
    first = snapshot("test")
    assert first is not None and first.exists()
    assert snapshot("test", min_interval_hours=6) is None  # too soon
    for i in range(3):
        snapshot(f"t{i}", keep=2)
    assert len(list(backups_dir().glob("journal-*.db"))) == 2


def test_clear_demo_preserves_real_accounts(client):
    real = client.post("/api/accounts", json={"name": "Real Account"}).json()
    client.post("/api/demo/load")
    assert len(client.get("/api/accounts").json()) == 3  # 1 real + 2 demo

    client.post("/api/demo/clear")
    remaining = client.get("/api/accounts").json()
    assert len(remaining) == 1
    assert remaining[0]["id"] == real["id"]
    assert remaining[0]["is_demo"] is False
