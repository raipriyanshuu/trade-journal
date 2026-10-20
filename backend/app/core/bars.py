"""OHLCV bar import (CSV from the charting platform) and lookups."""

from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.importing import _rows, parse_decimal, parse_dt
from app.models import Bar, Instrument
from app.models.bar import TIMEFRAMES


def import_bars(db: Session, *, content: bytes, config: dict) -> dict:
    """Import a CSV of bars. Existing (instrument, timeframe, ts) rows are skipped.

    config: instrument_id, timeframe ("1m"|"5m"), column_map {timestamp, open,
    high, low, close, volume?}, datetime_format, file_timezone, delimiter?.
    """
    instrument_id = int(config["instrument_id"])
    timeframe = config.get("timeframe", "1m")
    if timeframe not in TIMEFRAMES:
        raise ValueError(f"timeframe must be one of {list(TIMEFRAMES)}")
    cmap = config.get("column_map", {})
    dt_fmt = config.get("datetime_format", "auto")
    tz = config.get("file_timezone", "UTC")

    _, rows = _rows(content, config.get("delimiter"))
    existing = set(
        db.scalars(
            select(Bar.ts).where(Bar.instrument_id == instrument_id, Bar.timeframe == timeframe)
        )
    )

    def col(row, field):
        h = cmap.get(field)
        return row.get(h, "") if h else ""

    read = imported = skipped = failed = 0
    errors: list[str] = []
    for row in rows:
        read += 1
        ts = parse_dt(str(col(row, "timestamp")), dt_fmt, tz)
        o, h, l, c = (parse_decimal(col(row, k)) for k in ("open", "high", "low", "close"))
        if ts is None or None in (o, h, l, c):
            failed += 1
            if len(errors) < 50:
                errors.append(f"Row {read}: missing time or OHLC")
            continue
        if ts in existing:
            skipped += 1
            continue
        existing.add(ts)
        db.add(Bar(instrument_id=instrument_id, timeframe=timeframe, ts=ts,
                   open=o, high=h, low=l, close=c, volume=parse_decimal(col(row, "volume"))))
        imported += 1
        if imported % 2000 == 0:
            db.flush()
    db.commit()
    return {"rows_read": read, "imported": imported, "skipped": skipped,
            "failed": failed, "errors": errors}


def coverage(db: Session) -> list[dict]:
    rows = db.execute(
        select(Bar.instrument_id, Bar.timeframe, func.count(Bar.id), func.min(Bar.ts), func.max(Bar.ts))
        .group_by(Bar.instrument_id, Bar.timeframe)
    ).all()
    instruments = {i.id: i.symbol_root for i in db.scalars(select(Instrument))}
    out = []
    for inst_id, tf, n, first, last in rows:
        out.append({
            "instrument_id": inst_id, "symbol": instruments.get(inst_id, "?"), "timeframe": tf,
            "bars": n, "first": first.isoformat() if first else None,
            "last": last.isoformat() if last else None,
        })
    return out


def delete_bars(db: Session, instrument_id: int, timeframe: str) -> int:
    n = 0
    for b in db.scalars(select(Bar).where(Bar.instrument_id == instrument_id, Bar.timeframe == timeframe)):
        db.delete(b)
        n += 1
    db.commit()
    return n


def bars_between(
    db: Session, instrument_id: int, start: datetime, end: datetime
) -> tuple[str | None, list[Bar]]:
    """Bars overlapping [start, end], using the finest timeframe that has any.

    A bar starting at ts covers [ts, ts + tf); it overlaps the window when
    ts <= end and ts + tf > start.
    """
    for tf in sorted(TIMEFRAMES, key=TIMEFRAMES.get):
        secs = TIMEFRAMES[tf]
        bars = list(
            db.scalars(
                select(Bar)
                .where(
                    Bar.instrument_id == instrument_id,
                    Bar.timeframe == tf,
                    Bar.ts <= end,
                    Bar.ts > start - timedelta(seconds=secs),
                )
                .order_by(Bar.ts)
            )
        )
        if bars:
            return tf, bars
    return None, []
