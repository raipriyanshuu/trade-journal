"""Attachments: screenshots linked to trades or daily sessions (stored on disk)."""

from __future__ import annotations

from sqlalchemy import JSON, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, DemoMixin, TimestampMixin


class Attachment(Base, TimestampMixin, DemoMixin):
    __tablename__ = "attachments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    trade_id: Mapped[int | None] = mapped_column(
        ForeignKey("trades.id", ondelete="CASCADE"), nullable=True, index=True
    )
    daily_session_id: Mapped[int | None] = mapped_column(
        ForeignKey("daily_sessions.id", ondelete="CASCADE"), nullable=True, index=True
    )
    note_id: Mapped[int | None] = mapped_column(
        ForeignKey("notes.id", ondelete="CASCADE"), nullable=True, index=True
    )
    # Drawings on the screenshot (pen, lines, arrows, boxes, circles, text) in
    # image pixel coordinates; the image file itself is never modified.
    annotations: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # Path relative to the attachments directory.
    file_path: Mapped[str] = mapped_column(String, nullable=False)
    original_name: Mapped[str | None] = mapped_column(String, nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String, nullable=True)
