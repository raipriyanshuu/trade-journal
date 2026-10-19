"""Reusable trade statistics (used by the Mistakes page and analytics).

Definitions follow the spec exactly:
- Win rate = winners / (winners + losers); breakevens counted separately.
- Profit factor = gross profit of winners / |gross loss of losers| (net P&L).
- Expectancy ($) = average net P&L per trade; Expectancy (R) = average R.
- Max drawdown = largest peak-to-trough decline of the cumulative net P&L curve.
"""

from __future__ import annotations

from decimal import Decimal

from app.models import Trade

ZERO = Decimal("0")


def _f(v) -> float:
    return float(v) if v is not None else 0.0


def basic_stats(trades: list[Trade], be: Decimal = ZERO) -> dict:
    closed = [t for t in trades if t.status == "closed"]
    wins = [t for t in closed if Decimal(t.net_pnl) > be]
    losses = [t for t in closed if Decimal(t.net_pnl) < -be]
    bes = [t for t in closed if -be <= Decimal(t.net_pnl) <= be]

    gross_win = sum((Decimal(t.net_pnl) for t in wins), ZERO)
    gross_loss = sum((Decimal(t.net_pnl) for t in losses), ZERO)
    net = sum((Decimal(t.net_pnl) for t in closed), ZERO)
    fees = sum((Decimal(t.fees) for t in closed), ZERO)

    decided = len(wins) + len(losses)
    win_rate = (len(wins) / decided) if decided else 0.0
    profit_factor = (_f(gross_win) / abs(_f(gross_loss))) if gross_loss != 0 else (
        float("inf") if gross_win > 0 else 0.0
    )
    avg_win = (_f(gross_win) / len(wins)) if wins else 0.0
    avg_loss = (_f(gross_loss) / len(losses)) if losses else 0.0
    expectancy = (_f(net) / len(closed)) if closed else 0.0

    r_vals = [_f(t.r_multiple) for t in closed if t.r_multiple is not None]
    expectancy_r = (sum(r_vals) / len(r_vals)) if r_vals else None

    return {
        "trades": len(closed),
        "wins": len(wins),
        "losses": len(losses),
        "breakevens": len(bes),
        "win_rate": round(win_rate, 4),
        "profit_factor": None if profit_factor == float("inf") else round(profit_factor, 3),
        "avg_win": round(avg_win, 2),
        "avg_loss": round(avg_loss, 2),
        "avg_win_loss_ratio": round(avg_win / abs(avg_loss), 3) if avg_loss else None,
        "expectancy": round(expectancy, 2),
        "expectancy_r": round(expectancy_r, 3) if expectancy_r is not None else None,
        "net_pnl": str(net),
        "gross_pnl": str(sum((Decimal(t.gross_pnl) for t in closed), ZERO)),
        "fees": str(fees),
        "largest_win": str(max((Decimal(t.net_pnl) for t in wins), default=ZERO)),
        "largest_loss": str(min((Decimal(t.net_pnl) for t in losses), default=ZERO)),
    }


def equity_and_drawdown(trades: list[Trade]) -> dict:
    """Cumulative net P&L curve ordered by close/open time, plus drawdown."""
    closed = sorted(
        [t for t in trades if t.status == "closed"],
        key=lambda t: (t.close_time or t.open_time, t.id),
    )
    points = []
    cum = ZERO
    peak = ZERO
    max_dd = ZERO
    for t in closed:
        cum += Decimal(t.net_pnl)
        peak = max(peak, cum)
        dd = cum - peak
        max_dd = min(max_dd, dd)
        points.append({
            "id": t.id,
            "date": t.trading_date.isoformat(),
            "cumulative": float(cum),
            "drawdown": float(dd),
        })
    max_dd_pct = (float(max_dd) / float(peak) * 100) if peak > 0 else 0.0
    return {"points": points, "max_drawdown": str(max_dd), "max_drawdown_pct": round(max_dd_pct, 2)}


def streaks(trades: list[Trade], be: Decimal = ZERO) -> dict:
    closed = sorted(
        [t for t in trades if t.status == "closed"],
        key=lambda t: (t.close_time or t.open_time, t.id),
    )
    cur_win = cur_loss = best_win = best_loss = 0
    for t in closed:
        net = Decimal(t.net_pnl)
        if net > be:
            cur_win += 1
            cur_loss = 0
        elif net < -be:
            cur_loss += 1
            cur_win = 0
        else:
            cur_win = cur_loss = 0
        best_win = max(best_win, cur_win)
        best_loss = max(best_loss, cur_loss)
    return {
        "current_win_streak": cur_win,
        "current_loss_streak": cur_loss,
        "longest_win_streak": best_win,
        "longest_loss_streak": best_loss,
    }


def avg_holding(trades: list[Trade], winners: bool, be: Decimal = ZERO) -> float | None:
    vals = [
        t.holding_time_seconds
        for t in trades
        if t.status == "closed" and t.holding_time_seconds is not None
        and ((Decimal(t.net_pnl) > be) == winners) and (Decimal(t.net_pnl) != 0)
    ]
    return (sum(vals) / len(vals)) if vals else None
