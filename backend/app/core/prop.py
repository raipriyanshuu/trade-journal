"""Prop-firm rules engine: balance, drawdown floor, daily loss, consistency, days.

Everything is computed from the account's *closed* trades (net of fees), in the
order they closed, plus the ledger (payouts lower the balance; a reset restarts
it). Unrealised P&L isn't known to the journal, so "trailing intraday" trails
the highest closed-trade balance, not the live peak the firm sees.

Drawdown floor by type (dd = max drawdown amount):
  static                   start - dd, never moves
  trailing_eod             highest end-of-day balance - dd
  trailing_intraday        highest balance after any trade - dd
  trailing_lock_breakeven  like trailing_eod, but stops rising at the lock level
                           (default: the starting balance)
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date
from decimal import Decimal

from app.models import Account, Trade
from app.models.prop import PropLedgerEntry

ZERO = Decimal("0")
LEVEL_ORDER = ["ok", "caution", "warning", "danger", "breached"]
LEVELS = ((Decimal("1"), "breached"), (Decimal("0.9"), "danger"), (Decimal("0.75"), "warning"), (Decimal("0.5"), "caution"))


def level(used: Decimal | None) -> str:
    """ok / caution (50%) / warning (75%) / danger (90%) / breached (100%) of a limit."""
    if used is None:
        return "ok"
    for threshold, name in LEVELS:
        if used >= threshold:
            return name
    return "ok"


def _f(v: Decimal | None) -> float | None:
    return None if v is None else float(round(v, 2))


def _d(v) -> Decimal | None:
    return None if v is None else Decimal(str(v))


def _money(v: Decimal, ccy: str | None) -> str:
    sym = {"USD": "$", "INR": "₹"}.get(ccy or "USD", "")
    return f"{'-' if v < 0 else ''}{sym}{abs(v):,.2f}".replace(".00", "")


def start_balance(acc: Account) -> Decimal:
    sb = _d(acc.starting_balance) or ZERO
    return sb if sb > 0 else (_d(acc.account_size) or ZERO)


def evaluate(acc: Account, trades: list[Trade], ledger: list[PropLedgerEntry], today: date) -> dict:
    start = start_balance(acc)
    ccy = getattr(acc, "currency", "USD")
    dd = _d(acc.max_drawdown_amount)
    dd_type = acc.max_drawdown_type or ("static" if dd else None)
    daily_limit = _d(acc.daily_loss_limit)
    target = _d(acc.profit_target)
    lock_at = _d(acc.drawdown_lock_at) or start

    # A reset restarts the account: only what comes after the latest reset counts.
    resets = sorted(e.entry_date for e in ledger if e.kind == "reset")
    period_start = max([d for d in [acc.prop_start_date, resets[-1] if resets else None] if d], default=None)

    closed = sorted(
        (t for t in trades if t.status == "closed" and t.pnl_known
         and (period_start is None or t.trading_date >= period_start)),
        key=lambda t: (t.trading_date, t.close_time or t.open_time, t.id),
    )
    payouts = defaultdict(lambda: ZERO)
    for e in ledger:
        if e.kind == "payout" and (period_start is None or e.entry_date >= period_start):
            payouts[e.entry_date] += Decimal(e.amount)

    def floor_from(high: Decimal) -> Decimal | None:
        if dd is None:
            return None
        if dd_type == "static":
            return start - dd
        f = high - dd
        if dd_type == "trailing_lock_breakeven":
            f = min(f, lock_at)
        return f

    by_day: dict[date, list[Trade]] = defaultdict(list)
    for t in closed:
        by_day[t.trading_date].append(t)
    days = sorted(set(by_day) | set(payouts))

    balance = start
    high_eod = high_live = start
    floor = floor_from(start)
    history, breaches = [], []
    breached_dd = False
    for d in days:
        day_trades = by_day.get(d, [])
        day_net = ZERO
        low = balance
        for t in day_trades:
            balance += Decimal(t.net_pnl)
            day_net += Decimal(t.net_pnl)
            low = min(low, balance)
            if dd_type == "trailing_intraday":
                high_live = max(high_live, balance)
                floor = floor_from(high_live)
            if floor is not None and balance <= floor and not breached_dd:
                breached_dd = True
                breaches.append({"date": d, "rule": "drawdown",
                                 "detail": f"Balance {_money(balance, ccy)} reached the drawdown floor {_money(floor, ccy)}"})
        if daily_limit and day_net <= -daily_limit:
            breaches.append({"date": d, "rule": "daily_loss",
                             "detail": f"Day P&L {_money(day_net, ccy)} hit the daily loss limit of {_money(daily_limit, ccy)}"})
        if acc.max_contracts:
            biggest = max((Decimal(t.max_position_size) for t in day_trades), default=ZERO)
            if biggest > acc.max_contracts:
                breaches.append({"date": d, "rule": "max_contracts",
                                 "detail": f"{biggest:g} contracts used; the limit is {acc.max_contracts}"})
        balance -= payouts.get(d, ZERO)
        # End of day: EOD-trailing floors move up overnight.
        high_eod = max(high_eod, balance)
        if dd_type in ("trailing_eod", "trailing_lock_breakeven"):
            floor = floor_from(high_eod)
        history.append({
            "date": d, "balance": _f(balance), "floor": _f(floor), "day_net": _f(day_net),
            "low": _f(low), "trades": len(day_trades), "payout": _f(payouts.get(d)) if d in payouts else None,
            "target": _f(start + target) if target else None,
        })

    profit = balance - start + sum(payouts.values(), ZERO)  # payouts were profit too
    trade_days = [d for d in days if by_day.get(d)]
    day_nets = [sum((Decimal(t.net_pnl) for t in by_day[d]), ZERO) for d in trade_days]
    total = sum(day_nets, ZERO)
    best_day = max(day_nets, default=ZERO)
    consistency = (best_day / total * 100) if total > 0 and best_day > 0 else None
    cons_limit = _d(acc.consistency_pct)
    max_used = max((Decimal(t.max_position_size) for t in closed), default=ZERO)

    today_net = sum((Decimal(t.net_pnl) for t in by_day.get(today, [])), ZERO)
    distance = (balance - floor) if floor is not None else None
    left_today = (daily_limit - max(ZERO, -today_net)) if daily_limit else None
    candidates = [v for v in (left_today, distance) if v is not None]
    can_lose = max(ZERO, min(candidates)) if candidates else None

    rules = []

    def rule(key, label, used, value, limit, ok=None, cap=None):
        lv = level(used) if ok is None else ("ok" if ok else "warning")
        if cap and LEVEL_ORDER.index(lv) > LEVEL_ORDER.index(cap):
            lv = cap
        rules.append({"key": key, "label": label, "used": _f(used) if used is not None else None,
                      "level": lv, "value": value, "limit": limit})

    if target:
        rule("target", "Profit target", None, _f(profit), _f(target), ok=profit >= target)
    if daily_limit:
        rule("daily_loss", "Daily loss limit (today)", max(ZERO, -today_net) / daily_limit, _f(today_net), _f(daily_limit))
    if dd is not None:
        used = (dd - distance) / dd if dd else None
        rule("drawdown", "Max drawdown", max(ZERO, used) if used is not None else None, _f(distance), _f(dd))
    if cons_limit:
        rule("consistency", "Consistency (best day)", (consistency / cons_limit) if consistency is not None else None,
             _f(consistency), _f(cons_limit), cap="warning")  # blocks a pass, doesn't fail the account
    if acc.min_trading_days:
        rule("days", "Minimum trading days", None, len(trade_days), acc.min_trading_days,
             ok=len(trade_days) >= acc.min_trading_days)
    if acc.max_contracts:
        rule("contracts", "Max contracts", max_used / acc.max_contracts, _f(max_used), acc.max_contracts)

    passed_checks = (
        (not target or profit >= target)
        and (not acc.min_trading_days or len(trade_days) >= acc.min_trading_days)
        and (consistency is None or not cons_limit or consistency <= cons_limit)
    )
    if breached_dd:
        suggested = "failed"
    elif acc.type == "prop_funded":
        suggested = "funded"
    elif target and passed_checks:
        suggested = "passed"
    else:
        suggested = "in_progress"

    worst = max((r["level"] for r in rules), key=LEVEL_ORDER.index, default="ok")
    return {
        "start_balance": _f(start), "balance": _f(balance), "profit": _f(profit),
        "target": _f(target), "target_remaining": _f(max(ZERO, target - profit)) if target else None,
        "target_pct": _f(profit / target * 100) if target else None,
        "floor": _f(floor), "distance_to_floor": _f(distance), "drawdown_type": dd_type,
        "today": today, "today_net": _f(today_net), "daily_left": _f(left_today), "can_lose_today": _f(can_lose),
        "consistency_pct": _f(consistency), "best_day": _f(best_day) if trade_days else None,
        "trading_days": len(trade_days), "max_contracts_used": _f(max_used),
        "period_start": period_start, "trades": len(closed),
        "rules": rules, "worst_level": worst, "breaches": breaches,
        "suggested_status": suggested, "status": acc.prop_status or suggested,
        "history": history,
    }


def ledger_totals(entries: list[PropLedgerEntry]) -> dict:
    costs = sum((Decimal(e.amount) for e in entries if e.kind != "payout"), ZERO)
    paid = sum((Decimal(e.amount) for e in entries if e.kind == "payout"), ZERO)
    return {"costs": _f(costs), "payouts": _f(paid), "net": _f(paid - costs)}
