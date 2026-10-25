"""Download history for backtesting from Yahoo Finance into ``backtest.db``.

Only the ticker (ES=F ...) and a date range leave the computer. Yahoo keeps
5-minute bars for ~60 days, hourly for ~2 years and daily back to 2000, so a
"Load / update" stores the longest history of each; later updates append the
newest bars, and stored history is kept even after Yahoo drops it.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.backtest.candles import day_start, trading_date
from app.backtest.instruments import BASES, INSTRUMENTS
from app.backtest.models import BtBar
from app.core.market_data import fetch_yahoo

# base -> (Yahoo interval, how far back Yahoo serves it, request chunk size)
PLAN = {
    "5m": ("5m", timedelta(days=59), timedelta(days=59)),
    "1h": ("60m", timedelta(days=729), timedelta(days=120)),
    "1d": ("1d", None, timedelta(days=3650)),
}
DAILY_FROM = datetime(2000, 1, 1, tzinfo=timezone.utc)


def _snap(v: float, tick: float) -> float:
    return round(round(v / tick) * tick, 6)


def load_symbol(db: Session, symbol: str, fetcher=fetch_yahoo, now: datetime | None = None) -> dict:
    inst = INSTRUMENTS[symbol]
    now = now or datetime.now(timezone.utc)
    result: dict[str, dict] = {}
    for base, (interval, max_age, span) in PLAN.items():
        last = db.scalar(select(func.max(BtBar.ts)).where(BtBar.symbol == symbol, BtBar.tf == base))
        earliest = now - max_age if max_age else DAILY_FROM
        if last is not None:
            # Re-fetch from a little before the newest stored bar (it may have been partial).
            start = max(earliest, datetime.fromtimestamp(last, tz=timezone.utc) - timedelta(days=3))
        else:
            start = earliest
        raw = fetcher(inst["yahoo"], start, now, interval, span)
        rows: dict[int, dict] = {}
        for r in sorted(raw, key=lambda r: r["ts"]):
            ts = int(r["ts"].timestamp())
            if base == "1d":
                # Yahoo stamps a daily futures bar at midnight (or the session
                # open); either way it maps to the session open of its trading day.
                ts = day_start(trading_date(ts))
            else:
                # Holiday half-days come as :30 bars and the newest bar is stamped at
                # its last trade: snap onto the grid and merge bars sharing a slot.
                ts -= ts % BASES[base]
            bar = {
                "open": _snap(r["open"], inst["tick"]), "high": _snap(r["high"], inst["tick"]),
                "low": _snap(r["low"], inst["tick"]), "close": _snap(r["close"], inst["tick"]),
                "volume": float(r.get("volume") or 0),
            }
            prev = rows.get(ts)
            if prev and base != "1d":
                prev.update(high=max(prev["high"], bar["high"]), low=min(prev["low"], bar["low"]),
                            close=bar["close"], volume=prev["volume"] + bar["volume"])
            else:
                rows[ts] = bar
        if rows:
            first = min(rows)
            db.execute(delete(BtBar).where(BtBar.symbol == symbol, BtBar.tf == base, BtBar.ts >= first))
            db.add_all([BtBar(symbol=symbol, tf=base, ts=ts, **v) for ts, v in sorted(rows.items())])
            db.commit()
        result[base] = {"fetched": len(rows)}
    return result
