"""Engine + session management. The one place that opens DB connections.

Use `session_scope()` for a transactional block:

    with session_scope() as session:
        ...  # auto-commit on success, rollback on error
"""
from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from core.config import settings

# Pool sized for the FastAPI bridge: a single company page fires ~8 endpoint calls
# at once, so the default 5+10 exhausts under a few concurrent page loads. 20+40
# stays well under Postgres' default max_connections (100).
engine = create_engine(
    settings.database_url, pool_pre_ping=True, future=True,
    pool_size=20, max_overflow=40, pool_timeout=30, pool_recycle=1800,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


@contextmanager
def session_scope() -> Iterator[Session]:
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
