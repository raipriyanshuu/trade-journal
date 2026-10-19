"""Demo data endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.demo import clear_demo_data, demo_status, load_demo_data

router = APIRouter(prefix="/api/demo", tags=["demo"])


@router.get("")
def status(db: Session = Depends(get_db)) -> dict:
    return demo_status(db)


@router.post("/load")
def load(db: Session = Depends(get_db)) -> dict:
    return load_demo_data(db)


@router.post("/clear")
def clear(db: Session = Depends(get_db)) -> dict:
    return clear_demo_data(db)
