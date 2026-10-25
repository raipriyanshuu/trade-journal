"""Trade styles (Scalp / Swing / ...): saving, the style list, filters, breakdowns, rebuilds."""

from __future__ import annotations


def _acc_es(client):
    acc = client.post("/api/accounts", json={"name": "S", "currency": "USD"}).json()
    es = next(i for i in client.get("/api/instruments").json() if i["symbol_root"] == "ES")
    return acc, es


def _trade(client, acc, es, *, exit_price, style=None, day="2026-10-20"):
    body = {
        "account_id": acc["id"], "instrument_id": es["id"], "direction": "long",
        "entries": [{"time": f"{day}T14:00:00Z", "price": "6000", "quantity": "1"}],
        "exits": [{"time": f"{day}T14:10:00Z", "price": exit_price, "quantity": "1"}],
    }
    if style is not None:
        body["style"] = style
    r = client.post("/api/trades/manual", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def test_default_styles_and_case_insensitive_match(client):
    assert client.get("/api/trades/styles").json() == ["Scalp", "Intraday", "Swing", "Positional"]
    acc, es = _acc_es(client)
    t = _trade(client, acc, es, exit_price="6010", style="  swing ")
    assert t["style"] == "Swing"
    assert client.get("/api/trades/styles").json() == ["Scalp", "Intraday", "Swing", "Positional"]


def test_new_style_is_added_to_list(client):
    acc, es = _acc_es(client)
    t = _trade(client, acc, es, exit_price="6010", style="Overnight")
    assert t["style"] == "Overnight"
    assert client.get("/api/trades/styles").json()[-1] == "Overnight"
    # Patching to another casing of it reuses the stored name.
    t2 = client.patch(f"/api/trades/{t['id']}", json={"style": "OVERNIGHT"}).json()
    assert t2["style"] == "Overnight"
    assert client.get("/api/trades/styles").json().count("Overnight") == 1


def test_set_styles_dedupes_and_keeps_trade_styles(client):
    acc, es = _acc_es(client)
    t = _trade(client, acc, es, exit_price="6010", style="Scalp")
    out = client.put("/api/trades/styles", json={"styles": ["Swing", " swing", "Scalp", ""]}).json()
    assert out == ["Swing", "Scalp"]
    client.put("/api/trades/styles", json={"styles": ["Swing"]})
    assert client.get(f"/api/trades/{t['id']}").json()["style"] == "Scalp"


def test_clear_style_and_bulk_style(client):
    acc, es = _acc_es(client)
    a = _trade(client, acc, es, exit_price="6010", style="Scalp")
    b = _trade(client, acc, es, exit_price="5990", day="2026-10-21")
    r = client.post("/api/trades/bulk-style", json={"trade_ids": [a["id"], b["id"]], "style": "swing"}).json()
    assert r == {"updated": 2, "style": "Swing"}
    assert {t["style"] for t in client.get("/api/trades").json()} == {"Swing"}
    assert client.patch(f"/api/trades/{a['id']}", json={"style": ""}).json()["style"] is None


def test_style_filters_dashboard_trades_and_breakdown(client):
    acc, es = _acc_es(client)
    _trade(client, acc, es, exit_price="6010", style="Swing")               # +10 pts win
    _trade(client, acc, es, exit_price="5995", style="Scalp", day="2026-10-21")  # loss
    _trade(client, acc, es, exit_price="6004", style="Scalp", day="2026-10-22")  # win
    _trade(client, acc, es, exit_price="6002", day="2026-10-23")               # unassigned

    def kpis(style=None):
        params = {"account_id": acc["id"]}
        if style:
            params["style"] = style
        return client.get("/api/analytics/dashboard", params=params).json()["kpis"]

    assert kpis()["trades"] == 4
    assert kpis("Swing")["trades"] == 1 and kpis("Swing")["win_rate"] == 1.0
    assert kpis("scalp")["trades"] == 2 and kpis("Scalp")["win_rate"] == 0.5
    assert kpis("__none")["trades"] == 1

    assert len(client.get("/api/trades", params={"style": "Scalp"}).json()) == 2
    assert len(client.get("/api/trades", params={"style": "__none"}).json()) == 1

    rows = {r["key"]: r for r in client.get(
        "/api/analytics/breakdown", params={"dimension": "style", "account_id": acc["id"]}).json()}
    assert set(rows) == {"Swing", "Scalp", "(unassigned)"}
    assert rows["Scalp"]["trades"] == 2

    rep = client.get("/api/reports", params={"anchor": "2026-10-22", "period": "week", "style": "Swing"})
    assert rep.status_code == 200
    assert client.get("/api/mistakes/analytics", params={"style": "Swing"}).status_code == 200
    assert client.get("/api/review/mae-mfe", params={"style": "Swing"}).status_code == 200


def test_style_survives_rebuild(client):
    acc, es = _acc_es(client)
    t = _trade(client, acc, es, exit_price="6010", style="Swing")
    ex = next(e for e in t["executions"] if e["side"] == "sell")
    client.patch(f"/api/executions/{ex['id']}", json={"timestamp": "2026-10-20T15:00:00Z"})
    rebuilt = client.get("/api/trades", params={"account_id": acc["id"]}).json()[0]
    assert rebuilt["style"] == "Swing"
    assert rebuilt["holding_time_seconds"] == 60 * 60


def test_missed_setup_with_style(client):
    acc, es = _acc_es(client)
    r = client.post("/api/trades/missed", json={
        "account_id": acc["id"], "instrument_id": es["id"], "direction": "short",
        "time": "2026-10-20T14:00:00Z", "style": "Swing",
    })
    assert r.status_code == 201 and r.json()["style"] == "Swing"


def test_notes_context_behaviour_editable_after_logging(client):
    acc, es = _acc_es(client)
    t = _trade(client, acc, es, exit_price="6010")
    out = client.patch(f"/api/trades/{t['id']}", json={
        "notes": "Held through news", "context": "Trend day", "behaviour": "Calm",
    }).json()
    assert (out["notes"], out["context"], out["behaviour"]) == ("Held through news", "Trend day", "Calm")
