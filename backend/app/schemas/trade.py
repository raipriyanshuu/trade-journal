"""Trade schemas: manual entry, list rows and detail."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from app.schemas.common import DecimalStr, ORMModel
from app.schemas.execution import ExecutionRead


class TagRead(ORMModel):
    id: int
    name: str
    category: str


class AttachmentRead(ORMModel):
    id: int
    file_path: str
    original_name: str | None
    mime_type: str | None


class Leg(BaseModel):
    time: datetime
    price: DecimalStr
    quantity: DecimalStr


class ManualTradeCreate(BaseModel):
    account_id: int
    instrument_id: int
    direction: str  # long | short
    entries: list[Leg] = Field(min_length=1)
    exits: list[Leg] = []
    fees: DecimalStr = Decimal("0")

    initial_stop: DecimalStr | None = None
    planned_target: DecimalStr | None = None
    planned_risk_amount: DecimalStr | None = None

    scenario: str = "none"
    planned: bool | None = None
    checklist_score: int | None = None
    vwap_relation: str = "n/a"
    entry_location: str = "other"
    notes: str = ""
    self_rating: int | None = None
    tag_ids: list[int] = []
    time_known: bool = True


class TradeUpdate(BaseModel):
    initial_stop: DecimalStr | None = None
    planned_target: DecimalStr | None = None
    planned_risk_amount: DecimalStr | None = None
    scenario: str | None = None
    planned: bool | None = None
    checklist_score: int | None = None
    vwap_relation: str | None = None
    entry_location: str | None = None
    notes: str | None = None
    self_rating: int | None = None
    pnl_only: bool | None = None
    tag_ids: list[int] | None = None


class TradeSummary(ORMModel):
    id: int
    account_id: int
    account_name: str
    instrument_id: int
    symbol: str
    direction: str
    trading_date: date
    open_time: datetime
    close_time: datetime | None
    status: str
    max_position_size: DecimalStr
    avg_entry: DecimalStr | None
    avg_exit: DecimalStr | None
    points: DecimalStr | None
    gross_pnl: DecimalStr
    fees: DecimalStr
    net_pnl: DecimalStr
    currency: str
    r_multiple: DecimalStr | None
    holding_time_seconds: int | None
    source: str
    scenario: str
    self_rating: int | None
    pnl_only: bool
    time_known: bool
    is_demo: bool
    result: str
    tags: list[TagRead] = []


class TradeDetail(TradeSummary):
    initial_stop: DecimalStr | None
    planned_target: DecimalStr | None
    planned_risk_amount: DecimalStr | None
    first_entry_price: DecimalStr | None
    planned: bool | None
    checklist_score: int | None
    vwap_relation: str
    entry_location: str
    notes: str
    currency: str
    executions: list[ExecutionRead] = []
    attachments: list[AttachmentRead] = []
