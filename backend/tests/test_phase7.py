"""Phase 7: bars, MAE/MFE, replay, reports, charges, missed + label-only trades."""

from __future__ import annotations

import json


def _acc(client, name="P7", ccy="USD"):
    return client.post("/api/accounts", json={"name": name, "currency": ccy}).json()


def _inst(client, sym):
    return next(i for i in client.get("/api/instruments").json() if i["symbol_root"] == sym)


def _bars_csv() -> bytes:
    # 1m ES bars 14:00-14:30 UTC: high reaches 5015, low dips to 4995.
    rows = ["time,o,h,l,c,v"]
    for m in range(0, 31):
        hi, lo = 5005, 5000
        if m == 5:
            lo = 4995
        if m == 20:
            hi = 5015
        rows.append(f"2026-10-14 14:{m:02d}:00,5002,{hi},{lo},5003,100")
    return ("\n".join(rows) + "\n").encode()


def _import_bars(client, es):
    cfg = {"instrument_id": es["id"], "timeframe": "1m", "datetime_format": "%Y-%m-%d %H:%M:%S",
           "file_timezone": "UTC",
           "column_map": {"timestamp": "time", "open": "o", "high": "h", "low": "l", "close": "c", "volume": "v"}}
    return client.post("/api/bars/import", files={"file": ("bars.csv", _bars_csv(), "text/csv")},
                       data={"config": json.dumps(cfg)}).json()


def _long_trade(client, acc, es):
    return client.post("/api/trades/manual", json={
        "account_id": acc["id"], "instrument_id": es["id"], "direction": "long",
        "entries": [{"time": "2026-10-14T14:00:00Z", "price": "5000", "quantity": "1"}],
        "exits": [{"time": "2026-10-14T14:30:00Z", "price": "5010", "quantity": "1"}],
        "initial_stop": "4990", "entry_quality": "A", "htf_alignment": "bullish",
    }).json()


def test_bar_import_and_duplicates(client):
    es = _inst(client, "ES")
    first = _import_bars(client, es)
    assert first["imported"] == 31
    again = _import_bars(client, es)
    assert again["imported"] == 0 and again["skipped"] == 31
    cov = client.get("/api/bars/coverage").json()
    assert cov[0]["symbol"] == "ES" and cov[0]["bars"] == 31


def test_mae_mfe(client):
    acc, es = _acc(client), _inst(client, "ES")
    _import_bars(client, es)
    _long_trade(client, acc, es)
    data = client.get("/api/review/mae-mfe", params={"account_id": acc["id"]}).json()
    assert data["covered_trades"] == 1
    p = data["points"][0]
    assert p["mfe_points"] == 15.0      # 5015 - 5000
    assert p["mae_points"] == 5.0       # 5000 - 4995
    assert p["mfe_r"] == 1.5            # 750 / 500 risk
    assert p["mae_r"] == 0.5
    assert p["captured_pct"] == 66.7    # 10 of 15 points
    assert data["avg_exit_efficiency_pct"] == 66.7


def test_exit_efficiency_only_for_profitable_trades(client):
    acc, es = _acc(client), _inst(client, "ES")
    _import_bars(client, es)
    client.post("/api/trades/manual", json={
        "account_id": acc["id"], "instrument_id": es["id"], "direction": "long",
        "entries": [{"time": "2026-10-14T14:00:00Z", "price": "5000", "quantity": "1"}],
        "exits": [{"time": "2026-10-14T14:30:00Z", "price": "4996", "quantity": "1"}],
    })
    p = client.get("/api/review/mae-mfe", params={"account_id": acc["id"]}).json()["points"][0]
    assert p["result"] == "loss" and p["captured_pct"] is None


def test_replay_payload(client):
    acc, es = _acc(client), _inst(client, "ES")
    _import_bars(client, es)
    t = _long_trade(client, acc, es)
    r = client.get(f"/api/trades/{t['id']}/replay").json()
    assert r["timeframe"] == "1m"
    assert len(r["candles"]) == 31
    assert len(r["markers"]) == 2
    assert any(line["title"] == "Stop" for line in r["lines"])
    # Times are shifted into IST (UTC+5:30) for display.
    from datetime import datetime, timezone
    utc_epoch = int(datetime(2026, 10, 14, 14, 0, tzinfo=timezone.utc).timestamp())
    assert r["candles"][0]["time"] - utc_epoch == 19800


def test_journal_fields_round_trip(client):
    acc, es = _acc(client), _inst(client, "ES")
    t = _long_trade(client, acc, es)
    assert t["entry_quality"] == "A"
    assert t["htf_alignment"] == "bullish"
    rows = client.get("/api/analytics/breakdown", params={"dimension": "with_htf", "account_id": acc["id"]}).json()
    assert rows[0]["key"] == "with HTF"


