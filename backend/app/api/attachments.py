"""Screenshot attachments for trades (upload, paste-from-clipboard, delete)."""

from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from sqlalchemy import select

from app.config import settings
from app.db import get_db
from app.models import Attachment, DailySession, Trade
from app.schemas.trade import AttachmentRead

router = APIRouter(prefix="/api", tags=["attachments"])

_ALLOWED = {"image/png", "image/jpeg", "image/gif", "image/webp"}
_EXT = {"image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp"}


@router.post("/trades/{trade_id}/attachments", response_model=AttachmentRead, status_code=201)
async def upload_trade_attachment(
    trade_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)
):
    trade = db.get(Trade, trade_id)
    if trade is None:
        raise HTTPException(404, "Trade not found")
    content_type = file.content_type or "application/octet-stream"
    if content_type not in _ALLOWED:
        raise HTTPException(415, f"Unsupported image type: {content_type}")

    settings.ensure_dirs()
    ext = _EXT.get(content_type, Path(file.filename or "").suffix or ".bin")
    name = f"{uuid.uuid4().hex}{ext}"
    dest = settings.attachments_dir / name
    data = await file.read()
    dest.write_bytes(data)

    att = Attachment(
        trade_id=trade_id,
        file_path=name,
        original_name=file.filename,
        mime_type=content_type,
        is_demo=trade.is_demo,
    )
    db.add(att)
    db.commit()
    db.refresh(att)
    return att


async def _save_upload(file: UploadFile) -> tuple[str, str]:
    content_type = file.content_type or "application/octet-stream"
    if content_type not in _ALLOWED:
        raise HTTPException(415, f"Unsupported image type: {content_type}")
    settings.ensure_dirs()
    ext = _EXT.get(content_type, Path(file.filename or "").suffix or ".bin")
    name = f"{uuid.uuid4().hex}{ext}"
    (settings.attachments_dir / name).write_bytes(await file.read())
    return name, content_type


@router.get("/journal/{session_id}/attachments", response_model=list[AttachmentRead])
def list_journal_attachments(session_id: int, db: Session = Depends(get_db)):
    return list(
        db.scalars(select(Attachment).where(Attachment.daily_session_id == session_id))
    )


@router.post("/journal/{session_id}/attachments", response_model=AttachmentRead, status_code=201)
async def upload_journal_attachment(
    session_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)
):
    sess = db.get(DailySession, session_id)
    if sess is None:
        raise HTTPException(404, "Journal entry not found")
    name, content_type = await _save_upload(file)
    att = Attachment(
        daily_session_id=session_id, file_path=name, original_name=file.filename,
        mime_type=content_type, is_demo=sess.is_demo,
    )
    db.add(att)
    db.commit()
    db.refresh(att)
    return att


@router.delete("/attachments/{attachment_id}", status_code=204)
def delete_attachment(attachment_id: int, db: Session = Depends(get_db)):
    att = db.get(Attachment, attachment_id)
    if att is None:
        raise HTTPException(404, "Attachment not found")
    file_path = settings.attachments_dir / att.file_path
    db.delete(att)
    db.commit()
    try:
        file_path.unlink(missing_ok=True)
    except OSError:
        pass


ANNOTATION_TYPES = {"pen", "line", "arrow", "box", "circle", "text"}


class AnnotationsIn(BaseModel):
    shapes: list[dict]


@router.put("/attachments/{attachment_id}/annotations", response_model=AttachmentRead)
def save_annotations(attachment_id: int, payload: AnnotationsIn, db: Session = Depends(get_db)):
    """Drawings on a screenshot, stored next to it (the image file is untouched)."""
    att = db.get(Attachment, attachment_id)
    if att is None:
        raise HTTPException(404, "Attachment not found")
    if len(payload.shapes) > 500:
        raise HTTPException(422, "Too many drawings on one screenshot")
    clean = []
    for s in payload.shapes:
        if s.get("type") not in ANNOTATION_TYPES:
            raise HTTPException(422, f"Unknown drawing type: {s.get('type')}")
        if s["type"] == "text" and len(str(s.get("text", ""))) > 500:
            raise HTTPException(422, "Text is too long")
        if s["type"] == "pen" and len(s.get("points") or []) > 4000:
            raise HTTPException(422, "Pen stroke is too long")
        clean.append({k: s[k] for k in ("id", "type", "x1", "y1", "x2", "y2", "points", "text", "color", "size")
                      if k in s})
    att.annotations = clean
    db.commit()
    db.refresh(att)
    return att
