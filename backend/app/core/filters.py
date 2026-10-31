"""Reusable trade filtering for the analytics and mistakes endpoints."""

from __future__ import annotations

from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Trade
from app.models.tag import trade_tags


UNASSIGNED_STYLE = "__none"


def where_style(stmt, style: str | None):
    """Filter a Trade query by style; "__none" selects trades with no style."""
    if not style:
        return stmt
    if style == UNASSIGNED_STYLE:
        return stmt.where(Trade.style.is_(None))
    return stmt.where(func.lower(Trade.style) == style.lower())


def where_playbook(stmt, playbook: str | None):
    """Filter by playbook id; "none" selects trades without a playbook."""
    if not playbook:
        return stmt
    if playbook == "none":
        return stmt.where(Trade.playbook_id.is_(None))
    try:
        return stmt.where(Trade.playbook_id == int(playbook))
    except ValueError:
        return stmt.where(Trade.id.is_(None))  # unknown value: match nothing


def filtered_trades(
    db: Session,
    *,
    style: str | None = None,
    playbook: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    account_id: int | None = None,
    instrument_id: int | None = None,
    direction: str | None = None,
    status: str | None = None,
    scenario: str | None = None,
    source: str | None = None,
    tag_id: int | None = None,
    currency: str | None = None,
    include_demo: bool = True,
    include_approx: bool = True,
    include_pnl_only: bool = True,
) -> list[Trade]:
    stmt = where_playbook(where_style(select(Trade), style), playbook)
    if date_from:
        stmt = stmt.where(Trade.trading_date >= date_from)
    if date_to:
        stmt = stmt.where(Trade.trading_date <= date_to)
    if account_id:
        stmt = stmt.where(Trade.account_id == account_id)
    if instrument_id:
        stmt = stmt.where(Trade.instrument_id == instrument_id)
    if direction:
        stmt = stmt.where(Trade.direction == direction)
    if status:
        stmt = stmt.where(Trade.status == status)
    if scenario:
        stmt = stmt.where(Trade.scenario == scenario)
    if source:
        stmt = stmt.where(Trade.source == source)
    if currency:
        stmt = stmt.where(Trade.currency == currency)
    if not include_demo:
        stmt = stmt.where(Trade.is_demo.is_(False))
    if not include_approx:
        stmt = stmt.where(Trade.time_known.is_(True))
    if not include_pnl_only:
        stmt = stmt.where(Trade.pnl_only.is_(False))
    if tag_id:
        stmt = stmt.where(
            Trade.id.in_(select(trade_tags.c.trade_id).where(trade_tags.c.tag_id == tag_id))
        )
    return list(db.scalars(stmt.order_by(Trade.trading_date, Trade.open_time, Trade.id)))
