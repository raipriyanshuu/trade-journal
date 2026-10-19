"""Declarative base and shared mixins."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Boolean, MetaData, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.types import UTCDateTime


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# Naming convention so SQLite batch migrations always have named constraints.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


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
