"""Daily Report Card: one per trading day (both books together).

The day grade, lesson, change and tomorrow's goal are NOT stored here: they live on
the day's general Trading Day session (account and instrument empty), so the
Review step and the report card always show the same text.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import JSON, Date, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin

GOAL_RESULTS = ("hit", "partly", "missed")


class ReportCard(Base, TimestampMixin):
    __tablename__ = "report_cards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    trading_date: Mapped[date] = mapped_column(Date, nullable=False, unique=True, index=True)
    goal: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    goal_result: Mapped[str | None] = mapped_column(String, nullable=True)
    # [{"name": "US open 19:00-20:30", "grade": "A", "cells": {"Sizing": "Right"}, "comment": ""}]
    segments: Mapped[list] = mapped_column(JSON, nullable=False, default=list, server_default="[]")
    overview: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    easiest_money: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
