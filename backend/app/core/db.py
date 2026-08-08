"""DB エンジン／セッション。

2プレーン構成（コーディング規約 §3.4）:
- control（管理DB）＝accounts/companies 等。固定の1データベース。
- tenant（会社DB）＝会社ごとに物理データベースを分ける。`companies.db_identifier` を
  データベース名として `get_tenant_session(db_identifier)` で解決する（§1.5 動的ルーティング）。

会社DBエンジンは db_identifier 単位でキャッシュする（毎回作らない）。
"""
from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings

_control_engine: Engine | None = None
_control_sessionmaker: sessionmaker[Session] | None = None
_tenant_engines: dict[str, Engine] = {}
_tenant_sessionmakers: dict[str, sessionmaker[Session]] = {}


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


def _tenant_sessionmaker(db_identifier: str) -> sessionmaker[Session]:
    if db_identifier not in _tenant_sessionmakers:
        engine = create_engine(get_settings().server_dsn(db_identifier), pool_pre_ping=True)
        _tenant_engines[db_identifier] = engine
        _tenant_sessionmakers[db_identifier] = sessionmaker(bind=engine, expire_on_commit=False)
    return _tenant_sessionmakers[db_identifier]


@contextmanager
def get_tenant_session(db_identifier: str) -> Iterator[Session]:
    """会社DB（db_identifier）へのセッションを開く。テナント境界の唯一の入口。"""
    with _tenant_sessionmaker(db_identifier)() as session:
        yield session
