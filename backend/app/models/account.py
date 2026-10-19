"""Accounts: trading accounts (prop eval/funded or personal)."""

from __future__ import annotations

from decimal import Decimal

from sqlalchemy import Boolean, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, DemoMixin, TimestampMixin
from app.types import DecimalText

# Account types
ACCOUNT_TYPES = ("prop_eval", "prop_funded", "personal")

# Max drawdown types for prop accounts (used in Phase 6)
MAX_DD_TYPES = ("static", "trailing_intraday", "trailing_eod", "trailing_lock_breakeven")


class Account(Base, TimestampMixin, DemoMixin):
    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    platform: Mapped[str | None] = mapped_column(String, nullable=True)
    type: Mapped[str] = mapped_column(String, nullable=False, default="personal")
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="USD")
    starting_balance: Mapped[Decimal] = mapped_column(
        DecimalText, nullable=False, default=Decimal("0")
    )
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Prop-rule fields (used in Phase 6; nullable for personal accounts).
    account_size: Mapped[Decimal | None] = mapped_column(DecimalText, nullable=True)
    profit_target: Mapped[Decimal | None] = mapped_column(DecimalText, nullable=True)
    daily_loss_limit: Mapped[Decimal | None] = mapped_column(DecimalText, nullable=True)
    max_drawdown_type: Mapped[str | None] = mapped_column(String, nullable=True)
    max_drawdown_amount: Mapped[Decimal | None] = mapped_column(DecimalText, nullable=True)
    consistency_pct: Mapped[Decimal | None] = mapped_column(DecimalText, nullable=True)
    min_trading_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_contracts: Mapped[int | None] = mapped_column(Integer, nullable=True)
