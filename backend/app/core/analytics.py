"""Dashboard KPIs, charts, P&L calendar and breakdowns."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.sessions import minutes_since_session_open
from app.core.stats import avg_holding, basic_stats, equity_and_drawdown, streaks
from app.models import DailySession, Instrument, Trade

ZERO = Decimal("0")


def _net_by_ccy(trades: list[Trade]) -> dict:
    out: dict[str, Decimal] = defaultdict(lambda: ZERO)
    for t in trades:
        if t.status == "closed":
            out[t.currency] += Decimal(t.net_pnl)
    return {k: str(v) for k, v in out.items()}


def dashboard(trades: list[Trade]) -> dict:
    closed = [t for t in trades if t.status == "closed"]
    stats = basic_stats(trades)
    eq = equity_and_drawdown(trades)
    strk = streaks(trades)

    # Daily P&L.
    daily: dict = defaultdict(lambda: ZERO)
    for t in closed:
        daily[t.trading_date] += Decimal(t.net_pnl)
    daily_pnl = [{"date": d.isoformat(), "net": float(v)} for d, v in sorted(daily.items())]

    # R-multiple distribution.
    buckets = [("< -3", -99, -3), ("-3..-2", -3, -2), ("-2..-1", -2, -1), ("-1..0", -1, 0),
               ("0..1", 0, 1), ("1..2", 1, 2), ("2..3", 2, 3), ("> 3", 3, 99)]
    r_dist = []
    rs = [float(t.r_multiple) for t in closed if t.r_multiple is not None]
    for label, lo, hi in buckets:
        r_dist.append({"bucket": label, "count": sum(1 for r in rs if lo <= r < hi)})

    # Win/loss by direction.
    wl = []
    for direction in ("long", "short"):
        sub = [t for t in closed if t.direction == direction]
        wins = sum(1 for t in sub if Decimal(t.net_pnl) > 0)
        losses = sum(1 for t in sub if Decimal(t.net_pnl) < 0)
        net = sum((Decimal(t.net_pnl) for t in sub), ZERO)
        wl.append({"direction": direction, "wins": wins, "losses": losses, "net": float(net)})

    stats.update({
        "max_drawdown": eq["max_drawdown"],
        "max_drawdown_pct": eq["max_drawdown_pct"],
        "net_by_ccy": _net_by_ccy(trades),
        "avg_hold_winner": avg_holding(trades, True),
        "avg_hold_loser": avg_holding(trades, False),
        **strk,
    })

    return {
        "kpis": stats,
        "equity": eq["points"],
        "daily_pnl": daily_pnl,
        "r_distribution": r_dist,
        "winloss_by_direction": wl,
    }


def calendar(trades: list[Trade]) -> dict:
    """Per-day net/trades/win-rate, for the P&L calendar heatmap."""
    days: dict = {}
    for t in trades:
        if t.status != "closed":
            continue
        key = t.trading_date.isoformat()
        d = days.setdefault(key, {"net": ZERO, "trades": 0, "wins": 0, "losses": 0})
        d["net"] += Decimal(t.net_pnl)
        d["trades"] += 1
        if Decimal(t.net_pnl) > 0:
            d["wins"] += 1
        elif Decimal(t.net_pnl) < 0:
            d["losses"] += 1
    return {
        k: {
            "net": float(v["net"]),
            "trades": v["trades"],
            "win_rate": round(v["wins"] / (v["wins"] + v["losses"]), 3) if (v["wins"] + v["losses"]) else 0,
        }
        for k, v in days.items()
    }


def _holding_bucket(seconds) -> str:
    if seconds is None:
        return "unknown"
    m = seconds / 60
    if m < 5:
        return "< 5m"
    if m < 30:
        return "5-30m"
    if m < 120:
        return "30m-2h"
    if m < 1440:
        return "2h-1d"
    return "> 1d"


def breakdown(db: Session, trades: list[Trade], dimension: str, tz: str) -> list[dict]:
    instruments = {i.id: i for i in db.scalars(select(Instrument))}

    def journal_field(trade, field):
        js = db.scalar(select(DailySession).where(
            DailySession.trading_date == trade.trading_date,
            DailySession.account_id == trade.account_id,
            DailySession.instrument_id.is_(None),
        ))
        return getattr(js, field) if js else None

    def keys_for(t) -> list[str]:
        if dimension == "instrument":
            return [t.instrument.symbol_root if t.instrument else "?"]
        if dimension == "account":
            return [t.account.name if t.account else "?"]
        if dimension == "direction":
            return [t.direction]
        if dimension == "scenario":
            return [t.scenario]
        if dimension == "planned":
            return ["planned" if t.planned else ("unplanned" if t.planned is False else "unset")]
        if dimension == "checklist_score":
            return [str(t.checklist_score) if t.checklist_score is not None else "unset"]
        if dimension == "vwap":
            return [t.vwap_relation]
        if dimension == "entry_location":
            return [t.entry_location]
        if dimension == "weekday":
            return [["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][t.trading_date.weekday()]]
        if dimension == "holding_bucket":
            return [_holding_bucket(t.holding_time_seconds)]
        if dimension == "position_size":
            return [str(t.max_position_size)]
        if dimension == "setup_tag":
            tags = [tag.name for tag in t.tags if tag.category == "setup"]
            return tags or ["(untagged)"]
        if dimension == "day_type":
            return [journal_field(t, "actual_day_type") or "(unset)"]
        if dimension == "opening_type":
            return [journal_field(t, "actual_opening_type") or "(unset)"]
        if dimension == "session_time":
            inst = instruments.get(t.instrument_id)
            if not t.time_known or not inst:
                return ["unknown"]
            m = minutes_since_session_open(t.open_time, inst)
            if m is None or m < 0:
                return ["pre-open"]
            return [f"+{int(m // 30) * 30}m"]
        if dimension == "clock_time":
            if not t.time_known:
                return ["unknown"]
            local = t.open_time.astimezone(ZoneInfo(tz))
            return [f"{local.hour:02d}:00"]
        return ["all"]

    groups: dict[str, list[Trade]] = defaultdict(list)
    for t in trades:
        for k in keys_for(t):
            groups[k].append(t)

    rows = []
    for key, group in groups.items():
        s = basic_stats(group)
        rows.append({
            "key": key,
            "trades": s["trades"],
            "win_rate": s["win_rate"],
            "net_pnl": s["net_pnl"],
            "avg_pnl": s["expectancy"],
            "profit_factor": s["profit_factor"],
            "expectancy_r": s["expectancy_r"],
        })
    rows.sort(key=lambda r: float(r["net_pnl"]), reverse=True)
    return rows
