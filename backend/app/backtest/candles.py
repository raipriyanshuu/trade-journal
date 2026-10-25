"""Candles for the replay chart, built from stored base bars, without look-ahead.

* Trading day = CME Globex session: 18:00 New York to 18:00 the next day,
  dated by the day it ends (Sunday evening belongs to Monday).
* 5m/15m/30m/1h candles are clock-aligned; 4h candles start at 18:00, 22:00,
  02:00 ... New York (like TradingView); 1D = one trading day; 1W starts Sunday
  18:00 New York.
* A chart timeframe is built from the finest base that has data (5m where Yahoo
  still has it, 1h further back, daily before that). Only base bars that have
  fully closed before ``revealed_until`` are used, so the last candle is shown
  half-formed exactly as it would have looked at that moment.
* Session VWAP (anchored at each trading day's open) with 1 and 2 standard
  deviation bands, for intraday timeframes.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from datetime import date, datetime, time, timedelta, timezone
from functools import lru_cache
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.backtest.instruments import BASES, INTRADAY, TF_BASES, TIMEFRAMES
from app.backtest.models import BtBar

NY = ZoneInfo("America/New_York")
SESSION_OPEN = time(18, 0)


@dataclass(frozen=True, slots=True)
class Bar:
    ts: int
    open: float
    high: float
    low: float
    close: float
    volume: float
    dur: int


# ----------------------------------------------------------------- trading day
@lru_cache(maxsize=200_000)
def _trading_date_for_hour(hour_index: int) -> date:
    # Session boundaries fall on whole hours, so the hour decides the trading date.
    local = datetime.fromtimestamp(hour_index * 3600, tz=timezone.utc).astimezone(NY)
    return (local + timedelta(hours=6)).date()


def trading_date(ts: int) -> date:
    return _trading_date_for_hour(ts // 3600)


@lru_cache(maxsize=50_000)
def day_start(d: date) -> int:
    """UTC epoch of the session open (18:00 New York the evening before ``d``)."""
    return int(datetime.combine(d - timedelta(days=1), SESSION_OPEN, tzinfo=NY).timestamp())


def day_start_of(ts: int) -> int:
    return day_start(trading_date(ts))


def bucket(ts: int, tf: str) -> int:
    """UTC start of the chart-timeframe candle that contains ``ts``."""
    if tf in ("5m", "15m", "30m", "1h"):
        size = TIMEFRAMES[tf]
        return ts - ts % size
    if tf == "4h":
        s = day_start_of(ts)
        return s + (ts - s) // 14400 * 14400
    d = trading_date(ts)
    if tf == "1W":
        d = d - timedelta(days=d.weekday())  # the week's Monday
    return day_start(d)


def chart_time(bucket_ts: int, tf: str, zone: ZoneInfo) -> int:
    """Time value for the chart: local wall-clock epoch for intraday, the date for D/W."""
    if tf in INTRADAY:
        dt = datetime.fromtimestamp(bucket_ts, tz=timezone.utc)
        off = dt.astimezone(zone).utcoffset() or timedelta(0)
        return int(bucket_ts + off.total_seconds())
    d = trading_date(bucket_ts + 3600)
    return int(datetime(d.year, d.month, d.day, tzinfo=timezone.utc).timestamp())


# ------------------------------------------------------------------- coverage
def coverage(db: Session, symbol: str) -> dict[str, dict]:
    rows = db.execute(
        select(BtBar.tf, func.min(BtBar.ts), func.max(BtBar.ts), func.count())
        .where(BtBar.symbol == symbol).group_by(BtBar.tf)
    ).all()
    out = {}
    for tf, first, last, n in rows:
        # A base is used from its first *complete* trading day, so no candle mixes bases.
        ds = day_start_of(first)
        usable = first if first == ds else day_start(trading_date(first) + timedelta(days=1))
        out[tf] = {"first": first, "last": last, "end": last + BASES[tf], "bars": n, "usable_from": usable}
    return out


def step_base(cov: dict[str, dict], tf: str, revealed_until: int) -> str | None:
    """Finest base (allowed for ``tf``) whose data covers the replay cursor."""
    for b in TF_BASES[tf]:
        c = cov.get(b)
        if c and c["usable_from"] <= revealed_until <= c["end"]:
            return b
    # Before every base's usable range: the coarsest with data still lets you step.
    for b in reversed(TF_BASES[tf]):
        c = cov.get(b)
        if c and revealed_until <= c["end"]:
            return b
    return None


def _load(db: Session, symbol: str, base: str, start: int, end: int) -> list[Bar]:
    dur = BASES[base]
    rows = db.execute(
        select(BtBar.ts, BtBar.open, BtBar.high, BtBar.low, BtBar.close, BtBar.volume)
        .where(BtBar.symbol == symbol, BtBar.tf == base, BtBar.ts >= start, BtBar.ts + dur <= end)
        .order_by(BtBar.ts)
    ).all()
    return [Bar(r[0], r[1], r[2], r[3], r[4], r[5] or 0.0, dur) for r in rows]


def revealed_bars(db: Session, symbol: str, tf: str, start: int, revealed_until: int,
                  cov: dict[str, dict] | None = None) -> list[Bar]:
    """Closed base bars in [start, revealed_until), finest base where it has full days."""
    cov = cov if cov is not None else coverage(db, symbol)
    bases = [b for b in TF_BASES[tf] if b in cov]
    out: list[Bar] = []
    upper = revealed_until
    for i, b in enumerate(bases):
        coarser_left = i < len(bases) - 1
        lo = max(start, cov[b]["usable_from"]) if coarser_left else start
        if lo >= upper:
            continue
        out = _load(db, symbol, b, lo, upper) + out
        upper = lo
        if upper <= start:
            break
    return out


# ------------------------------------------------------------------ building
def aggregate(bars: list[Bar], tf: str) -> list[dict]:
    """Chart candles (UTC bucket starts) from base bars."""
    candles: list[dict] = []
    cur = None
    for b in bars:
        k = bucket(b.ts, tf)
        if cur is None or cur["t"] != k:
            cur = {"t": k, "open": b.open, "high": b.high, "low": b.low, "close": b.close, "volume": b.volume}
            candles.append(cur)
        else:
            cur["high"] = max(cur["high"], b.high)
            cur["low"] = min(cur["low"], b.low)
            cur["close"] = b.close
            cur["volume"] += b.volume
    return candles


def vwap(bars: list[Bar], tf: str) -> dict[int, dict]:
    """Session VWAP and bands at the end of each chart candle (keyed by bucket)."""
    out: dict[int, dict] = {}
    day = None
    pv = v = p2v = 0.0
    for b in bars:
        d = day_start_of(b.ts)
        if d != day:
            day, pv, v, p2v = d, 0.0, 0.0, 0.0
        tp = (b.high + b.low + b.close) / 3
        w = b.volume if b.volume and b.volume > 0 else 0.0
        pv += tp * w
        p2v += tp * tp * w
        v += w
        if v <= 0:
            continue
        mean = pv / v
        sd = max(p2v / v - mean * mean, 0.0) ** 0.5
        out[bucket(b.ts, tf)] = {"vwap": mean, "sd": sd, "day": d}
    return out


def history_start(tf: str, revealed_until: int, start_at: int, candles: int = 600) -> int:
    """How far back to show: ``candles`` chart candles before the session start (calendar estimate)."""
    span = TIMEFRAMES[tf] * candles
    if tf in INTRADAY:
        span = int(span * 7 / 5 * 1.05)  # weekends
    else:
        span = int(span * 7 / 5) if tf == "1D" else span
    return min(start_at, revealed_until) - span


def build_chart(db: Session, symbol: str, tf: str, start_at: int, revealed_until: int,
                zone: ZoneInfo, since: int | None = None, tick: float = 0.01) -> dict:
    """Candles + VWAP up to the cursor. With ``since`` (a UTC bucket start from a
    previous response) only candles from that bucket on are returned."""
    cov = coverage(db, symbol)
    start = history_start(tf, revealed_until, start_at)
    if since is not None:
        # Enough to rebuild the tail candle and today's VWAP.
        start = max(start, min(since, day_start_of(since)))
    bars = revealed_bars(db, symbol, tf, start, revealed_until, cov)
    candles = aggregate(bars, tf)
    if since is not None:
        candles = [c for c in candles if c["t"] >= since]
    vw = vwap(bars, tf) if tf in INTRADAY else {}
    digits = max(0, -Decimal(str(tick)).as_tuple().exponent)

    out_c, out_v = [], []
    prev_day = None
    for c in candles:
        t = chart_time(c["t"], tf, zone)
        out_c.append({"time": t, "open": c["open"], "high": c["high"], "low": c["low"],
                      "close": c["close"], "volume": c["volume"]})
        if c["t"] in vw:
            m, sd, d = vw[c["t"]]["vwap"], vw[c["t"]]["sd"], vw[c["t"]]["day"]
            # new_day marks a session reset, so the chart can break the line there.
            out_v.append({"time": t, "vwap": round(m, digits + 2), "sd": round(sd, digits + 2),
                          "new_day": prev_day is not None and d != prev_day})
            prev_day = d
    base = step_base(cov, tf, revealed_until)
    return {
        "tf": tf,
        "candles": out_c,
        "vwap": out_v,
        "tail_from": candles[-1]["t"] if candles else None,
        "step_base": base,
        "at_end": base is None or revealed_until >= cov[base]["end"],
    }


def last_bar(db: Session, symbol: str, revealed_until: int) -> Bar | None:
    """The most recently closed bar at the cursor (finest base wins a tie)."""
    best: Bar | None = None
    for b, dur in BASES.items():
        r = db.execute(
            select(BtBar.ts, BtBar.open, BtBar.high, BtBar.low, BtBar.close, BtBar.volume)
            .where(BtBar.symbol == symbol, BtBar.tf == b, BtBar.ts + dur <= revealed_until)
            .order_by(BtBar.ts.desc()).limit(1)
        ).first()
        if r is None:
            continue
        bar = Bar(r[0], r[1], r[2], r[3], r[4], r[5] or 0.0, dur)
        if best is None or bar.ts + bar.dur > best.ts + best.dur:
            best = bar
    return best


def bars_between(db: Session, symbol: str, base: str, after: int, until: int) -> list[Bar]:
    """Base bars that close inside (after, until] and open at or after ``after``."""
    return _load(db, symbol, base, after, until)


def next_bars(db: Session, symbol: str, base: str, revealed_until: int, limit: int) -> list[Bar]:
    dur = BASES[base]
    rows = db.execute(
        select(BtBar.ts, BtBar.open, BtBar.high, BtBar.low, BtBar.close, BtBar.volume)
        .where(BtBar.symbol == symbol, BtBar.tf == base, BtBar.ts >= revealed_until)
        .order_by(BtBar.ts).limit(limit)
    ).all()
    return [Bar(r[0], r[1], r[2], r[3], r[4], r[5] or 0.0, dur) for r in rows]
