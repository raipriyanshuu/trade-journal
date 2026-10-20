"""Tags: list and create (full management arrives in Phase 3)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Tag
from app.models.tag import TAG_CATEGORIES, trade_tags
from app.schemas.common import ORMModel

router = APIRouter(prefix="/api/tags", tags=["tags"])


class TagRead(ORMModel):
    id: int
    name: str
    category: str
    archived: bool


class TagCreate(ORMModel):
    name: str
    category: str = "custom"


class TagUpdate(ORMModel):
    name: str | None = None
    category: str | None = None
    archived: bool | None = None


@router.get("", response_model=list[TagRead])
def list_tags(include_archived: bool = False, db: Session = Depends(get_db)):
    stmt = select(Tag).order_by(Tag.category, Tag.name)
    if not include_archived:
        stmt = stmt.where(Tag.archived.is_(False))
    return list(db.scalars(stmt))


@router.post("", response_model=TagRead, status_code=201)
def create_tag(payload: TagCreate, db: Session = Depends(get_db)):
    if payload.category not in TAG_CATEGORIES:
        raise HTTPException(422, f"category must be one of {TAG_CATEGORIES}")
    name = " ".join(payload.name.split())
    if not name:
        raise HTTPException(422, "Tag name can't be empty")
    # Reuse an existing tag that differs only in case ("fomo" == "FOMO"), and
    # bring it back if it was archived -- the user clearly wants to use it.
    existing = db.scalar(
        select(Tag).where(func.lower(Tag.name) == name.lower(), Tag.category == payload.category)
    )
    if existing:
        if existing.archived:
            existing.archived = False
            db.commit()
            db.refresh(existing)
        return existing
    tag = Tag(name=name, category=payload.category)
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return tag


@router.patch("/{tag_id}", response_model=TagRead)
def update_tag(tag_id: int, payload: TagUpdate, db: Session = Depends(get_db)):
    tag = db.get(Tag, tag_id)
    if tag is None:
        raise HTTPException(404, "Tag not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(tag, field, value)
    db.commit()
    db.refresh(tag)
    return tag


@router.post("/{tag_id}/merge/{into_id}", response_model=TagRead)
def merge_tag(tag_id: int, into_id: int, db: Session = Depends(get_db)):
    """Move every trade from tag_id onto into_id, then delete tag_id."""
    if tag_id == into_id:
        raise HTTPException(422, "Pick two different tags to merge")
    src = db.get(Tag, tag_id)
    dst = db.get(Tag, into_id)
    if src is None or dst is None:
        raise HTTPException(404, "Tag not found")
    trade_ids = [r[0] for r in db.execute(
        select(trade_tags.c.trade_id).where(trade_tags.c.tag_id == tag_id)
    ).all()]
    for tid in trade_ids:
        exists = db.scalar(
            select(trade_tags.c.tag_id).where(
                trade_tags.c.trade_id == tid, trade_tags.c.tag_id == into_id
            )
        )
        if not exists:
            db.execute(trade_tags.insert().values(trade_id=tid, tag_id=into_id))
    db.execute(trade_tags.delete().where(trade_tags.c.tag_id == tag_id))
    db.delete(src)
    db.commit()
    db.refresh(dst)
    return dst


@router.delete("/{tag_id}", status_code=204)
def delete_tag(tag_id: int, db: Session = Depends(get_db)):
    tag = db.get(Tag, tag_id)
    if tag is None:
        raise HTTPException(404, "Tag not found")
    db.execute(trade_tags.delete().where(trade_tags.c.tag_id == tag_id))
    db.delete(tag)
    db.commit()
