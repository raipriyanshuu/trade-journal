"""Demo data: clearly marked (is_demo) and fully removable.

Seeds two accounts, executions (built into trades by the trade builder), two
planned + reviewed trading days, Notion-style journal fields, a missed setup and
synthetic 1-minute bars so every screen -- including replay and MAE/MFE -- has
something to show. Clearing removes only rows flagged is_demo.
"""

from __future__ import annotations

import random
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.trade_builder import recompute_trade_r
from app.models import (
    Account,
    Attachment,
    Bar,
    DailySession,
    Execution,
    ImportBatch,
    Instrument,
    MistakeFlag,
    Tag,
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
        ready = [{"label": label, "done": True} for label in (
            "Slept well / clear head", "Marked HTF levels & value area", "Checked news calendar",
            "Defined max loss for the day", "Wrote scenarios A / B / C")]
        db.add(DailySession(
            account_id=apex.id, instrument_id=None, trading_date=date(2026, 10, 13),
            htf_bias="bullish",
            htf_read="Demo: daily balance breaking higher; value migrating up for 3 sessions.",
            market_context="Overnight held above prior POC. Expect a dip into VAL/demand to be bought; "
                           "longs only while price accepts above 4995.",
            readiness=ready,
            prior_day_type="Normal Variation", prior_profile_shape="P-shape",
            prior_vah="5012", prior_poc="4998", prior_val="4990",
            on_high="5006", on_low="4994", expected_open_location="Inside prior value",
            levels=[{"label": "Prior VAH", "price": "5012"}, {"label": "Prior POC", "price": "4998"},
                    {"label": "Demand", "price": "4995"}],
            scenarios=[
                {"name": "A", "probability": "65-75", "trigger": "Dip into 4995-5000 demand holds",
                 "entry": "5000", "stop": "4990", "targets": "5012 / 5020", "invalidation": "Accept below 4990"},
                {"name": "B", "probability": "25-35", "trigger": "Accept below VAL",
                 "entry": "4988", "stop": "4996", "targets": "4975", "invalidation": "Back above POC"},
            ],
            news_events=[{"time": "2026-10-13T12:30:00+00:00", "label": "CPI"}],
            actual_opening_type="Open test drive", actual_day_type="Normal variation up",
            scenario_played_out="A", followed_plan="yes", day_grade="A",
            what_to_repeat="Waited for the dip into demand before buying.",
            what_to_change="Could have held the runner to VAH.",
            key_lesson="Patience at the level pays; the plan did the work.",
            focus_tomorrow="Only trade at planned locations — no chasing.",
            mood=4, sleep=4, is_demo=True,
        ))
        db.add(DailySession(
            account_id=apex.id, instrument_id=None, trading_date=date(2026, 10, 14),
            htf_bias="bullish", market_context="Gap up; look for a retest of yesterday's VAH as support.",
            readiness=ready[:3] + [{"label": r["label"], "done": False} for r in ready[3:]],
            levels=[{"label": "Prior VAH", "price": "5012"}],
            actual_opening_type="Open auction in range", actual_day_type="Balance",
            scenario_played_out="none", followed_plan="partly", day_grade="C",
            what_to_change="Entered mid-range instead of waiting for 5012.",
            key_lesson="A late chase after missing the first setup cost the day.",
            focus_tomorrow="If I miss the setup, I log it and wait for the next one.",
            mood=2, sleep=3, is_demo=True,
        ))

    db.commit()

    # Build trades from the demo executions (same pipeline as manual entry).
    from app.core.trade_builder import rebuild_all

    rebuild_all(db)
    if es is not None:
        _enrich_demo(db, apex, es, crude, mcx)
        db.add_all(_demo_bars(es.id))
        db.commit()

    from app.core.mistakes import recompute_for_account

    recompute_for_account(db, apex.id)
    recompute_for_account(db, mcx.id)
    return {"status": "loaded", "accounts": 2, "executions": len(execs)}


def _tags(db: Session, pairs: list[tuple[str, str]]) -> list[Tag]:
    out = []
    for category, name in pairs:
        # Case-insensitive: e.g. the spec seed "chased entry" == Notion's "Chased Entry".
        tag = db.scalar(select(Tag).where(Tag.category == category, func.lower(Tag.name) == name.lower()))
        if tag is not None:
            out.append(tag)
    return out


def _enrich_demo(db: Session, apex: Account, es: Instrument, crude: Instrument | None, mcx: Account) -> None:
    """Notion-style journal fields on the demo trades, plus one missed setup."""
    by_open = {t.open_time: t for t in db.scalars(select(Trade).where(Trade.is_demo.is_(True)))}

    t1 = by_open.get(_dt(2026, 10, 13, 14, 0))
    if t1 is not None:
        t1.initial_stop, t1.planned_target = Decimal("4990"), Decimal("5012")
        t1.htf_alignment, t1.entry_quality, t1.exit_quality = "bullish", "A", "B"
        t1.dtr, t1.atr, t1.scenario, t1.planned = Decimal("22"), Decimal("60"), "A", True
        t1.context = "Dip into overnight demand right after the open, above prior POC."
        t1.behaviour = "Waited for the level and sized normally. Exited early before VAH."
        t1.tags = _tags(db, [("setup", "Pullback"), ("location", "Demand/Supply Zones"),
                             ("probability", "65-75"), ("thesis", "Continuation (Thesis Held)")])

    t2 = by_open.get(_dt(2026, 10, 14, 15, 0))
    if t2 is not None:
        t2.initial_stop = Decimal("5014")
        t2.htf_alignment, t2.entry_quality, t2.exit_quality = "bullish", "C", "B"
        t2.dtr, t2.atr, t2.planned = Decimal("41"), Decimal("60"), False
        t2.context = "Price was mid-range after a gap; no planned level nearby."
        t2.behaviour = "Missed the first setup and chased the move. Impatient."
        t2.tags = _tags(db, [("setup", "Retest"), ("location", "Random Area"), ("probability", "35-50"),
                             ("thesis", "Stopped (Analysis was wrong)"), ("mistake", "Chased Entry")])

    t3 = by_open.get(_dt(2026, 10, 13, 6, 0))
    if t3 is not None:
        t3.initial_stop = Decimal("5970")
        t3.htf_alignment, t3.entry_quality, t3.exit_quality = "bullish", "A", "A"
        t3.context = "Crude trending after EIA draw; bought the first VWAP pullback."
        t3.tags = _tags(db, [("setup", "Aggressive Move"), ("location", "VWAP"), ("probability", "75-85"),
                             ("thesis", "Continuation (Thesis Held)")])

    for t in (t1, t2, t3):
        if t is not None:
            recompute_trade_r(db, t)

    missed = Trade(
        account_id=apex.id, instrument_id=es.id, direction="short",
        open_time=_dt(2026, 10, 14, 14, 40), trading_date=date(2026, 10, 14),
        max_position_size=Decimal("1"), currency="USD", status="missed", outcome="missed",
        first_entry_price=Decimal("5024"), initial_stop=Decimal("5028"), planned_target=Decimal("5012"),
        r_multiple=Decimal("3"), gross_pnl=Decimal("0"), fees=Decimal("0"), net_pnl=Decimal("0"),
        source="manual", htf_alignment="bullish", entry_quality="A+",
        context="Failed breakout above the overnight high into prior VAH extension.",
        behaviour="Hesitated because it was counter to the HTF bias.", is_demo=True,
    )
    missed.tags = _tags(db, [("setup", "Failed Breakout"), ("mistake", "Not Able to execute"),
                             ("probability", "50-65")])
    db.add(missed)
    db.commit()


def _demo_bars(instrument_id: int) -> list[Bar]:
    """Deterministic 1-minute ES bars around the demo trades (for replay + MAE/MFE)."""
    rng = random.Random(42)
    paths = [
        (_dt(2026, 10, 13, 13, 30), [(0, 5002), (25, 4996), (30, 5000), (42, 4995.5), (54, 5014.25),
                                     (60, 5010), (75, 5011), (120, 5006)]),
        (_dt(2026, 10, 14, 14, 0), [(0, 5014), (40, 5023.5), (60, 5020), (64, 5023), (70, 5015),
                                    (90, 5009), (120, 5011)]),
    ]
    bars: list[Bar] = []
    tick = Decimal("0.25")
    for start, points in paths:
        prev_close = Decimal(str(points[0][1]))
        for (m0, p0), (m1, p1) in zip(points, points[1:]):
            for m in range(m0, m1):
                frac = (m + 1 - m0) / (m1 - m0)
                target = p0 + (p1 - p0) * frac + rng.uniform(-0.6, 0.6)
                close = (Decimal(str(target)) / tick).to_integral_value() * tick
                o = prev_close
                hi = max(o, close) + tick * rng.randint(0, 3)
                lo = min(o, close) - tick * rng.randint(0, 3)
                bars.append(Bar(instrument_id=instrument_id, timeframe="1m",
                                ts=start + timedelta(minutes=m), open=o, high=hi, low=lo,
                                close=close, volume=Decimal(rng.randint(800, 4000)), is_demo=True))
                prev_close = close
    # Make sure fills sit inside their bars.
    fills = {_dt(2026, 10, 13, 14, 0): 5000, _dt(2026, 10, 13, 14, 30): 5010,
             _dt(2026, 10, 14, 15, 0): 5020, _dt(2026, 10, 14, 15, 10): 5015}
    for b in bars:
        price = fills.get(b.ts)
        if price is not None:
            b.high, b.low = max(b.high, Decimal(price)), min(b.low, Decimal(price))
    return bars


def clear_demo_data(db: Session) -> dict:
    # Delete child rows first to respect foreign keys.
    for model in (Attachment, MistakeFlag, Execution, Trade, DailySession, ImportBatch, Bar, Account):
        db.execute(delete(model).where(model.is_demo.is_(True)))
    db.commit()
    return {"status": "cleared"}


def demo_status(db: Session) -> dict:
    return {
        "present": demo_present(db),
        "accounts": db.query(Account).filter(Account.is_demo.is_(True)).count(),
        "executions": db.query(Execution).filter(Execution.is_demo.is_(True)).count(),
        "trades": db.query(Trade).filter(Trade.is_demo.is_(True)).count(),
        "bars": db.query(Bar).filter(Bar.is_demo.is_(True)).count(),
    }