def test_missed_trade_excluded_from_stats(client):
    acc, es = _acc(client), _inst(client, "ES")
    _long_trade(client, acc, es)
    m = client.post("/api/trades/missed", json={
        "account_id": acc["id"], "instrument_id": es["id"], "direction": "short",
        "time": "2026-10-14T15:00:00Z", "planned_entry": "5020", "initial_stop": "5025",
        "planned_target": "5005",
    }).json()
    assert m["status"] == "missed" and m["result"] == "missed"
    assert m["r_multiple"] == "3"  # 15 pts target / 5 pts risk
    d = client.get("/api/analytics/dashboard", params={"account_id": acc["id"]}).json()
    assert d["kpis"]["trades"] == 1
    mk = client.get("/api/mistakes/analytics", params={"account_id": acc["id"]}).json()
    assert mk["missed"]["count"] == 1 and mk["missed"]["potential_r"] == 3.0


def test_notion_label_only_rows(client):
    acc, es = _acc(client), _inst(client, "ES")
    csv = (
        "Instrument,Lot Size,Time,DTR/ATR,Direction,Trade,Trade Type,Entry Quality,HTF Alignment,What exactly happened\n"
        "ES,4,2026-10-12 19:30,46/77,Short,Loss,Pullback,B,Bearish,Stopped(Analysis was wrong)\n"
        "ES,6,2026-10-12 22:22,77/77,Long,Win,\"Pullback, Continuation\",A,Bearish,Continuation(Thesis Held)\n"
        "ES,4,2026-10-13 20:03,46/77,Short,Missed Trade,Aggressive Move,A+,Bearish,\n"
    ).encode()
    cfg = {
        "source": "notion", "account_id": acc["id"], "format": "roundtrip",
        "file_timezone": "Asia/Kolkata", "datetime_format": "auto", "quantity_unit": "lots",
        "column_map": {"symbol": "Instrument", "quantity": "Lot Size", "entry_time": "Time",
                       "dtr_atr": "DTR/ATR", "direction": "Direction", "outcome": "Trade",
                       "entry_quality": "Entry Quality", "htf_alignment": "HTF Alignment"},
        "tag_columns": [{"column": "Trade Type", "category": "setup"},
                        {"column": "What exactly happened", "category": "thesis"}],
    }
    res = client.post("/api/import/run", files={"file": ("notion.csv", csv, "text/csv")},
                      data={"config": json.dumps(cfg)}).json()
    assert res["imported"] == 3 and res["failed"] == 0
    trades = client.get("/api/trades", params={"account_id": acc["id"]}).json()
    by_result = sorted(t["result"] for t in trades)
    assert by_result == ["loss", "missed", "win"]
    win = next(t for t in trades if t["result"] == "win")
    assert win["dtr"] == "77" and win["atr"] == "77" and win["entry_quality"] == "A"
    assert {g["name"] for g in win["tags"]} >= {"Pullback", "Continuation", "Continuation (Thesis Held)"}
    k = client.get("/api/analytics/dashboard", params={"account_id": acc["id"]}).json()["kpis"]
    assert k["trades"] == 2 and k["win_rate"] == 0.5
    assert k["label_only"] == 2 and k["net_pnl"] == "0"


def test_weekly_report(client):
    acc, es = _acc(client), _inst(client, "ES")
    _long_trade(client, acc, es)
    rep = client.get("/api/reports", params={"period": "week", "anchor": "2026-10-14", "account_id": acc["id"]}).json()
    assert rep["start"] == "2026-10-12" and rep["end"] == "2026-10-18"
    assert rep["kpis"]["trades"] == 1
    assert rep["compare"]["trades"]["delta"] == 1
    assert rep["focus"] is not None


def test_india_charges(client):
    nifty = _inst(client, "NIFTY")
    r = client.post("/api/charges/estimate", json={
        "instrument_id": nifty["id"], "direction": "long",
        "entries": [{"price": "20000", "quantity": "1"}], "exits": [{"price": "20010", "quantity": "1"}],
    }).json()
    assert r["brokerage"] == "40.00"   # min(20, 0.03% of value) per order x 2
    assert r["stt_ctt"] == "300.15"    # 0.02% of 1,500,750 sell value
    assert r["stamp_duty"] == "30.00"  # 0.002% of 1,500,000 buy value
    assert float(r["total"]) > 400
    assert r["exchange_name"] == "NSE" and float(r["exchange"]) > 0  # fee amount, not the name


def test_ai_review_off_by_default(client):
    r = client.post("/api/reports/ai-review", json={"period": "week", "anchor": "2026-10-14"})
    assert r.status_code == 400
    assert "turned off" in r.json()["detail"]


def test_api_key_is_masked(client):
    client.put("/api/settings", json={"ai_review": {"enabled": True, "api_key": "sk-ant-secret-1234", "model": "claude-opus-5-5"}})
    shown = client.get("/api/settings").json()["ai_review"]
    assert shown["api_key"].endswith("1234") and "secret" not in shown["api_key"]
    assert shown["api_key_set"] is True
    # Saving the masked value back keeps the real key.
    client.put("/api/settings", json={"ai_review": shown})
    from app.db import SessionLocal
    from app.models import Setting
    with SessionLocal() as db:
        assert db.get(Setting, "ai_review").value["api_key"] == "sk-ant-secret-1234"
