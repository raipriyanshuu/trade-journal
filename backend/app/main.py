"""FastAPI application: serves the API and the built frontend. Binds 127.0.0.1."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api import accounts, attachments, demo, executions, health, instruments, journal, tags, trades
from app.api import analytics as analytics_api
from app.api import export as export_api
from app.api import mistakes as mistakes_api
from app.api import importing as import_api
from app.api import review as review_api
from app.api import settings as settings_api
from app.backtest import api as backtest_api
from app.backtest.db import init_db as init_backtest_db
from app.config import settings
from app.db import SessionLocal
from app.seeds import seed_all


@asynccontextmanager
async def lifespan(_app: FastAPI):
    settings.ensure_dirs()
    # Safety net: snapshot the database at most every 6 hours on startup.
    from app.core.autobackup import snapshot

    try:
        snapshot("startup", min_interval_hours=6)
        from app.backtest.db import backtest_db_path

        snapshot("startup", min_interval_hours=6, db=backtest_db_path(), prefix="backtest")
    except Exception as exc:  # noqa: BLE001 - a failed backup must not block the app
        print(f"[backup] startup snapshot failed: {exc}")
    # Backtest store: its own file, data/backtest.db (tables created if missing).
    init_backtest_db()
    # Seed instrument master, default settings and mistake tags if missing.
    with SessionLocal() as db:
        seed_all(db)
    yield


app = FastAPI(title="Trade Journal", version="0.1.0", lifespan=lifespan)

# During development the Vite dev server runs on 5173 and proxies /api, but allow
# direct cross-origin calls from localhost dev hosts too.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(instruments.router)
app.include_router(accounts.router)
app.include_router(settings_api.router)
app.include_router(demo.router)
app.include_router(tags.router)
app.include_router(journal.router)
app.include_router(mistakes_api.router)
app.include_router(analytics_api.router)
app.include_router(trades.router)
app.include_router(executions.router)
app.include_router(attachments.router)
app.include_router(import_api.router)
app.include_router(export_api.router)
app.include_router(review_api.router)
app.include_router(backtest_api.router)

# Serve uploaded screenshots.
settings.ensure_dirs()
app.mount("/attachments", StaticFiles(directory=settings.attachments_dir), name="attachments")


# --- Serve the built frontend (frontend/dist) with SPA fallback ---
_dist = settings.frontend_dist
if _dist.exists():
    app.mount("/assets", StaticFiles(directory=_dist / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str):  # noqa: ANN201
        candidate = _dist / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(_dist / "index.html")
else:

    @app.get("/")
    def no_frontend():  # noqa: ANN201
        return {
            "message": "Frontend not built yet. Run the frontend dev server, "
            "or build it (npm run build) and restart.",
            "docs": "/docs",
        }
