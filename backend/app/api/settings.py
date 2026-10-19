"""Key-value settings endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Setting

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("")
def get_settings(db: Session = Depends(get_db)) -> dict[str, Any]:
    return {s.key: s.value for s in db.scalars(select(Setting))}


@router.put("")
def update_settings(payload: dict[str, Any], db: Session = Depends(get_db)) -> dict[str, Any]:
    for key, value in payload.items():
        setting = db.get(Setting, key)
        if setting is None:
            db.add(Setting(key=key, value=value))
        else:
            setting.value = value
    db.commit()
    return {s.key: s.value for s in db.scalars(select(Setting))}
