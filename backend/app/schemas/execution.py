"""Execution schemas."""

from __future__ import annotations

from datetime import datetime

from app.schemas.common import DecimalStr, ORMModel


class ExecutionRead(ORMModel):
    id: int
    account_id: int
    instrument_id: int
    side: str
    quantity: DecimalStr
    price: DecimalStr
    timestamp: datetime
    fees: DecimalStr
    source: str
    external_id: str | None
    time_known: bool
    trade_id: int | None


class ExecutionUpdate(ORMModel):
    side: str | None = None
    quantity: DecimalStr | None = None
    price: DecimalStr | None = None
    timestamp: datetime | None = None
    fees: DecimalStr | None = None
    time_known: bool | None = None
