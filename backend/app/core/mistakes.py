"""The mistake engine.

Each rule is a small function with a rule code and configurable thresholds
(from the `mistake_rules` setting). The engine recomputes auto flags for an
account, grouping trades by trading date; dismissed false positives are preserved
across recomputes. Manual mistake tags/flags are never touched here.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.sessions import minutes_since_session_open
from app.models import Account, DailySession, Execution, Instrument, MistakeFlag, Setting, Trade

DEFAULT_RULES = {
    "REVENGE": {"enabled": True, "minutes": 5},
    "TWO_STRIKES": {"enabled": True, "losses": 2},
    "OVERTRADING": {"enabled": True, "max_trades": 6},
    "AFTER_DAILY_LIMIT": {"enabled": True},
    "LOSS_EXCEEDS_PLAN": {"enabled": True, "tolerance_pct": 20},
    "NO_STOP": {"enabled": True},
    "OVERSIZE": {"enabled": True},
    "ADDED_TO_LOSER": {"enabled": True},
    "FIRST_MINUTES": {"enabled": True, "minutes": 5},
    "NEWS_WINDOW": {"enabled": True, "minutes": 5},
    "UNPLANNED": {"enabled": True},
    "FADED_TREND_DAY": {"enabled": True},
    "HELD_LOSERS": {"enabled": True, "ratio": 1.5},
}

RULE_EXPLANATIONS = {
    "REVENGE": "Opened a new trade too soon after a loss.",
    "TWO_STRIKES": "Kept trading the same instrument/direction after two straight losses.",
    "OVERTRADING": "More trades in the day than your maximum.",
    "AFTER_DAILY_LIMIT": "Traded after hitting the account's daily loss limit.",
    "LOSS_EXCEEDS_PLAN": "Loss was bigger than planned risk (stop moved or missing).",
    "NO_STOP": "No initial stop or planned risk was recorded.",
    "OVERSIZE": "Position larger than the account's maximum contracts.",
    "ADDED_TO_LOSER": "Added to a position that was already offside.",
    "FIRST_MINUTES": "Entered within the first minutes of the session.",
    "NEWS_WINDOW": "Entered right around a scheduled news event.",
    "UNPLANNED": "Trade was not in the plan.",
    "FADED_TREND_DAY": "Traded counter-trend on a day you tagged as a trend day.",
    "HELD_LOSERS": "Held losers much longer than winners.",
}


def get_rules(db: Session) -> dict:
    setting = db.get(Setting, "mistake_rules")
    rules = dict(DEFAULT_RULES)
    if setting and isinstance(setting.value, dict):
        for code, cfg in setting.value.items():
            rules[code] = {**rules.get(code, {}), **cfg}
    return rules


def _enabled(rules, code) -> bool:
    return bool(rules.get(code, {}).get("enabled", False))


def _risk_amount(trade: Trade, instrument: Instrument) -> Decimal | None:
    if trade.planned_risk_amount:
        return abs(Decimal(trade.planned_risk_amount))
    if trade.initial_stop is not None and trade.first_entry_price is not None:
        return abs(Decimal(trade.first_entry_price) - Decimal(trade.initial_stop)) * Decimal(
            trade.max_position_size
        ) * Decimal(instrument.point_value)
    return None


def recompute_for_account(db: Session, account_id: int) -> int:
    account = db.get(Account, account_id)
    if account is None:
        return 0
    rules = get_rules(db)

    # Preserve dismissed auto flags.
    dismissed_keys = {
        (f.trade_id, f.session_date, f.rule_code)
        for f in db.scalars(
            select(MistakeFlag).where(
                MistakeFlag.account_id == account_id,
                MistakeFlag.source == "auto",
                MistakeFlag.dismissed.is_(True),
            )
        )
    }
    # Clear existing auto flags for this account.
    for f in db.scalars(
        select(MistakeFlag).where(
            MistakeFlag.account_id == account_id, MistakeFlag.source == "auto"
        )
    ):
        db.delete(f)
    db.flush()

    trades = list(
        db.scalars(
            select(Trade)
            .where(Trade.account_id == account_id, Trade.status != "missed")
            .order_by(Trade.trading_date, Trade.open_time, Trade.id)
        )
    )
    instruments = {i.id: i for i in db.scalars(select(Instrument))}

    by_day: dict[date, list[Trade]] = defaultdict(list)
    for t in trades:
        by_day[t.trading_date].append(t)

    created: list[MistakeFlag] = []

    def flag(trade_id, session_date, code, details=""):
        created.append(MistakeFlag(
            trade_id=trade_id, account_id=account_id, session_date=session_date,
            rule_code=code, source="auto", details=details,
            dismissed=(trade_id, session_date, code) in dismissed_keys,
        ))

    for day, day_trades in by_day.items():
        journal = db.scalar(
            select(DailySession).where(
                DailySession.trading_date == day,
                DailySession.account_id == account_id,
                DailySession.instrument_id.is_(None),
            )
        )
        _apply_day_rules(db, rules, account, day, day_trades, instruments, journal, flag)

    for f in created:
        db.add(f)
    db.commit()
    return len(created)


def _is_loss(t: Trade) -> bool:
    return t.status == "closed" and Decimal(t.net_pnl) < 0 and not t.pnl_only


def _is_win(t: Trade) -> bool:
    return t.status == "closed" and Decimal(t.net_pnl) > 0 and not t.pnl_only


def _apply_day_rules(db, rules, account, day, day_trades, instruments, journal, flag):
    # OVERTRADING: flag the trades beyond the max.
    if _enabled(rules, "OVERTRADING"):
        maxn = int(rules["OVERTRADING"].get("max_trades", 6))
        for t in day_trades[maxn:]:
            flag(t.id, day, "OVERTRADING", f"Trade #{day_trades.index(t) + 1} of {len(day_trades)}")

    # REVENGE: a new trade opens within X min after a losing trade closes.
    if _enabled(rules, "REVENGE"):
        minutes = int(rules["REVENGE"].get("minutes", 5))
        last_loss_close = None
        for t in day_trades:
            if t.time_known and last_loss_close and t.open_time:
                gap = (t.open_time - last_loss_close).total_seconds() / 60.0
                if 0 <= gap <= minutes:
                    flag(t.id, day, "REVENGE", f"{gap:.0f} min after a loss")
            if _is_loss(t) and t.close_time:
                last_loss_close = t.close_time

    # TWO_STRIKES: trading the same instrument+direction after two straight losses.
    if _enabled(rules, "TWO_STRIKES"):
        need = int(rules["TWO_STRIKES"].get("losses", 2))
        streak: dict[tuple, int] = defaultdict(int)
        for t in day_trades:
            key = (t.instrument_id, t.direction)
            if streak[key] >= need:
                flag(t.id, day, "TWO_STRIKES", f"After {streak[key]} losses in {t.direction}")
            if _is_loss(t):
                streak[key] += 1
            elif _is_win(t):
                streak[key] = 0

    # AFTER_DAILY_LIMIT: trades opened after the day's net loss hit the limit.
    if _enabled(rules, "AFTER_DAILY_LIMIT") and account.daily_loss_limit:
        limit = -abs(Decimal(account.daily_loss_limit))
        cumulative = Decimal("0")
        breached = False
        for t in day_trades:
            if breached:
                flag(t.id, day, "AFTER_DAILY_LIMIT", "Opened after daily loss limit")
            cumulative += Decimal(t.net_pnl)
            if cumulative <= limit:
                breached = True

    # OVERSIZE: position above the account maximum.
    if _enabled(rules, "OVERSIZE") and account.max_contracts:
        for t in day_trades:
            if Decimal(t.max_position_size) > Decimal(account.max_contracts):
                flag(t.id, day, "OVERSIZE", f"Size {t.max_position_size} > {account.max_contracts}")

    for t in day_trades:
        inst = instruments.get(t.instrument_id)

        # NO_STOP
        if _enabled(rules, "NO_STOP") and not t.pnl_only:
            if t.initial_stop is None and t.planned_risk_amount is None:
                flag(t.id, day, "NO_STOP", "No stop or planned risk")

        # LOSS_EXCEEDS_PLAN
        if _enabled(rules, "LOSS_EXCEEDS_PLAN") and _is_loss(t) and inst:
            risk = _risk_amount(t, inst)
            if risk and risk > 0:
                tol = Decimal(str(rules["LOSS_EXCEEDS_PLAN"].get("tolerance_pct", 20))) / 100
                if -Decimal(t.net_pnl) > risk * (1 + tol):
                    flag(t.id, day, "LOSS_EXCEEDS_PLAN", f"Loss {t.net_pnl} vs risk {risk:.0f}")

        # UNPLANNED
        if _enabled(rules, "UNPLANNED") and t.planned is False:
            flag(t.id, day, "UNPLANNED", "Marked not planned")

        # ADDED_TO_LOSER
        if _enabled(rules, "ADDED_TO_LOSER") and not t.pnl_only:
            if _added_to_loser(db, t):
                flag(t.id, day, "ADDED_TO_LOSER", "Added at an adverse price")

        # FIRST_MINUTES
        if _enabled(rules, "FIRST_MINUTES") and t.time_known and inst:
            m = minutes_since_session_open(t.open_time, inst)
            x = int(rules["FIRST_MINUTES"].get("minutes", 5))
            if m is not None and 0 <= m <= x:
                flag(t.id, day, "FIRST_MINUTES", f"{m:.0f} min into the session")

        # NEWS_WINDOW
        if _enabled(rules, "NEWS_WINDOW") and t.time_known and journal and journal.news_events:
            x = int(rules["NEWS_WINDOW"].get("minutes", 5))
            if _near_news(t, journal.news_events, x):
                flag(t.id, day, "NEWS_WINDOW", "Near a news event")

        # FADED_TREND_DAY
        if _enabled(rules, "FADED_TREND_DAY") and journal and journal.actual_day_type:
            dt = journal.actual_day_type.lower()
            if "trend" in dt:
                if "up" in dt and t.direction == "short":
                    flag(t.id, day, "FADED_TREND_DAY", "Short on an up-trend day")
                elif "down" in dt and t.direction == "long":
                    flag(t.id, day, "FADED_TREND_DAY", "Long on a down-trend day")

    # HELD_LOSERS: day-level check on average holding times.
    if _enabled(rules, "HELD_LOSERS"):
        ratio = Decimal(str(rules["HELD_LOSERS"].get("ratio", 1.5)))
        winners = [t.holding_time_seconds for t in day_trades if _is_win(t) and t.holding_time_seconds]
        losers = [t.holding_time_seconds for t in day_trades if _is_loss(t) and t.holding_time_seconds]
        if winners and losers:
            avg_w = sum(winners) / len(winners)
            avg_l = sum(losers) / len(losers)
            if avg_w > 0 and Decimal(avg_l) > ratio * Decimal(avg_w):
                flag(None, day, "HELD_LOSERS", f"Losers held {avg_l / avg_w:.1f}x winners")


def _added_to_loser(db: Session, trade: Trade) -> bool:
    execs = list(
        db.scalars(
            select(Execution).where(Execution.trade_id == trade.id).order_by(
                Execution.timestamp, Execution.id
            )
        )
    )
    if len(execs) < 2:
        return False
    entry_side = "buy" if trade.direction == "long" else "sell"
    first_entry = next((e for e in execs if e.side == entry_side), None)
    if first_entry is None:
        return False
    first_price = Decimal(first_entry.price)
    for e in execs:
        if e is first_entry or e.side != entry_side:
            continue
        price = Decimal(e.price)
        # Adverse = adding lower on a long, or higher on a short.
        if trade.direction == "long" and price < first_price:
            return True
        if trade.direction == "short" and price > first_price:
            return True
    return False


def _near_news(trade: Trade, news_events, minutes: int) -> bool:
    from datetime import datetime, timezone

    for ev in news_events:
        t = ev.get("time") if isinstance(ev, dict) else None
        if not t:
            continue
        try:
            when = datetime.fromisoformat(str(t).replace("Z", "+00:00"))
            if when.tzinfo is None:
                when = when.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        gap = abs((trade.open_time - when).total_seconds()) / 60.0
        if gap <= minutes:
            return True
    return False


def recompute_all(db: Session) -> int:
    total = 0
    for (account_id,) in db.execute(select(Trade.account_id).distinct()).all():
        total += recompute_for_account(db, account_id)
    return total
