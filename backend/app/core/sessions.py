"""Session rules: trading-date assignment and session-open times.

All timestamps are UTC; conversions use zoneinfo so US daylight-saving changes
are handled correctly. The trading date is assigned per the instrument's session
definition:

- ``trading_day_start_offset_days == -1`` (e.g. CME index, Globex): the trading
  day opens the previous evening. A fill at/after ``trading_day_start`` local time
  belongs to the NEXT calendar day's trading date.
- ``offset == 0`` (NSE, MCX): the trading date is simply the local calendar date.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from app.models import Instrument


def _parse_hhmm(value: str | None, default: str) -> time:
    raw = value or default
    hh, mm = raw.split(":")
    return time(int(hh), int(mm))


def to_session_local(dt_utc: datetime, instrument: Instrument) -> datetime:
    tz = ZoneInfo(instrument.session_timezone)
    return dt_utc.astimezone(tz)


def trading_date_for(dt_utc: datetime, instrument: Instrument) -> date:
    """Return the trading date for a UTC timestamp, per the instrument's session."""
    sd = instrument.session_definitions or {}
    offset = sd.get("trading_day_start_offset_days", 0)
    local = to_session_local(dt_utc, instrument)

    if offset == -1:
        start = _parse_hhmm(sd.get("trading_day_start"), "18:00")
        if local.time() >= start:
            return local.date() + timedelta(days=1)
        return local.date()

    # Same-day session (offset 0).
    return local.date()


def session_open_utc(trading_date: date, instrument: Instrument) -> datetime:
    """UTC datetime of the regular-session open for a given trading date."""
    sd = instrument.session_definitions or {}
    tz = ZoneInfo(instrument.session_timezone)
    open_t = _parse_hhmm(sd.get("regular_start"), "09:30")

    if sd.get("trading_day_start_offset_days", 0) == -1:
        # The regular session opens on the trading date's own calendar day.
        local_open = datetime.combine(trading_date, open_t, tzinfo=tz)
    else:
        local_open = datetime.combine(trading_date, open_t, tzinfo=tz)
    return local_open.astimezone(ZoneInfo("UTC"))


def minutes_since_session_open(dt_utc: datetime, instrument: Instrument) -> float | None:
    """Minutes from the regular-session open to the given time (None if before)."""
    td = trading_date_for(dt_utc, instrument)
    open_utc = session_open_utc(td, instrument)
    delta = (dt_utc - open_utc).total_seconds() / 60.0
    return delta
