"""Weekly / monthly review reports with a rule-based suggested focus."""

from __future__ import annotations

import calendar
from collections import Counter, defaultdict
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import analytics
from app.core.filters import filtered_trades
from app.core.mistake_analytics import build as mistake_build
from app.core.stats import avg_holding, basic_stats
from app.models import DailySession, MistakeFlag, Setting


def period_bounds(period: str, anchor: date) -> tuple[date, date]:
    if period == "month":
        start = anchor.replace(day=1)
        end = anchor.replace(day=calendar.monthrange(anchor.year, anchor.month)[1])
    else:
        start = anchor - timedelta(days=anchor.weekday())
        end = start + timedelta(days=6)
    return start, end


def previous_bounds(period: str, start: date) -> tuple[date, date]:
    return period_bounds(period, start - timedelta(days=1))


def _setting(db: Session, key: str, default):
    s = db.get(Setting, key)
    return s.value if s and s.value is not None else default


def _delta(cur, prev):
    try:
        return round(float(cur) - float(prev), 4)
    except (TypeError, ValueError):
        return None


def build_report(
    db: Session,
    period: str,
    anchor: date,
    account_id: int | None = None,
    currency: str | None = None,
    include_demo: bool = True,
) -> dict:
    tz = _setting(db, "display_timezone", "Asia/Kolkata")
    big_win_r = float(_setting(db, "big_win_threshold_r", 2) or 2)
    start, end = period_bounds(period, anchor)
    pstart, pend = previous_bounds(period, start)
    common = dict(account_id=account_id, currency=currency, include_demo=include_demo)

    cur = filtered_trades(db, date_from=start, date_to=end, **common)
    prev = filtered_trades(db, date_from=pstart, date_to=pend, **common)
    k_cur, k_prev = basic_stats(cur), basic_stats(prev)

    compare = {}
    for key in ("trades", "win_rate", "net_pnl", "profit_factor", "expectancy", "expectancy_r"):
        compare[key] = {"current": k_cur.get(key), "previous": k_prev.get(key),
                        "delta": _delta(k_cur.get(key), k_prev.get(key))}

    setups = [r for r in analytics.breakdown(db, cur, "setup_tag", tz) if r["key"] != "(untagged)"]
    mistakes = mistake_build(db, cur, tz, big_win_r)
    all_to_date = filtered_trades(db, date_to=end, **common)
    streak = mistake_build(db, all_to_date, tz, big_win_r)["clean_streak"]

    flag_q = select(MistakeFlag).where(
        MistakeFlag.source == "auto", MistakeFlag.dismissed.is_(False),
        MistakeFlag.session_date >= start, MistakeFlag.session_date <= end,
    )
    if account_id:
        flag_q = flag_q.where(MistakeFlag.account_id == account_id)
    violations = Counter(f.rule_code for f in db.scalars(flag_q))

    # Journal discipline over the period.
    jq = select(DailySession).where(DailySession.trading_date >= start, DailySession.trading_date <= end)
    if account_id:
        jq = jq.where(DailySession.account_id == account_id)
    journals = list(db.scalars(jq))
    trading_days = sorted({t.trading_date for t in cur if t.status == "closed"})
    moods = [j.mood for j in journals if j.mood]
    sleeps = [j.sleep for j in journals if j.sleep]
    discipline = {
        "trading_days": len(trading_days),
        "days_with_plan": len({j.trading_date for j in journals if j.htf_read or j.levels or j.scenarios or j.market_context}),
        "days_reviewed": len({j.trading_date for j in journals if j.followed_plan or j.day_grade or j.key_lesson}),
        "followed_plan": dict(Counter(j.followed_plan for j in journals if j.followed_plan)),
        "day_grades": dict(Counter(j.day_grade for j in journals if j.day_grade)),
        "avg_mood": round(sum(moods) / len(moods), 1) if moods else None,
        "avg_sleep": round(sum(sleeps) / len(sleeps), 1) if sleeps else None,
        "lessons": [{"date": j.trading_date.isoformat(), "lesson": j.key_lesson} for j in journals if j.key_lesson],
    }

    daily: dict = defaultdict(lambda: Decimal("0"))
    for t in cur:
        if t.status == "closed" and t.pnl_known:
            daily[t.trading_date] += Decimal(t.net_pnl)

    focus = suggest_focus(db, cur, mistakes, setups, tz)

    return {
        "period": period,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "previous": {"start": pstart.isoformat(), "end": pend.isoformat()},
        "kpis": k_cur,
        "previous_kpis": k_prev,
        "compare": compare,
        "best_setups": setups[:3],
        "worst_setups": [r for r in reversed(setups) if float(r["net_pnl"]) < 0][:3],
        "top_mistakes": [m for m in mistakes["cost_by_type"] if float(m["net_pnl"]) < 0][:3],
        "mistake_rate": round(mistakes["mistake_trades"] / mistakes["total_trades"], 3) if mistakes["total_trades"] else 0,
        "missed": mistakes["missed"],
        "clean_streak": streak,
        "rule_violations": sum(violations.values()),
        "violations_by_rule": dict(violations.most_common()),
        "discipline": discipline,
        "daily_pnl": [{"date": d.isoformat(), "net": float(v)} for d, v in sorted(daily.items())],
        "focus": focus[0] if focus else None,
        "focus_candidates": focus,
    }


