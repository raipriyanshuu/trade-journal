"""Daily sessions: one record per trading date (optionally per instrument).

Holds the morning plan and evening review for the auction-market workflow.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import JSON, Date, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, DemoMixin, TimestampMixin
from app.types import DecimalText

FOLLOWED_PLAN = ("yes", "partly", "no")


class DailySession(Base, TimestampMixin, DemoMixin):
    __tablename__ = "daily_sessions"
    __table_args__ = (
        UniqueConstraint(
            "account_id", "instrument_id", "trading_date", name="uq_daily_session_scope"
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    account_id: Mapped[int | None] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), nullable=True, index=True
    )
    instrument_id: Mapped[int | None] = mapped_column(
        ForeignKey("instruments.id", ondelete="SET NULL"), nullable=True, index=True
    )
    trading_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)

    # ----- Morning plan -----
    htf_read: Mapped[str] = mapped_column(Text, nullable=False, default="")
    prior_day_type: Mapped[str | None] = mapped_column(String, nullable=True)
    prior_profile_shape: Mapped[str | None] = mapped_column(String, nullable=True)
    prior_vah: Mapped[Decimal | None] = mapped_column(DecimalText, nullable=True)
    prior_poc: Mapped[Decimal | None] = mapped_column(DecimalText, nullable=True)
    prior_val: Mapped[Decimal | None] = mapped_column(DecimalText, nullable=True)
    on_high: Mapped[Decimal | None] = mapped_column(DecimalText, nullable=True)
    on_low: Mapped[Decimal | None] = mapped_column(DecimalText, nullable=True)
    on_poc: Mapped[Decimal | None] = mapped_column(DecimalText, nullable=True)
    on_vwap: Mapped[Decimal | None] = mapped_column(DecimalText, nullable=True)
    on_range_vs_atr: Mapped[str | None] = mapped_column(String, nullable=True)
    on_inventory: Mapped[str | None] = mapped_column(String, nullable=True)
    expected_open_location: Mapped[str | None] = mapped_column(String, nullable=True)
    # Up to 6 level objects: [{"label": ..., "price": ...}]
    levels: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    # Scenarios A/B/C: [{"name": "A", "trigger", "entry", "stop", "targets", "invalidation"}]
    scenarios: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    # News events: [{"time": "ISO", "label": ...}]
    news_events: Mapped[list] = mapped_column(JSON, nullable=False, default=list)

    # ----- Evening review -----
    actual_opening_type: Mapped[str | None] = mapped_column(String, nullable=True)
    actual_day_type: Mapped[str | None] = mapped_column(String, nullable=True)
    scenario_played_out: Mapped[str | None] = mapped_column(String, nullable=True)
    followed_plan: Mapped[str | None] = mapped_column(String, nullable=True)
    what_to_repeat: Mapped[str] = mapped_column(Text, nullable=False, default="")
    what_to_change: Mapped[str] = mapped_column(Text, nullable=False, default="")
    mood: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 1-5
    sleep: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 1-5
