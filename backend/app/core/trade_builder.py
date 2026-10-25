"""The trade builder: the ONLY code that creates or updates trades.

Executions (fills) in, trades out. Per account+instrument, executions are sorted
by time and walked while tracking net position:

- A trade opens when position leaves zero and closes when it returns to zero.
- A fill that flips position (e.g. long 2 -> short 1) is split: part closes the
  current trade, the rest opens a new one in the opposite direction.
- Average entry/exit are size-weighted. Realized P&L = (sell value - buy value)
  * point value - fees. If position is not flat at the end, the trade stays open.
- User-entered metadata (stop, target, risk, context, tags, notes, rating,
  attachments) is preserved across rebuilds by anchoring to the trade's earliest
  execution id.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.money import q_money, q_price
from app.core.sessions import trading_date_for
from app.models import Attachment, Execution, Instrument, MistakeFlag, Trade
from app.models.tag import trade_tags

ZERO = Decimal("0")

# Trade-level fields that are user-entered and must survive a rebuild.
_META_FIELDS = (
    "initial_stop",
    "planned_target",
    "planned_risk_amount",
    "notes",
    "self_rating",
    "pnl_only",
    "points_known",
    "scenario",
    "planned",
    "checklist_score",
    "vwap_relation",
    "entry_location",
    "dtr",
    "atr",
    "entry_quality",
    "exit_quality",
    "htf_alignment",
    "context",
    "behaviour",
    "partial_profit",
    "outcome",
    "style",
)


@dataclass
class _Fill:
    exec_id: int
    side: str
    qty: Decimal
    price: Decimal
    fee: Decimal
    ts: datetime
    time_known: bool


@dataclass
class _Group:
    direction: str
    open_ts: datetime
    is_demo: bool
    source: str
    fills: list[_Fill] = field(default_factory=list)
    close_ts: datetime | None = None
    anchor_exec_id: int | None = None


def _signed(side: str) -> int:
    return 1 if side == "buy" else -1


def _walk(execs: list[Execution]) -> list[_Group]:
    """Split a time-sorted execution list into trade groups, handling flips."""
    position = ZERO
    groups: list[_Group] = []
    current: _Group | None = None

    for ex in execs:
        remaining = Decimal(ex.quantity)
        sgn = _signed(ex.side)
        while remaining > 0:
            if position == 0:
                current = _Group(
                    direction="long" if ex.side == "buy" else "short",
                    open_ts=ex.timestamp,
                    is_demo=ex.is_demo,
                    source=ex.source,
                    anchor_exec_id=ex.id,
                )
                groups.append(current)
                applied = remaining
            else:
                same_dir = (position > 0 and sgn > 0) or (position < 0 and sgn < 0)
                applied = remaining if same_dir else min(remaining, abs(position))

            assert current is not None
            fee_portion = ex.fees * (applied / Decimal(ex.quantity)) if ex.quantity else ZERO
            current.fills.append(
                _Fill(ex.id, ex.side, applied, ex.price, fee_portion, ex.timestamp, ex.time_known)
            )
            position += sgn * applied
            remaining -= applied
            if position == 0:
                current.close_ts = ex.timestamp
                current = None

    return groups


def _finalize(group: _Group, instrument: Instrument) -> dict:
    pv = Decimal(instrument.point_value)
    fills = group.fills

    buy_qty = sum((f.qty for f in fills if f.side == "buy"), ZERO)
    buy_val = sum((f.qty * f.price for f in fills if f.side == "buy"), ZERO)
    sell_qty = sum((f.qty for f in fills if f.side == "sell"), ZERO)
    sell_val = sum((f.qty * f.price for f in fills if f.side == "sell"), ZERO)
    fees = sum((f.fee for f in fills), ZERO)

    long = group.direction == "long"
    entry_qty, entry_val = (buy_qty, buy_val) if long else (sell_qty, sell_val)
    exit_qty, exit_val = (sell_qty, sell_val) if long else (buy_qty, buy_val)

    avg_entry = entry_val / entry_qty if entry_qty else None
    avg_exit = exit_val / exit_qty if exit_qty else None

    closed = group.close_ts is not None

    # Max position reached during the trade.
    running = ZERO
    max_pos = ZERO
    for f in fills:
        running += _signed(f.side) * f.qty
        if abs(running) > max_pos:
            max_pos = abs(running)

    if closed:
        gross = (sell_val - buy_val) * pv
        points = (avg_exit - avg_entry) if long else (avg_entry - avg_exit)
    else:
        if exit_qty > 0 and avg_exit is not None and avg_entry is not None:
            per_point = (avg_exit - avg_entry) if long else (avg_entry - avg_exit)
            gross = per_point * exit_qty * pv
        else:
            gross = ZERO
        points = None

    net = gross - fees

    # First entry fill price (chronological; fills are already time-ordered).
    entry_side = "buy" if long else "sell"
    first_entry_price = next((f.price for f in fills if f.side == entry_side), None)

    holding = None
    if closed and group.close_ts is not None:
        holding = int((group.close_ts - group.open_ts).total_seconds())

    return {
        "direction": group.direction,
        "open_time": group.open_ts,
        "close_time": group.close_ts,
        "trading_date": trading_date_for(group.open_ts, instrument),
        "max_position_size": max_pos,
        "first_entry_price": q_price(first_entry_price),
        "avg_entry": q_price(avg_entry),
        "avg_exit": q_price(avg_exit),
        "points": q_price(points),
        "gross_pnl": q_money(gross),
        "fees": q_money(fees),
        "net_pnl": q_money(net),
        "currency": instrument.currency,
        "status": "closed" if closed else "open",
        "source": group.source,
        "holding_time_seconds": holding,
        "is_demo": group.is_demo,
        "time_known": all(f.time_known for f in fills),
        "anchor_exec_id": group.anchor_exec_id,
    }


def compute_r(
    net_pnl: Decimal,
    status: str,
    pnl_only: bool,
    first_entry_price: Decimal | None,
    initial_stop: Decimal | None,
    planned_risk_amount: Decimal | None,
    max_position_size: Decimal,
    point_value: Decimal,
) -> Decimal | None:
    """R-multiple. Uses planned risk if given, else risk from the initial stop."""
    if status != "closed" or pnl_only:
        return None
    risk: Decimal | None = None
    if planned_risk_amount is not None and planned_risk_amount != 0:
        risk = abs(Decimal(planned_risk_amount))
    elif initial_stop is not None and first_entry_price is not None:
        risk = abs(Decimal(first_entry_price) - Decimal(initial_stop)) * Decimal(
            max_position_size
        ) * Decimal(point_value)
    if risk and risk > 0:
        return q_price(Decimal(net_pnl) / risk)
    return None


def _collect_meta(db: Session, account_id: int, instrument_id: int) -> tuple[dict, dict]:
    """Snapshot user metadata + attachments of existing trades, keyed by anchor."""
    trades = db.scalars(
        select(Trade).where(
            Trade.account_id == account_id, Trade.instrument_id == instrument_id
        )
    ).all()
    meta_by_anchor: dict[int, dict] = {}
    attachments_by_anchor: dict[int, list[int]] = {}
    for t in trades:
        execs = db.scalars(
            select(Execution.id).where(Execution.trade_id == t.id)
        ).all()
        if not execs:
            continue
        anchor = min(execs)
        meta_by_anchor[anchor] = {f: getattr(t, f) for f in _META_FIELDS}
        meta_by_anchor[anchor]["tag_ids"] = [tag.id for tag in t.tags]
        # Manual mistake flags and dismissed auto flags are user decisions: keep
        # them. (Other auto flags are recomputed by the mistake engine anyway.)
        meta_by_anchor[anchor]["flags"] = [
            {"rule_code": f.rule_code, "source": f.source, "details": f.details,
             "dismissed": f.dismissed, "is_demo": f.is_demo}
            for f in db.scalars(select(MistakeFlag).where(MistakeFlag.trade_id == t.id))
            if f.source == "manual" or f.dismissed
        ]
        att_ids = db.scalars(
            select(Attachment.id).where(Attachment.trade_id == t.id)
        ).all()
        if att_ids:
            attachments_by_anchor[anchor] = list(att_ids)
    return meta_by_anchor, attachments_by_anchor


def rebuild_for(
    db: Session,
    account_id: int,
    instrument_id: int,
    meta_overrides: dict[int, dict] | None = None,
) -> list[Trade]:
    """Rebuild all trades for one account+instrument from its executions."""
    instrument = db.get(Instrument, instrument_id)
    if instrument is None:
        return []

    meta_by_anchor, attachments_by_anchor = _collect_meta(db, account_id, instrument_id)
    if meta_overrides:
        for anchor, override in meta_overrides.items():
            merged = meta_by_anchor.get(anchor, {})
            merged.update({k: v for k, v in override.items() if v is not None})
            meta_by_anchor[anchor] = merged

    # Detach attachments so the trade delete-cascade does not remove them.
    # Rebuild every execution-derived trade; P&L-only imported trades (created
    # directly, pnl_only=True) are never built from executions, so keep them.
    old_trade_ids = list(
        db.scalars(
            select(Trade.id).where(
                Trade.account_id == account_id,
                Trade.instrument_id == instrument_id,
                Trade.pnl_only.is_(False),
                Trade.status != "missed",
            )
        ).all()
    )
    if old_trade_ids:
        for att in db.scalars(
            select(Attachment).where(Attachment.trade_id.in_(old_trade_ids))
        ):
            att.trade_id = None
        # Delete old flags through the ORM (not the DB cascade) so the session's
        # identity map stays consistent; the ones worth keeping were snapshotted
        # in _collect_meta and are re-created on the rebuilt trades below.
        for fl in db.scalars(select(MistakeFlag).where(MistakeFlag.trade_id.in_(old_trade_ids))):
            db.delete(fl)
        for t in db.scalars(select(Trade).where(Trade.id.in_(old_trade_ids))):
            db.delete(t)
        db.flush()

    execs = db.scalars(
        select(Execution)
        .where(
            Execution.account_id == account_id,
            Execution.instrument_id == instrument_id,
        )
        .order_by(Execution.timestamp, Execution.id)
    ).all()

    groups = _walk(execs)
    new_trades: list[Trade] = []

    for group in groups:
        data = _finalize(group, instrument)
        anchor = data.pop("anchor_exec_id")
        trade = Trade(
            account_id=account_id,
            instrument_id=instrument_id,
            max_position_size=data["max_position_size"],
            first_entry_price=data["first_entry_price"],
            avg_entry=data["avg_entry"],
            avg_exit=data["avg_exit"],
            points=data["points"],
            gross_pnl=data["gross_pnl"],
            fees=data["fees"],
            net_pnl=data["net_pnl"],
            currency=data["currency"],
            direction=data["direction"],
            open_time=data["open_time"],
            close_time=data["close_time"],
            trading_date=data["trading_date"],
            status=data["status"],
            source=data["source"],
            holding_time_seconds=data["holding_time_seconds"],
            is_demo=data["is_demo"],
            time_known=data["time_known"],
        )

        meta = meta_by_anchor.get(anchor, {}) if anchor is not None else {}
        for f in _META_FIELDS:
            if f in meta and meta[f] is not None:
                setattr(trade, f, meta[f])

        trade.r_multiple = compute_r(
            net_pnl=trade.net_pnl,
            status=trade.status,
            pnl_only=trade.pnl_only,
            first_entry_price=trade.first_entry_price,
            initial_stop=trade.initial_stop,
            planned_risk_amount=trade.planned_risk_amount,
            max_position_size=trade.max_position_size,
            point_value=instrument.point_value,
        )

        db.add(trade)
        db.flush()  # assign trade.id

        # Link executions of this group to the trade (first portion wins on a flip).
        for f in group.fills:
            ex = db.get(Execution, f.exec_id)
            if ex is not None and ex.trade_id is None:
                ex.trade_id = trade.id

        # Restore tags and attachments.
        if meta.get("tag_ids"):
            for tag_id in meta["tag_ids"]:
                db.execute(
                    trade_tags.insert().values(trade_id=trade.id, tag_id=tag_id)
                )
        for fl in meta.get("flags") or []:
            db.add(MistakeFlag(
                trade_id=trade.id, account_id=account_id, session_date=trade.trading_date, **fl,
            ))
        if anchor in attachments_by_anchor:
            for att_id in attachments_by_anchor[anchor]:
                att = db.get(Attachment, att_id)
                if att is not None:
                    att.trade_id = trade.id

        new_trades.append(trade)

    db.commit()
    return new_trades


def recompute_trade_r(db: Session, trade: Trade) -> None:
    """Recompute R for a single trade after its stop/risk/pnl_only changed."""
    instrument = db.get(Instrument, trade.instrument_id)
    if instrument is None or trade.status == "missed":
        return  # missed trades keep their "potential R"
    trade.r_multiple = compute_r(
        net_pnl=trade.net_pnl,
        status=trade.status,
        pnl_only=trade.pnl_only,
        first_entry_price=trade.first_entry_price,
        initial_stop=trade.initial_stop,
        planned_risk_amount=trade.planned_risk_amount,
        max_position_size=trade.max_position_size,
        point_value=instrument.point_value,
    )
    db.commit()


def rebuild_all(db: Session) -> int:
    """Rebuild every account+instrument pair that has executions."""
    pairs = db.execute(
        select(Execution.account_id, Execution.instrument_id).distinct()
    ).all()
    for account_id, instrument_id in pairs:
        rebuild_for(db, account_id, instrument_id)
    return len(pairs)
