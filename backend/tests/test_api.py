"""API smoke tests for Phase 0 endpoints."""

from __future__ import annotations


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_list_and_verify_instrument(client):
    r = client.get("/api/instruments")
    assert r.status_code == 200
    insts = r.json()
    assert len(insts) == 16
    assert all(i["verified"] is False for i in insts)

    es = next(i for i in insts if i["symbol_root"] == "ES")
    r = client.post(f"/api/instruments/{es['id']}/verify")
    assert r.status_code == 200
    assert r.json()["verified"] is True


def test_update_instrument_point_value(client):
    es = next(i for i in client.get("/api/instruments").json() if i["symbol_root"] == "ES")
    # A genuinely different value persists; the decimal keeps full precision.
    r = client.patch(f"/api/instruments/{es['id']}", json={"point_value": "12.5"})
    assert r.status_code == 200
    assert r.json()["point_value"] == "12.5"
    assert client.get(f"/api/instruments/{es['id']}").json()["point_value"] == "12.5"


def test_account_crud(client):
    r = client.post(
        "/api/accounts",
        json={"name": "My Prop", "type": "prop_eval", "currency": "USD",
              "starting_balance": "50000", "account_size": "50000",
              "daily_loss_limit": "1250", "max_contracts": 10},
    )
    assert r.status_code == 201
    acc = r.json()
    assert acc["name"] == "My Prop"
    assert acc["max_contracts"] == 10

    r = client.patch(f"/api/accounts/{acc['id']}", json={"active": False})
    assert r.json()["active"] is False

    assert len(client.get("/api/accounts").json()) == 1

    r = client.delete(f"/api/accounts/{acc['id']}")
    assert r.status_code == 204
    assert client.get("/api/accounts").json() == []


def test_duplicate_account_name_rejected(client):
    client.post("/api/accounts", json={"name": "Dup"})
    r = client.post("/api/accounts", json={"name": "Dup"})
    assert r.status_code == 409


def test_settings_roundtrip(client):
    r = client.get("/api/settings")
    assert r.status_code == 200
    assert r.json()["display_timezone"] == "Asia/Kolkata"

    r = client.put("/api/settings", json={"usd_inr_rate": "90.5"})
    assert r.status_code == 200
    assert r.json()["usd_inr_rate"] == "90.5"
    # Persisted on a fresh read.
    assert client.get("/api/settings").json()["usd_inr_rate"] == "90.5"


def test_decimal_precision_is_exact(client):
    # A value that binary floats cannot represent must round-trip unchanged.
    r = client.post(
        "/api/accounts",
        json={"name": "Precise", "currency": "INR", "starting_balance": "12345.67"},
    )
    assert r.json()["starting_balance"] == "12345.67"
