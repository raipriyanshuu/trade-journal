"""Test fixtures: isolated temp SQLite DB, fresh tables per test, TestClient."""

from __future__ import annotations

import os
import tempfile

# Point the app at a throwaway data dir BEFORE importing app modules.
os.environ.setdefault("TJ_DATA_DIR", tempfile.mkdtemp(prefix="tj_test_"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Base  # noqa: E402


@pytest.fixture(autouse=True)
def fresh_db():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield


@pytest.fixture
def client():
    # Entering the context manager runs the lifespan, which seeds the DB.
    with TestClient(app) as c:
        yield c


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
