"""Playbooks: editable rules, per-trade checklists, stats, filters, rebuild safety."""

from __future__ import annotations


def _setup(client):
    acc = client.post("/api/accounts", json={"name": "P", "currency": "USD"}).json()
    es = next(i for i in client.get("/api/instruments").json() if i["symbol_root"] == "ES")
    return acc, es


def _pb(client, name="Opening drive", rules=None):
    rules = rules if rules is not None else [
        {"section": "Market context", "text": "Gap outside value"},
        {"section": "Entry criteria", "text": "First pullback holds VWAP"},
        {"section": "Exit criteria", "text": "Partial at 1R"},
    ]
    r = client.post("/api/playbooks", json={"name": name, "description": "d", "color": "teal", "rules": rules})
    assert r.status_code == 201, r.text
    return r.json()


def _trade(client, acc, es, exit_price, day="2026-10-20", **extra):
    r = client.post("/api/trades/manual", json={
        "account_id": acc["id"], "instrument_id": es["id"], "direction": "long",
        "entries": [{"time": f"{day}T14:00:00Z", "price": "6000", "quantity": "1"}],
        "exits": [{"time": f"{day}T14:10:00Z", "price": exit_price, "quantity": "1"}],
        **extra,
    })
    assert r.status_code == 201, r.text
    return r.json()


def test_create_edit_reorder_delete_rules(client):
    pb = _pb(client)
    assert [r["text"] for r in pb["rules"]] == ["Gap outside value", "First pullback holds VWAP", "Partial at 1R"]
    assert pb["sections"] == ["Market context", "Entry criteria", "Exit criteria"]
    r0, r1, r2 = pb["rules"]
    out = client.put(f"/api/playbooks/{pb['id']}", json={
        "name": "Opening drive v2", "rules": [
            {"id": r2["id"], "section": "Exit criteria", "text": "Partial at 1.5R"},  # edited + moved first
            {"id": r0["id"], "section": "Market context", "text": "Gap outside value"},
            {"section": "Risk management", "text": "Max 2 attempts"},  # new
        ],  # r1 removed
    }).json()
    assert out["name"] == "Opening drive v2"
    assert [r["text"] for r in out["rules"]] == ["Partial at 1.5R", "Gap outside value", "Max 2 attempts"]
    assert out["rules"][0]["id"] == r2["id"]
    assert r1["id"] not in {r["id"] for r in out["rules"]}
    assert client.put(f"/api/playbooks/{pb['id']}", json={"rules": [{"id": 99999, "text": "x"}]}).status_code == 422


def test_names_unique_duplicate_archive_delete(client):
    acc, es = _setup(client)
    pb = _pb(client)
    assert client.post("/api/playbooks", json={"name": "opening DRIVE"}).status_code == 422
    dup = client.post(f"/api/playbooks/{pb['id']}/duplicate").json()
    assert dup["name"] == "Opening drive (copy)" and len(dup["rules"]) == 3
    client.put(f"/api/playbooks/{dup['id']}", json={"archived": True})
    assert [p["id"] for p in client.get("/api/playbooks").json()] == [pb["id"]]
    assert len(client.get("/api/playbooks", params={"include_archived": True}).json()) == 2

    t = _trade(client, acc, es, "6004", playbook_id=pb["id"], rule_ids=[pb["rules"][0]["id"]])
    assert client.delete(f"/api/playbooks/{pb['id']}").status_code == 204
    after = client.get(f"/api/trades/{t['id']}").json()
    assert after["playbook"] is None and after["checked_rule_ids"] == []  # trade kept, just unassigned


