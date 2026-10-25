"""Backtest API (``/api/backtest``). Reads and writes ``backtest.db`` only.

Every action that changes the replay (step, jump, order, close, edit) returns
the same ``state`` payload: chart candles up to the cursor, VWAP, trade markers
and lines, the session's trades and balance.
"""

from __future__ import annotations

import re
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.backtest import engine
from app.backtest.candles import (
    bars_between, bucket, build_chart, chart_time, coverage, day_start, last_bar, next_bars, step_base,
)
from app.backtest.data import load_symbol
from app.backtest.db import get_bt_db
from app.backtest.instruments import BASES, INSTRUMENTS, TIMEFRAMES, contract_spec
from app.backtest.models import BtSession, BtTrade
from app.backtest.stats import dashboard
from app.config import settings
from app.core.market_data import MarketDataError

router = APIRouter(prefix="/api/backtest", tags=["backtest"])


def _tz() -> str:
    """Display timezone from the journal's settings (read-only)."""
    from app.db import SessionLocal
    from app.models import Setting

    try:
        with SessionLocal() as db:
            s = db.get(Setting, "display_timezone")
            return s.value if s and s.value else "Asia/Kolkata"
    except Exception:  # noqa: BLE001
        return "Asia/Kolkata"


def snapshots_dir():
    d = settings.data_dir / "backtest_snapshots"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _iso(ts: int | None) -> str | None:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat() if ts else None


def _session_or_404(db: Session, sid: int) -> BtSession:
    s = db.get(BtSession, sid)
    if s is None:
        raise HTTPException(404, "Backtest session not found")
    return s


def _trade_or_404(db: Session, tid: int) -> BtTrade:
    t = db.get(BtTrade, tid)
    if t is None:
        raise HTTPException(404, "Backtest trade not found")
    return t


def _tf(tf: str | None, s: BtSession) -> str:
    tf = tf or s.timeframe
    if tf not in TIMEFRAMES:
        raise HTTPException(422, f"Unknown timeframe {tf}")
    return tf


# ------------------------------------------------------------------ instruments
@router.get("/instruments")
def instruments(db: Session = Depends(get_bt_db)) -> list[dict]:
    out = []
    for sym, inst in INSTRUMENTS.items():
        cov = coverage(db, sym)
        out.append({
            "symbol": sym, "name": inst["name"], "yahoo": inst["yahoo"], "tick": inst["tick"],
            "point_value": inst["point_value"], "micro": inst["micro"],
            "micro_point_value": inst["micro_point_value"],
            "fee_full": inst["fee_full"], "fee_micro": inst["fee_micro"],
            "coverage": {b: {"first": _iso(c["first"]), "last": _iso(c["end"]), "bars": c["bars"]}
                         for b, c in cov.items()},
        })
    return out


@router.post("/data/{symbol}/load")
def load_data(symbol: str, db: Session = Depends(get_bt_db)) -> dict:
    if symbol not in INSTRUMENTS:
        raise HTTPException(404, "Unknown instrument")
    try:
        res = load_symbol(db, symbol)
    except MarketDataError as exc:
        raise HTTPException(502, str(exc))
    return {"symbol": symbol, "result": res}


# --------------------------------------------------------------------- sessions
class SessionCreate(BaseModel):
    name: str = ""
    strategy: str = Field(min_length=1)
    symbol: str
    contract: str = "full"
    starting_balance: float = 10000
    risk_per_trade: float = 100
    fee_per_contract: float | None = None
    timeframe: str = "1h"
    start_date: date
    notes: str = ""


class SessionUpdate(BaseModel):
    name: str | None = None
    strategy: str | None = None
    starting_balance: float | None = None
    risk_per_trade: float | None = None
    fee_per_contract: float | None = None
    timeframe: str | None = None
    notes: str | None = None
    archived: bool | None = None


