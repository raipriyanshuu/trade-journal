"""Trade result classification and the breakeven threshold from settings."""

from __future__ import annotations

from decimal import Decimal

from sqlalchemy.orm import Session

from app.models import Setting, Trade


def breakeven_threshold(db: Session, currency: str) -> Decimal:
    setting = db.get(Setting, "breakeven_threshold")
    mapping = setting.value if setting and isinstance(setting.value, dict) else {}
    raw = mapping.get(currency, "0")
    try:
        return abs(Decimal(str(raw)))
    except Exception:
        return Decimal("0")


def trade_result(net_pnl: Decimal, status: str, threshold: Decimal) -> str:
    """win | loss | breakeven | open | missed (from P&L)."""
    if status == "missed":
        return "missed"
    if status != "closed":
        return "open"
    if abs(Decimal(net_pnl)) <= threshold:
        return "breakeven"
    return "win" if Decimal(net_pnl) > 0 else "loss"


def result_for(trade: Trade, threshold: Decimal) -> str:
    """Result for a trade, honouring the outcome label when P&L is unknown."""
    if trade.status == "closed" and not trade.pnl_known:
        return trade.outcome if trade.outcome in ("win", "loss", "breakeven") else "breakeven"
    return trade_result(trade.net_pnl, trade.status, threshold)


def _tags_in(trade: Trade, category: str) -> list[str]:
    return [t.name for t in trade.tags if t.category == category]


def serialize_summary(db: Session, trade: Trade, threshold: Decimal | None = None) -> dict:
    if threshold is None:
        threshold = breakeven_threshold(db, trade.currency)
    return {
        "id": trade.id,
        "account_id": trade.account_id,
        "account_name": trade.account.name if trade.account else "",
        "instrument_id": trade.instrument_id,
        "symbol": trade.instrument.symbol_root if trade.instrument else "",
        "direction": trade.direction,
        "trading_date": trade.trading_date,
        "open_time": trade.open_time,
        "close_time": trade.close_time,
        "status": trade.status,
        "max_position_size": trade.max_position_size,
        "avg_entry": trade.avg_entry,
        "avg_exit": trade.avg_exit,
        "points": trade.points,
        "gross_pnl": trade.gross_pnl,
        "fees": trade.fees,
        "net_pnl": trade.net_pnl,
        "currency": trade.currency,
        "r_multiple": trade.r_multiple,
        "holding_time_seconds": trade.holding_time_seconds,
        "source": trade.source,
        "scenario": trade.scenario,
        "self_rating": trade.self_rating,
        "pnl_only": trade.pnl_only,
        "time_known": trade.time_known,
        "is_demo": trade.is_demo,
        "result": result_for(trade, threshold),
        "tags": [{"id": t.id, "name": t.name, "category": t.category} for t in trade.tags],
        # Mistakes typed in the "Mistake flags" box, and the engine's live flags.
        "manual_flags": [f.rule_code for f in trade.flags if f.source == "manual" and not f.dismissed],
        "auto_flags": [f.rule_code for f in trade.flags if f.source == "auto" and not f.dismissed],
        # Notion-style journal fields.
        "dtr": trade.dtr,
        "atr": trade.atr,
        "entry_quality": trade.entry_quality,
        "exit_quality": trade.exit_quality,
        "htf_alignment": trade.htf_alignment,
        "partial_profit": trade.partial_profit,
        "style": trade.style,
        "outcome": trade.outcome,
        "pnl_known": trade.pnl_known,
        "context": trade.context,
        "behaviour": trade.behaviour,
        "initial_stop": trade.initial_stop,
        "planned_target": trade.planned_target,
        "first_entry_price": trade.first_entry_price,
    }


def serialize_detail(db: Session, trade: Trade) -> dict:
    data = serialize_summary(db, trade)
    data.update(
        {
            "initial_stop": trade.initial_stop,
            "planned_target": trade.planned_target,
            "planned_risk_amount": trade.planned_risk_amount,
            "first_entry_price": trade.first_entry_price,
            "planned": trade.planned,
            "checklist_score": trade.checklist_score,
            "vwap_relation": trade.vwap_relation,
            "entry_location": trade.entry_location,
            "notes": trade.notes,
            "executions": sorted(trade.executions, key=lambda e: (e.timestamp, e.id)),
            "attachments": trade.attachments if hasattr(trade, "attachments") else [],
        }
    )
    return data
