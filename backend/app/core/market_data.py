"""Optional delayed chart data for CME futures from Yahoo Finance.

Off by default (Settings -> Market data). When enabled, the app fetches 1-minute
bars (5-minute for trades older than ~29 days, nothing beyond ~59 days) around a
trade and stores them locally like imported bars, so each chart is fetched once.

Only the Yahoo ticker and a time range leave the computer -- never trade data.
Yahoo serves the *continuous front-month* contract, so prices can differ slightly
from the contract you traded around roll dates. Micros share the full-size chart.
Yahoo's chart endpoint is unofficial and can rate-limit or change; CSV import
remains the fallback.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal

import httpx
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Bar, Instrument, Setting, Trade

CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) TradeJournal/0.2"}

DEFAULT_SYMBOLS = {
    "ES": "ES=F", "MES": "ES=F",
    "NQ": "NQ=F", "MNQ": "NQ=F",
    "GC": "GC=F", "MGC": "GC=F",
    "CL": "CL=F", "MCL": "CL=F",
}
DEFAULT_CONFIG = {"enabled": False, "auto_fetch_on_save": True, "symbols": DEFAULT_SYMBOLS}

# Yahoo retention (with a day of margin): 1m within 30 days, 5m within 60 days.
ONE_MIN_MAX_AGE = timedelta(days=29)
FIVE_MIN_MAX_AGE = timedelta(days=59)
MAX_REQUEST_SPAN = timedelta(days=7)  # Yahoo allows ~8 days of 1m per request
WINDOW_BEFORE = timedelta(hours=3)
WINDOW_AFTER = timedelta(hours=2)


class MarketDataError(Exception):
    pass


def get_config(db: Session) -> dict:
    s = db.get(Setting, "market_data")
    cfg = dict(DEFAULT_CONFIG)
    if s and isinstance(s.value, dict):
        cfg.update(s.value)
    cfg["symbols"] = {**DEFAULT_SYMBOLS, **(cfg.get("symbols") or {})}
    return cfg


def yahoo_symbol(cfg: dict, instrument: Instrument) -> str | None:
    return (cfg.get("symbols") or {}).get(instrument.symbol_root.upper())


def _snap(value: float, tick: Decimal) -> Decimal:
    """Round Yahoo's float noise (4191.2998...) onto the contract's tick grid."""
    d = Decimal(str(value))
    if tick and tick > 0:
        return ((d / tick).quantize(Decimal("1"), rounding=ROUND_HALF_UP) * tick).normalize()
    return d


def fetch_yahoo(symbol: str, start: datetime, end: datetime, interval: str,
                span: timedelta = MAX_REQUEST_SPAN) -> list[dict]:
    """Raw bars from Yahoo's chart endpoint (network call). Times are UTC.

    The range is requested in ``span``-sized chunks (Yahoo caps 1m requests at ~8 days).
    """
    out: list[dict] = []
    cursor = start
    while cursor < end:
        chunk_end = min(end, cursor + span)
        try:
            r = httpx.get(
                CHART_URL.format(symbol=symbol),
                params={"interval": interval, "period1": int(cursor.timestamp()),
                        "period2": int(chunk_end.timestamp()), "includePrePost": "true"},
                headers=HEADERS, timeout=20,
            )
        except httpx.HTTPError as exc:
            raise MarketDataError(f"Could not reach Yahoo Finance: {exc}") from exc
        if r.status_code == 429:
            raise MarketDataError("Yahoo Finance is rate-limiting requests. Try again in a few minutes.")
        try:
            payload = r.json()["chart"]
        except (ValueError, KeyError) as exc:
            raise MarketDataError(f"Unexpected response from Yahoo Finance (HTTP {r.status_code}).") from exc
        if payload.get("error"):
            desc = payload["error"].get("description") or payload["error"].get("code")
            raise MarketDataError(f"Yahoo Finance: {desc}")
        result = (payload.get("result") or [None])[0]
        if result and result.get("timestamp"):
            quote = result["indicators"]["quote"][0]
            for i, ts in enumerate(result["timestamp"]):
                o, h, l, c = (quote[k][i] for k in ("open", "high", "low", "close"))
                if None in (o, h, l, c):
                    continue  # Yahoo leaves gaps as nulls
                out.append({"ts": datetime.fromtimestamp(ts, tz=timezone.utc), "open": o, "high": h,
                            "low": l, "close": c, "volume": (quote.get("volume") or [None] * (i + 1))[i]})
        cursor = chunk_end
    return out


def trade_window(trade: Trade) -> tuple[datetime, datetime]:
    end_anchor = trade.close_time or trade.open_time
    end = min(end_anchor + WINDOW_AFTER, datetime.now(timezone.utc))
    return trade.open_time - WINDOW_BEFORE, end


def _covered(db: Session, instrument_id: int, timeframe: str, start: datetime, end: datetime) -> bool:
    """True when stored bars already span the trade itself (no refetch needed)."""
    first, last = db.execute(
        select(func.min(Bar.ts), func.max(Bar.ts)).where(
            Bar.instrument_id == instrument_id, Bar.timeframe == timeframe,
            Bar.ts >= start, Bar.ts <= end,
        )
    ).one()
    if first is None:
        return False
    if first.tzinfo is None:
        first, last = first.replace(tzinfo=timezone.utc), last.replace(tzinfo=timezone.utc)
    return first <= start + WINDOW_BEFORE and last >= end - WINDOW_AFTER


def fetch_for_trade(db: Session, trade: Trade, force: bool = False, fetcher=fetch_yahoo) -> dict:
    cfg = get_config(db)
    if not cfg.get("enabled"):
        raise MarketDataError("Delayed charts are turned off. Enable them in Settings → Market data.")
    inst = db.get(Instrument, trade.instrument_id)
    symbol = yahoo_symbol(cfg, inst) if inst else None
    if not symbol:
        raise MarketDataError(
            f"No Yahoo symbol for {inst.symbol_root if inst else '?'}. Import bars for it in Import / Export → Bar data.")
    if not trade.time_known:
        raise MarketDataError("This trade has an approximate time, so a chart window can't be placed.")

    start, end = trade_window(trade)
    age = datetime.now(timezone.utc) - start
    if age <= ONE_MIN_MAX_AGE:
        interval = "1m"
    elif age <= FIVE_MIN_MAX_AGE:
        interval = "5m"
    else:
        raise MarketDataError(
            "Yahoo only keeps intraday futures data for about 60 days; this trade is older. Import bars from a CSV instead.")

    if not force and _covered(db, inst.id, interval, start, end):
        return {"status": "cached", "symbol": symbol, "timeframe": interval, "added": 0}

    raw = fetcher(symbol, start, end, interval)
    if not raw:
        raise MarketDataError("Yahoo returned no bars for this time window (market closed?).")

    existing = set(
        db.scalars(select(Bar.ts).where(
            Bar.instrument_id == inst.id, Bar.timeframe == interval, Bar.ts >= start, Bar.ts <= end,
        ))
    )
    tick = Decimal(inst.tick_size)
    added = 0
    for row in raw:
        if row["ts"] in existing:
            continue
        o, h, l, c = (_snap(row[k], tick) for k in ("open", "high", "low", "close"))
        db.add(Bar(instrument_id=inst.id, timeframe=interval, ts=row["ts"], open=o,
                   high=max(o, h, l, c), low=min(o, h, l, c), close=c,
                   volume=Decimal(str(row["volume"])) if row.get("volume") is not None else None,
                   source="yahoo"))
        existing.add(row["ts"])
        added += 1
    db.commit()
    return {"status": "fetched", "symbol": symbol, "timeframe": interval, "added": added}


def backfill(db: Session, days: int = 59, fetcher=fetch_yahoo) -> dict:
    """Fetch charts for every recent CME trade that doesn't have bars yet."""
    cfg = get_config(db)
    if not cfg.get("enabled"):
        raise MarketDataError("Delayed charts are turned off. Enable them in Settings → Market data.")
    since = datetime.now(timezone.utc) - timedelta(days=min(days, 59))
    supported = {i.id for i in db.scalars(select(Instrument)) if yahoo_symbol(cfg, i)}
    trades = db.scalars(
        select(Trade).where(Trade.open_time >= since, Trade.instrument_id.in_(supported),
                            Trade.time_known.is_(True)).order_by(Trade.open_time)
    ).all()
    summary = {"trades": len(trades), "fetched": 0, "cached": 0, "failed": 0, "errors": []}
    for t in trades:
        try:
            res = fetch_for_trade(db, t, fetcher=fetcher)
            summary["fetched" if res["status"] == "fetched" else "cached"] += 1
        except MarketDataError as exc:
            summary["failed"] += 1
            if len(summary["errors"]) < 10:
                summary["errors"].append(f"Trade {t.id}: {exc}")
    return summary


def auto_fetch_trade(trade_id: int) -> None:
    """Background task after a trade is saved: fetch its chart if enabled."""
    from app.db import SessionLocal

    with SessionLocal() as db:
        cfg = get_config(db)
        if not (cfg.get("enabled") and cfg.get("auto_fetch_on_save")):
            return
        trade = db.get(Trade, trade_id)
        if trade is None:
            return
        try:
            fetch_for_trade(db, trade)
        except MarketDataError:
            pass  # the trade page offers a manual "Fetch chart" with the reason
