"""Daily journal: upsert by (account, instrument, date), fetch, copy levels."""

from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import DailySession
from app.schemas.journal import DailySessionRead, DailySessionUpsert

router = APIRouter(prefix="/api/journal", tags=["journal"])


def _find(db: Session, account_id, instrument_id, trading_date) -> DailySession | None:
    stmt = select(DailySession).where(DailySession.trading_date == trading_date)
    stmt = stmt.where(
        DailySession.account_id.is_(None) if account_id is None else DailySession.account_id == account_id
    )
    stmt = stmt.where(
        DailySession.instrument_id.is_(None) if instrument_id is None else DailySession.instrument_id == instrument_id
    )
    return db.scalar(stmt)


@router.get("", response_model=DailySessionRead | None)
def get_session(
    trading_date: date,
    account_id: int | None = None,
    instrument_id: int | None = None,
    db: Session = Depends(get_db),
):
    return _find(db, account_id, instrument_id, trading_date)


@router.put("", response_model=DailySessionRead)
def upsert_session(payload: DailySessionUpsert, db: Session = Depends(get_db)):
    existing = _find(db, payload.account_id, payload.instrument_id, payload.trading_date)
    data = payload.model_dump()
    if existing is None:
        existing = DailySession(**data)
        db.add(existing)
    else:
        for field, value in data.items():
            setattr(existing, field, value)
    db.commit()
    db.refresh(existing)
    if existing.account_id:
        from app.core.mistakes import recompute_for_account

        recompute_for_account(db, existing.account_id)
    return existing


@router.get("/previous", response_model=DailySessionRead | None)
def previous_session(
    trading_date: date,
    account_id: int | None = None,
    instrument_id: int | None = None,
    db: Session = Depends(get_db),
):
    """The most recent journal before this date (for 'copy yesterday's levels')."""
    stmt = select(DailySession).where(DailySession.trading_date < trading_date)
    stmt = stmt.where(
        DailySession.account_id.is_(None) if account_id is None else DailySession.account_id == account_id
    )
    stmt = stmt.where(
        DailySession.instrument_id.is_(None) if instrument_id is None else DailySession.instrument_id == instrument_id
    )
    return db.scalar(stmt.order_by(DailySession.trading_date.desc()))


@router.delete("/{session_id}", status_code=204)
def delete_session(session_id: int, db: Session = Depends(get_db)):
    s = db.get(DailySession, session_id)
    if s is None:
        raise HTTPException(404, "Journal entry not found")
    db.delete(s)
    db.commit()
