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

from app.control_plane.auth.orm import Account, Company
from app.core.config import get_settings
from app.core.security import hash_password
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.profile.orm import User

# 開発用シード。値は固定（本番シードには使わない）。
# ACME-01＝MFA OFF（状態A/B/D 用）、ACME-02＝MFA ON（状態C＝メールOTP 用・ADR-0004）。
SEED_COMPANY = {
    "company_code": "ACME-01",
    "name": "Acme Inc.",
    "db_identifier": "ideaquest_company_acme",
    "status": "active",
    "mfa_required": False,
}
SEED_ACCOUNT = {
    "login_id": "user@acme.example",
    "email": "user@acme.example",
    "display_name": "テスト 太郎",
    "password": "Passw0rd!",
    "locale": "ja",
    "system_role": "general",
    "status": "active",
}
SEED_MFA_COMPANY = {
    "company_code": "ACME-02",
    "name": "Beta MFA Inc.",
    "db_identifier": "ideaquest_company_acme2",
    "status": "active",
    "mfa_required": True,  # 状態C（メールOTP MFA）スライスのため MFA ON
}
SEED_MFA_ACCOUNT = {
    "login_id": "mfa@acme2.example",
    "email": "mfa@acme2.example",
    "display_name": "MFA 花子",
    "password": "Passw0rd!",
    "locale": "ja",
    "system_role": "general",
    "status": "active",
}

_SEEDS = [(SEED_COMPANY, SEED_ACCOUNT), (SEED_MFA_COMPANY, SEED_MFA_ACCOUNT)]


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


def _seed_ops_admin(session) -> None:
    """運営テナント（OPS）＋初期 system_admin を seed（B.5.1・案a＝シークレット直投入・冪等）。

    パスワードは env `BOOTSTRAP_ADMIN_PASSWORD`（秘匿）。**空なら system_admin を作らない**
    （既知/デフォルトPW の埋め込み禁止・B.5.1）。OPS は外部依存ゼロ起動のため `mfa_required=False`。
    """
    s = get_settings()
    ops = session.query(Company).filter_by(company_code=s.ops_company_code).one_or_none()
    if ops is None:
        ops = Company(
            id=uuid.uuid4(), company_code=s.ops_company_code, name="Platform Ops",
            db_identifier=s.ops_db_identifier, status="active", mfa_required=False,
        )
        session.add(ops)
        session.flush()
        print(f"[bootstrap] seeded ops tenant {ops.company_code}")
    if not s.bootstrap_admin_password:
        print("[bootstrap] BOOTSTRAP_ADMIN_PASSWORD 未設定 → system_admin は seed しない")
        return
    admin = (
        session.query(Account)
        .filter_by(company_id=ops.id, login_id=s.bootstrap_admin_login)
        .one_or_none()
    )
    if admin is None:
        session.add(Account(
            id=uuid.uuid4(), company_id=ops.id,
            login_id=s.bootstrap_admin_login, email=s.bootstrap_admin_email,
            display_name="Platform Admin",
            password_hash=hash_password(s.bootstrap_admin_password),  # password_set=true 相当
            locale="ja", system_role="system_admin", status="active",
        ))
        print(f"[bootstrap] seeded system_admin {s.bootstrap_admin_login}")


def seed_control() -> None:
    with control_session() as session:
        _seed_ops_admin(session)
        for company_def, account_def in _SEEDS:
            company = (
                session.query(Company)
                .filter_by(company_code=company_def["company_code"])
                .one_or_none()
            )
            if company is None:
                company = Company(id=uuid.uuid4(), **company_def)
                session.add(company)
                session.flush()
                print(f"[bootstrap] seeded company {company.company_code}")
            account = (
                session.query(Account)
                .filter_by(company_id=company.id, login_id=account_def["login_id"])
                .one_or_none()
            )
            if account is None:
                account = Account(
                    id=uuid.uuid4(),
                    company_id=company.id,
                    login_id=account_def["login_id"],
                    email=account_def["email"],
                    display_name=account_def["display_name"],
                    password_hash=hash_password(account_def["password"]),
                    locale=account_def["locale"],
                    system_role=account_def["system_role"],
                    status=account_def["status"],
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
                        password_set=account.password_hash is not None,  # accounts のミラー（§4.6）
                        login_id=account.login_id,        # identity/role のミラー（§5.3）
                        email=account.email,
                        system_role=account.system_role,
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
