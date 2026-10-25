# CLAUDE.md — Trade Journal

Context for Claude Code sessions in this repo. Read this first, then `PROGRESS.md`
(what is built, phase by phase) and `README.md` (how to run).

## What this is
A **local, single-user trading journal** ("my own TradeZella") for a discretionary
futures trader in India (display time zone **Asia/Kolkata / IST**). They trade
**CME** (ES/MES, NQ/MNQ, Gold GC/MGC, Crude CL/MCL — prop-firm accounts, USD) and
**Indian markets** (NSE Nifty futures, MCX commodities — INR), using orderflow and
Market Profile / auction-market concepts (James Dalton: day types, opening types,
value area, scenarios A/B/C). Their old journal is a Notion database; this app
mirrors its fields (see "Journal model" below).

Runs only on `127.0.0.1:8000`, data in SQLite under `data/`. Start with
`.\start.bat` (PowerShell needs the `.\`) or `./start.sh`.

## Stack
- **Backend:** Python 3.13 venv in `backend/.venv`, FastAPI, SQLAlchemy 2.x,
  SQLite, Pydantic v2, Alembic. Optional: `anthropic` SDK (AI review), `httpx`
  (Yahoo charts), `openpyxl` (Excel export), `tzdata` (zoneinfo on Windows).
- **Frontend:** React 18 + Vite + TypeScript + Tailwind (dark theme tokens in
  `tailwind.config.js`), Recharts, `lightweight-charts@4.2.0` (trade replay).
  FastAPI serves the built `frontend/dist`; `npm run dev` (port 5173) proxies `/api`.

## Commands (Windows; run from the folder named)
- Tests: `backend\.venv\Scripts\python -m pytest -q` (from `backend/`) — 92 passing.
- Frontend build/type-check: `npm run build` (from `frontend/`). Rebuild after any
  frontend change — the app serves `dist/`, and `start.bat` only builds if `dist/`
  is missing.
- Migrations: from `backend/`: `python -m app.core.autobackup pre-migrate` then
  `.venv\Scripts\alembic revision --autogenerate -m "..."` and `alembic upgrade head`.
- Manual DB snapshot: `python -m app.core.autobackup manual` → `data/backups/`.

## NON-NEGOTIABLE: the user's data
- `data/journal.db` is the user's **real journal** (also `data/attachments/`,
  `data/backups/`). **Never delete, reset, truncate or "clear demo data" on it**,
  and never run destructive SQL, without inspecting it and asking first. A real
  trade was lost once this way.
- To try things in the running app, use a **throwaway copy**: set
  `TJ_DATA_DIR=<temp dir>`, run migrations, start uvicorn on another port (8001),
  or snapshot the real DB read-only with `VACUUM INTO` into the temp dir.
  Read the real DB only read-only: `sqlite3.connect("file:../data/journal.db?mode=ro", uri=True)`.
- Tests already isolate themselves (`tests/conftest.py` sets `TJ_DATA_DIR` to a
  temp dir and recreates tables per test).
- If a migration fails, fix the migration — never delete the DB to "start clean".

## Core design rules (keep them)
1. **One pipeline:** manual entry, CSV import and Notion import all create
   **executions**; `app/core/trade_builder.py` is the only code that builds trades
   (net-position walk, flip splitting, size-weighted averages, realized P&L).
   After any create/edit/delete/import: `rebuild_for(account, instrument)` then
   `recompute_for_account()` (mistake engine). User metadata (stop, tags, notes,
   journal fields, attachments) survives rebuilds via the earliest-execution anchor
   — new user-editable trade fields must be added to `_META_FIELDS`.
2. **Money/prices are `Decimal`**, stored as TEXT (`app/types.py: DecimalText`);
   never floats. JSON serializes Decimals as strings (`schemas/common.py: DecimalStr`).
   Cash is quantized to 2 dp (`core/money.py`).
3. **Time:** stored UTC (`UTCDateTime`), displayed IST. Trading date per instrument
   session rules (`core/sessions.py`; CME overnight rolls to next day; DST-safe).
4. **Never mix USD and INR** in totals unless the user picked a currency filter.
5. Exceptions to "no network": both **opt-in, off by default** — delayed CME charts
   from Yahoo Finance (`core/market_data.py`, sends only ticker + time window) and
   the AI weekly review (`core/ai_review.py`, anonymized stats, `claude-opus-5-5`
   via the `anthropic` SDK with `fallbacks="default"`). The API key is masked in
   `GET /api/settings`.
6. Demo data is flagged `is_demo` and fully removable; clearing it **keeps** any
   demo account that holds the user's own trades (converts it to a normal account).

## Journal model (the user's Notion fields)
Trades carry: lot size (`max_position_size`), time, **DTR/ATR** (`dtr`, `atr`),
direction, **entry/exit quality** A+/A/B/C, **HTF alignment** bullish/bearish/range,
**context**, **behaviour**, **partial_profit**, **outcome** label, plus tags by
category: `setup` (shown as **"Trade type"**), `location` (entry location),
`probability` (e.g. "65-75"), `thesis` (**"What happened"**), `mistake`,
`emotion`, `custom`. Seeds in `app/seeds.py: TAXONOMY_SEEDS`; tag names match
case-insensitively. Every tag picker has an inline "+ tag" (`components/journal/Pickers.tsx: ChipPicker`).
- **Style** (`trades.style`, nullable): Scalp/Intraday/Swing/Positional + user
  additions, list in setting `trade_styles` (`core/styles.py`; names normalized
  case-insensitively, new names appended). Filter param `style` on every
  analytics endpoint; `"__none"` = unassigned (`core/filters.py: where_style`).
  Preserved across rebuilds via `_META_FIELDS`.
- **Missed setups:** `status="missed"`, no executions, planned entry/stop/target,
  potential R in `r_multiple`; excluded from all P&L stats.
- **Label-only trades** (Notion rows with Win/Loss but no prices or P&L):
  `pnl_only=True, pnl_known=False`; count toward win rate/streaks, never money.
  Use `core/stats.py: classify()` for win/loss.
- Daily workflow page **Trading Day** (`pages/Journal.tsx`, route `/journal`):
  Plan (HTF bias, thesis, levels, scenarios A/B/C with probability, news,
  readiness checklist, yesterday's lesson/focus) → Execute (day table, log trade /
  missed setup) → Review (plan vs reality, auto scorecard, day grade, lessons).

## Map of the code
- `backend/app/models/` tables; `schemas/` Pydantic; `api/` routers (one file per
  area; `review.py` = bars, replay, MAE/MFE, reports, AI review, charges, Yahoo
  fetch); `core/` logic: `trade_builder`, `sessions`, `mistakes` (13 rules,
  thresholds in Settings), `mistake_analytics`, `stats`, `analytics` (dashboard,
  calendar, breakdown dimensions), `importing` (CSV/Notion wizard backend),
  `export`, `bars`, `excursions` (MAE/MFE), `replay`, `reports`, `charges` (NSE/MCX),
  `market_data` (Yahoo), `autobackup`.
- **Backtest (bar replay), fully separate:** `backend/app/backtest/` with its own
  SQLite file `data/backtest.db` (own `BtBase`, tables via `create_all` in
  `init_db()`; NOT Alembic: add columns with an explicit ALTER in `init_db`).
  `candles.py` = CME trading day (18:00 NY), timeframe buckets, base selection
  (5m ~60d / 1h ~2y / 1d since 2000 from Yahoo via `data.py`), no-look-ahead
  candles, session VWAP + bands; `engine.py` = fills (market at last close, gap
  fills at open, stop first if a bar hits both), partials, R, MAE/MFE; `stats.py`;
  `api.py` under `/api/backtest` (every action returns the same `state`).
  Frontend: `pages/Backtest.tsx`, `components/backtest/*`, `lib/backtestApi.ts`.
  Never let journal code read backtest tables or vice versa. Tests:
  `tests/test_backtest.py`. Autobackup also snapshots backtest.db (`backtest-*.db`).
- `frontend/src/lib/api.ts` = every API call + types (add new endpoints here);
  `lib/format.ts` money/time helpers; `lib/useReference.ts` accounts/instruments/tags;
  `components/AnalyticsFilterBar.tsx` shared filters; `components/journal/Pickers.tsx`
  chips/grades/HTF/result badges; `components/trades/ManualTradeForm.tsx` (taken /
  missed); `components/trades/ReplayChart.tsx`.
- Pages: Dashboard, TradeLog (journal + numbers views), TradeDetail, Journal
  (Trading Day), Calendar, Mistakes, Analytics (Breakdowns), Reports, Excursions
  (MAE/MFE), Data (import/export/bar data), Settings (tabs incl. Market data,
  India charges, AI review, Mistake rules, Tags), PropTracker (placeholder).

## Gotchas learned the hard way
- **Migrations (SQLite batch mode):** constraint naming convention lives in
  `models/base.py`; new NOT NULL columns need `server_default` in the model;
  check the generated file before `upgrade` (autogenerate omits server defaults
  sometimes) and take a pre-migrate backup.
- `SessionLocal` has `autoflush=False`: `db.flush()` before bulk `delete()`/`update()`
  that depends on pending ORM changes.
- Decimal equality: `Decimal("50.00") == Decimal("50")`, so SQLAlchemy skips "no-op" writes.
- lightweight-charts v4 markers can only be above/below/in a bar; fills are drawn
  "inBar" on one tiny invisible line series each so arrows sit at the exact price.
- Yahoo: 1m bars only for the last ~30 days, 5m up to ~60; continuous front-month
  (may differ from fills around roll); micros map to the full-size ticker; prices
  are floats and get snapped to tick size.
- PowerShell 5.1: no `&&`; avoid embedded `"` in `git commit -m @'...'@` (args get
  split) — write the message to a temp file and use `git commit -F` (Bash tool) instead.
  `sed` replacement strings don't understand `·` — use literal characters.
- When adding a pytest test after an existing one, make sure you don't split the
  existing test (insert after its last line).

## Workflow preferences
- Commit after each coherent change with a clear message; end commit messages with
  the Co-Authored-By line your session's attribution guidance gives.
- Branch `main`; remote `origin` = `https://github.com/raipriyanshuu/trade-journal.git`
  (private). The user pushes from VS Code themselves — don't push unless asked.
- Verify UI changes in the browser against a throwaway copy, run the full test
  suite and `npm run build`, update `PROGRESS.md` for user-visible changes.
- Not done yet: **Phase 6 — prop-firm tracker** (account rule fields already exist;
  `PropTracker.tsx` is a placeholder). NSE/MCX chart data comes from the user's own
  source via Import / Export → Bar data (not MotiveWave).
