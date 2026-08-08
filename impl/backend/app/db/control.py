"""管理DB（コントロールプレーン）のエンジン／セッション。固定の1データベース。"""
from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings

_control_engine: Engine | None = None
_control_sessionmaker: sessionmaker[Session] | None = None


def control_engine() -> Engine:
    global _control_engine, _control_sessionmaker
    if _control_engine is None:
        _control_engine = create_engine(get_settings().control_dsn, pool_pre_ping=True)
        _control_sessionmaker = sessionmaker(bind=_control_engine, expire_on_commit=False)
    return _control_engine


@contextmanager
def control_session() -> Iterator[Session]:
    control_engine()
    assert _control_sessionmaker is not None
    with _control_sessionmaker() as session:
        yield session
