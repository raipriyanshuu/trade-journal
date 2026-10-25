"""Backtest dashboard numbers (closed trades only)."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from app.backtest.models import BtSession, BtTrade

WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _result(t: BtTrade) -> str:
    return "win" if t.net > 0 else "loss" if t.net < 0 else "breakeven"


def summary(trades: list[BtTrade]) -> dict:
    n = len(trades)
    wins = [t for t in trades if t.net > 0]
    losses = [t for t in trades if t.net < 0]
    gp = sum(t.net for t in wins)
    gl = -sum(t.net for t in losses)
    rs = [t.r_multiple for t in trades if t.r_multiple is not None]
    net = sum(t.net for t in trades)
    avg_win = gp / len(wins) if wins else 0.0
    avg_loss = -gl / len(losses) if losses else 0.0
    holds = [t.close_ts - t.entry_ts for t in trades if t.close_ts]
    return {
        "trades": n,
        "wins": len(wins),
        "losses": len(losses),
        "win_rate": round(len(wins) / n, 4) if n else 0.0,
        "net": round(net, 2),
        "gross_profit": round(gp, 2),
        "gross_loss": round(gl, 2),
        "profit_factor": round(gp / gl, 2) if gl else None,
        "expectancy": round(net / n, 2) if n else 0.0,
        "expectancy_r": round(sum(rs) / len(rs), 2) if rs else None,
        "total_r": round(sum(rs), 2) if rs else None,
        "avg_win": round(avg_win, 2),
        "avg_loss": round(avg_loss, 2),
        "avg_win_loss": round(avg_win / -avg_loss, 2) if avg_loss else None,
        "largest_win": round(max((t.net for t in trades), default=0.0), 2),
        "largest_loss": round(min((t.net for t in trades), default=0.0), 2),
        "fees": round(sum(t.fees for t in trades), 2),
        "avg_hold_seconds": int(sum(holds) / len(holds)) if holds else None,
    }


def _streaks(trades: list[BtTrade]) -> dict:
    best_w = best_l = cur_w = cur_l = 0
    for t in trades:
        r = _result(t)
        if r == "win":
            cur_w, cur_l = cur_w + 1, 0
        elif r == "loss":
            cur_l, cur_w = cur_l + 1, 0
        best_w, best_l = max(best_w, cur_w), max(best_l, cur_l)
    return {"longest_win_streak": best_w, "longest_loss_streak": best_l}


def _group(trades: list[BtTrade], key) -> list[dict]:
    groups: dict[str, list[BtTrade]] = defaultdict(list)
    for t in trades:
        groups[key(t)].append(t)
    rows = []
    for k, g in groups.items():
        s = summary(g)
        rows.append({"key": k, **{f: s[f] for f in (
            "trades", "win_rate", "net", "profit_factor", "expectancy", "expectancy_r", "total_r")}})
    return rows


def dashboard(trades: list[BtTrade], sessions: dict[int, BtSession], tz: str) -> dict:
    zone = ZoneInfo(tz)
    closed = sorted((t for t in trades if t.status == "closed"), key=lambda t: (t.close_ts or 0, t.id))

    # Equity on the combined starting balance of the sessions involved.
    used = {t.session_id for t in closed} or set(sessions)
    start_bal = sum(sessions[i].starting_balance for i in used if i in sessions)
    eq, peak, max_dd, max_dd_pct = start_bal, start_bal, 0.0, 0.0
    curve = [{"n": 0, "time": None, "equity": round(start_bal, 2), "r": 0.0}]
    cum_r = 0.0
    for i, t in enumerate(closed, 1):
        eq += t.net
        cum_r += t.r_multiple or 0.0
        peak = max(peak, eq)
        dd = peak - eq
        if dd > max_dd:
            max_dd = dd
            max_dd_pct = dd / peak * 100 if peak > 0 else 0.0
        curve.append({"n": i, "time": t.close_ts, "equity": round(eq, 2), "r": round(cum_r, 2)})

    def local(ts: int) -> datetime:
        return datetime.fromtimestamp(ts, tz=timezone.utc).astimezone(zone)

    def strategy(t):
        s = sessions.get(t.session_id)
        return s.strategy if s else "?"

    order = {d: i for i, d in enumerate(WEEKDAYS)}
    by_weekday = sorted(_group(closed, lambda t: WEEKDAYS[local(t.entry_ts).weekday()]),
                        key=lambda r: order[r["key"]])
    by_hour = sorted(_group(closed, lambda t: f"{local(t.entry_ts).hour:02d}:00"), key=lambda r: r["key"])
    by_net = lambda rows: sorted(rows, key=lambda r: r["net"], reverse=True)  # noqa: E731

    return {
        "kpis": {**summary(closed), **_streaks(closed), "starting_balance": round(start_bal, 2),
                 "ending_balance": round(eq, 2), "max_drawdown": round(max_dd, 2),
                 "max_drawdown_pct": round(max_dd_pct, 2),
                 "return_pct": round((eq - start_bal) / start_bal * 100, 2) if start_bal else None},
        "equity": curve,
        "by_strategy": by_net(_group(closed, strategy)),
        "by_setup": by_net(_group(closed, lambda t: t.setup or "(no setup)")),
        "by_symbol": by_net(_group(closed, lambda t: t.symbol)),
        "by_direction": by_net(_group(closed, lambda t: t.direction)),
        "by_exit": by_net(_group(closed, lambda t: t.exit_reason or "?")),
        "by_weekday": by_weekday,
        "by_hour": by_hour,
        "r_distribution": _r_buckets(closed),
        "tz": tz,
    }


def _r_buckets(trades: list[BtTrade]) -> list[dict]:
    edges = [("< -2", -99, -2), ("-2..-1", -2, -1), ("-1..0", -1, 0), ("0..1", 0, 1),
             ("1..2", 1, 2), ("2..3", 2, 3), ("> 3", 3, 99)]
    rs = [t.r_multiple for t in trades if t.r_multiple is not None]
    return [{"bucket": lbl, "count": sum(1 for r in rs if lo <= r < hi)} for lbl, lo, hi in edges]
