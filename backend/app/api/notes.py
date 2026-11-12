"""Notes: learning notes with screenshots, plus a spaced-repetition review deck."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.attachments import _save_upload
from app.config import settings
from app.db import get_db
from app.models import Attachment, Instrument, Note, Setting, Trade
from app.models.note import MASTERED_BOX, NOTE_TYPES, REVIEW_INTERVALS
from app.schemas.trade import AttachmentRead

router = APIRouter(prefix="/api/notes", tags=["notes"])

# Lessons and mistakes join the review deck unless you say otherwise.
REVIEW_BY_DEFAULT = {"lesson", "mistake"}


def today(db: Session) -> date:
    """Today in the display time zone (so 'due today' matches your morning)."""
    s = db.get(Setting, "display_timezone")
    tz = s.value if s and s.value else "Asia/Kolkata"
    return datetime.now(ZoneInfo(tz)).date()


def _serialize(n: Note) -> dict:
    return {
        "id": n.id, "title": n.title, "body": n.body, "note_type": n.note_type, "pinned": n.pinned,
        "note_date": n.note_date, "instrument_id": n.instrument_id,
        "symbol": n.instrument.symbol_root if n.instrument else None,
        "trade_id": n.trade_id,
        "in_review": n.in_review, "review_box": n.review_box, "next_review": n.next_review,
        "mastered": n.review_box >= MASTERED_BOX, "times_reviewed": n.times_reviewed,
        "times_got_it": n.times_got_it,
        "created_at": n.created_at, "updated_at": n.updated_at,
        "attachments": [AttachmentRead.model_validate(a).model_dump() for a in n.attachments],
    }


def _get(db: Session, nid: int) -> Note:
    n = db.get(Note, nid)
    if n is None:
        raise HTTPException(404, "Note not found")
    return n


class NoteIn(BaseModel):
    title: str = ""
    body: str = ""
    note_type: str = "note"
    pinned: bool = False
    in_review: bool | None = None  # None = default for the type
    note_date: date | None = None
    instrument_id: int | None = None
    trade_id: int | None = None


class NotePatch(BaseModel):
    title: str | None = None
    body: str | None = None
    note_type: str | None = None
    pinned: bool | None = None
    in_review: bool | None = None
    note_date: date | None = None
    instrument_id: int | None = None
    trade_id: int | None = None


def _check(db: Session, data: dict) -> None:
    if "note_type" in data and data["note_type"] not in NOTE_TYPES:
        raise HTTPException(422, f"note_type must be one of {', '.join(NOTE_TYPES)}")
    if data.get("instrument_id") is not None and db.get(Instrument, data["instrument_id"]) is None:
        raise HTTPException(422, "Instrument not found")
    if data.get("trade_id") is not None and db.get(Trade, data["trade_id"]) is None:
        raise HTTPException(422, "Trade not found")


@router.get("")
def list_notes(
    db: Session = Depends(get_db),
    note_type: str | None = None,
    q: str | None = None,
    pinned: bool | None = None,
    in_review: bool | None = None,
    instrument_id: int | None = None,
) -> list[dict]:
    stmt = select(Note)
    if note_type:
        stmt = stmt.where(Note.note_type == note_type)
    if pinned is not None:
        stmt = stmt.where(Note.pinned.is_(pinned))
    if in_review is not None:
        stmt = stmt.where(Note.in_review.is_(in_review))
    if instrument_id:
        stmt = stmt.where(Note.instrument_id == instrument_id)
    if q and q.strip():
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(or_(func.lower(Note.title).like(like), func.lower(Note.body).like(like)))
    stmt = stmt.order_by(Note.pinned.desc(), Note.note_date.desc(), Note.id.desc())
    return [_serialize(n) for n in db.scalars(stmt)]


@router.post("", status_code=201)
def create_note(p: NoteIn, db: Session = Depends(get_db)) -> dict:
    data = p.model_dump()
    _check(db, data)
    if not (p.title.strip() or p.body.strip()):
        # A screenshot-only note still needs something to show on the card.
        data["title"] = {"mistake": "Mistake", "lesson": "Lesson", "idea": "Idea",
                         "observation": "Observation"}.get(p.note_type, "Note")
    in_review = p.in_review if p.in_review is not None else p.note_type in REVIEW_BY_DEFAULT
    n = Note(
        title=data["title"].strip(), body=p.body, note_type=p.note_type, pinned=p.pinned,
        note_date=p.note_date or today(db), instrument_id=p.instrument_id, trade_id=p.trade_id,
        in_review=in_review, next_review=today(db) + timedelta(days=1) if in_review else None,
    )
    db.add(n)
    db.commit()
    return _serialize(db.get(Note, n.id))


@router.patch("/{nid}")
def update_note(nid: int, p: NotePatch, db: Session = Depends(get_db)) -> dict:
    n = _get(db, nid)
    data = p.model_dump(exclude_unset=True)
    _check(db, data)
    for k, v in data.items():
        if k == "title" and v is not None:
            v = v.strip()
        setattr(n, k, v)
    if data.get("in_review") and n.next_review is None:
        n.next_review = today(db)  # newly added to the deck: review it today
    db.commit()
    return _serialize(n)


@router.delete("/{nid}", status_code=204)
def delete_note(nid: int, db: Session = Depends(get_db)):
    n = _get(db, nid)
    for a in list(n.attachments):
        path = settings.attachments_dir / a.file_path
        db.delete(a)
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass
    db.delete(n)
    db.commit()


@router.post("/{nid}/attachments", response_model=AttachmentRead, status_code=201)
async def upload_note_attachment(nid: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    _get(db, nid)
    name, content_type = await _save_upload(file)
    att = Attachment(note_id=nid, file_path=name, original_name=file.filename, mime_type=content_type)
    db.add(att)
    db.commit()
    db.refresh(att)
    return att


# ------------------------------------------------------------------ review deck
@router.get("/review/due")
def review_due(db: Session = Depends(get_db), limit: int = 10) -> dict:
    t = today(db)
    deck = select(Note).where(Note.in_review.is_(True))
    due = db.scalars(
        deck.where(or_(Note.next_review.is_(None), Note.next_review <= t))
        .order_by(Note.review_box, Note.next_review, Note.id).limit(limit)
    ).all()
    all_cards = db.scalars(deck).all()
    upcoming = min((n.next_review for n in all_cards if n.next_review and n.next_review > t), default=None)
    return {
        "today": t,
        "due": [_serialize(n) for n in due],
        "stats": {
            "due": sum(1 for n in all_cards if n.next_review is None or n.next_review <= t),
            "in_deck": len(all_cards),
            "mastered": sum(1 for n in all_cards if n.review_box >= MASTERED_BOX),
            "learning": sum(1 for n in all_cards if n.review_box < MASTERED_BOX),
            "next_due": upcoming,
        },
    }


class ReviewIn(BaseModel):
    result: str  # got_it | again


@router.post("/{nid}/review")
def review_note(nid: int, p: ReviewIn, db: Session = Depends(get_db)) -> dict:
    """Got it: next box, back in 1/2/4/8/16/32 days. Again: box 0, back tomorrow."""
    n = _get(db, nid)
    if p.result not in ("got_it", "again"):
        raise HTTPException(422, "result must be 'got_it' or 'again'")
    t = today(db)
    if p.result == "got_it":
        n.review_box = min(n.review_box + 1, len(REVIEW_INTERVALS) - 1)
        n.times_got_it += 1
        n.next_review = t + timedelta(days=REVIEW_INTERVALS[n.review_box])
    else:
        n.review_box = 0
        n.next_review = t + timedelta(days=1)
    n.times_reviewed += 1
    n.last_reviewed_at = datetime.now(timezone.utc)
    n.in_review = True
    db.commit()
    return _serialize(n)
