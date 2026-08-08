"""会社DB（テナントプレーン）の動的解決。

`companies.db_identifier` をデータベース名として `get_tenant_session(db_identifier)` で解決する
（§1.5 動的ルーティング）。テナント境界の唯一の入口。エンジンは db_identifier 単位でキャッシュ。
"""
from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings

_tenant_engines: dict[str, Engine] = {}
_tenant_sessionmakers: dict[str, sessionmaker[Session]] = {}


def _tenant_sessionmaker(db_identifier: str) -> sessionmaker[Session]:
    if db_identifier not in _tenant_sessionmakers:
        engine = create_engine(get_settings().server_dsn(db_identifier), pool_pre_ping=True)
        _tenant_engines[db_identifier] = engine
        _tenant_sessionmakers[db_identifier] = sessionmaker(bind=engine, expire_on_commit=False)
    return _tenant_sessionmakers[db_identifier]


@contextmanager
def get_tenant_session(db_identifier: str) -> Iterator[Session]:
    with _tenant_sessionmaker(db_identifier)() as session:
        yield session
