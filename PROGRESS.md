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

## Phase 2 — CSV import, Notion migration and export ✅ (complete)

- **Generic CSV importer** (`app/core/importing.py`) through the same pipeline:
  rows → executions → trade builder. Two formats: **fills** (one row per
  execution) and **round-trip** (one row per trade, converted to entry+exit
  executions). Mapping of columns → fields, date/time format + file time zone,
  quantity unit (lots/units, normalized to lots), and symbol mapping
  (explicit map + longest-prefix auto-detect: `ESZ6`→ES, `NIFTY26OCTFUT`→NIFTY).
- **Mapping profiles** saved/loaded by name for reuse.
- **Duplicate detection** by external id or a content hash; summary of read /
  imported / skipped / failed with per-row reasons.
- **Import history** with whole-batch **undo**.
- **Notion migration:** multi-select columns → tags, missing times → session
  open with `time_known=false`, and **P&L-only trades** (no prices) created
  directly and excluded from point/R stats (preserved across rebuilds).
- **Export:** trades & executions CSV, a full **Excel workbook** (trades,
  executions, tags, daily_sessions, mistake_flags), and a one-click **backup
  zip** (consistent SQLite snapshot + attachments) with **restore**.
- Frontend **Import / Export** page: mapping wizard with live preview, import
  history + undo, export/backup/restore.
- 7 import tests (symbol resolution, fills, round-trip units→lots, duplicates,
  undo, Notion P&L-only + tags, P&L-only survives rebuild). **50 tests total.**

---

## Phase 3 — Context, tagging and the daily journal ✅ (complete)

- **Tag management:** create, rename, archive/unarchive, delete and **merge**
  (move all trades onto another tag), by category — in Settings → Tags.
- **Bulk tagging** from the Trade Log: select rows, add/remove a tag across all.
- **Daily journal** page per trading date + account:
  - Morning plan: HTF read, prior day type/shape, prior VAH/POC/VAL, overnight
    high/low/POC/VWAP, range-vs-ATR, inventory, expected open, up to 6 levels,
    scenarios A/B/C (trigger/entry/stop/targets/invalidation), news events.
  - Evening review: actual opening/day type, scenario played out, followed plan,
    what to repeat/change, mood & sleep.
  - That day's trades listed with day P&L; **copy previous levels** helper.
  - Journal screenshots (upload endpoint).
- 5 new tests (journal upsert/copy, tag rename/archive/merge, bulk tag).
  **55 tests total.**

---

## Phase 4 — Mistake engine ✅ (complete)

- **13 configurable auto rules** (`app/core/mistakes.py`): REVENGE, TWO_STRIKES,
  OVERTRADING, AFTER_DAILY_LIMIT, LOSS_EXCEEDS_PLAN, NO_STOP, OVERSIZE,
  ADDED_TO_LOSER, FIRST_MINUTES, NEWS_WINDOW, UNPLANNED, FADED_TREND_DAY,
  HELD_LOSERS. Each has a plain-English explanation and editable thresholds;
  each can be switched on/off (Settings → Mistake rules).
- The engine **re-runs automatically** after any trade/execution/import/journal
  change, for the affected account. **Dismissed false positives survive rebuilds.**
- Manual mistake flags/tags and auto flags both count as mistakes.
- **Mistakes page:** cost of mistakes ranked by $ (with drill-down to trades),
  clean-vs-mistake stat comparison, the **actual vs without-mistakes equity
  overlay**, when mistakes happen (by weekday / time-in-session / trade number),
  after-loss behaviour, weekly trend, and the **clean streak** (days since last
  violation + best).
- Trade detail shows flags with dismiss/restore and manual-flag add.
- Shared `stats.py` (win rate, PF, expectancy $/R, drawdown, streaks) reused in
  Phase 5. 9 engine tests. **64 tests total.**

---

## Phase 5 — Dashboard and analytics ✅ (complete)

- **Dashboard:** full KPI grid (net P&L per currency, win rate, profit factor,
  expectancy $/R, avg win/loss & ratio, max drawdown $/%, largest win/loss,
  win/loss streaks, avg holding winners vs losers) plus cumulative P&L (area),
  drawdown, daily P&L bars and the R-multiple distribution histogram.
- **P&L calendar:** monthly heatmap of daily net P&L with trade counts and win%,
  weekly totals column, month nav; clicking a day opens that day's journal.
- **Breakdowns:** every dimension from the spec — instrument, account, direction,
  time-in-session, clock time (IST), weekday, setup tag, scenario, planned,
  checklist score, VWAP, entry location, day type, opening type, holding bucket,
  position size — each with trades, win%, net, avg, PF, expectancy R + bar chart.
- Global analytics filter bar (account, instrument, currency, date range, demo),
  reused across Dashboard, Mistakes, Calendar and Breakdowns.
- 4 analytics tests. **68 tests total.**

---

## Next: Phase 6 — Prop-firm tracker
Per-account prop rules, live status cards (balance, target, daily loss, drawdown
floor, consistency, trading days), colour warnings, and balance-vs-floor history.