def suggest_focus(db, trades, mistakes, setups, tz) -> list[dict]:
    """Rule-based focus suggestions, most important first (no AI)."""
    out: list[dict] = []
    closed = [t for t in trades if t.status == "closed"]
    if not closed:
        return [{"rule": "NO_TRADES", "title": "Log every trade and missed setup",
                 "detail": "There were no closed trades in this period. Use the daily Plan step so next period has data to review."}]

    worst = [m for m in mistakes["cost_by_type"] if float(m["net_pnl"]) < 0 and m["count"] >= 2]
    if worst:
        m = worst[0]
        label = m["type"].split(":", 1)[-1]
        out.append({"rule": "COSTLIEST_MISTAKE", "title": f"Eliminate “{label}”",
                    "detail": f"It cost {m['net_pnl']} across {m['count']} trades. Write one concrete rule that prevents it and check it before every entry."})

    after = mistakes["after_loss_behavior"]
    two, overall = after["after_two_losses"], after["overall"]
    if two["count"] >= 3 and two["win_rate"] < overall["win_rate"] - 0.15:
        out.append({"rule": "STOP_AFTER_TWO", "title": "Stop for the day after two losses in a row",
                    "detail": f"Your win rate drops from {round(overall['win_rate'] * 100)}% to {round(two['win_rate'] * 100)}% on the trade after two straight losses."})

    w, l = avg_holding(closed, True), avg_holding(closed, False)
    if w and l and l > 1.5 * w:
        out.append({"rule": "CUT_LOSERS", "title": "Cut losers faster",
                    "detail": f"You hold losers {l / w:.1f}x longer than winners. Respect the initial stop; don't wait for a rescue."})

    htf = {r["key"]: r for r in analytics.breakdown(db, trades, "with_htf", tz)}
    against = htf.get("against HTF")
    if against and against["trades"] >= 2 and float(against["net_pnl"]) < 0:
        out.append({"rule": "WITH_HTF", "title": "Trade with the higher-timeframe bias",
                    "detail": f"Counter-HTF trades lost {against['net_pnl']} over {against['trades']} trades."})

    eq = {r["key"]: r for r in analytics.breakdown(db, trades, "entry_quality", tz)}
    c_grade = eq.get("C")
    if c_grade and c_grade["trades"] >= 2 and float(c_grade["net_pnl"]) < 0:
        out.append({"rule": "SKIP_C_ENTRIES", "title": "Skip C-grade entries",
                    "detail": f"C-quality entries lost {c_grade['net_pnl']} over {c_grade['trades']} trades. Wait for A/A+ locations."})

    if mistakes["missed"]["count"] >= 2:
        out.append({"rule": "MISSED", "title": "Execute the setups you plan",
                    "detail": f"You missed {mistakes['missed']['count']} setups worth about {mistakes['missed']['potential_r']}R. Pre-define the trigger so execution is automatic."})

    best = [s for s in setups if float(s["net_pnl"]) > 0]
    if best:
        out.append({"rule": "PRESS_EDGE", "title": f"Press your edge: {best[0]['key']}",
                    "detail": f"{best[0]['key']} made {best[0]['net_pnl']} over {best[0]['trades']} trades ({round(best[0]['win_rate'] * 100)}% win rate)."})

    if not out:
        untagged = sum(1 for t in closed if not any(g.category == "setup" for g in t.tags))
        if untagged:
            out.append({"rule": "TAG_SETUPS", "title": "Tag every trade with its trade type",
                        "detail": f"{untagged} of {len(closed)} trades have no trade type, so the report can't tell which setups carry your edge."})
        else:
            out.append({"rule": "KEEP_PROCESS", "title": "Repeat the process",
                        "detail": "No costly pattern stood out this period. Keep the same plan → execute → review routine."})
    return out
