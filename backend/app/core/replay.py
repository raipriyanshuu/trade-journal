"""Trade replay payload for the candlestick chart (lightweight-charts).

lightweight-charts renders timestamps as UTC, so every time is shifted into the
display time zone (per timestamp, so US/IN daylight-saving is respected).
"""

from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.bars import bars_between
from app.core.excursions import excursion
from app.core.market_data import get_config, yahoo_symbol
from app.models import DailySession, Instrument, Trade


def _local_epoch(ts: datetime, zone: ZoneInfo) -> int:
    offset = ts.astimezone(zone).utcoffset() or timedelta(0)
    return int(ts.timestamp() + offset.total_seconds())


def replay(db: Session, trade: Trade, tz: str, before_h: float = 3, after_h: float = 2) -> dict:
    zone = ZoneInfo(tz)
    inst = db.get(Instrument, trade.instrument_id)
    md_cfg = get_config(db)
    end_anchor = trade.close_time or trade.open_time
    start = trade.open_time - timedelta(hours=before_h)
    end = end_anchor + timedelta(hours=after_h)
    tf, bars = bars_between(db, trade.instrument_id, start, end)
    sources = sorted({b.source for b in bars})

    candles = [
        {"time": _local_epoch(b.ts, zone), "open": float(b.open), "high": float(b.high),
         "low": float(b.low), "close": float(b.close)}
        for b in bars
    ]

    markers = []
    entry_side = "buy" if trade.direction == "long" else "sell"
    for ex in sorted(trade.executions, key=lambda e: (e.timestamp, e.id)):
        is_entry = ex.side == entry_side
        markers.append({
            "time": _local_epoch(ex.timestamp, zone),
            "position": "belowBar" if ex.side == "buy" else "aboveBar",
            "color": "#22c58b" if ex.side == "buy" else "#f0566b",
            "shape": "arrowUp" if ex.side == "buy" else "arrowDown",
            "text": f"{'IN' if is_entry else 'OUT'} {ex.side} {ex.quantity} @ {ex.price}",
        })
    if trade.status == "missed":
        markers.append({
            "time": _local_epoch(trade.open_time, zone), "position": "aboveBar",
            "color": "#f3b53d", "shape": "circle", "text": "missed setup",
        })

    lines = []
    used_prices: set[float] = set()

    def line(price, title, color, style=2, journal=False):
        if price is None:
            return
        p = float(price)
        # Journal levels often repeat (e.g. "Prior VAH" level == prior_vah field);
        # keep the first line at a price so the chart stays readable.
        if journal and p in used_prices:
            return
        used_prices.add(p)
        lines.append({"price": p, "title": title, "color": color, "style": style})

    line(trade.initial_stop, "Stop", "#f0566b", 0)
    line(trade.planned_target, "Target", "#22c58b", 0)
    line(trade.avg_entry or trade.first_entry_price, "Entry", "#8f8dfb", 1)
    line(trade.avg_exit, "Exit", "#9aa6b8", 1)

    journals = db.scalars(
        select(DailySession).where(
            DailySession.trading_date == trade.trading_date,
            or_(DailySession.account_id == trade.account_id, DailySession.account_id.is_(None)),
            or_(DailySession.instrument_id == trade.instrument_id, DailySession.instrument_id.is_(None)),
        )
    ).all()
    for js in journals:
        for lv in js.levels or []:
            try:
                line(float(lv.get("price")), lv.get("label") or "level", "#f3b53d", journal=True)
            except (TypeError, ValueError):
                continue
        for label, price in (("pVAH", js.prior_vah), ("pPOC", js.prior_poc), ("pVAL", js.prior_val),
                             ("ONH", js.on_high), ("ONL", js.on_low), ("ON VWAP", js.on_vwap)):
            line(price, label, "#6b7688", journal=True)

    return {
        "trade_id": trade.id,
        "symbol": inst.symbol_root if inst else "",
        "timeframe": tf,
        "sources": sources,
        "candles": candles,
        "markers": markers,
        "lines": lines,
        "excursion": excursion(db, trade, inst),
        "tz": tz,
        # Whether a delayed Yahoo chart could be fetched for this instrument.
        "can_fetch": bool(inst and yahoo_symbol(md_cfg, inst)),
        "fetch_enabled": bool(md_cfg.get("enabled")),
    }
