"""Learning notes: ideas, mistakes, lessons and observations, with screenshots.

Any note can join the review deck. Reviews follow a simple Leitner schedule:
"Got it" moves a card up a box (it comes back later), "Still learning" sends it
back to box 0 (it comes back tomorrow).
"""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Boolean, Date, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin
from app.types import UTCDateTime

NOTE_TYPES = ("idea", "mistake", "lesson", "observation", "note")
# Days until the next review for each box (after "Got it").
REVIEW_INTERVALS = (1, 2, 4, 8, 16, 32)
MASTERED_BOX = 4


class Note(Base, TimestampMixin):
    __tablename__ = "notes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String, nullable=False, default="", server_default="")
    body: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    note_type: Mapped[str] = mapped_column(String, nullable=False, default="note", server_default="note", index=True)
    pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    note_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    instrument_id: Mapped[int | None] = mapped_column(
        ForeignKey("instruments.id", ondelete="SET NULL"), nullable=True, index=True
    )
    trade_id: Mapped[int | None] = mapped_column(
        ForeignKey("trades.id", ondelete="SET NULL"), nullable=True, index=True
    )

    # Review deck (spaced repetition).
    in_review: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    review_box: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    next_review: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    last_reviewed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    times_reviewed: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    times_got_it: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    instrument = relationship("Instrument", lazy="joined")
    attachments = relationship(
        "Attachment", foreign_keys="Attachment.note_id", viewonly=True, lazy="selectin",
        order_by="Attachment.id",
    )
