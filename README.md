# Trade Journal

A **local, single-user trading journal** for futures (CME/COMEX/NYMEX) and Indian
markets (NSE/MCX), built around orderflow and Market Profile / auction-market
concepts. It runs entirely on your machine, stores data in SQLite, and opens in
your browser. Your trades never leave your computer. Two optional network
features are off by default: delayed CME charts from Yahoo Finance (sends only a
ticker and time window) and the AI weekly review (sends anonymized statistics).

Local snapshots of the database are written to `data/backups/` on startup and
before every migration.

## Core design principle: one pipeline

Every trade, however it enters the system, follows the same path:

```
Manual entry  ─┐
CSV import    ─┼─► executions ─► trade builder ─► trades ─► mistake engine ─► analytics
Notion import ─┘
```

Manual entry and imports only create **executions**. The **trade builder** is the
only code that creates trades, so every path produces identical results.

## Requirements

- **Python 3.11+**
- **Node.js 18+** (with npm)

## Run it

**Windows:** double-click `start.bat`, or in a terminal run it with a leading
`.\` (PowerShell does not run programs from the current folder without it):

```bat
.\start.bat
```

**macOS / Linux:**

```bash
./start.sh
```

The script creates a virtual environment, installs dependencies on first run,
applies database migrations, builds the frontend, starts the backend serving the
built frontend, and opens `http://127.0.0.1:8000`.

## Development

Run the backend and the Vite dev server separately for hot reload:

```bash
# Terminal 1 - backend
cd backend
.venv/Scripts/activate        # Windows:  .venv\Scripts\activate.bat
alembic upgrade head
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# Terminal 2 - frontend (proxies /api to the backend)
cd frontend
npm install
npm run dev                    # http://127.0.0.1:5173
```

## Tests

```bash
cd backend
.venv/Scripts/activate
pytest
```

## Tech stack

- **Backend:** Python, FastAPI, SQLAlchemy 2.x, SQLite, Pydantic, Alembic.
- **Frontend:** React + Vite + TypeScript + Tailwind CSS, Recharts (charts),
  `lightweight-charts` (trade replay, Phase 7).
- **Money & prices:** `Decimal` throughout, stored as exact strings (never floats).
- **Time:** stored in UTC, displayed in Asia/Kolkata (IST) by default.

## Data & backups

All local data lives in `data/` (the SQLite database and `data/attachments/`).
This folder is git-ignored. To use a non-synced drive, set `TJ_DATA_DIR`.

See `PROGRESS.md` for the current build status and what each phase delivers.
