"""Notes: pinboard CRUD, screenshots with drawings, and the spaced-repetition review deck."""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.api import notes as notes_api

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
TODAY = date(2026, 11, 12)


@pytest.fixture(autouse=True)
def fixed_today(monkeypatch):
    monkeypatch.setattr(notes_api, "today", lambda db: TODAY)


def _note(client, **kw):
    r = client.post("/api/notes", json={"title": "t", "body": "b", **kw})
    assert r.status_code == 201, r.text
    return r.json()


def test_create_filter_search_pin_edit_delete(client):
    a = _note(client, title="Chased MES breakout", note_type="mistake")
    b = _note(client, title="Gold reacts to DXY", body="watch the dollar index", note_type="observation", pinned=True)
    _note(client, title="ORB idea", note_type="idea")

    rows = client.get("/api/notes").json()
    assert rows[0]["id"] == b["id"]  # pinned first
    assert [n["title"] for n in client.get("/api/notes", params={"note_type": "mistake"}).json()] == ["Chased MES breakout"]
    assert [n["id"] for n in client.get("/api/notes", params={"q": "DOLLAR"}).json()] == [b["id"]]
    assert len(client.get("/api/notes", params={"pinned": True}).json()) == 1

    up = client.patch(f"/api/notes/{a['id']}", json={"body": "No retest, entered late", "pinned": True}).json()
    assert up["pinned"] and up["body"] == "No retest, entered late"
    assert client.patch(f"/api/notes/{a['id']}", json={"note_type": "rant"}).status_code == 422

    assert client.delete(f"/api/notes/{a['id']}").status_code == 204
    assert len(client.get("/api/notes").json()) == 2


def test_screenshot_only_note_gets_a_title_and_links(client):
    es = next(i for i in client.get("/api/instruments").json() if i["symbol_root"] == "ES")
    n = client.post("/api/notes", json={"note_type": "lesson", "instrument_id": es["id"]}).json()
    assert n["title"] == "Lesson" and n["symbol"] == "ES" and n["note_date"] == TODAY.isoformat()
    assert client.post("/api/notes", json={"title": "x", "instrument_id": 99999}).status_code == 422


def test_screenshots_and_drawings(client):
    n = _note(client)
    att = client.post(f"/api/notes/{n['id']}/attachments", files={"file": ("chart.png", PNG, "image/png")}).json()
    shapes = [
        {"id": "1", "type": "arrow", "x1": 10, "y1": 20, "x2": 200, "y2": 80, "color": "#f3b53d", "size": 4},
        {"id": "2", "type": "text", "x1": 50, "y1": 60, "text": "VAH held", "color": "#fff", "size": 28, "junk": 1},
        {"id": "3", "type": "pen", "points": [[1, 2], [3, 4], [5, 6]], "color": "#22c58b", "size": 3},
    ]
    out = client.put(f"/api/attachments/{att['id']}/annotations", json={"shapes": shapes}).json()
    assert [s["type"] for s in out["annotations"]] == ["arrow", "text", "pen"]
    assert "junk" not in out["annotations"][1]
    got = client.get("/api/notes").json()[0]["attachments"][0]
    assert got["annotations"][1]["text"] == "VAH held"
    assert client.put(f"/api/attachments/{att['id']}/annotations", json={"shapes": [{"type": "laser"}]}).status_code == 422
    # Deleting the note removes its screenshots.
    client.delete(f"/api/notes/{n['id']}")
    assert client.put(f"/api/attachments/{att['id']}/annotations", json={"shapes": []}).status_code == 404


def test_drawings_work_on_trade_screenshots_too(client):
    acc = client.post("/api/accounts", json={"name": "N", "currency": "USD"}).json()
    es = next(i for i in client.get("/api/instruments").json() if i["symbol_root"] == "ES")
    t = client.post("/api/trades/manual", json={
        "account_id": acc["id"], "instrument_id": es["id"], "direction": "long",
        "entries": [{"time": "2026-11-10T14:00:00Z", "price": "6000", "quantity": "1"}], "exits": [],
    }).json()
    att = client.post(f"/api/trades/{t['id']}/attachments", files={"file": ("c.png", PNG, "image/png")}).json()
    client.put(f"/api/attachments/{att['id']}/annotations", json={"shapes": [{"type": "box", "x1": 1, "y1": 1, "x2": 9, "y2": 9}]})
    assert client.get(f"/api/trades/{t['id']}").json()["attachments"][0]["annotations"][0]["type"] == "box"


def test_review_deck_schedule(client):
    lesson = _note(client, title="No volume = no breakout", note_type="lesson")
    idea = _note(client, title="Idea", note_type="idea")
    assert lesson["in_review"] and lesson["next_review"] == (TODAY + timedelta(days=1)).isoformat()
    assert not idea["in_review"]

    # Not due yet today; adding the idea to the deck makes it due today.
    assert client.get("/api/notes/review/due").json()["stats"]["due"] == 0
    client.patch(f"/api/notes/{idea['id']}", json={"in_review": True})
    due = client.get("/api/notes/review/due").json()
    assert [n["id"] for n in due["due"]] == [idea["id"]] and due["stats"]["in_deck"] == 2

    # Got it -> box 1 -> back in 2 days; again -> box 0 -> tomorrow.
    r = client.post(f"/api/notes/{idea['id']}/review", json={"result": "got_it"}).json()
    assert r["review_box"] == 1 and r["next_review"] == (TODAY + timedelta(days=2)).isoformat()
    r = client.post(f"/api/notes/{idea['id']}/review", json={"result": "again"}).json()
    assert r["review_box"] == 0 and r["next_review"] == (TODAY + timedelta(days=1)).isoformat()
    for _ in range(4):
        r = client.post(f"/api/notes/{lesson['id']}/review", json={"result": "got_it"}).json()
    assert r["mastered"] and r["next_review"] == (TODAY + timedelta(days=16)).isoformat()
    stats = client.get("/api/notes/review/due").json()["stats"]
    assert stats["mastered"] == 1 and stats["next_due"] == (TODAY + timedelta(days=1)).isoformat()
    assert client.post(f"/api/notes/{lesson['id']}/review", json={"result": "maybe"}).status_code == 422
