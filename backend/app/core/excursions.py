"""MAE / MFE (maximum adverse / favourable excursion) from imported bars.

For a trade with bar coverage between its open and close:
- Long:  MFE = highest high - avg entry,   MAE = avg entry - lowest low
- Short: MFE = avg entry - lowest low,     MAE = highest high - avg entry
Both are reported as positive distances in points, cash (points x point value
x max position) and R (cash / risk). The first bar may start slightly before the
entry, so excursions are a close (slightly conservative) approximation.
"""

from __future__ import annotations

from decimal import Decimal

from sqlalchemy.orm import Session

from app.core.bars import bars_between
from app.core.mistakes import _risk_amount
from app.core.stats import classify
from app.models import Instrument, Trade

ZERO = Decimal("0")


def excursion(db: Session, trade: Trade, instrument: Instrument | None = None) -> dict | None:
    if trade.status != "closed" or not trade.pnl_known or trade.avg_entry is None:
        return None
    if trade.close_time is None:
        return None
    instrument = instrument or db.get(Instrument, trade.instrument_id)
    tf, bars = bars_between(db, trade.instrument_id, trade.open_time, trade.close_time)
    if not bars:
        return None

    entry = Decimal(trade.avg_entry)
    hi = max(Decimal(b.high) for b in bars)
    lo = min(Decimal(b.low) for b in bars)
    if trade.direction == "long":
        mfe, mae = hi - entry, entry - lo
    else:
        mfe, mae = entry - lo, hi - entry
    mfe, mae = max(mfe, ZERO), max(mae, ZERO)

    size = Decimal(trade.max_position_size)
    pv = Decimal(instrument.point_value)
    mfe_cash, mae_cash = mfe * pv * size, mae * pv * size
    risk = _risk_amount(trade, instrument)

    # Exit efficiency is only meaningful on trades that made points.
    captured = None
    if trade.points is not None and Decimal(trade.points) > 0 and mfe > 0:
        captured = float(Decimal(trade.points) / mfe * 100)

    return {
        "trade_id": trade.id,
        "timeframe": tf,
        "bars": len(bars),
        "mfe_points": float(mfe),
        "mae_points": float(mae),
        "mfe_cash": float(mfe_cash),
        "mae_cash": float(mae_cash),
        "mfe_r": float(mfe_cash / risk) if risk else None,
        "mae_r": float(mae_cash / risk) if risk else None,
        "captured_pct": round(captured, 1) if captured is not None else None,
    }


def analytics(db: Session, trades: list[Trade], adverse_r: float = 0.5) -> dict:
    """Scatter points, stop-placement and exit-efficiency stats."""
    instruments: dict[int, Instrument] = {}
    points = []
    for t in trades:
        if t.status != "closed":
            continue
        inst = instruments.setdefault(t.instrument_id, db.get(Instrument, t.instrument_id))
        ex = excursion(db, t, inst)
        if ex is None:
            continue
        ex["result"] = classify(t)
        ex["symbol"] = inst.symbol_root if inst else ""
        ex["date"] = t.trading_date.isoformat()
        ex["net_pnl"] = float(t.net_pnl)
        ex["r_multiple"] = float(t.r_multiple) if t.r_multiple is not None else None
        points.append(ex)

    winners = [p for p in points if p["result"] == "win"]
    winners_r = [p for p in winners if p["mae_r"] is not None]
    beyond = [p for p in winners_r if p["mae_r"] > adverse_r]
    captured = [p["captured_pct"] for p in winners if p["captured_pct"] is not None]
    losers = [p for p in points if p["result"] == "loss"]
    # Losers that were in profit by >= 1R first: trades that should have been managed.
    gave_back = [p for p in losers if p["mfe_r"] is not None and p["mfe_r"] >= 1]

    return {
        "covered_trades": len(points),
        "closed_trades": len([t for t in trades if t.status == "closed"]),
        "adverse_r_threshold": adverse_r,
        "winners_beyond_threshold_pct": round(len(beyond) / len(winners_r) * 100, 1) if winners_r else None,
        "avg_exit_efficiency_pct": round(sum(captured) / len(captured), 1) if captured else None,
        "losers_that_were_up_1r": len(gave_back),
        "avg_winner_mae_r": round(sum(p["mae_r"] for p in winners_r) / len(winners_r), 2) if winners_r else None,
        "points": points,
    }
