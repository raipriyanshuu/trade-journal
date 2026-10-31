"""Playbooks (strategies / models) with rule checklists, and per-trade rule ticks.

A playbook is a strategy you trade (e.g. "Crude swing retest") with rules grouped
in sections (Market context, Entry criteria, ...). A trade can belong to one
playbook; the rules you followed on that trade are stored in trade_rule_checks.
"""

from __future__ import annotations

from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, Table, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

trade_rule_checks = Table(
    "trade_rule_checks",
    Base.metadata,
    Column("trade_id", ForeignKey("trades.id", ondelete="CASCADE"), primary_key=True),
    Column("rule_id", ForeignKey("playbook_rules.id", ondelete="CASCADE"), primary_key=True),
)


class Playbook(Base, TimestampMixin):
    __tablename__ = "playbooks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    color: Mapped[str] = mapped_column(String, nullable=False, default="violet", server_default="violet")
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")

    rules: Mapped[list[PlaybookRule]] = relationship(
        back_populates="playbook", cascade="all, delete-orphan", passive_deletes=True,
        order_by="PlaybookRule.position", lazy="selectin",
    )


class PlaybookRule(Base, TimestampMixin):
    __tablename__ = "playbook_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    playbook_id: Mapped[int] = mapped_column(ForeignKey("playbooks.id", ondelete="CASCADE"), index=True)
    section: Mapped[str] = mapped_column(String, nullable=False, default="Entry criteria")
    text: Mapped[str] = mapped_column(String, nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    playbook: Mapped[Playbook] = relationship(back_populates="rules")
