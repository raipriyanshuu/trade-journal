"""Demo data: clearly marked (is_demo) and fully removable.

In Phase 0 the demo seeds accounts, a few executions and a daily session so the
UI has something to show. From Phase 1 the trade builder turns the demo
executions into trades automatically.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import (
    Account,
    Attachment,
    DailySession,
    Execution,
    ImportBatch,
    Instrument,
    MistakeFlag,
    Trade,
)


def demo_present(db: Session) -> bool:
    return db.query(Account).filter(Account.is_demo.is_(True)).count() > 0


def _dt(y, m, d, hh, mm) -> datetime:
    return datetime(y, m, d, hh, mm, tzinfo=timezone.utc)


def load_demo_data(db: Session) -> dict:
    if demo_present(db):
        return {"status": "exists", "message": "Demo data already loaded."}

    es = db.scalar(select(Instrument).where(Instrument.symbol_root == "ES"))
    crude = db.scalar(select(Instrument).where(Instrument.symbol_root == "CRUDEOIL"))

    apex = Account(
        name="DEMO Apex 50K (eval)",
        platform="Tradovate",
        type="prop_eval",
        currency="USD",
        starting_balance=Decimal("50000"),
        account_size=Decimal("50000"),
        profit_target=Decimal("3000"),
        daily_loss_limit=Decimal("1250"),
        max_contracts=10,
        max_drawdown_type="trailing_eod",
        max_drawdown_amount=Decimal("2500"),
        is_demo=True,
    )
    mcx = Account(
        name="DEMO Personal MCX",
        platform="Zerodha",
        type="personal",
        currency="INR",
        starting_balance=Decimal("100000"),
        is_demo=True,
    )
    db.add_all([apex, mcx])
    db.flush()

    execs: list[Execution] = []
    if es is not None:
        # Winning long: +10 pts on 2 contracts = +$1000.
        execs += [
            Execution(account_id=apex.id, instrument_id=es.id, side="buy",
                      quantity=Decimal("2"), price=Decimal("5000.00"),
                      timestamp=_dt(2026, 10, 13, 14, 0), fees=Decimal("4.00"),
                      source="manual", is_demo=True),
            Execution(account_id=apex.id, instrument_id=es.id, side="sell",
                      quantity=Decimal("2"), price=Decimal("5010.00"),
                      timestamp=_dt(2026, 10, 13, 14, 30), fees=Decimal("4.00"),
                      source="manual", is_demo=True),
            # Losing long: -5 pts on 1 contract = -$250.
            Execution(account_id=apex.id, instrument_id=es.id, side="buy",
                      quantity=Decimal("1"), price=Decimal("5020.00"),
                      timestamp=_dt(2026, 10, 14, 15, 0), fees=Decimal("2.00"),
                      source="manual", is_demo=True),
            Execution(account_id=apex.id, instrument_id=es.id, side="sell",
                      quantity=Decimal("1"), price=Decimal("5015.00"),
                      timestamp=_dt(2026, 10, 14, 15, 10), fees=Decimal("2.00"),
                      source="manual", is_demo=True),
        ]
    if crude is not None:
        # MCX crude winning long: +50 pts * 100 = +5000 INR (quantity in lots).
        execs += [
            Execution(account_id=mcx.id, instrument_id=crude.id, side="buy",
                      quantity=Decimal("1"), price=Decimal("6000"),
                      timestamp=_dt(2026, 10, 13, 6, 0), fees=Decimal("50"),
                      source="manual", is_demo=True),
            Execution(account_id=mcx.id, instrument_id=crude.id, side="sell",
                      quantity=Decimal("1"), price=Decimal("6050"),
                      timestamp=_dt(2026, 10, 13, 8, 0), fees=Decimal("50"),
                      source="manual", is_demo=True),
        ]
    db.add_all(execs)

    if es is not None:
        db.add(DailySession(
            account_id=apex.id,
            instrument_id=es.id,
            trading_date=_dt(2026, 10, 13, 0, 0).date(),
            htf_read="Demo: balance below prior-day VAH; expecting rotation.",
            prior_day_type="Normal Variation",
            expected_open_location="Inside prior value",
            levels=[{"label": "Prior VAH", "price": "5012"},
                    {"label": "Prior POC", "price": "4998"}],
            scenarios=[{"name": "A", "trigger": "Accept above VAH",
                        "entry": "5013", "stop": "5006", "targets": ["5025"],
                        "invalidation": "Back inside value"}],
            followed_plan="yes",
            what_to_repeat="Waited for acceptance.",
            mood=4, sleep=4,
            is_demo=True,
        ))

    db.commit()

    # Build trades from the demo executions if the trade builder is available
    # (Phase 1+). In Phase 0 it is absent, so trades appear once that lands.
    try:
        from app.core.trade_builder import rebuild_all  # type: ignore

        rebuild_all(db)
    except Exception:
        pass

    return {"status": "loaded", "accounts": 2, "executions": len(execs)}


def clear_demo_data(db: Session) -> dict:
    # Delete child rows first to respect foreign keys.
    for model in (Attachment, MistakeFlag, Execution, Trade, DailySession, ImportBatch, Account):
        db.execute(delete(model).where(model.is_demo.is_(True)))
    db.commit()
    return {"status": "cleared"}


def demo_status(db: Session) -> dict:
    return {
        "present": demo_present(db),
        "accounts": db.query(Account).filter(Account.is_demo.is_(True)).count(),
        "executions": db.query(Execution).filter(Execution.is_demo.is_(True)).count(),
        "trades": db.query(Trade).filter(Trade.is_demo.is_(True)).count(),
    }
