"""The Mistakes page analytics payload: cost, clean-vs-mistake, when, streaks."""

from __future__ import annotations

from collections import defaultdict
from datetime import timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.mistakes import RULE_EXPLANATIONS
from app.core.sessions import minutes_since_session_open
from app.core.stats import basic_stats
from app.models import Instrument, MistakeFlag, Trade

ZERO = Decimal("0")


def _mistake_types_by_trade(db: Session, trades: list[Trade]) -> dict[int, set[str]]:
    ids = [t.id for t in trades]
    types: dict[int, set[str]] = defaultdict(set)
    if ids:
        for f in db.scalars(
            select(MistakeFlag).where(
                MistakeFlag.trade_id.in_(ids), MistakeFlag.dismissed.is_(False)
            )
        ):
            label = f.rule_code if f.source == "auto" else f"manual:{f.rule_code}"
            types[f.trade_id].add(label)
    for t in trades:
        for tag in t.tags:
            if tag.category == "mistake":
                types[t.id].add(f"tag:{tag.name}")
    return types


def build(db: Session, trades: list[Trade], tz: str, big_win_r: float) -> dict:
    types = _mistake_types_by_trade(db, trades)
    mistake_ids = {tid for tid, s in types.items() if s}
    closed = [t for t in trades if t.status == "closed"]

    # --- Cost of mistakes, ranked most expensive first ---
    agg: dict[str, dict] = {}
    for t in trades:
        for typ in types.get(t.id, ()):
            a = agg.setdefault(typ, {"count": 0, "net": ZERO, "r": 0.0, "rn": 0})
            a["count"] += 1
            a["net"] += Decimal(t.net_pnl)
            if t.r_multiple is not None:
                a["r"] += float(t.r_multiple)
                a["rn"] += 1
    cost_by_type = sorted(
        [
            {
                "type": typ,
                "explanation": RULE_EXPLANATIONS.get(typ, typ),
                "count": a["count"],
                "net_pnl": str(a["net"]),
                "avg_net": str((a["net"] / a["count"]).quantize(Decimal("0.01"))) if a["count"] else "0",
                "total_r": round(a["r"], 2),
                "avg_r": round(a["r"] / a["rn"], 2) if a["rn"] else None,
            }
            for typ, a in agg.items()
        ],
        key=lambda x: float(x["net_pnl"]),
    )

    # --- Clean vs mistake ---
    clean = [t for t in trades if t.id not in mistake_ids]
    bad = [t for t in trades if t.id in mistake_ids]
    clean_vs_mistake = {"clean": basic_stats(clean), "mistake": basic_stats(bad)}

    # --- Equity overlay: actual vs without mistake trades ---
    ordered = sorted(closed, key=lambda t: (t.close_time or t.open_time, t.id))
    overlay = []
    cum_actual = ZERO
    cum_clean = ZERO
    for t in ordered:
        cum_actual += Decimal(t.net_pnl)
        if t.id not in mistake_ids:
            cum_clean += Decimal(t.net_pnl)
        overlay.append({"date": t.trading_date.isoformat(), "actual": float(cum_actual), "without_mistakes": float(cum_clean)})

    # --- When mistakes happen ---
    instruments = {i.id: i for i in db.scalars(select(Instrument))}

    def rate(bucket_fn):
        total: dict = defaultdict(int)
        bad_c: dict = defaultdict(int)
        for t in closed:
            b = bucket_fn(t)
            if b is None:
                continue
            total[b] += 1
            if t.id in mistake_ids:
                bad_c[b] += 1
        return [
            {"bucket": str(k), "trades": total[k], "mistakes": bad_c[k],
             "rate": round(bad_c[k] / total[k], 3) if total[k] else 0}
            for k in sorted(total, key=lambda x: (isinstance(x, str), x))
        ]

    def weekday(t):
        return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][t.trading_date.weekday()]

    def session_bucket(t):
        if not t.time_known:
            return None
        inst = instruments.get(t.instrument_id)
        if not inst:
            return None
        m = minutes_since_session_open(t.open_time, inst)
        if m is None or m < 0:
            return "pre-open"
        return f"+{int(m // 30) * 30}m"

    # Trade number within the day.
    day_counter: dict = defaultdict(int)
    trade_number = {}
    for t in sorted(closed, key=lambda x: (x.trading_date, x.open_time, x.id)):
        day_counter[(t.account_id, t.trading_date)] += 1
        trade_number[t.id] = day_counter[(t.account_id, t.trading_date)]

    when = {
        "by_weekday": rate(weekday),
        "by_session_bucket": rate(session_bucket),
        "by_trade_number": rate(lambda t: f"#{trade_number.get(t.id, 0)}"),
        "by_day_type": rate(lambda t: _day_type(db, t)),
    }

    # --- After-loss behaviour (sequence-based) ---
    seq = ordered
    after = _after_states(seq, mistake_ids, big_win_r)

    # --- Trends: weekly mistake count and net cost ---
    weekly: dict = defaultdict(lambda: {"count": 0, "net": ZERO})
    for t in closed:
        if t.id in mistake_ids:
            y, w, _ = t.trading_date.isocalendar()
            key = f"{y}-W{w:02d}"
            weekly[key]["count"] += 1
            weekly[key]["net"] += Decimal(t.net_pnl)
    trends = [
        {"week": k, "count": v["count"], "net_pnl": str(v["net"])}
        for k, v in sorted(weekly.items())
    ]

    # --- Clean streak over trading days ---
    streak = _clean_streak(closed, mistake_ids)

    # --- Missed opportunities (setups seen but not taken) ---
    missed = [t for t in trades if t.status == "missed"]
    missed_summary = {
        "count": len(missed),
        "potential_r": round(sum(float(t.r_multiple) for t in missed if t.r_multiple is not None), 2),
        "by_type": sorted(
            (
                {"type": name, "count": sum(1 for t in missed if name in {g.name for g in t.tags if g.category == "setup"})}
                for name in {g.name for t in missed for g in t.tags if g.category == "setup"}
            ),
            key=lambda x: -x["count"],
        ),
    }

    return {
        "missed": missed_summary,
        "cost_by_type": cost_by_type,
        "clean_vs_mistake": clean_vs_mistake,
        "equity_overlay": overlay,
        "when": when,
        "after_loss_behavior": after,
        "trends": trends,
        "clean_streak": streak,
        "total_trades": len(closed),
        "mistake_trades": len([t for t in closed if t.id in mistake_ids]),
    }


