"""Trade endpoints: list (filterable), detail, manual entry, edit, delete.

Manual entry creates executions and then runs the trade builder -- the same
pipeline as imports. Edits and deletes re-run the builder for the affected
account+instrument so trades, P&L and (later) mistakes stay consistent.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.mistakes import recompute_for_account
from app.core.results import breakeven_threshold, serialize_detail, serialize_summary, trade_result
from app.core.trade_builder import rebuild_for
from app.db import get_db
from app.models import Account, Execution, Instrument, Trade
from app.models.tag import trade_tags
from app.schemas.trade import (
    ManualTradeCreate,
    MissedTradeCreate,
    TradeDetail,
    TradeSummary,
    TradeUpdate,
)

router = APIRouter(prefix="/api/trades", tags=["trades"])


def _as_utc(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _get_trade_or_404(db: Session, trade_id: int) -> Trade:
    trade = db.get(Trade, trade_id)
    if trade is None:
        raise HTTPException(404, "Trade not found")
    return trade


@router.get("", response_model=list[TradeSummary])
def list_trades(
    db: Session = Depends(get_db),
    date_from: date | None = None,
    date_to: date | None = None,
    account_id: int | None = None,
    instrument_id: int | None = None,
    direction: str | None = None,
    result: str | None = Query(None, description="win|loss|breakeven|open"),
    status: str | None = None,
    scenario: str | None = None,
    source: str | None = None,
    tag_id: int | None = None,
    include_demo: bool = True,
    sort_by: str = "open_time",
    order: str = "desc",
):
    stmt = select(Trade)
    if date_from:
        stmt = stmt.where(Trade.trading_date >= date_from)
    if date_to:
        stmt = stmt.where(Trade.trading_date <= date_to)
    if account_id:
        stmt = stmt.where(Trade.account_id == account_id)
    if instrument_id:
        stmt = stmt.where(Trade.instrument_id == instrument_id)
    if direction:
        stmt = stmt.where(Trade.direction == direction)
    if status:
        stmt = stmt.where(Trade.status == status)
    if scenario:
        stmt = stmt.where(Trade.scenario == scenario)
    if source:
        stmt = stmt.where(Trade.source == source)
    if not include_demo:
        stmt = stmt.where(Trade.is_demo.is_(False))
    if tag_id:
        stmt = stmt.where(Trade.id.in_(select(trade_tags.c.trade_id).where(trade_tags.c.tag_id == tag_id)))

    sort_col = getattr(Trade, sort_by, Trade.open_time)
    stmt = stmt.order_by(sort_col.desc() if order == "desc" else sort_col.asc())

    trades = db.scalars(stmt).all()
    thresholds: dict[str, Decimal] = {}
    rows = []
    for t in trades:
        if t.currency not in thresholds:
            thresholds[t.currency] = breakeven_threshold(db, t.currency)
        row = serialize_summary(db, t, thresholds[t.currency])
        if result and row["result"] != result:
            continue
        rows.append(row)
    return rows


class BulkTagRequest(BaseModel):
    trade_ids: list[int]
    add: list[int] = []
    remove: list[int] = []


@router.post("/bulk-tag")
def bulk_tag(payload: BulkTagRequest, db: Session = Depends(get_db)) -> dict:
    for trade_id in payload.trade_ids:
        for tag_id in payload.add:
            exists = db.scalar(
                select(trade_tags.c.tag_id).where(
                    trade_tags.c.trade_id == trade_id, trade_tags.c.tag_id == tag_id
                )
            )
            if not exists:
                db.execute(trade_tags.insert().values(trade_id=trade_id, tag_id=tag_id))
        for tag_id in payload.remove:
            db.execute(
                trade_tags.delete().where(
                    trade_tags.c.trade_id == trade_id, trade_tags.c.tag_id == tag_id
                )
            )
    db.commit()
    return {"updated": len(payload.trade_ids)}


@router.get("/{trade_id}", response_model=TradeDetail)
def get_trade(trade_id: int, db: Session = Depends(get_db)):
    return serialize_detail(db, _get_trade_or_404(db, trade_id))


@router.post("/manual", response_model=TradeDetail, status_code=201)
def create_manual(payload: ManualTradeCreate, db: Session = Depends(get_db)):
    acc = db.get(Account, payload.account_id)
    if acc is None:
        raise HTTPException(404, "Account not found")
    inst = db.get(Instrument, payload.instrument_id)
    if inst is None:
        raise HTTPException(404, "Instrument not found")
    if payload.direction not in ("long", "short"):
        raise HTTPException(422, "direction must be 'long' or 'short'")

    long = payload.direction == "long"
    entry_side = "buy" if long else "sell"
    exit_side = "sell" if long else "buy"

    legs = [(entry_side, leg) for leg in payload.entries] + [(exit_side, leg) for leg in payload.exits]

    created: list[Execution] = []
    for i, (side, leg) in enumerate(legs):
        ex = Execution(
            account_id=acc.id,
            instrument_id=inst.id,
            side=side,
            quantity=Decimal(leg.quantity),
            price=Decimal(leg.price),
            timestamp=_as_utc(leg.time),
            # Total trade fees go on the first execution; the builder sums them.
            fees=Decimal(payload.fees) if i == 0 else Decimal("0"),
            source="manual",
            time_known=payload.time_known,
            is_demo=False,
        )
        db.add(ex)
        created.append(ex)
    db.commit()

    first_entry_id = created[0].id
    rebuild_for(db, acc.id, inst.id)

    ex0 = db.get(Execution, first_entry_id)
    trade = db.get(Trade, ex0.trade_id) if ex0 and ex0.trade_id else None
    if trade is None:
        raise HTTPException(500, "Trade builder did not produce a trade")

    _apply_trade_meta(db, trade, payload)
    recompute_for_account(db, acc.id)
    return serialize_detail(db, _get_trade_or_404(db, trade.id))


def _apply_trade_meta(db: Session, trade: Trade, payload: ManualTradeCreate) -> None:
    trade.initial_stop = Decimal(payload.initial_stop) if payload.initial_stop is not None else None
    trade.planned_target = (
        Decimal(payload.planned_target) if payload.planned_target is not None else None
    )
    trade.planned_risk_amount = (
        Decimal(payload.planned_risk_amount) if payload.planned_risk_amount is not None else None
    )
    trade.scenario = payload.scenario
    trade.planned = payload.planned
    trade.checklist_score = payload.checklist_score
    trade.vwap_relation = payload.vwap_relation
    trade.entry_location = payload.entry_location
    trade.notes = payload.notes
    trade.self_rating = payload.self_rating
    _apply_journal_fields(trade, payload)
    _set_tags(db, trade, payload.tag_ids)
    db.commit()
    # Recompute R now that stop/risk are set.
    from app.core.trade_builder import recompute_trade_r

    recompute_trade_r(db, trade)


def _apply_journal_fields(trade: Trade, payload) -> None:
    trade.dtr = Decimal(payload.dtr) if payload.dtr is not None else None
    trade.atr = Decimal(payload.atr) if payload.atr is not None else None
    trade.entry_quality = payload.entry_quality
    trade.exit_quality = payload.exit_quality
    trade.htf_alignment = payload.htf_alignment
    trade.context = payload.context
    trade.behaviour = payload.behaviour
    trade.partial_profit = payload.partial_profit


@router.post("/missed", response_model=TradeDetail, status_code=201)
def create_missed(payload: MissedTradeCreate, db: Session = Depends(get_db)):
    """Log a setup you saw but did not take (no executions, no P&L)."""
    from app.core.sessions import trading_date_for

    acc = db.get(Account, payload.account_id)
    inst = db.get(Instrument, payload.instrument_id)
    if acc is None or inst is None:
        raise HTTPException(404, "Account or instrument not found")
    if payload.direction not in ("long", "short"):
        raise HTTPException(422, "direction must be 'long' or 'short'")
    ts = _as_utc(payload.time)
    trade = Trade(
        account_id=acc.id, instrument_id=inst.id, direction=payload.direction,
        open_time=ts, close_time=None, trading_date=trading_date_for(ts, inst),
        max_position_size=Decimal(payload.quantity), currency=inst.currency,
        first_entry_price=Decimal(payload.planned_entry) if payload.planned_entry is not None else None,
        initial_stop=Decimal(payload.initial_stop) if payload.initial_stop is not None else None,
        planned_target=Decimal(payload.planned_target) if payload.planned_target is not None else None,
        status="missed", outcome="missed", source="manual", scenario=payload.scenario,
        notes=payload.notes, gross_pnl=Decimal("0"), fees=Decimal("0"), net_pnl=Decimal("0"),
    )
    # Potential R the missed setup offered (target distance / stop distance).
    if trade.first_entry_price is not None and trade.initial_stop is not None and trade.planned_target is not None:
        risk = abs(trade.first_entry_price - trade.initial_stop)
        if risk > 0:
            from app.core.money import q_price

            trade.r_multiple = q_price(abs(trade.planned_target - trade.first_entry_price) / risk)
    _apply_journal_fields(trade, payload)
    db.add(trade)
    db.flush()
    _set_tags(db, trade, payload.tag_ids)
    db.commit()
    return serialize_detail(db, _get_trade_or_404(db, trade.id))


def _set_tags(db: Session, trade: Trade, tag_ids: list[int]) -> None:
    db.execute(trade_tags.delete().where(trade_tags.c.trade_id == trade.id))
    for tag_id in tag_ids or []:
        db.execute(trade_tags.insert().values(trade_id=trade.id, tag_id=tag_id))


@router.patch("/{trade_id}", response_model=TradeDetail)
def update_trade(trade_id: int, payload: TradeUpdate, db: Session = Depends(get_db)):
    trade = _get_trade_or_404(db, trade_id)
    data = payload.model_dump(exclude_unset=True)
    tag_ids = data.pop("tag_ids", None)
    for field, value in data.items():
        setattr(trade, field, value)
    if tag_ids is not None:
        _set_tags(db, trade, tag_ids)
    db.commit()
    from app.core.trade_builder import recompute_trade_r

    recompute_trade_r(db, trade)
    recompute_for_account(db, trade.account_id)
    return serialize_detail(db, _get_trade_or_404(db, trade_id))


@router.delete("/{trade_id}", status_code=204)
def delete_trade(trade_id: int, db: Session = Depends(get_db)):
    trade = _get_trade_or_404(db, trade_id)
    account_id, instrument_id = trade.account_id, trade.instrument_id
    # Remove this trade's executions, then rebuild the pair.
    for ex in db.scalars(select(Execution).where(Execution.trade_id == trade.id)):
        db.delete(ex)
    db.delete(trade)
    db.commit()
    rebuild_for(db, account_id, instrument_id)
    recompute_for_account(db, account_id)
