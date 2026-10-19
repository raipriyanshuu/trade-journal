"""Analytics endpoints: dashboard, P&L calendar and breakdowns."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core import analytics
from app.core.filters import filtered_trades
from app.db import get_db
from app.models import Setting

router = APIRouter(prefix="/api/analytics", tags=["analytics"])

DIMENSIONS = [
    "instrument", "account", "direction", "session_time", "clock_time", "weekday",
    "setup_tag", "scenario", "planned", "checklist_score", "vwap", "entry_location",
    "day_type", "opening_type", "holding_bucket", "position_size",
]


def _tz(db: Session) -> str:
    s = db.get(Setting, "display_timezone")
    return s.value if s and s.value else "Asia/Kolkata"


def _trades(db, **kw):
    return filtered_trades(db, **{k: v for k, v in kw.items()})


@router.get("/dashboard")
def dashboard(
    db: Session = Depends(get_db),
    date_from: date | None = None,
    date_to: date | None = None,
    account_id: int | None = None,
    instrument_id: int | None = None,
    currency: str | None = None,
    include_demo: bool = True,
):
    trades = _trades(db, date_from=date_from, date_to=date_to, account_id=account_id,
                     instrument_id=instrument_id, currency=currency, include_demo=include_demo)
    return analytics.dashboard(trades)


@router.get("/calendar")
def calendar(
    db: Session = Depends(get_db),
    account_id: int | None = None,
    instrument_id: int | None = None,
    currency: str | None = None,
    include_demo: bool = True,
):
    trades = _trades(db, account_id=account_id, instrument_id=instrument_id,
                     currency=currency, include_demo=include_demo)
    return analytics.calendar(trades)


@router.get("/breakdown")
def breakdown(
    dimension: str,
    db: Session = Depends(get_db),
    date_from: date | None = None,
    date_to: date | None = None,
    account_id: int | None = None,
    instrument_id: int | None = None,
    currency: str | None = None,
    include_demo: bool = True,
):
    trades = _trades(db, date_from=date_from, date_to=date_to, account_id=account_id,
                     instrument_id=instrument_id, currency=currency, include_demo=include_demo)
    return analytics.breakdown(db, trades, dimension, _tz(db))


@router.get("/dimensions")
def dimensions() -> list[str]:
    return DIMENSIONS
