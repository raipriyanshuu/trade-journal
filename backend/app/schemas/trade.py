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


class JournalFields(BaseModel):
    """Notion-style fields shared by manual, missed and edited trades."""

    dtr: DecimalStr | None = None
    atr: DecimalStr | None = None
    entry_quality: str | None = None
    exit_quality: str | None = None
    htf_alignment: str | None = None
    context: str = ""
    behaviour: str = ""
    partial_profit: bool = False
    style: str | None = None
    playbook_id: int | None = None
    rule_ids: list[int] = []


class ManualTradeCreate(JournalFields):
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


class MissedTradeCreate(JournalFields):
    """A setup you saw but did not take. No executions; excluded from P&L stats."""

    account_id: int
    instrument_id: int
    direction: str
    time: datetime
    quantity: DecimalStr = Decimal("1")
    planned_entry: DecimalStr | None = None
    initial_stop: DecimalStr | None = None
    planned_target: DecimalStr | None = None
    scenario: str = "none"
    notes: str = ""
    tag_ids: list[int] = []


class TradeUpdate(BaseModel):
    dtr: DecimalStr | None = None
    atr: DecimalStr | None = None
    entry_quality: str | None = None
    exit_quality: str | None = None
    htf_alignment: str | None = None
    context: str | None = None
    behaviour: str | None = None
    partial_profit: bool | None = None
    style: str | None = None
    outcome: str | None = None
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
    manual_flags: list[str] = []
    auto_flags: list[str] = []
    dtr: DecimalStr | None = None
    atr: DecimalStr | None = None
    entry_quality: str | None = None
    exit_quality: str | None = None
    htf_alignment: str | None = None
    partial_profit: bool = False
    style: str | None = None
    playbook: dict | None = None
    rules_followed: int | None = None
    rules_total: int | None = None
    outcome: str | None = None
    pnl_known: bool = True
    context: str = ""
    behaviour: str = ""
    initial_stop: DecimalStr | None = None
    planned_target: DecimalStr | None = None
    first_entry_price: DecimalStr | None = None


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
    checked_rule_ids: list[int] = []
    executions: list[ExecutionRead] = []
    attachments: list[AttachmentRead] = []
