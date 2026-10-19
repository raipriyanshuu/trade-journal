"""Import batches and mapping profiles (used from Phase 2)."""

from __future__ import annotations

from sqlalchemy import JSON, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, DemoMixin, TimestampMixin

IMPORT_FORMATS = ("fills", "roundtrip")


class ImportBatch(Base, TimestampMixin, DemoMixin):
    __tablename__ = "import_batches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source: Mapped[str] = mapped_column(String, nullable=False, default="import")
    profile_name: Mapped[str | None] = mapped_column(String, nullable=True)
    filename: Mapped[str | None] = mapped_column(String, nullable=True)
    rows_read: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rows_imported: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rows_skipped: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rows_failed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String, nullable=False, default="completed")
    details: Mapped[str] = mapped_column(Text, nullable=False, default="")


class MappingProfile(Base, TimestampMixin):
    __tablename__ = "mapping_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    format: Mapped[str] = mapped_column(String, nullable=False, default="fills")
    config: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
