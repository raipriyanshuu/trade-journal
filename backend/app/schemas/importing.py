"""Import / mapping-profile schemas."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from app.schemas.common import ORMModel


class PreviewResponse(BaseModel):
    headers: list[str]
    rows: list[dict]
    delimiter: str


class ImportResult(BaseModel):
    batch_id: int
    rows_read: int
    imported: int
    skipped: int
    failed: int
    errors: list[str]


class ImportBatchRead(ORMModel):
    id: int
    source: str
    profile_name: str | None
    filename: str | None
    rows_read: int
    rows_imported: int
    rows_skipped: int
    rows_failed: int
    status: str
    created_at: datetime


class MappingProfileCreate(BaseModel):
    name: str
    format: str = "fills"
    config: dict = {}


class MappingProfileRead(ORMModel):
    id: int
    name: str
    format: str
    config: dict
