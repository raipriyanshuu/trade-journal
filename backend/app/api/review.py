"""Phase 7 endpoints: bars, MAE/MFE, replay, reports, AI review, charges."""

from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core import bars as bars_core
from app.core import excursions, market_data
from app.core.ai_review import AIReviewError
from app.core.ai_review import review as ai_review
from app.core.charges import estimate
from app.core.filters import filtered_trades
from app.core.replay import replay
from app.core.reports import build_report
from app.db import get_db
from app.models import Instrument, Setting, Trade

router = APIRouter(prefix="/api", tags=["review"])


def _setting(db: Session, key: str, default):
    s = db.get(Setting, key)
    return s.value if s and s.value is not None else default


# ---------------- Bars ----------------
@router.post("/bars/import")
async def import_bars(file: UploadFile = File(...), config: str = Form(...), db: Session = Depends(get_db)):
    try:
        cfg = json.loads(config)
        return bars_core.import_bars(db, content=await file.read(), config=cfg)
    except (ValueError, KeyError) as exc:
        raise HTTPException(422, str(exc))


@router.get("/bars/coverage")
def bar_coverage(db: Session = Depends(get_db)):
    return bars_core.coverage(db)


@router.delete("/bars")
def delete_bars(instrument_id: int, timeframe: str, db: Session = Depends(get_db)):
    return {"deleted": bars_core.delete_bars(db, instrument_id, timeframe)}


# ---------------- Delayed charts (Yahoo, CME only, opt-in) ----------------
@router.post("/trades/{trade_id}/fetch-bars")
def fetch_trade_bars(trade_id: int, force: bool = False, db: Session = Depends(get_db)):
    trade = db.get(Trade, trade_id)
    if trade is None:
        raise HTTPException(404, "Trade not found")
    try:
        return market_data.fetch_for_trade(db, trade, force=force)
    except market_data.MarketDataError as exc:
        raise HTTPException(400, str(exc))


@router.post("/market-data/backfill")
def market_data_backfill(days: int = 59, db: Session = Depends(get_db)):
    try:
        return market_data.backfill(db, days)
    except market_data.MarketDataError as exc:
        raise HTTPException(400, str(exc))


# ---------------- Replay + MAE/MFE ----------------
@router.get("/trades/{trade_id}/replay")
def trade_replay(trade_id: int, before_h: float = 3, after_h: float = 2, db: Session = Depends(get_db)):
    trade = db.get(Trade, trade_id)
    if trade is None:
        raise HTTPException(404, "Trade not found")
    return replay(db, trade, _setting(db, "display_timezone", "Asia/Kolkata"), before_h, after_h)


@router.get("/review/mae-mfe")
def mae_mfe(
    db: Session = Depends(get_db),
    adverse_r: float = 0.5,
    date_from: date | None = None,
    date_to: date | None = None,
    account_id: int | None = None,
    instrument_id: int | None = None,
    currency: str | None = None,
    style: str | None = None,
    playbook: str | None = None,
    include_demo: bool = True,
):
    trades = filtered_trades(db, date_from=date_from, date_to=date_to, account_id=account_id,
                             instrument_id=instrument_id, currency=currency, style=style, playbook=playbook,
                             include_demo=include_demo)
    return excursions.analytics(db, trades, adverse_r)


# ---------------- Reports ----------------
class ReportRequest(BaseModel):
    period: str = "week"
    anchor: date
    account_id: int | None = None
    currency: str | None = None
    style: str | None = None
    playbook: str | None = None
    include_demo: bool = True


@router.get("/reports")
def report(
    anchor: date,
    period: str = "week",
    account_id: int | None = None,
    currency: str | None = None,
    style: str | None = None,
    playbook: str | None = None,
    include_demo: bool = True,
    db: Session = Depends(get_db),
):
    if period not in ("week", "month"):
        raise HTTPException(422, "period must be 'week' or 'month'")
    return build_report(db, period, anchor, account_id, currency, include_demo, style, playbook)


@router.post("/reports/ai-review")
def report_ai_review(payload: ReportRequest, db: Session = Depends(get_db)):
    rep = build_report(db, payload.period, payload.anchor, payload.account_id,
                       payload.currency, payload.include_demo, payload.style, payload.playbook)
    try:
        return ai_review(rep, _setting(db, "ai_review", {}))
    except AIReviewError as exc:
        raise HTTPException(400, str(exc))


# ---------------- Indian charges ----------------
class ChargeLeg(BaseModel):
    price: Decimal
    quantity: Decimal


class ChargeRequest(BaseModel):
    instrument_id: int
    direction: str = "long"
    entries: list[ChargeLeg] = []
    exits: list[ChargeLeg] = []


@router.post("/charges/estimate")
def charges_estimate(payload: ChargeRequest, db: Session = Depends(get_db)):
    inst = db.get(Instrument, payload.instrument_id)
    if inst is None:
        raise HTTPException(404, "Instrument not found")
    cfg_all = _setting(db, "india_charges", {})
    cfg = cfg_all.get(inst.exchange)
    if inst.currency != "INR" or not cfg:
        raise HTTPException(422, f"No Indian charge schedule for {inst.exchange}")
    pv = Decimal(inst.point_value)
    entry_vals = [leg.price * pv * leg.quantity for leg in payload.entries]
    exit_vals = [leg.price * pv * leg.quantity for leg in payload.exits]
    buys, sells = (entry_vals, exit_vals) if payload.direction == "long" else (exit_vals, entry_vals)
    result = estimate(cfg, buys, sells)
    result["verified"] = bool(cfg_all.get("verified"))
    result["exchange_name"] = inst.exchange
    return result
