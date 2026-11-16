"""Prop Tracker API: status of every prop account, its history, and the costs/payouts ledger."""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.prop import evaluate, ledger_totals
from app.core.sessions import trading_date_for
from app.db import get_db
from app.models import Account, Instrument, Setting, Trade
from app.models.account import PROP_STATUSES
from app.models.prop import LEDGER_KINDS, PropLedgerEntry
from app.schemas.account import AccountRead

router = APIRouter(tags=["prop"])
PROP_TYPES = ("prop_eval", "prop_funded")


def today_for(db: Session, acc: Account, trades: list[Trade]) -> date:
    """Today's *trading* date for the account (CME days start the evening before)."""
    now = datetime.now(timezone.utc)
    if trades:
        inst = db.get(Instrument, max(trades, key=lambda t: t.open_time).instrument_id)
        if inst is not None:
            return trading_date_for(now, inst)
    s = db.get(Setting, "display_timezone")
    return now.astimezone(ZoneInfo(s.value if s and s.value else "Asia/Kolkata")).date()


def _ledger(db: Session, account_id: int) -> list[PropLedgerEntry]:
    return list(db.scalars(select(PropLedgerEntry).where(PropLedgerEntry.account_id == account_id)
                           .order_by(PropLedgerEntry.entry_date, PropLedgerEntry.id)))


def _status(db: Session, acc: Account, history: bool) -> dict:
    trades = list(db.scalars(select(Trade).where(Trade.account_id == acc.id)))
    ledger = _ledger(db, acc.id)
    ev = evaluate(acc, trades, ledger, today_for(db, acc, trades))
    if not history:
        ev.pop("history")
    return {
        "account": AccountRead.model_validate(acc).model_dump(),
        "status": ev,
        "ledger_totals": ledger_totals(ledger),
        **({"ledger": [_entry(e) for e in ledger]} if history else {}),
    }


def _entry(e: PropLedgerEntry) -> dict:
    return {"id": e.id, "account_id": e.account_id, "entry_date": e.entry_date, "kind": e.kind,
            "amount": float(e.amount), "note": e.note}


def _prop_or_404(db: Session, account_id: int) -> Account:
    acc = db.get(Account, account_id)
    if acc is None:
        raise HTTPException(404, "Account not found")
    if acc.type not in PROP_TYPES:
        raise HTTPException(422, "This isn't a prop account (set its type to prop evaluation or funded)")
    return acc


@router.get("/api/prop/accounts")
def list_prop_accounts(db: Session = Depends(get_db), include_inactive: bool = True) -> dict:
    q = select(Account).where(Account.type.in_(PROP_TYPES)).order_by(Account.active.desc(), Account.name)
    if not include_inactive:
        q = q.where(Account.active.is_(True))
    rows = [_status(db, a, history=False) for a in db.scalars(q)]
    all_ledger = list(db.scalars(select(PropLedgerEntry).where(
        PropLedgerEntry.account_id.in_([r["account"]["id"] for r in rows] or [0]))))
    counts: dict[str, int] = {}
    for r in rows:
        counts[r["status"]["status"]] = counts.get(r["status"]["status"], 0) + 1
    trading_pnl = sum((Decimal(str(r["status"]["profit"] or 0)) for r in rows), Decimal("0"))
    return {"accounts": rows, "totals": {**ledger_totals(all_ledger), "by_status": counts,
                                          "trading_profit": float(trading_pnl)}}


@router.get("/api/prop/accounts/{account_id}")
def prop_account(account_id: int, db: Session = Depends(get_db)) -> dict:
    return _status(db, _prop_or_404(db, account_id), history=True)


class LedgerIn(BaseModel):
    entry_date: date
    kind: str
    amount: Decimal = Field(gt=0)
    note: str = ""


@router.post("/api/prop/accounts/{account_id}/ledger", status_code=201)
def add_ledger(account_id: int, p: LedgerIn, db: Session = Depends(get_db)) -> dict:
    _prop_or_404(db, account_id)
    if p.kind not in LEDGER_KINDS:
        raise HTTPException(422, f"kind must be one of {', '.join(LEDGER_KINDS)}")
    e = PropLedgerEntry(account_id=account_id, entry_date=p.entry_date, kind=p.kind, amount=p.amount, note=p.note.strip())
    db.add(e)
    db.commit()
    return _entry(e)


@router.delete("/api/prop/ledger/{entry_id}", status_code=204)
def delete_ledger(entry_id: int, db: Session = Depends(get_db)):
    e = db.get(PropLedgerEntry, entry_id)
    if e is None:
        raise HTTPException(404, "Entry not found")
    db.delete(e)
    db.commit()


@router.post("/api/accounts/{account_id}/duplicate", response_model=AccountRead, status_code=201)
def duplicate_account(account_id: int, db: Session = Depends(get_db)):
    """Same rules, new name, no trades: for the next evaluation at the same firm."""
    src = db.get(Account, account_id)
    if src is None:
        raise HTTPException(404, "Account not found")
    names = {a.name.lower() for a in db.scalars(select(Account))}
    n, name = 2, f"{src.name} (2)"
    while name.lower() in names:
        n += 1
        name = f"{src.name} ({n})"
    copy = Account(
        name=name, platform=src.platform, type=src.type, currency=src.currency,
        starting_balance=src.starting_balance, active=True, account_size=src.account_size,
        profit_target=src.profit_target, daily_loss_limit=src.daily_loss_limit,
        max_drawdown_type=src.max_drawdown_type, max_drawdown_amount=src.max_drawdown_amount,
        consistency_pct=src.consistency_pct, min_trading_days=src.min_trading_days,
        max_contracts=src.max_contracts, firm=src.firm, drawdown_lock_at=src.drawdown_lock_at,
        prop_start_date=None, prop_status=None,
    )
    db.add(copy)
    db.commit()
    db.refresh(copy)
    return copy


def check_prop_fields(data: dict) -> None:
    """Validation shared with account create/update."""
    if data.get("prop_status") is not None and data["prop_status"] not in PROP_STATUSES:
        raise HTTPException(422, f"prop_status must be one of {', '.join(PROP_STATUSES)}")
    from app.models.account import ACCOUNT_TYPES, MAX_DD_TYPES

    if data.get("type") is not None and data["type"] not in ACCOUNT_TYPES:
        raise HTTPException(422, f"type must be one of {', '.join(ACCOUNT_TYPES)}")
    if data.get("max_drawdown_type") is not None and data["max_drawdown_type"] not in MAX_DD_TYPES:
        raise HTTPException(422, f"max_drawdown_type must be one of {', '.join(MAX_DD_TYPES)}")
