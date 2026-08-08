"""DB 用意（作成→マイグレーション→シード）。冪等。entrypoint と手動実行の両方から使う。

2プレーン（§1.5）を実データベースで再現する:
  - 管理DB（control_db_name）
  - 会社DB（companies.db_identifier ごとに1データベース）
"""
from __future__ import annotations

import uuid

import psycopg
from alembic import command
from alembic.config import Config

from app.core.config import get_settings
from app.core.db import control_session, get_tenant_session
from app.core.security import hash_password
from app.models.company import User
from app.models.control import Account, Company

# 初回ログイン確認用シード（1社・1アカウント）。値は開発用の固定値。
SEED_COMPANY = {
    "company_code": "ACME-01",
    "name": "Acme Inc.",
    "db_identifier": "ideaquest_company_acme",
    "status": "active",
    "mfa_required": False,  # 状態A（PWログイン）スライスのため MFA OFF
}
SEED_ACCOUNT = {
    "login_id": "user@acme.example",
    "email": "user@acme.example",
    "display_name": "テスト 太郎",
    "password": "Passw0rd!",  # 開発用。本番シードには使わない
    "locale": "ja",
    "system_role": "general",
    "status": "active",
}


def _server_conninfo(dbname: str) -> str:
    s = get_settings()
    return f"host={s.postgres_host} port={s.postgres_port} user={s.postgres_user} password={s.postgres_password} dbname={dbname}"


def create_database(dbname: str) -> None:
    """存在しなければ CREATE DATABASE（autocommit・冪等）。"""
    with psycopg.connect(_server_conninfo("postgres"), autocommit=True) as conn:
        exists = conn.execute("SELECT 1 FROM pg_database WHERE datname = %s", (dbname,)).fetchone()
        if not exists:
            conn.execute(f'CREATE DATABASE "{dbname}"')
            print(f"[bootstrap] created database {dbname}")
        else:
            print(f"[bootstrap] database exists {dbname}")


def _alembic_cfg(ini: str, url: str) -> Config:
    cfg = Config(ini)
    cfg.set_main_option("sqlalchemy.url", url)
    return cfg


def migrate_control() -> None:
    s = get_settings()
    command.upgrade(_alembic_cfg("alembic_control.ini", s.control_dsn), "head")


def migrate_company(db_identifier: str) -> None:
    s = get_settings()
    command.upgrade(_alembic_cfg("alembic_company.ini", s.server_dsn(db_identifier)), "head")


def seed_control() -> None:
    with control_session() as session:
        company = session.query(Company).filter_by(company_code=SEED_COMPANY["company_code"]).one_or_none()
        if company is None:
            company = Company(id=uuid.uuid4(), **SEED_COMPANY)
            session.add(company)
            session.flush()
            print(f"[bootstrap] seeded company {company.company_code}")
        account = (
            session.query(Account)
            .filter_by(company_id=company.id, login_id=SEED_ACCOUNT["login_id"])
            .one_or_none()
        )
        if account is None:
            account = Account(
                id=uuid.uuid4(),
                company_id=company.id,
                login_id=SEED_ACCOUNT["login_id"],
                email=SEED_ACCOUNT["email"],
                display_name=SEED_ACCOUNT["display_name"],
                password_hash=hash_password(SEED_ACCOUNT["password"]),
                locale=SEED_ACCOUNT["locale"],
                system_role=SEED_ACCOUNT["system_role"],
                status=SEED_ACCOUNT["status"],
            )
            session.add(account)
            print(f"[bootstrap] seeded account {account.login_id}")
        session.commit()


def seed_company_users() -> None:
    with control_session() as session:
        rows = (
            session.query(Company, Account)
            .join(Account, Account.company_id == Company.id)
            .all()
        )
    for company, account in rows:
        with get_tenant_session(company.db_identifier) as tsession:
            user = tsession.query(User).filter_by(account_id=account.id).one_or_none()
            if user is None:
                tsession.add(
                    User(
                        id=uuid.uuid4(),
                        account_id=account.id,
                        display_name=account.display_name,
                        locale=account.locale,
                        status="active",
                    )
                )
                tsession.commit()
                print(f"[bootstrap] seeded user mirror for {account.login_id} in {company.db_identifier}")


def main() -> None:
    s = get_settings()
    # 1. 管理DB
    create_database(s.control_db_name)
    migrate_control()
    seed_control()
    # 2. 会社DB（seed 済みの全社）
    with control_session() as session:
        db_identifiers = [c.db_identifier for c in session.query(Company).all()]
    for db_identifier in db_identifiers:
        create_database(db_identifier)
        migrate_company(db_identifier)
    seed_company_users()
    print("[bootstrap] done")


if __name__ == "__main__":
    main()
