"""Prop-firm costs and payouts per account (eval fees, resets, payouts...)."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import Date, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin
from app.types import DecimalText

# "reset" costs money AND restarts the account balance from that date.
# "payout" is money received and comes off the funded balance.
LEDGER_KINDS = ("eval_fee", "activation_fee", "reset", "subscription", "other_cost", "payout")


class PropLedgerEntry(Base, TimestampMixin):
    __tablename__ = "prop_ledger"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    entry_date: Mapped[date] = mapped_column(Date, nullable=False)
    kind: Mapped[str] = mapped_column(String, nullable=False)
    amount: Mapped[Decimal] = mapped_column(DecimalText, nullable=False)  # always positive
    note: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
