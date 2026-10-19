"""Daily journal upsert/copy, tag management (rename/merge) and bulk tagging."""

from __future__ import annotations


def _account(client):
    return client.post("/api/accounts", json={"name": "J", "currency": "USD"}).json()


def test_journal_upsert_and_fetch(client):
    acc = _account(client)
    body = {
        "account_id": acc["id"], "trading_date": "2026-10-14",
        "htf_read": "balance below VAH", "actual_day_type": "Normal",
        "levels": [{"label": "VAH", "price": "5012"}], "mood": 4,
    }
    r = client.put("/api/journal", json=body)
    assert r.status_code == 200
    assert r.json()["htf_read"] == "balance below VAH"

    # Upsert again updates the same record.
    body["htf_read"] = "updated"
    client.put("/api/journal", json=body)
    got = client.get("/api/journal", params={"trading_date": "2026-10-14", "account_id": acc["id"]}).json()
    assert got["htf_read"] == "updated"
    assert got["levels"][0]["label"] == "VAH"


def test_journal_previous(client):
    acc = _account(client)
    client.put("/api/journal", json={"account_id": acc["id"], "trading_date": "2026-10-13",
                                     "levels": [{"label": "POC", "price": "5000"}]})
    prev = client.get("/api/journal/previous", params={"trading_date": "2026-10-14", "account_id": acc["id"]}).json()
    assert prev["trading_date"] == "2026-10-13"
    assert prev["levels"][0]["price"] == "5000"


def test_tag_rename_and_archive(client):
    tag = client.post("/api/tags", json={"name": "scalp", "category": "setup"}).json()
    r = client.patch(f"/api/tags/{tag['id']}", json={"name": "scalping", "archived": True})
    assert r.json()["name"] == "scalping"
    assert r.json()["archived"] is True
    # Archived tags excluded by default.
    names = [t["name"] for t in client.get("/api/tags").json()]
    assert "scalping" not in names


def test_tag_merge(client):
    a = client.post("/api/tags", json={"name": "fomo", "category": "mistake"}).json()
    b = client.post("/api/tags", json={"name": "FOMO", "category": "mistake"}).json()
    client.post(f"/api/tags/{a['id']}/merge/{b['id']}")
    # Source gone.
    ids = [t["id"] for t in client.get("/api/tags", params={"include_archived": True}).json()]
    assert a["id"] not in ids
    assert b["id"] in ids


def test_bulk_tag(client):
    acc = _account(client)
    es = next(i for i in client.get("/api/instruments").json() if i["symbol_root"] == "ES")
    tag = client.post("/api/tags", json={"name": "A+", "category": "setup"}).json()
    t1 = client.post("/api/trades/manual", json={
        "account_id": acc["id"], "instrument_id": es["id"], "direction": "long",
        "entries": [{"time": "2026-10-14T14:00:00Z", "price": "5000", "quantity": "1"}],
        "exits": [{"time": "2026-10-14T14:30:00Z", "price": "5010", "quantity": "1"}],
    }).json()
    r = client.post("/api/trades/bulk-tag", json={"trade_ids": [t1["id"]], "add": [tag["id"]]})
    assert r.json()["updated"] == 1
    detail = client.get(f"/api/trades/{t1['id']}").json()
    assert any(tg["name"] == "A+" for tg in detail["tags"])