def _session_summary(s: BtSession) -> dict:
    closed = [t for t in s.trades if t.status == "closed"]
    wins = sum(1 for t in closed if t.net > 0)
    net = round(sum(t.net for t in closed), 2)
    return {
        "id": s.id, "name": s.name, "strategy": s.strategy, "symbol": s.symbol, "contract": s.contract,
        "contract_label": contract_spec(s.symbol, s.contract)["label"],
        "point_value": s.point_value, "tick_size": s.tick_size,
        "starting_balance": s.starting_balance, "risk_per_trade": s.risk_per_trade,
        "fee_per_contract": s.fee_per_contract, "timeframe": s.timeframe,
        "start_at": _iso(s.start_at), "revealed_until": _iso(s.revealed_until),
        "notes": s.notes, "archived": s.archived,
        "trades": len(closed), "open_trades": sum(1 for t in s.trades if t.status == "open"),
        "win_rate": round(wins / len(closed), 4) if closed else 0.0,
        "net": net, "balance": round(s.starting_balance + net, 2),
    }


@router.get("/sessions")
def list_sessions(db: Session = Depends(get_bt_db)) -> list[dict]:
    rows = db.scalars(select(BtSession).order_by(BtSession.archived, BtSession.id.desc())).all()
    return [_session_summary(s) for s in rows]


@router.post("/sessions", status_code=201)
def create_session(p: SessionCreate, db: Session = Depends(get_bt_db)) -> dict:
    if p.symbol not in INSTRUMENTS:
        raise HTTPException(422, "Unknown instrument")
    if p.contract not in ("full", "micro"):
        raise HTTPException(422, "contract must be 'full' or 'micro'")
    if p.timeframe not in TIMEFRAMES:
        raise HTTPException(422, "Unknown timeframe")
    spec = contract_spec(p.symbol, p.contract)
    start = day_start(p.start_date)
    s = BtSession(
        name=p.name.strip() or f"{p.strategy.strip()} - {spec['label']}",
        strategy=p.strategy.strip(), symbol=p.symbol, contract=p.contract,
        point_value=spec["point_value"], tick_size=spec["tick_size"],
        starting_balance=p.starting_balance, risk_per_trade=p.risk_per_trade,
        fee_per_contract=spec["fee_per_contract"] if p.fee_per_contract is None else p.fee_per_contract,
        timeframe=p.timeframe, start_at=start, revealed_until=start, notes=p.notes,
    )
    db.add(s)
    db.commit()
    return _session_summary(s)


@router.patch("/sessions/{sid}")
def update_session(sid: int, p: SessionUpdate, db: Session = Depends(get_bt_db)) -> dict:
    s = _session_or_404(db, sid)
    data = p.model_dump(exclude_unset=True)
    if "timeframe" in data and data["timeframe"] not in TIMEFRAMES:
        raise HTTPException(422, "Unknown timeframe")
    if "strategy" in data and not (data["strategy"] or "").strip():
        raise HTTPException(422, "Strategy can't be empty")
    for k, v in data.items():
        setattr(s, k, v.strip() if isinstance(v, str) and k in ("name", "strategy") else v)
    if "fee_per_contract" in data:
        for t in s.trades:
            engine.recompute(t, s)
    db.commit()
    return _session_summary(s)


@router.delete("/sessions/{sid}", status_code=204)
def delete_session(sid: int, db: Session = Depends(get_bt_db)):
    s = _session_or_404(db, sid)
    for t in s.trades:
        _remove_snapshot(t)
    db.delete(s)
    db.commit()


# ------------------------------------------------------------------------ state
def _serialize_trade(t: BtTrade, s: BtSession, last_price: float | None) -> dict:
    return {
        "id": t.id, "session_id": t.session_id, "symbol": t.symbol, "direction": t.direction,
        "qty": t.qty, "remaining": engine.remaining_qty(t),
        "entry_time": _iso(t.entry_ts), "entry_price": t.entry_price,
        "initial_stop": t.initial_stop, "stop": t.stop, "target": t.target,
        "status": t.status, "exits": t.exits or [], "exit_reason": t.exit_reason,
        "close_time": _iso(t.close_ts), "gross": t.gross, "fees": t.fees, "net": t.net,
        "r_multiple": t.r_multiple, "mae": round(t.mae, 6), "mfe": round(t.mfe, 6),
        "setup": t.setup, "notes": t.notes, "snapshot": bool(t.snapshot),
        "unrealized": engine.unrealized(t, s, last_price) if t.status == "open" and last_price else 0.0,
    }


