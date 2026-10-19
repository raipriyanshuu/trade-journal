"""Import endpoints: preview, run, batch history/undo, mapping profiles."""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.importing import run_import, sniff_csv, undo_batch
from app.db import get_db
from app.models import ImportBatch, MappingProfile
from app.schemas.importing import (
    ImportBatchRead,
    ImportResult,
    MappingProfileCreate,
    MappingProfileRead,
    PreviewResponse,
)

router = APIRouter(prefix="/api/import", tags=["import"])


@router.post("/preview", response_model=PreviewResponse)
async def preview(file: UploadFile = File(...)):
    content = await file.read()
    return sniff_csv(content)


@router.post("/run", response_model=ImportResult)
async def run(file: UploadFile = File(...), config: str = Form(...), db: Session = Depends(get_db)):
    try:
        cfg = json.loads(config)
    except json.JSONDecodeError:
        raise HTTPException(422, "config must be valid JSON")
    if "account_id" not in cfg:
        raise HTTPException(422, "config.account_id is required")
    cfg["filename"] = file.filename
    content = await file.read()
    return run_import(db, content=content, config=cfg)


@router.get("/batches", response_model=list[ImportBatchRead])
def list_batches(db: Session = Depends(get_db)):
    return list(db.scalars(select(ImportBatch).order_by(ImportBatch.created_at.desc())))


@router.delete("/batches/{batch_id}")
def delete_batch(batch_id: int, db: Session = Depends(get_db)):
    result = undo_batch(db, batch_id)
    if result["status"] == "not_found":
        raise HTTPException(404, "Batch not found")
    return result


@router.get("/profiles", response_model=list[MappingProfileRead])
def list_profiles(db: Session = Depends(get_db)):
    return list(db.scalars(select(MappingProfile).order_by(MappingProfile.name)))


@router.post("/profiles", response_model=MappingProfileRead, status_code=201)
def save_profile(payload: MappingProfileCreate, db: Session = Depends(get_db)):
    existing = db.scalar(select(MappingProfile).where(MappingProfile.name == payload.name))
    if existing:
        existing.format = payload.format
        existing.config = payload.config
        db.commit()
        db.refresh(existing)
        return existing
    profile = MappingProfile(name=payload.name, format=payload.format, config=payload.config)
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return profile


@router.delete("/profiles/{profile_id}", status_code=204)
def delete_profile(profile_id: int, db: Session = Depends(get_db)):
    profile = db.get(MappingProfile, profile_id)
    if profile is None:
        raise HTTPException(404, "Profile not found")
    db.delete(profile)
    db.commit()