def _day_type(db, trade) -> str | None:
    from app.models import DailySession

    js = db.scalar(
        select(DailySession).where(
            DailySession.trading_date == trade.trading_date,
            DailySession.account_id == trade.account_id,
            DailySession.instrument_id.is_(None),
        )
    )
    return js.actual_day_type if js and js.actual_day_type else None


def _after_states(seq: list[Trade], mistake_ids: set[int], big_win_r: float) -> dict:
    def block(indices):
        trs = [seq[i] for i in indices]
        wins = [t for t in trs if Decimal(t.net_pnl) > 0]
        losses = [t for t in trs if Decimal(t.net_pnl) < 0]
        decided = len(wins) + len(losses)
        net = sum((Decimal(t.net_pnl) for t in trs), ZERO)
        bad = sum(1 for t in trs if t.id in mistake_ids)
        return {
            "count": len(trs),
            "win_rate": round(len(wins) / decided, 4) if decided else 0,
            "avg_pnl": str((net / len(trs)).quantize(Decimal("0.01"))) if trs else "0",
            "mistake_rate": round(bad / len(trs), 3) if trs else 0,
        }

    all_idx = list(range(len(seq)))
    after1, after2, afterbig = [], [], []
    for i in range(1, len(seq)):
        prev = seq[i - 1]
        if Decimal(prev.net_pnl) < 0:
            after1.append(i)
            if i >= 2 and Decimal(seq[i - 2].net_pnl) < 0:
                after2.append(i)
        if prev.r_multiple is not None and float(prev.r_multiple) >= big_win_r:
            afterbig.append(i)

    return {
        "overall": block(all_idx),
        "after_one_loss": block(after1),
        "after_two_losses": block(after2),
        "after_big_win": block(afterbig),
    }


def _clean_streak(closed: list[Trade], mistake_ids: set[int]) -> dict:
    dirty_days = {t.trading_date for t in closed if t.id in mistake_ids}
    all_days = sorted({t.trading_date for t in closed})
    if not all_days:
        return {"days_since_last": 0, "best": 0}
    best = cur = 0
    for d in all_days:
        if d in dirty_days:
            cur = 0
        else:
            cur += 1
            best = max(best, cur)
    # Days since last violation = clean trading days after the last dirty day.
    since = 0
    for d in reversed(all_days):
        if d in dirty_days:
            break
        since += 1
    return {"days_since_last": since, "best": best}
