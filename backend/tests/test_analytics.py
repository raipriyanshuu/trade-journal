"""Dashboard KPIs, breakdowns and calendar."""

from __future__ import annotations


def _acc(client):
    return client.post("/api/accounts", json={"name": "An", "currency": "USD"}).json()


def _es(client):
    return next(i for i in client.get("/api/instruments").json() if i["symbol_root"] == "ES")


def _trade(client, acc, es, ep, xp, day, direction="long"):
    e, x = (ep, xp)
    body = {
        "account_id": acc["id"], "instrument_id": es["id"], "direction": direction,
        "entries": [{"time": f"2026-10-{day}T14:00:00Z", "price": e, "quantity": "1"}],
        "exits": [{"time": f"2026-10-{day}T14:30:00Z", "price": x, "quantity": "1"}],
    }
    return client.post("/api/trades/manual", json=body).json()


def test_dashboard_kpis(client):
    acc, es = _acc(client), _es(client)
    _trade(client, acc, es, "5000", "5010", "14")  # +500 win
    _trade(client, acc, es, "5010", "5000", "15")  # -500 loss
    d = client.get("/api/analytics/dashboard", params={"account_id": acc["id"]}).json()
    assert d["kpis"]["trades"] == 2
    assert d["kpis"]["wins"] == 1
    assert d["kpis"]["losses"] == 1
    assert d["kpis"]["win_rate"] == 0.5
    assert len(d["equity"]) == 2
    assert len(d["daily_pnl"]) == 2


def test_breakdown_by_instrument(client):
    acc, es = _acc(client), _es(client)
    _trade(client, acc, es, "5000", "5010", "14")
    rows = client.get("/api/analytics/breakdown", params={"dimension": "instrument", "account_id": acc["id"]}).json()
    assert len(rows) == 1
    assert rows[0]["key"] == "ES"
    assert rows[0]["net_pnl"] == "500.00"


def test_calendar(client):
    acc, es = _acc(client), _es(client)
    _trade(client, acc, es, "5000", "5010", "14")
    cal = client.get("/api/analytics/calendar", params={"account_id": acc["id"]}).json()
    assert "2026-10-14" in cal
    assert cal["2026-10-14"]["trades"] == 1
    assert cal["2026-10-14"]["net"] == 500.0


def test_breakdown_by_weekday(client):
    acc, es = _acc(client), _es(client)
    _trade(client, acc, es, "5000", "5010", "14")  # 2026-10-14 is a Wednesday
    rows = client.get("/api/analytics/breakdown", params={"dimension": "weekday", "account_id": acc["id"]}).json()
    assert rows[0]["key"] == "Wed"
