"""Alembic env（管理DB）。接続URLは Config の sqlalchemy.url（bootstrap が設定）→無ければ settings。"""
from __future__ import annotations

from alembic import context
from sqlalchemy import create_engine

from app.control_plane.account_sync import orm as _sync_orm  # noqa: F401  (metadata に登録)
from app.control_plane.auth import orm as _control_orm  # noqa: F401  (テーブルを metadata に登録)
from app.control_plane.mail_outbox import orm as _mail_orm  # noqa: F401  (metadata に登録)
from app.core.config import get_settings
from app.db.base import ControlBase

target_metadata = ControlBase.metadata


def _url() -> str:
    return context.config.get_main_option("sqlalchemy.url") or get_settings().control_dsn


def run_migrations_online() -> None:
    engine = create_engine(_url())
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
        with context.begin_transaction():
            context.run_migrations()


run_migrations_online()
