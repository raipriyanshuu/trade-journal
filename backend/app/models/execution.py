"""Executions (fills): the single source rows that the trade builder consumes."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import JSON, Boolean, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, DemoMixin, TimestampMixin
from app.types import DecimalText, UTCDateTime

SIDES = ("buy", "sell")
SOURCES = ("manual", "import", "notion")


class Execution(Base, TimestampMixin, DemoMixin):
    __tablename__ = "executions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    account_id: Mapped[int] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    instrument_id: Mapped[int] = mapped_column(
        ForeignKey("instruments.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    side: Mapped[str] = mapped_column(String, nullable=False)
    # Quantity is always stored normalized to lots.
    quantity: Mapped[Decimal] = mapped_column(DecimalText, nullable=False)
    price: Mapped[Decimal] = mapped_column(DecimalText, nullable=False)
    timestamp: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, index=True)
    fees: Mapped[Decimal] = mapped_column(DecimalText, nullable=False, default=Decimal("0"))

    source: Mapped[str] = mapped_column(String, nullable=False, default="manual")
    external_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    import_batch_id: Mapped[int | None] = mapped_column(
        ForeignKey("import_batches.id", ondelete="SET NULL"), nullable=True, index=True
    )
    raw_source_row: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # False when the fill time is unknown (set to session open on import).
    time_known: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # Deduplication hash (account+instrument+time+side+qty+price) when no external id.
    dedup_hash: Mapped[str | None] = mapped_column(String, nullable=True, index=True)

    # Set by the trade builder.
    trade_id: Mapped[int | None] = mapped_column(
        ForeignKey("trades.id", ondelete="SET NULL"), nullable=True, index=True
    )
