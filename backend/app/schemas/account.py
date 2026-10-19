"""Account schemas."""

from __future__ import annotations

from decimal import Decimal

from pydantic import Field

from app.schemas.common import DecimalStr, ORMModel


class AccountRead(ORMModel):
    id: int
    name: str
    platform: str | None
    type: str
    currency: str
    starting_balance: DecimalStr
    active: bool
    is_demo: bool
    account_size: DecimalStr | None
    profit_target: DecimalStr | None
    daily_loss_limit: DecimalStr | None
    max_drawdown_type: str | None
    max_drawdown_amount: DecimalStr | None
    consistency_pct: DecimalStr | None
    min_trading_days: int | None
    max_contracts: int | None


class AccountCreate(ORMModel):
    name: str
    platform: str | None = None
    type: str = "personal"
    currency: str = "USD"
    starting_balance: DecimalStr = Decimal("0")
    active: bool = True
    account_size: DecimalStr | None = None
    profit_target: DecimalStr | None = None
    daily_loss_limit: DecimalStr | None = None
    max_drawdown_type: str | None = None
    max_drawdown_amount: DecimalStr | None = None
    consistency_pct: DecimalStr | None = None
    min_trading_days: int | None = None
    max_contracts: int | None = None


class AccountUpdate(ORMModel):
    name: str | None = None
    platform: str | None = None
    type: str | None = None
    currency: str | None = None
    starting_balance: DecimalStr | None = None
    active: bool | None = None
    account_size: DecimalStr | None = None
    profit_target: DecimalStr | None = None
    daily_loss_limit: DecimalStr | None = None
    max_drawdown_type: str | None = None
    max_drawdown_amount: DecimalStr | None = None
    consistency_pct: DecimalStr | None = None
    min_trading_days: int | None = None
    max_contracts: int | None = None