def test_trade_checklist_and_stats(client):
    acc, es = _setup(client)
    pb = _pb(client)
    ids = [r["id"] for r in pb["rules"]]
    a = _trade(client, acc, es, "6010", playbook_id=pb["id"], rule_ids=ids)            # all followed, win
    assert a["playbook"]["name"] == "Opening drive" and (a["rules_followed"], a["rules_total"]) == (3, 3)
    b = _trade(client, acc, es, "5990", day="2026-10-21", playbook_id=pb["id"], rule_ids=ids[:1])  # broke, loss
    client.post("/api/trades/missed", json={"account_id": acc["id"], "instrument_id": es["id"], "direction": "long",
                                            "time": "2026-10-22T14:00:00Z", "playbook_id": pb["id"]})
    _trade(client, acc, es, "6002", day="2026-10-23")  # no playbook

    row = next(p for p in client.get("/api/playbooks").json() if p["id"] == pb["id"])
    s = row["stats"]
    assert s["trades"] == 2 and s["missed"] == 1 and s["win_rate"] == 0.5
    assert s["net_by_ccy"]["USD"] == "0.00"  # +$500 - $500
    assert s["adherence"] == round((1 + 1 / 3) / 2, 4)

    d = client.get(f"/api/playbooks/{pb['id']}").json()
    st = d["stats"]
    assert st["followed_all"]["trades"] == 1 and st["followed_all"]["win_rate"] == 1.0
    assert st["broke_rules"]["trades"] == 1 and st["broke_rules"]["win_rate"] == 0.0
    r1 = next(r for r in st["per_rule"] if r["rule_id"] == ids[1])
    assert r1["followed"] == 1 and r1["win_rate_followed"] == 1.0 and r1["win_rate_not_followed"] == 0.0
    assert len(d["trades"]) == 3 and d["rules"][0]["used_on"] == 2

    # Change the checklist on an existing trade (ids change when the pair is rebuilt).
    b = next(t for t in client.get("/api/trades").json() if t["trading_date"] == "2026-10-21")
    assert b["rules_followed"] == 1  # survived the rebuilds caused by later trades
    _r = client.put(f"/api/trades/{b['id']}/playbook", json={"playbook_id": pb["id"], "rule_ids": ids})
    assert _r.status_code == 200, _r.text
    upd = _r.json()
    assert upd["rules_followed"] == 3 and set(upd["checked_rule_ids"]) == set(ids)
    other = _pb(client, "Other", [{"text": "x"}])
    bad = client.put(f"/api/trades/{b['id']}/playbook", json={"playbook_id": pb["id"], "rule_ids": [other["rules"][0]["id"]]})
    assert bad.status_code == 422


def test_filters_and_breakdown_by_playbook(client):
    acc, es = _setup(client)
    pb = _pb(client)
    _trade(client, acc, es, "6010", playbook_id=pb["id"])
    _trade(client, acc, es, "5995", day="2026-10-21")
    k = lambda **p: client.get("/api/analytics/dashboard", params={"account_id": acc["id"], **p}).json()["kpis"]  # noqa: E731
    assert k()["trades"] == 2
    assert k(playbook=str(pb["id"]))["trades"] == 1 and k(playbook="none")["trades"] == 1
    assert len(client.get("/api/trades", params={"playbook": str(pb["id"])}).json()) == 1
    rows = {r["key"] for r in client.get("/api/analytics/breakdown", params={"dimension": "playbook"}).json()}
    assert rows == {"Opening drive", "(no playbook)"}


def test_playbook_and_ticks_survive_rebuild(client):
    acc, es = _setup(client)
    pb = _pb(client)
    ids = [r["id"] for r in pb["rules"]]
    t = _trade(client, acc, es, "6010", playbook_id=pb["id"], rule_ids=ids[:2])
    ex = next(e for e in t["executions"] if e["side"] == "sell")
    client.patch(f"/api/executions/{ex['id']}", json={"timestamp": "2026-10-20T15:00:00Z"})
    rebuilt = client.get("/api/trades", params={"account_id": acc["id"]}).json()[0]
    assert rebuilt["playbook"]["id"] == pb["id"] and rebuilt["rules_followed"] == 2


def test_unknown_playbook_rejected_before_saving(client):
    acc, es = _setup(client)
    r = client.post("/api/trades/manual", json={
        "account_id": acc["id"], "instrument_id": es["id"], "direction": "long", "playbook_id": 999,
        "entries": [{"time": "2026-10-20T14:00:00Z", "price": "6000", "quantity": "1"}], "exits": [],
    })
    assert r.status_code == 422
    assert client.get("/api/trades").json() == []


def test_dashboard_day_win_rate_and_edge_score(client):
    acc, es = _setup(client)
    for day, px in (("2026-10-19", "6010"), ("2026-10-20", "5995"), ("2026-10-21", "6008"),
                    ("2026-10-22", "6006"), ("2026-10-23", "5997")):
        _trade(client, acc, es, px, day=day)
    d = client.get("/api/analytics/dashboard", params={"account_id": acc["id"]}).json()
    k, e = d["kpis"], d["edge"]
    assert (k["days"], k["winning_days"], k["losing_days"]) == (5, 3, 2)
    assert k["day_win_rate"] == 0.6
    assert e["enough_trades"] and 0 <= e["score"] <= 100
    assert set(e["parts"]) == {"win_rate", "profit_factor", "avg_win_loss", "recovery_factor", "max_drawdown", "consistency"}
    assert e["parts"]["win_rate"] == 100.0  # 60% win rate
    # +$500, -$250, +$400, +$300, -$150: net $800, worst drawdown $250 -> recovery 3.2
    assert k["recovery_factor"] == 3.2
