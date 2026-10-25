"""CSV import and Notion migration -> executions -> trade builder.

All imports create executions (or, for price-less rows, P&L-only trades) and then
run the trade builder, so imports and manual entry produce identical results.
Duplicates are skipped by external id or a content hash.
"""

from __future__ import annotations

import csv
import hashlib
import io
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.styles import normalize_style
from app.core.sessions import session_open_utc, trading_date_for
from app.core.trade_builder import rebuild_for
from app.models import Execution, ImportBatch, Instrument, Tag, Trade
from app.models.tag import trade_tags

_BUY = {"buy", "b", "bot", "bought", "long"}
_SELL = {"sell", "s", "sld", "sold", "short"}


def sniff_csv(content: bytes) -> dict:
    """Return the detected headers and the first preview rows."""
    text = content.decode("utf-8-sig", errors="replace")
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t|")
        delimiter = dialect.delimiter
    except csv.Error:
        delimiter = ","
    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    headers = reader.fieldnames or []
    rows = []
    for i, row in enumerate(reader):
        if i >= 15:
            break
        rows.append(row)
    return {"headers": headers, "rows": rows, "delimiter": delimiter}


def _rows(content: bytes, delimiter: str | None) -> tuple[list[str], list[dict]]:
    text = content.decode("utf-8-sig", errors="replace")
    if not delimiter:
        try:
            delimiter = csv.Sniffer().sniff(text[:4096], delimiters=",;\t|").delimiter
        except csv.Error:
            delimiter = ","
    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    return (reader.fieldnames or [], list(reader))


def resolve_symbol(raw: str, instruments: list[Instrument], symbol_map: dict) -> Instrument | None:
    if not raw:
        return None
    raw = raw.strip()
    root = symbol_map.get(raw) or symbol_map.get(raw.upper())
    by_root = {i.symbol_root.upper(): i for i in instruments}
    if root and root.upper() in by_root:
        return by_root[root.upper()]
    # Longest-prefix match against known roots on a cleaned symbol.
    cleaned = "".join(ch for ch in raw.upper() if ch.isalnum())
    for inst in sorted(instruments, key=lambda i: len(i.symbol_root), reverse=True):
        if cleaned.startswith(inst.symbol_root.upper()):
            return inst
    return None


def parse_decimal(value) -> Decimal | None:
    if value is None:
        return None
    s = str(value).strip().replace(",", "")
    if s == "":
        return None
    # Handle parenthesised negatives e.g. (123.45)
    neg = s.startswith("(") and s.endswith(")")
    s = s.strip("()").replace("$", "").replace("₹", "").strip()
    try:
        d = Decimal(s)
    except InvalidOperation:
        return None
    return -d if neg else d


def parse_dt(value: str, fmt: str, tz: str) -> datetime | None:
    if not value or not str(value).strip():
        return None
    value = str(value).strip()
    zone = ZoneInfo(tz)
    if fmt and fmt != "auto":
        try:
            naive = datetime.strptime(value, fmt)
            return naive.replace(tzinfo=zone).astimezone(timezone.utc)
        except ValueError:
            pass
    # Auto: try ISO then a set of common formats.
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=zone)
        return dt.astimezone(timezone.utc)
    except ValueError:
        pass
    for f in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%d-%m-%Y %H:%M:%S", "%d/%m/%Y %H:%M",
              "%m/%d/%Y %H:%M:%S", "%m/%d/%Y %H:%M", "%Y-%m-%d", "%d-%m-%Y", "%m/%d/%Y"):
        try:
            naive = datetime.strptime(value, f)
            return naive.replace(tzinfo=zone).astimezone(timezone.utc)
        except ValueError:
            continue
    return None


def normalize_qty(qty: Decimal, unit: str, instrument: Instrument) -> Decimal:
    """Normalize to lots. 'units' divides by the instrument lot size."""
    if unit == "units" and instrument.lot_size and instrument.lot_size != 0:
        return qty / Decimal(instrument.lot_size)
    return qty


def _parse_side(value: str) -> str | None:
    v = (value or "").strip().lower()
    if v in _BUY:
        return "buy"
    if v in _SELL:
        return "sell"
    return None


