"""Mistakes: flags (auto + manual), dismiss, recompute, analytics, drill-down."""

from __future__ import annotations

from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.filters import filtered_trades
from app.core.mistake_analytics import build
from app.core.mistakes import RULE_EXPLANATIONS, get_rules, recompute_all
from app.core.results import serialize_summary
from app.db import get_db
from app.models import MistakeFlag, Setting, Trade

router = APIRouter(prefix="/api/mistakes", tags=["mistakes"])


class FlagRead(BaseModel):
    id: int
    trade_id: int | None
    rule_code: str
    source: str
    details: str
    dismissed: bool
    explanation: str


class ManualFlagCreate(BaseModel):
    trade_id: int
    rule_code: str
    details: str = ""


class DismissRequest(BaseModel):
    dismissed: bool = True


def _to_read(f: MistakeFlag) -> FlagRead:
    return FlagRead(
        id=f.id, trade_id=f.trade_id, rule_code=f.rule_code, source=f.source,
        details=f.details, dismissed=f.dismissed,
        explanation=RULE_EXPLANATIONS.get(f.rule_code, f.rule_code),
    )


@router.get("/rules")
def rules(db: Session = Depends(get_db)) -> dict:
    cfg = get_rules(db)
    return {"rules": cfg, "explanations": RULE_EXPLANATIONS}


@router.post("/recompute")
def recompute(db: Session = Depends(get_db)) -> dict:
    return {"flags": recompute_all(db)}


@router.get("/flags", response_model=list[FlagRead])
def list_flags(trade_id: int | None = None, db: Session = Depends(get_db)):
    stmt = select(MistakeFlag)
    if trade_id is not None:
        stmt = stmt.where(MistakeFlag.trade_id == trade_id)
    return [_to_read(f) for f in db.scalars(stmt.order_by(MistakeFlag.id))]


@router.post("/flags", response_model=FlagRead, status_code=201)
def add_manual_flag(payload: ManualFlagCreate, db: Session = Depends(get_db)):
    trade = db.get(Trade, payload.trade_id)
    if trade is None:
        raise HTTPException(404, "Trade not found")
    flag = MistakeFlag(
        trade_id=payload.trade_id, account_id=trade.account_id,
        session_date=trade.trading_date, rule_code=payload.rule_code,
        source="manual", details=payload.details, is_demo=trade.is_demo,
    )
    db.add(flag)
    db.commit()
    db.refresh(flag)
    return _to_read(flag)


@router.post("/flags/{flag_id}/dismiss", response_model=FlagRead)
def dismiss_flag(flag_id: int, payload: DismissRequest, db: Session = Depends(get_db)):
    flag = db.get(MistakeFlag, flag_id)
    if flag is None:
        raise HTTPException(404, "Flag not found")
    flag.dismissed = payload.dismissed
    db.commit()
    db.refresh(flag)
    return _to_read(flag)


@router.delete("/flags/{flag_id}", status_code=204)
def delete_flag(flag_id: int, db: Session = Depends(get_db)):
    flag = db.get(MistakeFlag, flag_id)
    if flag is None:
        raise HTTPException(404, "Flag not found")
    db.delete(flag)
    db.commit()


def _filters(**kw):
    return {k: v for k, v in kw.items() if v is not None}


@router.get("/analytics")
def analytics(
    db: Session = Depends(get_db),
    date_from: date | None = None,
    date_to: date | None = None,
    account_id: int | None = None,
    instrument_id: int | None = None,
    currency: str | None = None,
    style: str | None = None,
    include_demo: bool = True,
):
    trades = filtered_trades(
        db, date_from=date_from, date_to=date_to, account_id=account_id,
        instrument_id=instrument_id, currency=currency, style=style, include_demo=include_demo,
    )
    tz = _setting(db, "display_timezone", "Asia/Kolkata")
    big_win_r = float(_setting(db, "big_win_threshold_r", 2) or 2)
    return build(db, trades, tz, big_win_r)


@router.get("/drilldown", response_model=list[dict])
def drilldown(
    type: str,
    db: Session = Depends(get_db),
    date_from: date | None = None,
    date_to: date | None = None,
    account_id: int | None = None,
    instrument_id: int | None = None,
    currency: str | None = None,
    style: str | None = None,
    include_demo: bool = True,
):
    trades = filtered_trades(
        db, date_from=date_from, date_to=date_to, account_id=account_id,
        instrument_id=instrument_id, currency=currency, style=style, include_demo=include_demo,
    )
    out = []
    for t in trades:
        matched = False
        if type.startswith("tag:"):
            matched = any(f"tag:{tag.name}" == type for tag in t.tags if tag.category == "mistake")
        else:
            matched = db.scalar(
                select(MistakeFlag.id).where(
                    MistakeFlag.trade_id == t.id,
                    MistakeFlag.rule_code == type.replace("manual:", ""),
                    MistakeFlag.dismissed.is_(False),
                )
            ) is not None
        if matched:
            out.append(serialize_summary(db, t))
    return out


def _setting(db: Session, key: str, default):
    s = db.get(Setting, key)
    return s.value if s and s.value is not None else default
