"""OHLCV bars imported from the charting platform (Phase 7: MAE/MFE + replay)."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, DemoMixin
from app.types import DecimalText, UTCDateTime

TIMEFRAMES = {"1m": 60, "5m": 300}


class Bar(Base, DemoMixin):
    __tablename__ = "bars"
    __table_args__ = (
        UniqueConstraint("instrument_id", "timeframe", "ts", name="uq_bars_inst_tf_ts"),
        Index("ix_bars_lookup", "instrument_id", "timeframe", "ts"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    instrument_id: Mapped[int] = mapped_column(
        ForeignKey("instruments.id", ondelete="CASCADE"), nullable=False
    )
    timeframe: Mapped[str] = mapped_column(String, nullable=False)  # "1m" | "5m"
    ts: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)  # bar open, UTC
    open: Mapped[Decimal] = mapped_column(DecimalText, nullable=False)
    high: Mapped[Decimal] = mapped_column(DecimalText, nullable=False)
    low: Mapped[Decimal] = mapped_column(DecimalText, nullable=False)
    close: Mapped[Decimal] = mapped_column(DecimalText, nullable=False)
    volume: Mapped[Decimal | None] = mapped_column(DecimalText, nullable=True)
