"""Instruments: editable instrument master seeded with CME/COMEX/NYMEX and NSE/MCX."""

from __future__ import annotations

from decimal import Decimal

from sqlalchemy import JSON, Boolean, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin
from app.types import DecimalText

QUANTITY_UNITS = ("lots", "units")


class Instrument(Base, TimestampMixin):
    __tablename__ = "instruments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    symbol_root: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    display_name: Mapped[str] = mapped_column(String, nullable=False)
    exchange: Mapped[str] = mapped_column(String, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)

    # Point value = cash per 1.0 price move, per contract/lot.
    point_value: Mapped[Decimal] = mapped_column(DecimalText, nullable=False)
    tick_size: Mapped[Decimal] = mapped_column(DecimalText, nullable=False)
    # Lot size in units (e.g. Nifty 75). Used to normalize units -> lots on import.
    lot_size: Mapped[Decimal] = mapped_column(DecimalText, nullable=False, default=Decimal("1"))

    asset_class: Mapped[str] = mapped_column(String, nullable=False, default="other")
    # Default quantity unit for imports of this instrument.
    quantity_unit: Mapped[str] = mapped_column(String, nullable=False, default="lots")

    session_timezone: Mapped[str] = mapped_column(String, nullable=False, default="America/New_York")
    # Session definitions: trading-day start, regular session open/close, IB minutes, etc.
    session_definitions: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # "verify" badge: seeded specs stay unverified until the user confirms them.
    verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