def _markers(s: BtSession, tf: str, zone: ZoneInfo) -> list[dict]:
    out = []
    for t in s.trades:
        if t.entry_ts > s.revealed_until:
            continue
        long = t.direction == "long"
        out.append({
            "time": chart_time(bucket(t.entry_ts - 1, tf), tf, zone),
            "position": "belowBar" if long else "aboveBar",
            "color": "#22c58b" if long else "#f0566b",
            "shape": "arrowUp" if long else "arrowDown",
            "text": f"{'B' if long else 'S'} {t.qty:g} @ {t.entry_price:g}",
        })
        for e in t.exits or []:
            if e["ts"] > s.revealed_until:
                continue
            out.append({
                "time": chart_time(bucket(e["ts"] - 1, tf), tf, zone),
                "position": "aboveBar" if long else "belowBar",
                "color": "#f0566b" if e["reason"] == "stop" else "#22c58b" if e["reason"] == "target" else "#9aa6b8",
                "shape": "circle",
                "text": f"{e['reason']} {e['price']:g}",
            })
    return sorted(out, key=lambda m: m["time"])


def _lines(s: BtSession) -> list[dict]:
    out = []
    for t in s.trades:
        if t.status != "open":
            continue
        out.append({"trade_id": t.id, "kind": "entry", "price": t.entry_price})
        if t.stop is not None:
            out.append({"trade_id": t.id, "kind": "stop", "price": t.stop})
        if t.target is not None:
            out.append({"trade_id": t.id, "kind": "target", "price": t.target})
    return out


def _state(db: Session, s: BtSession, tf: str, since: int | None = None, events: list | None = None,
           message: str | None = None) -> dict:
    zone = ZoneInfo(_tz())
    chart = build_chart(db, s.symbol, tf, s.start_at, s.revealed_until, zone, since=since, tick=s.tick_size)
    lb = last_bar(db, s.symbol, s.revealed_until)
    price = lb.close if lb else None
    trades = [_serialize_trade(t, s, price) for t in s.trades]
    closed_net = sum(t.net for t in s.trades)  # includes realised part of open trades
    open_pnl = sum(t["unrealized"] for t in trades)
    return {
        "session": _session_summary(s),
        "tf": tf,
        "chart": chart,
        "incremental": since is not None,
        "markers": _markers(s, tf, zone),
        "lines": _lines(s),
        "last": {"price": price, "time": _iso(s.revealed_until)},
        "trades": trades,
        "balance": round(s.starting_balance + closed_net, 2),
        "equity": round(s.starting_balance + closed_net + open_pnl, 2),
        "open_pnl": round(open_pnl, 2),
        "events": events or [],
        "message": message,
        "tz": zone.key,
    }


@router.get("/sessions/{sid}/state")
def get_state(sid: int, tf: str | None = None, since: int | None = None, db: Session = Depends(get_bt_db)):
    s = _session_or_404(db, sid)
    tf = _tf(tf, s)
    if s.timeframe != tf:
        s.timeframe = tf
        db.commit()
    return _state(db, s, tf, since)


class StepRequest(BaseModel):
    tf: str | None = None
    mode: str = "bar"  # bar = one base bar, candle = one chart candle
    count: int = Field(1, ge=1, le=500)
    since: int | None = None


