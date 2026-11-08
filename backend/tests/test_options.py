"""Options book: separate instruments, logged like futures, every stat scoped by segment."""

from __future__ import annotations

from decimal import Decimal


def _inst(client, symbol):
    return next(i for i in client.get("/api/instruments").json() if i["symbol_root"] == symbol)


def _trade(client, acc, inst, entry, exit_, qty="1", day="2026-11-03", direction="long", **extra):
    r = client.post("/api/trades/manual", json={
        "account_id": acc["id"], "instrument_id": inst["id"], "direction": direction,
        "entries": [{"time": f"{day}T05:00:00Z", "price": entry, "quantity": qty}],
        "exits": [{"time": f"{day}T05:20:00Z", "price": exit_, "quantity": qty}],
        **extra,
    })
    assert r.status_code == 201, r.text
    return r.json()


def test_options_instruments_seeded(client):
    opts = {i["symbol_root"]: i for i in client.get("/api/instruments").json() if i["segment"] == "options"}
    assert set(opts) == {"NIFTY-OPT", "CRUDEOIL-OPT", "CRUDEOILM-OPT", "GOLDM-OPT"}
    assert Decimal(opts["NIFTY-OPT"]["point_value"]) == 65
    assert Decimal(opts["CRUDEOIL-OPT"]["point_value"]) == 100
    assert Decimal(opts["CRUDEOILM-OPT"]["point_value"]) == 10
    assert Decimal(opts["GOLDM-OPT"]["point_value"]) == 10
    assert all(i["currency"] == "INR" for i in opts.values())
    assert _inst(client, "CRUDEOIL")["segment"] == "futures"


def test_option_trade_pnl_uses_premium_times_lot(client):
    acc = client.post("/api/accounts", json={"name": "Opt", "currency": "INR"}).json()
    t = _trade(client, acc, _inst(client, "NIFTY-OPT"), "120", "150", qty="2")
    assert Decimal(t["net_pnl"]) == 30 * 65 * 2  # premium points x 65 per lot x 2 lots


def test_every_view_is_scoped_to_its_book(client):
    acc = client.post("/api/accounts", json={"name": "Both", "currency": "INR"}).json()
    pb = client.post("/api/playbooks", json={"name": "Crude", "rules": [{"text": "r"}]}).json()
    _trade(client, acc, _inst(client, "CRUDEOIL"), "6000", "6020", playbook_id=pb["id"])            # futures +2000
    _trade(client, acc, _inst(client, "CRUDEOIL-OPT"), "150", "140", day="2026-11-04", playbook_id=pb["id"])  # options -1000
    _trade(client, acc, _inst(client, "GOLDM-OPT"), "300", "330", day="2026-11-05")                # options +300

    def dash(**p):
        return client.get("/api/analytics/dashboard", params={"account_id": acc["id"], **p}).json()["kpis"]

    assert dash()["trades"] == 3
    fut, opt = dash(segment="futures"), dash(segment="options")
    assert fut["trades"] == 1 and Decimal(fut["net_by_ccy"]["INR"]) == 2000
    assert opt["trades"] == 2 and Decimal(opt["net_by_ccy"]["INR"]) == -700

    assert len(client.get("/api/trades", params={"segment": "options"}).json()) == 2
    assert len(client.get("/api/trades", params={"segment": "futures"}).json()) == 1
    assert set(client.get("/api/analytics/calendar", params={"segment": "options"}).json()) == {"2026-11-04", "2026-11-05"}
    rows = {r["key"] for r in client.get("/api/analytics/breakdown", params={"dimension": "instrument", "segment": "options"}).json()}
    assert rows == {"CRUDEOIL-OPT", "GOLDM-OPT"}
    assert client.get("/api/mistakes/analytics", params={"segment": "options"}).status_code == 200
    assert client.get("/api/reports", params={"anchor": "2026-11-05", "segment": "options"}).status_code == 200

    stats = {p["name"]: p["stats"] for p in client.get("/api/playbooks", params={"segment": "options"}).json()}
    assert stats["Crude"]["trades"] == 1
    assert client.get(f"/api/playbooks/{pb['id']}", params={"segment": "futures"}).json()["stats"]["trades"] == 1


def test_option_charges_use_the_options_schedule(client):
    inst = _inst(client, "NIFTY-OPT")
    r = client.post("/api/charges/estimate", json={
        "instrument_id": inst["id"], "direction": "long",
        "entries": [{"price": "100", "quantity": "1"}], "exits": [{"price": "120", "quantity": "1"}],
    }).json()
    assert r["exchange_name"] == "NSE options"
    assert Decimal(r["brokerage"]) == 40  # flat Rs 20 per order
    assert Decimal(r["stt_ctt"]) == Decimal("7.80")  # 0.1% of the 120 x 65 sell premium


def test_segment_editable_and_validated(client):
    inst = _inst(client, "SILVERM")
    assert client.patch(f"/api/instruments/{inst['id']}", json={"segment": "options"}).json()["segment"] == "options"
    assert client.patch(f"/api/instruments/{inst['id']}", json={"segment": "bonds"}).status_code == 422