def _dedup_hash(account_id, instrument_id, ts: datetime, side, qty, price) -> str:
    key = f"{account_id}|{instrument_id}|{ts.isoformat()}|{side}|{qty}|{price}"
    return hashlib.sha256(key.encode()).hexdigest()


def _norm(s: str) -> str:
    return "".join(ch for ch in s.lower() if ch.isalnum())


def _tags_from_row(db: Session, row: dict, tag_columns: list) -> list[int]:
    """Split multi-select cells into tags.

    Each spec is either a column name (category "custom") or
    {"column": ..., "category": ...}. Names match existing tags in that category
    ignoring case/spacing/punctuation, so Notion's "Continuation(Thesis Held)"
    lands on the seeded "Continuation (Thesis Held)".
    """
    ids: list[int] = []
    for spec in tag_columns or []:
        if isinstance(spec, str):
            col, cat = spec, "custom"
        else:
            col, cat = spec.get("column"), spec.get("category", "custom")
        if not col:
            continue
        raw = row.get(col, "") or ""
        existing = {_norm(t.name): t for t in db.scalars(select(Tag).where(Tag.category == cat))}
        for name in [t.strip() for part in raw.split(";") for t in part.split(",")]:
            if not name:
                continue
            tag = existing.get(_norm(name))
            if tag is None:
                tag = Tag(name=name, category=cat)
                db.add(tag)
                db.flush()
                existing[_norm(name)] = tag
            if tag.id not in ids:
                ids.append(tag.id)
    return ids


def parse_outcome(raw: str) -> tuple[str | None, bool]:
    """Notion "Trade" cell -> (outcome, partial_profit)."""
    s = (raw or "").lower()
    partial = "partial" in s
    if "miss" in s:
        return "missed", partial
    if "win" in s:
        return "win", partial
    if "loss" in s or "lost" in s:
        return "loss", partial
    if "break" in s or s.strip() == "be":
        return "breakeven", partial
    if partial:
        return "win", True
    return None, partial


def journal_fields(row: dict, col) -> dict:
    """Notion-style scalar fields from a row (only those present)."""
    out: dict = {}
    for key in ("entry_quality", "exit_quality"):
        v = str(col(row, key)).strip().upper()
        if v:
            out[key] = v
    htf = str(col(row, "htf_alignment")).strip().lower()
    if htf.startswith("bull"):
        out["htf_alignment"] = "bullish"
    elif htf.startswith("bear"):
        out["htf_alignment"] = "bearish"
    elif htf.startswith(("range", "bal", "neutral")):
        out["htf_alignment"] = "range"
    for key in ("context", "behaviour", "notes", "style"):
        v = str(col(row, key)).strip()
        if v:
            out[key] = v
    dtr_atr = str(col(row, "dtr_atr")).strip()
    if "/" in dtr_atr:
        a, b = dtr_atr.split("/", 1)
        out["dtr"], out["atr"] = parse_decimal(a), parse_decimal(b)
    for key in ("dtr", "atr"):
        v = parse_decimal(col(row, key))
        if v is not None:
            out[key] = v
    return {k: v for k, v in out.items() if v is not None}


