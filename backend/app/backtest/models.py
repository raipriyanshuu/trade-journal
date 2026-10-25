"""Backtest tables (own declarative base, own database file).

Times are stored as integer UTC epoch seconds; prices and money as floats
(prices are snapped to the contract's tick, money rounded to cents).
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class BtBase(DeclarativeBase):
    pass


def _now() -> int:
    return int(datetime.now(timezone.utc).timestamp())


class BtBar(BtBase):
    """A stored candle. ``tf`` is a base timeframe: 5m, 1h or 1d.

    Daily bars are normalised to the CME trading day: ``ts`` is the session open
    (18:00 New York the evening before the trading date).
    """

    __tablename__ = "bt_bars"
    __table_args__ = (
        UniqueConstraint("symbol", "tf", "ts", name="uq_bt_bars_symbol_tf_ts"),
        Index("ix_bt_bars_symbol_tf_ts", "symbol", "tf", "ts"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    symbol: Mapped[str] = mapped_column(String(8))
    tf: Mapped[str] = mapped_column(String(4))
    ts: Mapped[int] = mapped_column(Integer)
    open: Mapped[float] = mapped_column(Float)
    high: Mapped[float] = mapped_column(Float)
    low: Mapped[float] = mapped_column(Float)
    close: Mapped[float] = mapped_column(Float)
    volume: Mapped[float] = mapped_column(Float, default=0)


class BtSession(BtBase):
    """One replay run: a strategy on one instrument, with its own balance and cursor."""

    __tablename__ = "bt_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    strategy: Mapped[str] = mapped_column(String(120), index=True)
    symbol: Mapped[str] = mapped_column(String(8))
    contract: Mapped[str] = mapped_column(String(8), default="full")  # full | micro
    point_value: Mapped[float] = mapped_column(Float)
    tick_size: Mapped[float] = mapped_column(Float)
    starting_balance: Mapped[float] = mapped_column(Float, default=10000)
    risk_per_trade: Mapped[float] = mapped_column(Float, default=100)
    fee_per_contract: Mapped[float] = mapped_column(Float, default=0)  # round turn
    timeframe: Mapped[str] = mapped_column(String(4), default="1h")
    start_at: Mapped[int] = mapped_column(Integer)
    revealed_until: Mapped[int] = mapped_column(Integer)  # everything before this is visible
    notes: Mapped[str] = mapped_column(Text, default="")
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[int] = mapped_column(Integer, default=_now)

    trades: Mapped[list[BtTrade]] = relationship(
        back_populates="session", cascade="all, delete-orphan", passive_deletes=True,
        order_by="BtTrade.entry_ts",
    )


class BtTrade(BtBase):
    __tablename__ = "bt_trades"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("bt_sessions.id", ondelete="CASCADE"), index=True)
    symbol: Mapped[str] = mapped_column(String(8))
    direction: Mapped[str] = mapped_column(String(5))  # long | short
    qty: Mapped[float] = mapped_column(Float)
    entry_ts: Mapped[int] = mapped_column(Integer)
    entry_price: Mapped[float] = mapped_column(Float)
    initial_stop: Mapped[float | None] = mapped_column(Float, nullable=True)
    stop: Mapped[float | None] = mapped_column(Float, nullable=True)
    target: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String(8), default="open")  # open | closed
    exits: Mapped[list] = mapped_column(JSON, default=list)  # [{ts, price, qty, reason}]
    exit_reason: Mapped[str | None] = mapped_column(String(10), nullable=True)
    close_ts: Mapped[int | None] = mapped_column(Integer, nullable=True)
    gross: Mapped[float] = mapped_column(Float, default=0)
    fees: Mapped[float] = mapped_column(Float, default=0)
    net: Mapped[float] = mapped_column(Float, default=0)
    r_multiple: Mapped[float | None] = mapped_column(Float, nullable=True)
    mae: Mapped[float] = mapped_column(Float, default=0)  # worst move against, in points
    mfe: Mapped[float] = mapped_column(Float, default=0)  # best move in favour, in points
    setup: Mapped[str] = mapped_column(String(120), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    snapshot: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[int] = mapped_column(Integer, default=_now)

    session: Mapped[BtSession] = relationship(back_populates="trades")
