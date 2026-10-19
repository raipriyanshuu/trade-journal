"""Tags: list and create (full management arrives in Phase 3)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Tag
from app.models.tag import TAG_CATEGORIES
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
    existing = db.scalar(
        select(Tag).where(Tag.name == payload.name, Tag.category == payload.category)
    )
    if existing:
        return existing
    tag = Tag(name=payload.name, category=payload.category)
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return tag