def run_import(db: Session, *, content: bytes, config: dict) -> dict:
    source = config.get("source", "import")
    account_id = int(config["account_id"])
    fmt = config.get("format", "fills")
    cmap = config.get("column_map", {})
    dt_fmt = config.get("datetime_format", "auto")
    tz = config.get("file_timezone", "UTC")
    unit = config.get("quantity_unit", "instrument")
    symbol_map = config.get("symbol_map", {})
    tag_columns = config.get("tag_columns", [])

    instruments = list(db.scalars(select(Instrument)))
    headers, rows = _rows(content, config.get("delimiter"))

    batch = ImportBatch(
        source=source,
        profile_name=config.get("profile_name"),
        filename=config.get("filename"),
        status="running",
    )
    db.add(batch)
    db.flush()

    read = imported = skipped = failed = 0
    errors: list[str] = []
    affected: set[tuple[int, int]] = set()

    def col(row, field):
        header = cmap.get(field)
        return row.get(header, "") if header else ""

    def qty_unit_for(inst):
        return inst.quantity_unit if unit == "instrument" else unit

    def add_execution(inst, side, qty_lots, price, ts, fees, ext_id, time_known, raw):
        nonlocal imported, skipped
        h = _dedup_hash(account_id, inst.id, ts, side, qty_lots, price)
        dup = db.scalar(select(Execution.id).where(Execution.dedup_hash == h))
        if dup is None and ext_id:
            dup = db.scalar(
                select(Execution.id).where(
                    Execution.external_id == ext_id, Execution.account_id == account_id
                )
            )
        if dup is not None:
            skipped += 1
            return False
        db.add(Execution(
            account_id=account_id, instrument_id=inst.id, side=side,
            quantity=qty_lots, price=price, timestamp=ts, fees=fees or Decimal("0"),
            source=source, external_id=ext_id or None, import_batch_id=batch.id,
            dedup_hash=h, time_known=time_known, raw_source_row=raw,
        ))
        affected.add((account_id, inst.id))
        imported += 1
        return True

    for row in rows:
        read += 1
        try:
            inst = resolve_symbol(str(col(row, "symbol")), instruments, symbol_map)
            if inst is None:
                failed += 1
                errors.append(f"Row {read}: unknown symbol '{col(row, 'symbol')}'")
                continue

            if fmt == "fills":
                side = _parse_side(str(col(row, "side")))
                qty = parse_decimal(col(row, "quantity"))
                price = parse_decimal(col(row, "price"))
                ts = parse_dt(str(col(row, "timestamp")), dt_fmt, tz)
                if side is None or qty is None or price is None:
                    failed += 1
                    errors.append(f"Row {read}: missing side/quantity/price")
                    continue
                time_known = True
                if ts is None:
                    td = trading_date_for(datetime.now(timezone.utc), inst)
                    ts = session_open_utc(td, inst)
                    time_known = False
                fees = parse_decimal(col(row, "fees")) or Decimal("0")
                qlots = normalize_qty(abs(qty), qty_unit_for(inst), inst)
                add_execution(inst, side, qlots, price, ts, fees,
                              str(col(row, "external_id")).strip() or None, time_known, row)

            else:  # roundtrip
                direction = _parse_side(str(col(row, "direction"))) or "buy"
                direction = "long" if direction in ("buy",) or str(col(row, "direction")).lower().startswith("l") else (
                    "short" if str(col(row, "direction")).lower().startswith("s") else "long")
                qty = parse_decimal(col(row, "quantity")) or Decimal("1")
                qlots = normalize_qty(abs(qty), qty_unit_for(inst), inst)
                entry_price = parse_decimal(col(row, "entry_price"))
                exit_price = parse_decimal(col(row, "exit_price"))
                pnl = parse_decimal(col(row, "pnl"))
                fees = parse_decimal(col(row, "fees")) or Decimal("0")
                ext_id = str(col(row, "external_id")).strip() or None
                tag_ids = _tags_from_row(db, row, tag_columns)

                entry_ts = parse_dt(str(col(row, "entry_time")), dt_fmt, tz)
                exit_ts = parse_dt(str(col(row, "exit_time")), dt_fmt, tz)
                time_known = entry_ts is not None
                fields = journal_fields(row, col)
                if "style" in fields:
                    fields["style"] = normalize_style(db, fields["style"])
                outcome, partial = parse_outcome(str(col(row, "outcome")))
                fields["partial_profit"] = partial
                if outcome:
                    fields["outcome"] = outcome

                if outcome == "missed" or entry_price is None or exit_price is None:
                    # Created directly (no executions): a missed setup, a P&L-only
                    # trade, or a label-only trade that only knows Win/Loss.
                    if outcome != "missed" and pnl is None and outcome is None:
                        failed += 1
                        errors.append(f"Row {read}: no prices, no P&L and no Win/Loss label")
                        continue
                    td_src = entry_ts or exit_ts
                    td = trading_date_for(td_src, inst) if td_src else datetime.now(timezone.utc).date()
                    missed = outcome == "missed"
                    known = pnl is not None and not missed
                    t = Trade(
                        account_id=account_id, instrument_id=inst.id, direction=direction,
                        open_time=entry_ts or session_open_utc(td, inst),
                        close_time=None if missed else exit_ts, trading_date=td,
                        max_position_size=qlots, gross_pnl=pnl if known else Decimal("0"),
                        fees=Decimal("0"), net_pnl=pnl if known else Decimal("0"),
                        currency=inst.currency, status="missed" if missed else "closed",
                        source=source, pnl_only=not missed, points_known=False,
                        pnl_known=known or missed, time_known=time_known,
                        first_entry_price=entry_price, import_batch_id=batch.id,
                    )
                    for k, v in fields.items():
                        setattr(t, k, v)
                    db.add(t)
                    db.flush()
                    for tid in tag_ids:
                        db.execute(trade_tags.insert().values(trade_id=t.id, tag_id=tid))
                    imported += 1
                    continue

                # Price-ful round trip -> entry + exit executions.
                entry_side = "buy" if direction == "long" else "sell"
                exit_side = "sell" if direction == "long" else "buy"
                td = trading_date_for(entry_ts, inst) if entry_ts else trading_date_for(
                    datetime.now(timezone.utc), inst)
                e_ts = entry_ts or session_open_utc(td, inst)
                x_ts = exit_ts or session_open_utc(td, inst)
                added = add_execution(inst, entry_side, qlots, entry_price, e_ts, fees, ext_id, time_known, row)
                add_execution(inst, exit_side, qlots, exit_price, x_ts, Decimal("0"),
                              (ext_id + "-x") if ext_id else None, exit_ts is not None, row)
                # Attach row tags + journal fields to the trade after rebuild.
                if added and (tag_ids or fields):
                    pending = config.setdefault("_pending_meta", {})
                    pending[_dedup_hash(account_id, inst.id, e_ts, entry_side, qlots, entry_price)] = {
                        "tag_ids": tag_ids, "fields": fields,
                    }
        except Exception as exc:  # noqa: BLE001 - row-level resilience
            failed += 1
            errors.append(f"Row {read}: {exc}")

    db.commit()

    for acc_id, inst_id in affected:
        rebuild_for(db, acc_id, inst_id)

    # Apply round-trip row tags + journal fields to the rebuilt trades
    # (matched by entry execution hash). Stored on the trade, so later rebuilds
    # preserve them via the builder's metadata anchoring.
    pending = config.get("_pending_meta", {})
    if pending:
        for h, meta in pending.items():
            ex = db.scalar(select(Execution).where(Execution.dedup_hash == h))
            if not (ex and ex.trade_id):
                continue
            trade = db.get(Trade, ex.trade_id)
            for k, v in meta["fields"].items():
                if k == "outcome":
                    continue  # priced trades are classified from real P&L
                setattr(trade, k, v)
            for tid in meta["tag_ids"]:
                exists = db.scalar(
                    select(trade_tags.c.tag_id).where(
                        trade_tags.c.trade_id == ex.trade_id, trade_tags.c.tag_id == tid
                    )
                )
                if not exists:
                    db.execute(trade_tags.insert().values(trade_id=ex.trade_id, tag_id=tid))
        db.commit()

    batch.rows_read = read
    batch.rows_imported = imported
    batch.rows_skipped = skipped
    batch.rows_failed = failed
    batch.status = "completed"
    batch.details = "\n".join(errors[:50])
    db.commit()

    from app.core.mistakes import recompute_for_account

    recompute_for_account(db, account_id)

    return {
        "batch_id": batch.id,
        "rows_read": read,
        "imported": imported,
        "skipped": skipped,
        "failed": failed,
        "errors": errors[:50],
    }


def undo_batch(db: Session, batch_id: int) -> dict:
    batch = db.get(ImportBatch, batch_id)
    if batch is None:
        return {"status": "not_found"}
    affected: set[tuple[int, int]] = set()
    for ex in db.scalars(select(Execution).where(Execution.import_batch_id == batch_id)):
        affected.add((ex.account_id, ex.instrument_id))
        db.delete(ex)
    # Remove P&L-only trades created directly by this batch.
    for t in db.scalars(select(Trade).where(Trade.import_batch_id == batch_id)):
        db.delete(t)
    db.commit()
    for acc_id, inst_id in affected:
        rebuild_for(db, acc_id, inst_id)
    db.delete(batch)
    db.commit()
    from app.core.mistakes import recompute_for_account

    for acc_id in {a for a, _ in affected}:
        recompute_for_account(db, acc_id)
    return {"status": "undone"}
