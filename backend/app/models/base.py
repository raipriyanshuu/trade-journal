"""Declarative base and shared mixins."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Boolean, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.types import UTCDateTime


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utcnow, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utcnow, onupdate=utcnow, server_default=func.now(), nullable=False
    )


class DemoMixin:
    """Marks rows created by the demo-data loader so they can be fully removed."""

    is_demo: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
