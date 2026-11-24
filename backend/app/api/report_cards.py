"""Daily Report Card: the day's goal, segment grades, reflection and trade write-ups.

Shared with the Trading Day Review step (general session = no account, no instrument):
  grade         <-> daily_sessions.day_grade
  learned       <-> daily_sessions.key_lesson
  changes       <-> daily_sessions.what_to_change
  goal_tomorrow <-> daily_sessions.focus_tomorrow  (becomes the next card's goal)
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.results import breakeven_threshold, serialize_summary
from app.db import get_db
from app.models import Attachment, DailySession, ReportCard, Setting, Trade
from app.models.report_card import GOAL_RESULTS
from app.seeds import DEFAULT_SETTINGS

router = APIRouter(prefix="/api/report-cards", tags=["report-cards"])

GRADE_POINTS = {"A+": 4, "A": 3, "B": 2, "C": 1}


def points_to_grade(p: float) -> str:
    return "A+" if p >= 3.5 else "A" if p >= 2.5 else "B" if p >= 1.5 else "C"


def _norm(s: str) -> str:
    return " ".join(s.lower().split())


def config(db: Session) -> dict:
    s = db.get(Setting, "report_card")
    return s.value if s and isinstance(s.value, dict) else DEFAULT_SETTINGS["report_card"]


def _general(db: Session, d: date) -> DailySession | None:
    return db.scalar(select(DailySession).where(
        DailySession.trading_date == d, DailySession.account_id.is_(None), DailySession.instrument_id.is_(None)))


def _carry_over(db: Session, d: date) -> dict | None:
    """From the previous journaled day only (so an old goal doesn't come back weeks later):
    its goal for tomorrow, else its change to make, else that day's goal again."""
    s = db.scalar(select(DailySession).where(
        DailySession.trading_date < d, DailySession.account_id.is_(None), DailySession.instrument_id.is_(None))
        .order_by(DailySession.trading_date.desc()).limit(1))
    c = db.scalar(select(ReportCard).where(ReportCard.trading_date < d).order_by(ReportCard.trading_date.desc()).limit(1))
    day = max([x.trading_date for x in (s, c) if x is not None], default=None)
    if day is None:
        return None
    if s is not None and s.trading_date == day:
        for field, label in (("focus_tomorrow", "goal for tomorrow"), ("what_to_change", "change to make")):
            text = (getattr(s, field) or "").strip()
            if text:
                return {"text": text, "date": day, "from": label}
    if c is not None and c.trading_date == day and c.goal.strip():
        return {"text": c.goal.strip(), "date": day, "from": "same goal as that day"}
    return None


def _streak(db: Session, d: date, goal: str) -> int:
    """How many days in a row (ending on d) the card had this same goal."""
    if not goal.strip():
        return 0
    n = 1
    for c in db.scalars(select(ReportCard).where(ReportCard.trading_date < d).order_by(ReportCard.trading_date.desc())):
        if _norm(c.goal) != _norm(goal):
            break
        n += 1
    return n


def _day_net(trades: list[Trade]) -> dict[str, float]:
    net: dict[str, Decimal] = defaultdict(Decimal)
    for t in trades:
        if t.status == "closed" and t.pnl_known:
            net[t.currency] += Decimal(t.net_pnl)
    return {k: float(v) for k, v in net.items()}


def _blank_segments(db: Session) -> list[dict]:
    return [{"name": n, "grade": None, "cells": {}, "comment": ""} for n in config(db).get("segments", [])]


@router.get("/{d}")
def get_card(d: date, db: Session = Depends(get_db)) -> dict:
    card = db.scalar(select(ReportCard).where(ReportCard.trading_date == d))
    gs = _general(db, d)
    trades = list(db.scalars(select(Trade).where(Trade.trading_date == d).order_by(Trade.open_time)))
    thresholds: dict[str, Decimal] = {}
    rows = []
    for t in trades:
        if t.currency not in thresholds:
            thresholds[t.currency] = breakeven_threshold(db, t.currency)
        row = serialize_summary(db, t, thresholds[t.currency])
        row["notes"] = t.notes
        row["attachments"] = [
            {"id": a.id, "file_path": a.file_path, "original_name": a.original_name, "mime_type": a.mime_type,
             "annotations": a.annotations}
            for a in db.scalars(select(Attachment).where(Attachment.trade_id == t.id).order_by(Attachment.id))
        ]
        rows.append(row)

    carry = _carry_over(db, d)
    goal = card.goal if card else (carry["text"] if carry else "")
    prev_card = db.scalar(select(ReportCard.trading_date).where(ReportCard.trading_date < d)
                          .order_by(ReportCard.trading_date.desc()).limit(1))
    next_card = db.scalar(select(ReportCard.trading_date).where(ReportCard.trading_date > d)
                          .order_by(ReportCard.trading_date).limit(1))
    return {
        "date": d,
        "exists": card is not None,
        "goal": goal,
        "carried_over": carry,
        "goal_result": card.goal_result if card else None,
        "goal_streak": _streak(db, d, goal),
        "segments": card.segments if card else _blank_segments(db),
        "overview": card.overview if card else "",
        "easiest_money": card.easiest_money if card else "",
        "grade": gs.day_grade if gs else None,
        "learned": gs.key_lesson if gs else "",
        "changes": gs.what_to_change if gs else "",
        "goal_tomorrow": gs.focus_tomorrow if gs else "",
        "trades": rows,
        "net": _day_net(trades),
        "prev_card": prev_card,
        "next_card": next_card,
    }


class CardIn(BaseModel):
    goal: str = ""
    goal_result: str | None = None
    segments: list[dict] = []
    overview: str = ""
    easiest_money: str = ""
    grade: str | None = None
    learned: str = ""
    changes: str = ""
    goal_tomorrow: str = ""


@router.put("/{d}")
def save_card(d: date, p: CardIn, db: Session = Depends(get_db)) -> dict:
    if p.goal_result is not None and p.goal_result not in GOAL_RESULTS:
        raise HTTPException(422, f"goal_result must be one of {', '.join(GOAL_RESULTS)}")
    if p.grade is not None and p.grade not in GRADE_POINTS:
        raise HTTPException(422, f"grade must be one of {', '.join(GRADE_POINTS)}")
    segments = []
    for s in p.segments:
        g = s.get("grade") or None
        if g is not None and g not in GRADE_POINTS:
            raise HTTPException(422, f"Segment grade must be one of {', '.join(GRADE_POINTS)}")
        segments.append({"name": str(s.get("name", "")).strip(), "grade": g,
                         "cells": {str(k): str(v) for k, v in (s.get("cells") or {}).items() if v not in (None, "")},
                         "comment": str(s.get("comment") or "")})

    card = db.scalar(select(ReportCard).where(ReportCard.trading_date == d))
    if card is None:
        card = ReportCard(trading_date=d)
        db.add(card)
    card.goal, card.goal_result, card.segments = p.goal, p.goal_result, segments
    card.overview, card.easiest_money = p.overview, p.easiest_money

    gs = _general(db, d)
    if gs is None:
        gs = DailySession(trading_date=d, account_id=None, instrument_id=None)
        db.add(gs)
    gs.day_grade, gs.key_lesson, gs.what_to_change, gs.focus_tomorrow = p.grade, p.learned, p.changes, p.goal_tomorrow
    db.commit()
    return get_card(d, db)


@router.get("")
def list_cards(date_from: date, date_to: date, db: Session = Depends(get_db)) -> dict:
    """Calendar of grades + stats (goal hit rate, grade by segment, P&L by grade)."""
    cards = {c.trading_date: c for c in db.scalars(select(ReportCard).where(
        ReportCard.trading_date >= date_from, ReportCard.trading_date <= date_to))}
    sessions = {s.trading_date: s for s in db.scalars(select(DailySession).where(
        DailySession.trading_date >= date_from, DailySession.trading_date <= date_to,
        DailySession.account_id.is_(None), DailySession.instrument_id.is_(None)))}
    trades_by_day: dict[date, list[Trade]] = defaultdict(list)
    for t in db.scalars(select(Trade).where(Trade.trading_date >= date_from, Trade.trading_date <= date_to)):
        trades_by_day[t.trading_date].append(t)

    days = []
    seg_points: dict[str, list[int]] = defaultdict(list)
    goal_counts = {k: 0 for k in GOAL_RESULTS}
    by_grade: dict[str, dict] = {}
    for d in sorted(set(cards) | set(trades_by_day) | {k for k, s in sessions.items() if s.day_grade}):
        c, s, ts = cards.get(d), sessions.get(d), trades_by_day.get(d, [])
        grade = s.day_grade if s else None
        net = _day_net(ts)
        days.append({"date": d, "has_card": c is not None, "grade": grade,
                     "goal": c.goal if c else "", "goal_result": c.goal_result if c else None,
                     "net": net, "trades": sum(1 for t in ts if t.status == "closed")})
        if c:
            if c.goal_result in goal_counts:
                goal_counts[c.goal_result] += 1
            for seg in c.segments or []:
                if seg.get("grade") in GRADE_POINTS:
                    seg_points[seg["name"]].append(GRADE_POINTS[seg["grade"]])
        if grade:
            g = by_grade.setdefault(grade, {"grade": grade, "days": 0, "net": defaultdict(float)})
            g["days"] += 1
            for ccy, v in net.items():
                g["net"][ccy] += v

    segments = [{"name": n, "days": len(p), "avg": round(sum(p) / len(p), 2), "grade": points_to_grade(sum(p) / len(p))}
                for n, p in seg_points.items()]
    grades = [{"grade": g["grade"], "days": g["days"],
               "avg_net": {ccy: round(v / g["days"], 2) for ccy, v in g["net"].items()}}
              for g in sorted(by_grade.values(), key=lambda x: -GRADE_POINTS[x["grade"]])]
    rated = sum(goal_counts.values())
    return {"days": days, "stats": {
        "goal": {**goal_counts, "rated": rated,
                 "hit_rate": round((goal_counts["hit"] + 0.5 * goal_counts["partly"]) / rated * 100) if rated else None},
        "segments": segments, "grades": grades, "cards": len(cards)}}
