"""Execution edit/delete. Any change re-runs the trade builder for the pair."""

from __future__ import annotations

from datetime import timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.mistakes import recompute_for_account
from app.core.trade_builder import rebuild_for
from app.db import get_db
from app.models import Execution
from app.schemas.execution import ExecutionRead, ExecutionUpdate

router = APIRouter(prefix="/api/executions", tags=["executions"])


@router.patch("/{execution_id}", response_model=ExecutionRead)
def update_execution(execution_id: int, payload: ExecutionUpdate, db: Session = Depends(get_db)):
    ex = db.get(Execution, execution_id)
    if ex is None:
        raise HTTPException(404, "Execution not found")
    data = payload.model_dump(exclude_unset=True)
    if "timestamp" in data and data["timestamp"] is not None:
        ts = data["timestamp"]
        data["timestamp"] = ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
    for field, value in data.items():
        setattr(ex, field, value)
    account_id, instrument_id = ex.account_id, ex.instrument_id
    db.commit()
    rebuild_for(db, account_id, instrument_id)
    recompute_for_account(db, account_id)
    return db.get(Execution, execution_id)


@router.delete("/{execution_id}", status_code=204)
def delete_execution(execution_id: int, db: Session = Depends(get_db)):
    ex = db.get(Execution, execution_id)
    if ex is None:
        raise HTTPException(404, "Execution not found")
    account_id, instrument_id = ex.account_id, ex.instrument_id
    db.delete(ex)
    db.commit()
    rebuild_for(db, account_id, instrument_id)
    recompute_for_account(db, account_id)
