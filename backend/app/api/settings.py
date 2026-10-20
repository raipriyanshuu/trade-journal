"""Key-value settings endpoints.

The Anthropic API key (ai_review.api_key) is never sent back in full: reads
return a masked value, and writing the masked value back keeps the stored key.
"""

from __future__ import annotations

import copy
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Setting

router = APIRouter(prefix="/api/settings", tags=["settings"])

MASK_PREFIX = "••••"


def _mask(key: str) -> str:
    return f"{MASK_PREFIX}{key[-4:]}" if key else ""


def _public(db: Session) -> dict[str, Any]:
    out = {s.key: copy.deepcopy(s.value) for s in db.scalars(select(Setting))}
    ai = out.get("ai_review")
    if isinstance(ai, dict):
        ai["api_key_set"] = bool(ai.get("api_key"))
        ai["api_key"] = _mask(ai.get("api_key") or "")
    return out


@router.get("")
def get_settings(db: Session = Depends(get_db)) -> dict[str, Any]:
    return _public(db)


@router.put("")
def update_settings(payload: dict[str, Any], db: Session = Depends(get_db)) -> dict[str, Any]:
    for key, value in payload.items():
        setting = db.get(Setting, key)
        if key == "ai_review" and isinstance(value, dict):
            value = dict(value)
            value.pop("api_key_set", None)
            submitted = value.get("api_key") or ""
            if submitted.startswith(MASK_PREFIX) and setting and isinstance(setting.value, dict):
                value["api_key"] = setting.value.get("api_key", "")
        if setting is None:
            db.add(Setting(key=key, value=value))
        else:
            setting.value = value
    db.commit()
    return _public(db)
