"""Simulated fills for backtest trades.

* Market orders fill at the close of the last revealed bar.
* Each new bar is checked against the stop and target. A bar that gaps past a
  level fills at the bar's open. If one bar touches both, the stop is assumed
  to fill first (conservative; step a lower timeframe to see the real order).
* Fees are a round-turn amount per contract, charged on each closed contract.
* R = net P&L / initial risk (|entry - initial stop| x size x point value).
"""

from __future__ import annotations

from app.backtest.candles import Bar
from app.backtest.models import BtSession, BtTrade


def _r(price: float, tick: float) -> float:
    return round(round(price / tick) * tick, 6)


def remaining_qty(t: BtTrade) -> float:
    return round(t.qty - sum(e["qty"] for e in (t.exits or [])), 6)


def recompute(t: BtTrade, s: BtSession) -> None:
    sign = 1 if t.direction == "long" else -1
    exits = t.exits or []
    closed = sum(e["qty"] for e in exits)
    t.gross = round(sum((e["price"] - t.entry_price) * sign * e["qty"] for e in exits) * s.point_value, 2)
    t.fees = round(closed * s.fee_per_contract, 2)
    t.net = round(t.gross - t.fees, 2)
    if t.initial_stop is not None and t.initial_stop != t.entry_price:
        risk = abs(t.entry_price - t.initial_stop) * t.qty * s.point_value
        t.r_multiple = round(t.net / risk, 2) if risk else None
    else:
        t.r_multiple = None


def close(t: BtTrade, s: BtSession, price: float, ts: int, reason: str, qty: float | None = None) -> None:
    left = remaining_qty(t)
    q = left if qty is None else min(max(qty, 0), left)
    if q <= 0:
        return
    t.exits = [*(t.exits or []), {"ts": ts, "price": _r(price, s.tick_size), "qty": q, "reason": reason}]
    if remaining_qty(t) <= 1e-9:
        t.status = "closed"
        t.close_ts = ts
        t.exit_reason = reason
    recompute(t, s)


def check_bar(t: BtTrade, bar: Bar) -> tuple[float, str] | None:
    """Update MAE/MFE for one bar and return (fill price, reason) if it exits."""
    long = t.direction == "long"
    e = t.entry_price
    stop, target = t.stop, t.target

    if long:
        stop_hit = stop is not None and bar.low <= stop
        tgt_hit = target is not None and bar.high >= target
        if target is not None and bar.open >= target:  # gapped through the target
            stop_hit, tgt_hit = False, True
        adverse, favour = e - bar.low, bar.high - e
    else:
        stop_hit = stop is not None and bar.high >= stop
        tgt_hit = target is not None and bar.low <= target
        if target is not None and bar.open <= target:
            stop_hit, tgt_hit = False, True
        adverse, favour = bar.high - e, e - bar.low

    if stop_hit:
        fill = min(bar.open, stop) if long else max(bar.open, stop)
        against = (e - fill) if long else (fill - e)  # > 0 unless a trailed stop was in profit
        t.mae = max(t.mae, against)
        return fill, "stop"
    t.mae = max(t.mae, adverse, 0)
    if tgt_hit:
        fill = max(bar.open, target) if long else min(bar.open, target)
        t.mfe = max(t.mfe, abs(fill - e))
        return fill, "target"
    t.mfe = max(t.mfe, favour, 0)
    return None


def process(trades: list[BtTrade], s: BtSession, bars: list[Bar]) -> list[dict]:
    """Run open trades through new bars; returns exit events."""
    events = []
    for bar in bars:
        for t in trades:
            if t.status != "open" or bar.ts < t.entry_ts:
                continue
            hit = check_bar(t, bar)
            if hit:
                price, reason = hit
                close(t, s, price, bar.ts + bar.dur, reason)
                events.append({"trade_id": t.id, "reason": reason, "price": t.exits[-1]["price"],
                               "net": t.net, "r": t.r_multiple})
    return events


def unrealized(t: BtTrade, s: BtSession, price: float) -> float:
    sign = 1 if t.direction == "long" else -1
    return round((price - t.entry_price) * sign * remaining_qty(t) * s.point_value, 2)
