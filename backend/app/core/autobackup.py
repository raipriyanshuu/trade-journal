"""Automatic local snapshots of the journal database.

A consistent copy (SQLite ``VACUUM INTO``) is written to ``data/backups/`` when
the app starts (at most every few hours) and by the start scripts right before
migrations. The newest ``KEEP`` snapshots are retained.

Run manually:  python -m app.core.autobackup [reason]
"""

from __future__ import annotations

import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from app.config import settings

KEEP = 20


def backups_dir() -> Path:
    return settings.data_dir / "backups"


def snapshot(reason: str = "manual", min_interval_hours: float = 0, keep: int = KEEP) -> Path | None:
    db = settings.db_path
    if not db.exists() or db.stat().st_size == 0:
        return None
    bdir = backups_dir()
    bdir.mkdir(parents=True, exist_ok=True)
    existing = sorted(bdir.glob("journal-*.db"))
    if min_interval_hours and existing:
        age_h = (time.time() - existing[-1].stat().st_mtime) / 3600
        if age_h < min_interval_hours:
            return None

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    dest = bdir / f"journal-{stamp}-{reason}.db"
    con = sqlite3.connect(str(db))
    try:
        con.execute("VACUUM INTO ?", (str(dest),))
    finally:
        con.close()

    for old in sorted(bdir.glob("journal-*.db"))[:-keep]:
        try:
            old.unlink()
        except OSError:
            pass
    return dest


if __name__ == "__main__":
    path = snapshot(sys.argv[1] if len(sys.argv) > 1 else "manual")
    print(f"[backup] {path}" if path else "[backup] nothing to back up yet")
