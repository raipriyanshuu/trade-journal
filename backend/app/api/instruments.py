"""Instrument master CRUD + verify."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Instrument
from app.schemas.instrument import InstrumentCreate, InstrumentRead, InstrumentUpdate

router = APIRouter(prefix="/api/instruments", tags=["instruments"])


@router.get("", response_model=list[InstrumentRead])
def list_instruments(include_inactive: bool = True, db: Session = Depends(get_db)):
    stmt = select(Instrument).order_by(Instrument.symbol_root)
    if not include_inactive:
        stmt = stmt.where(Instrument.active.is_(True))
    return list(db.scalars(stmt))


@router.post("", response_model=InstrumentRead, status_code=201)
def create_instrument(payload: InstrumentCreate, db: Session = Depends(get_db)):
    if db.scalar(select(Instrument).where(Instrument.symbol_root == payload.symbol_root)):
        raise HTTPException(409, f"Instrument {payload.symbol_root} already exists")
    inst = Instrument(**payload.model_dump())
    # A user-created instrument is considered verified by the user.
    inst.verified = True
    db.add(inst)
    db.commit()
    db.refresh(inst)
    return inst


@router.get("/{instrument_id}", response_model=InstrumentRead)
def get_instrument(instrument_id: int, db: Session = Depends(get_db)):
    inst = db.get(Instrument, instrument_id)
    if inst is None:
        raise HTTPException(404, "Instrument not found")
    return inst


@router.patch("/{instrument_id}", response_model=InstrumentRead)
def update_instrument(instrument_id: int, payload: InstrumentUpdate, db: Session = Depends(get_db)):
    inst = db.get(Instrument, instrument_id)
    if inst is None:
        raise HTTPException(404, "Instrument not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(inst, field, value)
    db.commit()
    db.refresh(inst)
    return inst


@router.post("/{instrument_id}/verify", response_model=InstrumentRead)
def verify_instrument(instrument_id: int, db: Session = Depends(get_db)):
    inst = db.get(Instrument, instrument_id)
    if inst is None:
        raise HTTPException(404, "Instrument not found")
    inst.verified = True
    db.commit()
    db.refresh(inst)
    return inst