@router.post("/sessions/{sid}/step")
def step(sid: int, p: StepRequest, db: Session = Depends(get_bt_db)):
    s = _session_or_404(db, sid)
    tf = _tf(p.tf, s)
    cov = coverage(db, s.symbol)
    base = step_base(cov, tf, s.revealed_until)
    if base is None:
        raise HTTPException(409, f"No {s.symbol} data for this timeframe yet. Load history first.")
    if p.mode == "candle":
        per = max(1, TIMEFRAMES[tf] // BASES[base])
        pool = next_bars(db, s.symbol, base, s.revealed_until, per * (p.count + 1) + 50)
        # Reveal whole chart candles; finishing a half-shown candle counts as one.
        nb, seen = [], []
        for b in pool:
            k = bucket(b.ts, tf)
            if k not in seen:
                if len(seen) == p.count:
                    break
                seen.append(k)
            nb.append(b)
    else:
        nb = next_bars(db, s.symbol, base, s.revealed_until, p.count)
    if not nb:
        return _state(db, s, tf, p.since, message="End of the available data.")
    open_trades = [t for t in s.trades if t.status == "open"]
    events = engine.process(open_trades, s, nb)
    s.revealed_until = nb[-1].ts + nb[-1].dur
    s.timeframe = tf
    db.commit()
    return _state(db, s, tf, p.since, events)


class JumpRequest(BaseModel):
    to: date  # trading date: the replay opens at that day's session open
    tf: str | None = None


@router.post("/sessions/{sid}/jump")
def jump(sid: int, p: JumpRequest, db: Session = Depends(get_bt_db)):
    s = _session_or_404(db, sid)
    tf = _tf(p.tf, s)
    target = day_start(p.to)
    open_trades = [t for t in s.trades if t.status == "open"]
    events: list = []
    if target < s.revealed_until and open_trades:
        raise HTTPException(409, "Close your open trades before going back in time.")
    if target > s.revealed_until and open_trades:
        cov = coverage(db, s.symbol)
        base = step_base(cov, "1h", s.revealed_until) or step_base(cov, "1D", s.revealed_until)
        if base:
            events = engine.process(open_trades, s, bars_between(db, s.symbol, base, s.revealed_until, target))
    s.revealed_until = target
    if target < s.start_at:
        s.start_at = target
    db.commit()
    return _state(db, s, tf, None, events)


# ------------------------------------------------------------------------ orders
class OrderRequest(BaseModel):
    direction: str
    qty: float = Field(gt=0)
    stop: float | None = None
    target: float | None = None
    setup: str = ""
    notes: str = ""
    tf: str | None = None
    since: int | None = None


def _check_levels(direction: str, price: float, stop: float | None, target: float | None) -> None:
    long = direction == "long"
    if stop is not None and ((long and stop >= price) or (not long and stop <= price)):
        raise HTTPException(422, f"Stop must be {'below' if long else 'above'} the current price ({price:g}).")
    if target is not None and ((long and target <= price) or (not long and target >= price)):
        raise HTTPException(422, f"Target must be {'above' if long else 'below'} the current price ({price:g}).")


def _snap(v: float | None, tick: float) -> float | None:
    return None if v is None else round(round(v / tick) * tick, 6)


@router.post("/sessions/{sid}/orders", status_code=201)
def place_order(sid: int, p: OrderRequest, db: Session = Depends(get_bt_db)):
    s = _session_or_404(db, sid)
    tf = _tf(p.tf, s)
    if p.direction not in ("long", "short"):
        raise HTTPException(422, "direction must be 'long' or 'short'")
    lb = last_bar(db, s.symbol, s.revealed_until)
    if lb is None:
        raise HTTPException(409, "No price yet: load history and step forward first.")
    price = lb.close
    stop, target = _snap(p.stop, s.tick_size), _snap(p.target, s.tick_size)
    _check_levels(p.direction, price, stop, target)
    t = BtTrade(
        session_id=s.id, symbol=s.symbol, direction=p.direction, qty=p.qty,
        entry_ts=s.revealed_until, entry_price=price, initial_stop=stop, stop=stop, target=target,
        status="open", exits=[], setup=p.setup.strip(), notes=p.notes,
    )
    db.add(t)
    db.commit()
    db.expire(s, ["trades"])
    return _state(db, s, tf, p.since)


class TradeUpdate(BaseModel):
    stop: float | None = None
    target: float | None = None
    setup: str | None = None
    notes: str | None = None
    tf: str | None = None
    since: int | None = None


@router.patch("/trades/{tid}")
def update_trade(tid: int, p: TradeUpdate, db: Session = Depends(get_bt_db)):
    t = _trade_or_404(db, tid)
    s = t.session
    data = p.model_dump(exclude_unset=True)
    if ("stop" in data or "target" in data) and t.status == "open":
        lb = last_bar(db, s.symbol, s.revealed_until)
        stop = _snap(data["stop"], s.tick_size) if "stop" in data else t.stop
        target = _snap(data["target"], s.tick_size) if "target" in data else t.target
        if lb:
            _check_levels(t.direction, lb.close, stop if "stop" in data else None,
                          target if "target" in data else None)
        t.stop, t.target = stop, target
        if t.initial_stop is None and stop is not None:
            t.initial_stop = stop  # first stop placed defines the trade's risk
            engine.recompute(t, s)
    if "setup" in data:
        t.setup = (data["setup"] or "").strip()
    if "notes" in data:
        t.notes = data["notes"] or ""
    db.commit()
    return _state(db, s, _tf(p.tf, s), p.since)


class CloseRequest(BaseModel):
    qty: float | None = None  # None = everything left
    tf: str | None = None
    since: int | None = None


@router.post("/trades/{tid}/close")
def close_trade(tid: int, p: CloseRequest, db: Session = Depends(get_bt_db)):
    t = _trade_or_404(db, tid)
    s = t.session
    if t.status != "open":
        raise HTTPException(409, "Trade is already closed")
    lb = last_bar(db, s.symbol, s.revealed_until)
    if lb is None:
        raise HTTPException(409, "No price available")
    engine.close(t, s, lb.close, s.revealed_until, "manual", p.qty)
    db.commit()
    events = [{"trade_id": t.id, "reason": "manual", "price": lb.close, "net": t.net, "r": t.r_multiple}] \
        if t.status == "closed" else []
    return _state(db, s, _tf(p.tf, s), p.since, events)


def _remove_snapshot(t: BtTrade) -> None:
    if t.snapshot:
        try:
            (snapshots_dir() / t.snapshot).unlink(missing_ok=True)
        except OSError:
            pass


@router.delete("/trades/{tid}", status_code=204)
def delete_trade(tid: int, db: Session = Depends(get_bt_db)):
    t = _trade_or_404(db, tid)
    _remove_snapshot(t)
    db.delete(t)
    db.commit()


@router.post("/trades/{tid}/snapshot")
async def upload_snapshot(tid: int, file: UploadFile = File(...), db: Session = Depends(get_bt_db)) -> dict:
    t = _trade_or_404(db, tid)
    data = await file.read()
    if not data.startswith(b"\x89PNG"):
        raise HTTPException(422, "Snapshot must be a PNG image")
    _remove_snapshot(t)
    name = f"bt-{t.id}-{int(datetime.now(timezone.utc).timestamp())}.png"
    (snapshots_dir() / name).write_bytes(data)
    t.snapshot = name
    db.commit()
    return {"ok": True}


@router.get("/trades/{tid}/snapshot")
def get_snapshot(tid: int, db: Session = Depends(get_bt_db)):
    t = _trade_or_404(db, tid)
    if not t.snapshot or not re.fullmatch(r"bt-\d+-\d+\.png", t.snapshot):
        raise HTTPException(404, "No snapshot")
    path = snapshots_dir() / t.snapshot
    if not path.exists():
        raise HTTPException(404, "No snapshot")
    return FileResponse(path, media_type="image/png")


# ------------------------------------------------------------------------- stats
@router.get("/stats")
def stats(strategy: str | None = None, symbol: str | None = None, session_id: int | None = None,
          include_archived: bool = True, db: Session = Depends(get_bt_db)) -> dict:
    q = select(BtSession)
    if strategy:
        q = q.where(BtSession.strategy == strategy)
    if symbol:
        q = q.where(BtSession.symbol == symbol)
    if session_id:
        q = q.where(BtSession.id == session_id)
    if not include_archived:
        q = q.where(BtSession.archived.is_(False))
    sessions = {s.id: s for s in db.scalars(q)}
    trades = [t for s in sessions.values() for t in s.trades]
    out = dashboard(trades, sessions, _tz())
    out["trades"] = [
        {**_serialize_trade(t, sessions[t.session_id], None), "strategy": sessions[t.session_id].strategy}
        for t in sorted(trades, key=lambda t: t.close_ts or 0, reverse=True) if t.status == "closed"
    ]
    return out


@router.get("/strategies")
def strategies(db: Session = Depends(get_bt_db)) -> list[str]:
    return sorted({s for s in db.scalars(select(BtSession.strategy)) if s})


@router.get("/setups")
def setups(db: Session = Depends(get_bt_db)) -> list[str]:
    return sorted({s for s in db.scalars(select(BtTrade.setup)) if s})
