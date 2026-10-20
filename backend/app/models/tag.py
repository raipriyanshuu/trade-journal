"""Tags and the trade-tag join table."""

from __future__ import annotations

from sqlalchemy import Boolean, ForeignKey, Integer, String, Table, Column, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

# "setup" is shown as "Trade type" in the UI (Pullback, Retest, Reversal, ...).
# "location" = entry location, "probability" = pre-trade probability bucket,
# "thesis" = what exactly happened (Continuation, Stopped, ...).
TAG_CATEGORIES = ("setup", "mistake", "location", "probability", "thesis", "emotion", "custom")

trade_tags = Table(
    "trade_tags",
    Base.metadata,
    Column("trade_id", ForeignKey("trades.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
)


class Tag(Base, TimestampMixin):
    __tablename__ = "tags"
    __table_args__ = (UniqueConstraint("name", "category", name="uq_tag_name_category"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    category: Mapped[str] = mapped_column(String, nullable=False, default="custom")
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    trades = relationship("Trade", secondary=trade_tags, back_populates="tags")
