"""Playbooks: CRUD with rule checklists, stats, and assigning playbooks to trades."""

from __future__ import annotations

from collections import defaultdict
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.filters import filtered_trades
from app.core.playbooks import (
    PlaybookError, playbook_stats, rule_use_counts, serialize_playbook, set_trade_playbook, sync_rules,
)
from app.core.results import serialize_detail, serialize_summary
from app.db import get_db
from app.models import Playbook, Trade
from app.schemas.trade import TradeDetail

router = APIRouter(tags=["playbooks"])

COLORS = ("violet", "blue", "teal", "green", "amber", "orange", "red", "pink", "gray")


class RuleIn(BaseModel):
    id: int | None = None
    section: str = "Entry criteria"
    text: str


class PlaybookIn(BaseModel):
    name: str = Field(min_length=1)
    description: str = ""
    color: str = "violet"
    rules: list[RuleIn] = []


class PlaybookPatch(BaseModel):
    name: str | None = None
    description: str | None = None
    color: str | None = None
    archived: bool | None = None
    rules: list[RuleIn] | None = None


def _get(db: Session, pid: int) -> Playbook:
    pb = db.get(Playbook, pid)
    if pb is None:
        raise HTTPException(404, "Playbook not found")
    return pb


def _clean_name(db: Session, name: str, exclude_id: int | None = None) -> str:
    name = " ".join(name.split())
    if not name:
        raise HTTPException(422, "Give the playbook a name")
    for other in db.scalars(select(Playbook)):
        if other.id != exclude_id and other.name.lower() == name.lower():
            raise HTTPException(422, f'A playbook called "{other.name}" already exists')
    return name


def _color(c: str | None) -> str:
    return c if c in COLORS else "violet"


@router.get("/api/playbooks")
def list_playbooks(
    db: Session = Depends(get_db),
    include_archived: bool = False,
    date_from: date | None = None,
    date_to: date | None = None,
    account_id: int | None = None,
    include_demo: bool = True,
) -> list[dict]:
    q = select(Playbook).order_by(Playbook.archived, Playbook.name)
    if not include_archived:
        q = q.where(Playbook.archived.is_(False))
    pbs = db.scalars(q).all()
    by_pb: dict[int, list[Trade]] = defaultdict(list)
    for t in filtered_trades(db, date_from=date_from, date_to=date_to, account_id=account_id,
                             include_demo=include_demo):
        if t.playbook_id is not None:
            by_pb[t.playbook_id].append(t)
    return [{**serialize_playbook(pb), "stats": playbook_stats(pb, by_pb.get(pb.id, []))} for pb in pbs]


@router.post("/api/playbooks", status_code=201)
def create_playbook(p: PlaybookIn, db: Session = Depends(get_db)) -> dict:
    pb = Playbook(name=_clean_name(db, p.name), description=p.description.strip(), color=_color(p.color))
    db.add(pb)
    db.flush()
    try:
        sync_rules(db, pb, [r.model_dump() for r in p.rules])
    except PlaybookError as exc:
        raise HTTPException(422, str(exc))
    db.commit()
    return serialize_playbook(pb)


@router.get("/api/playbooks/{pid}")
def get_playbook(pid: int, db: Session = Depends(get_db), include_demo: bool = True,
                 date_from: date | None = None, date_to: date | None = None) -> dict:
    pb = _get(db, pid)
    trades = filtered_trades(db, playbook=str(pid), include_demo=include_demo,
                             date_from=date_from, date_to=date_to)
    uses = rule_use_counts(db, pb)
    out = serialize_playbook(pb)
    for r in out["rules"]:
        r["used_on"] = uses.get(r["id"], 0)
    out["stats"] = playbook_stats(pb, trades, full=True)
    out["trades"] = [serialize_summary(db, t)
                     for t in sorted(trades, key=lambda t: (t.trading_date, t.open_time), reverse=True)]
    return out


@router.put("/api/playbooks/{pid}")
def update_playbook(pid: int, p: PlaybookPatch, db: Session = Depends(get_db)) -> dict:
    pb = _get(db, pid)
    if p.name is not None:
        pb.name = _clean_name(db, p.name, exclude_id=pb.id)
    if p.description is not None:
        pb.description = p.description.strip()
    if p.color is not None:
        pb.color = _color(p.color)
    if p.archived is not None:
        pb.archived = p.archived
    if p.rules is not None:
        try:
            sync_rules(db, pb, [r.model_dump() for r in p.rules])
        except PlaybookError as exc:
            raise HTTPException(422, str(exc))
    db.commit()
    db.refresh(pb)
    return serialize_playbook(pb)


@router.post("/api/playbooks/{pid}/duplicate", status_code=201)
def duplicate_playbook(pid: int, db: Session = Depends(get_db)) -> dict:
    src = _get(db, pid)
    n, name = 2, f"{src.name} (copy)"
    while any(o.name.lower() == name.lower() for o in db.scalars(select(Playbook))):
        name = f"{src.name} (copy {n})"
        n += 1
    pb = Playbook(name=name, description=src.description, color=src.color)
    db.add(pb)
    db.flush()
    sync_rules(db, pb, [{"section": r.section, "text": r.text} for r in src.rules])
    db.commit()
    return serialize_playbook(pb)


@router.delete("/api/playbooks/{pid}", status_code=204)
def delete_playbook(pid: int, db: Session = Depends(get_db)):
    """Deletes the playbook and its rules; its trades stay, just unassigned."""
    pb = _get(db, pid)
    for t in db.scalars(select(Trade).where(Trade.playbook_id == pid)):
        t.playbook_id = None
    db.delete(pb)
    db.commit()


class TradePlaybookIn(BaseModel):
    playbook_id: int | None = None
    rule_ids: list[int] = []


@router.put("/api/trades/{tid}/playbook", response_model=TradeDetail)
def set_playbook_on_trade(tid: int, p: TradePlaybookIn, db: Session = Depends(get_db)):
    trade = db.get(Trade, tid)
    if trade is None:
        raise HTTPException(404, "Trade not found")
    try:
        set_trade_playbook(db, trade, p.playbook_id, p.rule_ids)
    except PlaybookError as exc:
        raise HTTPException(422, str(exc))
    db.commit()
    return serialize_detail(db, db.get(Trade, tid))
