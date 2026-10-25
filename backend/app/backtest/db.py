"""The backtest database: ``data/backtest.db``, separate from the journal.

Tables are created with ``create_all`` on startup (new tables only). This store
is not managed by Alembic; if a column is ever added, add it here with an
explicit ``ALTER TABLE`` in ``init_db`` so existing files keep working.
"""

from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings


def backtest_db_path():
    return settings.data_dir / "backtest.db"


settings.ensure_dirs()
engine = create_engine(
    f"sqlite:///{backtest_db_path().as_posix()}",
    connect_args={"check_same_thread": False},
    future=True,
)


@event.listens_for(engine, "connect")
def _pragma(dbapi_connection, _record):  # noqa: ANN001
    cur = dbapi_connection.cursor()
    cur.execute("PRAGMA foreign_keys=ON")
    cur.execute("PRAGMA journal_mode=WAL")
    cur.close()


BtSessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)


def init_db() -> None:
    from app.backtest.models import BtBase

    BtBase.metadata.create_all(engine)


def get_bt_db() -> Iterator[Session]:
    db = BtSessionLocal()
    try:
        yield db
    finally:
        db.close()
