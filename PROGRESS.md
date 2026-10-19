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

## Next: Phase 1 — Trade engine and manual entry
The trade builder (executions → trades), R-multiple logic, trading-date assignment
per session rules (incl. CME across midnight IST and US DST changes), the manual
entry form (scale in/out), the trade log and the trade detail page, with tests.
