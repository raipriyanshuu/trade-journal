"""Trades: built from executions by the trade builder (the only writer of trades)."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, DemoMixin, TimestampMixin
from app.types import DecimalText, UTCDateTime

DIRECTIONS = ("long", "short")
# "missed" = a setup you saw but did not take; it has no executions and is
# excluded from every P&L statistic (tracked separately as missed opportunity).
STATUSES = ("open", "closed", "missed")
QUALITY_GRADES = ("A+", "A", "B", "C")
HTF_ALIGNMENTS = ("bullish", "bearish", "range")
# User-set outcome label (mirrors the Notion "Trade" column). For normal trades
# the result is computed from P&L; the label matters when P&L is unknown.
OUTCOMES = ("win", "loss", "breakeven", "missed")
SCENARIOS = ("A", "B", "C", "none")
VWAP_RELATIONS = ("with", "against", "n/a")
ENTRY_LOCATIONS = ("at_level", "mid_range", "breakout", "other")


class Trade(Base, TimestampMixin, DemoMixin):
    __tablename__ = "trades"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    account_id: Mapped[int] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    instrument_id: Mapped[int] = mapped_column(
        ForeignKey("instruments.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    direction: Mapped[str] = mapped_column(String, nullable=False)

    open_time: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, index=True)
    close_time: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    # Trading date assigned per the instrument's session rules.
    trading_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)

    max_position_size: Mapped[Decimal] = mapped_column(DecimalText, nullable=False)
    # Price of the first entry fill (chronologically); used for the R-multiple
    # formula and kept here so it survives position flips and rebuilds.
    first_entry_price: Mapped[Decimal | None] = mapped_column(DecimalText, nullable=True)
    avg_entry: Mapped[Decimal | None] = mapped_column(DecimalText, nullable=True)
    avg_exit: Mapped[Decimal | None] = mapped_column(DecimalText, nullable=True)
    points: Mapped[Decimal | None] = mapped_column(DecimalText, nullable=True)

    gross_pnl: Mapped[Decimal] = mapped_column(DecimalText, nullable=False, default=Decimal("0"))
    fees: Mapped[Decimal] = mapped_column(DecimalText, nullable=False, default=Decimal("0"))
    net_pnl: Mapped[Decimal] = mapped_column(DecimalText, nullable=False, default=Decimal("0"))
    currency: Mapped[str] = mapped_column(String(3), nullable=False)

    initial_stop: Mapped[Decimal | None] = mapped_column(DecimalText, nullable=True)
    planned_target: Mapped[Decimal | None] = mapped_column(DecimalText, nullable=True)
    planned_risk_amount: Mapped[Decimal | None] = mapped_column(DecimalText, nullable=True)
    r_multiple: Mapped[Decimal | None] = mapped_column(DecimalText, nullable=True)

    holding_time_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False, default="open")
    source: Mapped[str] = mapped_column(String, nullable=False, default="manual")
    # Set only on P&L-only / price-less imported trades, so a batch undo can
    # remove them (trades built from executions are removed via their executions).
    import_batch_id: Mapped[int | None] = mapped_column(
        ForeignKey("import_batches.id", ondelete="SET NULL"), nullable=True, index=True
    )

    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    self_rating: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Phase 2 flags for migrated/partial data.
    pnl_only: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    points_known: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    time_known: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Trade context (James Dalton / auction-market framework).
    scenario: Mapped[str] = mapped_column(String, nullable=False, default="none")
    planned: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    checklist_score: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 0-4
    vwap_relation: Mapped[str] = mapped_column(String, nullable=False, default="n/a")
    entry_location: Mapped[str] = mapped_column(String, nullable=False, default="other")

    # Notion-style journal fields.
    dtr: Mapped[Decimal | None] = mapped_column(DecimalText, nullable=True)  # day's range so far
    atr: Mapped[Decimal | None] = mapped_column(DecimalText, nullable=True)
    entry_quality: Mapped[str | None] = mapped_column(String, nullable=True)
    exit_quality: Mapped[str | None] = mapped_column(String, nullable=True)
    htf_alignment: Mapped[str | None] = mapped_column(String, nullable=True)
    context: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    behaviour: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    partial_profit: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    outcome: Mapped[str | None] = mapped_column(String, nullable=True)
    # False for imported rows that only carry a Win/Loss label (no prices, no P&L):
    # they count toward win rate but never toward money statistics.
    pnl_known: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1"
    )

    executions = relationship("Execution", backref="trade", foreign_keys="Execution.trade_id")
    tags = relationship("Tag", secondary="trade_tags", back_populates="trades")
    instrument = relationship("Instrument", lazy="joined")
    account = relationship("Account", lazy="joined")
    attachments = relationship("Attachment", foreign_keys="Attachment.trade_id", viewonly=True)
    # Batch-loaded so the trade list can show flags without N+1 queries.
    flags = relationship("MistakeFlag", foreign_keys="MistakeFlag.trade_id", viewonly=True, lazy="selectin")
