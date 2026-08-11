"""Alembic env（会社DB）。接続URLは Config の sqlalchemy.url（bootstrap が対象DBごとに設定）。"""
from __future__ import annotations

from alembic import context
from sqlalchemy import create_engine

from app.db.base import CompanyBase
from app.tenant.profile import orm as _company_orm  # noqa: F401  (テーブルを metadata に登録)
from app.tenant.quest_group import orm as _company_qg_orm  # noqa: F401  (§5.4/§5.5 を metadata に登録)

target_metadata = CompanyBase.metadata


def run_migrations_online() -> None:
    url = context.config.get_main_option("sqlalchemy.url")
    if not url:
        raise RuntimeError("company migration には対象会社DBの sqlalchemy.url が必要です")
    engine = create_engine(url)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
        with context.begin_transaction():
            context.run_migrations()


run_migrations_online()
