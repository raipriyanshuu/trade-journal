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


def test_clear_demo_preserves_real_accounts(client):
    real = client.post("/api/accounts", json={"name": "Real Account"}).json()
    client.post("/api/demo/load")
    assert len(client.get("/api/accounts").json()) == 3  # 1 real + 2 demo

    client.post("/api/demo/clear")
    remaining = client.get("/api/accounts").json()
    assert len(remaining) == 1
    assert remaining[0]["id"] == real["id"]
    assert remaining[0]["is_demo"] is False
