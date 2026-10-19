"""Instrument schemas."""

from __future__ import annotations

from decimal import Decimal

from pydantic import Field

from app.schemas.common import DecimalStr, ORMModel


class InstrumentRead(ORMModel):
    id: int
    symbol_root: str
    display_name: str
    exchange: str
    currency: str
    point_value: DecimalStr
    tick_size: DecimalStr
    lot_size: DecimalStr
    asset_class: str
    quantity_unit: str
    session_timezone: str
    session_definitions: dict
    active: bool
    verified: bool


class InstrumentCreate(ORMModel):
    symbol_root: str
    display_name: str
    exchange: str
    currency: str
    point_value: DecimalStr
    tick_size: DecimalStr
    lot_size: DecimalStr = Decimal("1")
    asset_class: str = "other"
    quantity_unit: str = "lots"
    session_timezone: str = "America/New_York"
    session_definitions: dict = Field(default_factory=dict)


class InstrumentUpdate(ORMModel):
    display_name: str | None = None
    exchange: str | None = None
    currency: str | None = None
    point_value: DecimalStr | None = None
    tick_size: DecimalStr | None = None
    lot_size: DecimalStr | None = None
    asset_class: str | None = None
    quantity_unit: str | None = None
    session_timezone: str | None = None
    session_definitions: dict | None = None
    active: bool | None = None
    verified: bool | None = None
