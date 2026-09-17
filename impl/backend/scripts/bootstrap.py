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


def _seed_demo_enabled(app_env: str) -> bool:
    """demo 会社/アカウント（`_SEEDS`）を seed してよいか（本番デプロイ要件 §5）。

    prod では既定PW のデモアカウント/会社を作らない（OPS テナント＋system_admin＋migration のみ）。
    非 prod（dev/e2e/test）は従来どおり demo を seed する（テスト/開発の前提データ）。
    """
    return app_env != "prod"


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
    s = get_settings()
    with control_session() as session:
        _seed_ops_admin(session)  # OPS テナント＋初期 system_admin（本番でも必要・B.5.1）
        if not _seed_demo_enabled(s.app_env):
            session.commit()  # prod は demo を seed しない（本番デプロイ要件 §5）
            print(f"[bootstrap] APP_ENV={s.app_env}: demo seed をスキップ（OPS のみ）")
            return
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


# 発見カタログ（SC-13・FR-40）デモ用の固定 seed（非prod のみ）。固定 UUID＝冪等・DB リセットでも安定再現。
# ゼロ部署＝全社公開（`can_discover_quest` は 0 部署を全社として可視）＝seed 一般ユーザーが非メンバーで発見できる。
# owner は合成ユーザー（seed 一般ユーザーとは別）＝seed ユーザーの `my_state=none`。公開アイデア＋直近チャットで活発度スパークを見せる。
DEMO_DISCOVERY_OWNER_ID = uuid.UUID("d15c0000-0000-4000-a000-000000000001")
DEMO_DISCOVERY_QUEST_ID = uuid.UUID("d15c0000-0000-4000-a000-000000000002")
DEMO_DISCOVERY_IDEA_IDS = (
    uuid.UUID("d15c0000-0000-4000-a000-000000000101"),
    uuid.UUID("d15c0000-0000-4000-a000-000000000102"),
)


def seed_demo_discovery() -> None:
    """ACME-01 に発見デモの discoverable クエスト（全社公開）＋活発度用の公開アイデア/チャットを seed（冪等・非prod）。"""
    from datetime import datetime, timedelta, timezone

    from app.tenant.chat.orm import ChatGroup, ChatMessage
    from app.tenant.ideas.orm import Idea
    from app.tenant.quests import repository as quest_repo
    from app.tenant.quests.orm import Quest

    s = get_settings()
    if not _seed_demo_enabled(s.app_env):
        return
    with control_session() as session:
        company = session.query(Company).filter_by(company_code=SEED_COMPANY["company_code"]).one_or_none()
        db_identifier = company.db_identifier if company else None
    if db_identifier is None:
        return
    with get_tenant_session(db_identifier) as ts:
        if ts.get(Quest, DEMO_DISCOVERY_QUEST_ID) is not None:
            return  # 冪等＝既に seed 済み
        if ts.query(User).filter_by(id=DEMO_DISCOVERY_OWNER_ID).one_or_none() is None:
            ts.add(User(id=DEMO_DISCOVERY_OWNER_ID, account_id=uuid.uuid4(),
                        display_name="発見 デモ太郎", locale="ja", status="active"))
            ts.flush()
        quest = quest_repo.create_quest(
            ts, quest_id=DEMO_DISCOVERY_QUEST_ID, owner_id=DEMO_DISCOVERY_OWNER_ID,
            title="【発見デモ】部署横断アイデア募集", color="#3B82F6", status="recruiting",
            purpose="部署をまたいで課題とアイデアを持ち寄る発見デモ用クエストです。参加すると議論・アイデア・評価が見られます。")
        quest.discoverable = True  # 参加部署リンクは張らない＝ゼロ部署＝全社公開
        quest_repo.add_member(ts, DEMO_DISCOVERY_QUEST_ID, DEMO_DISCOVERY_OWNER_ID, permissions=["owner"])
        # 活発度スパーク用＝公開アイデア2件＋各チャット群に直近の日次メッセージ（offset 日前→件数）。
        now = datetime.now(timezone.utc)
        groups = []
        for iid, title in zip(DEMO_DISCOVERY_IDEA_IDS,
                              ["部署間の情報共有を自動化する", "オンボーディングを1日で終える"]):
            ts.add(Idea(id=iid, quest_id=DEMO_DISCOVERY_QUEST_ID, author_id=DEMO_DISCOVERY_OWNER_ID,
                        title=title, body="（発見デモ用）", value="（発見デモ用）", status="published"))
            ts.flush()
            cgid = uuid.uuid4()
            ts.add(ChatGroup(id=cgid, idea_id=iid))
            ts.flush()
            groups.append(cgid)
        for off, cnt in {0: 4, 1: 2, 2: 5, 3: 1, 5: 3, 7: 2, 9: 1}.items():
            for k in range(cnt):
                ts.add(ChatMessage(id=uuid.uuid4(), chat_group_id=groups[(off + k) % len(groups)],
                                   author_id=DEMO_DISCOVERY_OWNER_ID, body="（発見デモ・議論サンプル）",
                                   created_at=now - timedelta(days=off, hours=k)))
        ts.commit()
        print(f"[bootstrap] seeded discovery demo quest in {db_identifier}")


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
    seed_demo_discovery()  # 発見カタログ（SC-13）デモ（非prod・冪等）
    print("[bootstrap] done")


if __name__ == "__main__":
    main()
