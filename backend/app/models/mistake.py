"""Mistake flags: auto (from the engine) or manual, with a dismissed flag."""

from __future__ import annotations

from datetime import date

from sqlalchemy import Boolean, Date, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, DemoMixin, TimestampMixin

FLAG_SOURCES = ("auto", "manual")


class MistakeFlag(Base, TimestampMixin, DemoMixin):
    __tablename__ = "mistake_flags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    trade_id: Mapped[int | None] = mapped_column(
        ForeignKey("trades.id", ondelete="CASCADE"), nullable=True, index=True
    )
    account_id: Mapped[int | None] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), nullable=True, index=True
    )
    session_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)

    rule_code: Mapped[str] = mapped_column(String, nullable=False, index=True)
    source: Mapped[str] = mapped_column(String, nullable=False, default="auto")
    details: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # A dismissed auto-flag (false positive) stays dismissed through rebuilds.
    dismissed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
