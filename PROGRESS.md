# Progress

## Phase 0 — Foundation ✅ (complete)

### What was built

**Project & tooling**
- Git repository, `README.md`, this `PROGRESS.md`.
- Backend skeleton: FastAPI + SQLAlchemy 2.x + SQLite + Pydantic, with Alembic
  migrations wired up from the start (initial migration generated).
- Frontend skeleton: React + Vite + TypeScript + Tailwind, dark trading-tool theme,
  sidebar navigation, and placeholder pages for the screens built in later phases.
- One-command start scripts: `start.bat` (Windows) and `start.sh` (macOS/Linux).
  They create the venv, install deps on first run, run migrations, build the
  frontend, serve it from the backend, and open `http://127.0.0.1:8000`.
- Server binds to `127.0.0.1` only.

**Data model (all tables except `bars`, which comes in Phase 7)**
- `accounts` (incl. prop-rule fields for Phase 6), `instruments`, `executions`,
  `trades` (incl. the auction-market context fields), `tags` + `trade_tags`,
  `daily_sessions` (full morning-plan / evening-review fields), `mistake_flags`
  (with a `dismissed` flag), `attachments`, `import_batches`, `mapping_profiles`,
  `settings` (key/value).
- Money and prices are stored as exact `Decimal` strings (TEXT). Timestamps are
  stored in UTC via a custom column type.
- A `is_demo` flag on the main record types makes demo data fully removable.

**Settings page (functional now)**
- **Instruments:** the seeded instrument master with a **"verify" badge** on every
  seeded row (unverified until you confirm it). Inline "Verify", full edit modal,
  and you can add new instruments. Seeded: ES, MES, NQ, MNQ, GC, MGC, CL, MCL,
  NIFTY, CRUDEOIL, CRUDEOILM, GOLD, GOLDM, SILVER, SILVERM, NATURALGAS, each with
  point value, tick size, lot size, quantity unit (lots/units) and session rules.
- **Accounts:** create / edit / delete, with prop-rule fields (account size,
  profit target, daily loss limit, max drawdown type/amount, max contracts).
- **Preferences:** display time zone (default Asia/Kolkata), USD/INR rate for the
  combined view, and breakeven thresholds per currency.
- **Demo Data:** load / clear clearly-marked sample data.

### Known limitations (by design for Phase 0)
- Demo data currently loads accounts, executions and a daily session. It will show
  **trades** once the trade builder lands in Phase 1 (the loader already calls the
  builder when present).
- Dashboard, Trade Log, Journal, Mistakes, Analytics and Prop Tracker are
  placeholders that name the phase that builds them.
- All seeded instrument specs and Indian lot sizes are **unverified** — please
  confirm them in Settings against your broker before trusting the numbers.

### How to verify Phase 0 in the browser
See the "Verify" steps in the chat summary. In short: start the app, open
**Settings → Instruments** (check the verify badges, edit one, verify one),
**Accounts** (add one), **Preferences** (change tz/rate and save), and
**Demo Data** (load, see the status, clear).

### Tests
`backend/tests/` — covers the instrument/settings/mistake-tag seeds, the API for
instruments/accounts/settings, and the demo load/clear round-trip. Run with
`pytest` from `backend/`.

---

## Phase 1 — Trade engine and manual entry ✅ (complete)

### What was built

**Trade builder** (`app/core/trade_builder.py`) — the only code that creates trades:
- Per account+instrument, executions sorted by time with net-position tracking.
- A trade opens when position leaves zero and closes when it returns to zero.
- A flipping fill (e.g. long 2 → short 1) is split: part closes the current
  trade, the rest opens a new one in the opposite direction.
- Size-weighted average entry/exit. Realized P&L = (sell value − buy value) ×
  point value − fees. Open trades (not flat) stay `open` with partial realized P&L.
- User metadata (stop, target, risk, context, tags, notes, rating, attachments)
  is **preserved across rebuilds** by anchoring to the trade's earliest execution.
- Rebuild re-runs automatically after any create, edit, delete or import.

**Sessions / trading dates** (`app/core/sessions.py`):
- Trading-date assignment per instrument session rules, via `zoneinfo` (added
  `tzdata`), correct across US daylight-saving changes. CME overnight fills roll
  to the next trading day; NSE/MCX use the local calendar date.

**R-multiple:** planned risk if given, else `|first entry − stop| × max size ×
point value`; empty when neither exists (excluded from R stats).

**Manual entry** (`POST /api/trades/manual`): account, instrument, direction,
multiple entries/exits (scale in/out) with time+price+qty, stop/target/risk/fees,
full context fields and tags. Creates executions, then runs the builder — the
same pipeline as imports.

**APIs:** trades (list with filters: date range, account, instrument, direction,
result, status, scenario, source, tag; + detail, edit, delete), executions
(edit/delete → rebuild), attachments (upload + paste, delete), tags (list/create).

**Frontend:**
- **Trade Log**: filter bar, per-currency P&L chips (USD and INR never mixed),
  sortable table, row → detail.
- **Manual entry form**: dynamic entry/exit legs, direction toggle, live
  risk/planned-R preview, context + tags + notes.
- **Trade detail**: computed KPIs, executions (inline edit/delete), context edit,
  notes, screenshots (upload + clipboard paste), delete trade.

### Tests (43 total, all passing)
`test_trade_builder.py` covers simple long/short, scale in/out, partial fills,
position flip, two trades in a day, open position at end, fees, Nifty & MCX point
values, R-from-stop, R-from-planned-risk, and metadata preservation.
`test_sessions.py` covers CME overnight/daytime, DST stability, NSE and MCX.
`test_trades_api.py` covers manual entry, naive-time→UTC, edits, delete, execution
edit rebuild, and result/direction filters.

### Known limitations
- Manual-entry times use the browser's local clock (assumed = display tz, IST).
- Trade↔execution linking assigns a flipping fill to the first trade it touches
  (R and P&L are unaffected; `first_entry_price` is stored for exact R).
- Bulk tagging, CSV/Notion import, the daily journal and analytics come later.

---

## Next: Phase 2 — CSV import, Notion migration and export
Generic CSV importer with a mapping wizard (fills + round-trip), duplicate
detection, import history with undo, Notion migration, and CSV/Excel/backup export.
