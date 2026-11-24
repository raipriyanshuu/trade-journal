"""Daily Report Card: shared fields with Trading Day, goal carry-over, streaks, calendar stats."""

from __future__ import annotations


def _inst(client, symbol):
    return next(i for i in client.get("/api/instruments").json() if i["symbol_root"] == symbol)


def _trade(client, acc, inst, entry, exit_, day, qty="1"):
    r = client.post("/api/trades/manual", json={
        "account_id": acc["id"], "instrument_id": inst["id"], "direction": "long",
        "entries": [{"time": f"{day}T15:00:00Z", "price": entry, "quantity": qty}],
        "exits": [{"time": f"{day}T15:20:00Z", "price": exit_, "quantity": qty}],
    })
    assert r.status_code == 201, r.text
    return r.json()


def _card(**kw):
    base = {"goal": "", "goal_result": None, "segments": [], "overview": "", "easiest_money": "",
            "grade": None, "learned": "", "changes": "", "goal_tomorrow": ""}
    base.update(kw)
    return base


def test_new_card_uses_segments_from_settings(client):
    c = client.get("/api/report-cards/2026-11-03").json()
    assert c["exists"] is False and c["goal"] == "" and c["carried_over"] is None
    assert [s["name"] for s in c["segments"]][:2] == ["Pre-market prep", "US open 19:00-20:30"]


def test_shared_fields_live_on_the_trading_day_session(client):
    r = client.put("/api/report-cards/2026-11-03", json=_card(
        grade="A", learned="Patience pays", changes="Smaller size at the open", goal_tomorrow="Wait for 2nd test",
        segments=[{"name": "US open", "grade": "B", "cells": {"Sizing": "Too big", "Empty": ""}, "comment": "late"}]))
    assert r.status_code == 200, r.text
    assert r.json()["segments"][0]["cells"] == {"Sizing": "Too big"}
    s = client.get("/api/journal", params={"trading_date": "2026-11-03"}).json()
    assert (s["day_grade"], s["key_lesson"], s["what_to_change"], s["focus_tomorrow"]) == (
        "A", "Patience pays", "Smaller size at the open", "Wait for 2nd test")
    # ...and the other way round: editing the Review step shows on the card.
    client.put("/api/journal", json={**s, "key_lesson": "Edited in Review"})
    assert client.get("/api/report-cards/2026-11-03").json()["learned"] == "Edited in Review"


def test_goal_carries_over_and_streak(client):
    client.put("/api/report-cards/2026-11-03", json=_card(goal="No trades in the first 5 min",
                                                          goal_tomorrow="No trades in the first 5 min"))
    nxt = client.get("/api/report-cards/2026-11-04").json()
    assert nxt["goal"] == "No trades in the first 5 min" and nxt["carried_over"]["date"] == "2026-11-03"
    client.put("/api/report-cards/2026-11-04", json=_card(goal=nxt["goal"], goal_result="hit"))
    third = client.get("/api/report-cards/2026-11-05").json()
    # Nothing written for tomorrow on the 4th: the 4th's own goal carries on.
    assert third["goal"] == "No trades in the first 5 min" and third["carried_over"]["date"] == "2026-11-04"
    assert third["goal_streak"] == 3
    # Only the previous journaled day counts: an old goal doesn't come back.
    client.put("/api/journal", json={"trading_date": "2026-11-20", "account_id": None, "instrument_id": None})
    assert client.get("/api/report-cards/2026-11-21").json()["carried_over"] is None
    # Falls back to "what to change" when no goal for tomorrow was written.
    client.put("/api/report-cards/2026-11-05", json=_card(goal="x", changes="Stop after 2 losses"))
    assert client.get("/api/report-cards/2026-11-06").json()["goal"] == "Stop after 2 losses"


def test_validation(client):
    assert client.put("/api/report-cards/2026-11-03", json=_card(goal_result="maybe")).status_code == 422
    assert client.put("/api/report-cards/2026-11-03", json=_card(grade="Z")).status_code == 422
    assert client.put("/api/report-cards/2026-11-03",
                      json=_card(segments=[{"name": "x", "grade": "F"}])).status_code == 422


def test_card_lists_the_days_trades_with_notes(client):
    acc = client.post("/api/accounts", json={"name": "A1"}).json()
    t = _trade(client, acc, _inst(client, "ES"), "5000", "5002", "2026-11-03")
    client.patch(f"/api/trades/{t['id']}", json={"notes": "Clean break of ONH"})
    c = client.get(f"/api/report-cards/{t['trading_date']}").json()
    assert len(c["trades"]) == 1 and c["trades"][0]["notes"] == "Clean break of ONH"
    assert c["trades"][0]["attachments"] == [] and c["net"]["USD"] > 0


def test_calendar_and_stats(client):
    acc = client.post("/api/accounts", json={"name": "A1"}).json()
    es = _inst(client, "ES")
    t1 = _trade(client, acc, es, "5000", "5004", "2026-11-03")
    t2 = _trade(client, acc, es, "5000", "4998", "2026-11-04")
    client.put(f"/api/report-cards/{t1['trading_date']}", json=_card(
        grade="A", goal_result="hit", segments=[{"name": "US open", "grade": "A+"}, {"name": "US mid", "grade": "C"}]))
    client.put(f"/api/report-cards/{t2['trading_date']}", json=_card(
        grade="C", goal_result="missed", segments=[{"name": "US open", "grade": "B"}]))
    r = client.get("/api/report-cards", params={"date_from": "2026-11-01", "date_to": "2026-11-30"}).json()
    assert [d["grade"] for d in r["days"]] == ["A", "C"]
    st = r["stats"]
    assert st["goal"]["hit_rate"] == 50 and st["cards"] == 2
    seg = {s["name"]: s for s in st["segments"]}
    assert seg["US open"]["avg"] == 3.0 and seg["US open"]["grade"] == "A" and seg["US mid"]["grade"] == "C"
    by = {g["grade"]: g for g in st["grades"]}
    assert by["A"]["avg_net"]["USD"] > 0 > by["C"]["avg_net"]["USD"]
