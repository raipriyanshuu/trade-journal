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


def test_create_tag_reuses_case_insensitive_match(client):
    a = client.post("/api/tags", json={"name": "Opening Drive", "category": "setup"})
    assert a.status_code == 201
    b = client.post("/api/tags", json={"name": "  opening   drive ", "category": "setup"}).json()
    assert b["id"] == a.json()["id"] and b["name"] == "Opening Drive"
    # Same name in a different category is a different tag.
    c = client.post("/api/tags", json={"name": "Opening Drive", "category": "custom"}).json()
    assert c["id"] != b["id"]
    # An archived tag comes back instead of being duplicated.
    client.patch(f"/api/tags/{b['id']}", json={"archived": True})
    d = client.post("/api/tags", json={"name": "OPENING DRIVE", "category": "setup"}).json()
    assert d["id"] == b["id"] and d["archived"] is False
    assert client.post("/api/tags", json={"name": "   ", "category": "setup"}).status_code == 422


def test_tag_merge(client):
    a = client.post("/api/tags", json={"name": "fear of missing out", "category": "mistake"}).json()
    b = client.post("/api/tags", json={"name": "FOMO", "category": "mistake"}).json()
    assert a["id"] != b["id"]
    client.post(f"/api/tags/{a['id']}/merge/{b['id']}")
    # Source gone.
    ids = [t["id"] for t in client.get("/api/tags", params={"include_archived": True}).json()]
    assert a["id"] not in ids
    assert b["id"] in ids
    # Merging a tag into itself is refused (it used to delete the tag).
    assert client.post(f"/api/tags/{b['id']}/merge/{b['id']}").status_code == 422
    assert b["id"] in [t["id"] for t in client.get("/api/tags").json()]


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


def test_breakdown_by_emotion_tag(client):
    acc = client.post("/api/accounts", json={"name": "Emo", "currency": "USD"}).json()
    es = next(i for i in client.get("/api/instruments").json() if i["symbol_root"] == "ES")
    calm = client.post("/api/tags", json={"name": "Calm", "category": "emotion"}).json()
    client.post("/api/trades/manual", json={
        "account_id": acc["id"], "instrument_id": es["id"], "direction": "long", "tag_ids": [calm["id"]],
        "entries": [{"time": "2026-10-20T14:00:00Z", "price": "6000", "quantity": "1"}],
        "exits": [{"time": "2026-10-20T14:10:00Z", "price": "6004", "quantity": "1"}],
    })
    client.post("/api/trades/manual", json={
        "account_id": acc["id"], "instrument_id": es["id"], "direction": "long",
        "entries": [{"time": "2026-10-21T14:00:00Z", "price": "6000", "quantity": "1"}],
        "exits": [{"time": "2026-10-21T14:10:00Z", "price": "5996", "quantity": "1"}],
    })
    assert "emotion_tag" in client.get("/api/analytics/dimensions").json()
    rows = {r["key"]: r for r in client.get(
        "/api/analytics/breakdown", params={"dimension": "emotion_tag", "account_id": acc["id"]}).json()}
    assert set(rows) == {"Calm", "(untagged)"}
    assert rows["Calm"]["win_rate"] == 1.0 and rows["(untagged)"]["trades"] == 1
