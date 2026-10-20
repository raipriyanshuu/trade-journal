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


def test_clear_demo_preserves_real_accounts(client):
    real = client.post("/api/accounts", json={"name": "Real Account"}).json()
    client.post("/api/demo/load")
    assert len(client.get("/api/accounts").json()) == 3  # 1 real + 2 demo

    client.post("/api/demo/clear")
    remaining = client.get("/api/accounts").json()
    assert len(remaining) == 1
    assert remaining[0]["id"] == real["id"]
    assert remaining[0]["is_demo"] is False
