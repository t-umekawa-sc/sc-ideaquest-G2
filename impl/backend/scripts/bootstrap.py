"""DB 用意（作成→マイグレーション→シード）。冪等。entrypoint と手動実行の両方から使う。

2プレーン（§1.5）を実データベースで再現する:
  - 管理DB（control_db_name）
  - 会社DB（companies.db_identifier ごとに1データベース）
"""
from __future__ import annotations

import re
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
# デモ公開会社（FR-48②・設計 §8.3）＝access_mode=public＋self_signup_enabled=true。
# ホームページ→セルフサインアップ→コンテストのみ操作可 のデモ導線用（公開＝コンテスト専用テナント）。
# 会社コードは §8.1 のデプロイ設定（env IQ_DEFAULT_COMPANY_CODE=DEMO）で自動供給する前提。
SEED_DEMO_COMPANY = {
    "company_code": "DEMO",
    "name": "IdeaQuest Demo",
    "db_identifier": "ideaquest_company_demo",
    "status": "active",
    "mfa_required": False,
    "access_mode": "public",
    "self_signup_enabled": True,
}
# デモ会社の運営アカウント（コンテスト作成/運営・company_account_admin）。一般参加者はセルフサインアップで作る。
SEED_DEMO_ADMIN = {
    "login_id": "admin@demo.example",
    "email": "admin@demo.example",
    "display_name": "DEMO 運営",
    "password": "Passw0rd!",
    "locale": "ja",
    "system_role": "company_account_admin",
    "status": "active",
}

# セッション破棄系 e2e（全端末ログアウト A-TC-022）専用の隔離アカウント。共有の user@acme を
# 使うと logout_all が並列ワーカ全員のセッションを巻き込み session_expired が多発する（e2e フレーク）。
# 専用垢に分離＝他 spec と衝突しない。非prod（demo seed 有効時）のみ作成。
SEED_E2E_SESSION_ACCOUNT = {
    "login_id": "e2e-session@acme.example",
    "email": "e2e-session@acme.example",
    "display_name": "E2E セッション",
    "password": "Passw0rd!",
    "locale": "ja",
    "system_role": "general",
    "status": "active",
}

# パスワード再設定フロー e2e（SC-00 状態D→B）専用の隔離アカウント。complete_password_setup は
# 当該アカウントの全セッションを破棄する（delete_account_sessions）ため、共有 user@acme を使うと
# storageState 方式で全 spec が再利用する共有セッションを壊してしまう。専用垢に分離＝共有を守る。
SEED_E2E_PWRESET_ACCOUNT = {
    "login_id": "e2e-pwreset@acme.example",
    "email": "e2e-pwreset@acme.example",
    "display_name": "E2E パス再設定",
    "password": "Passw0rd!",
    "locale": "ja",
    "system_role": "general",
    "status": "active",
}

# 受入デモ（scripts/seed_demo.py）および一部 e2e（sc-24-chat・sc-30-32-balance-sync）が前提とする
# ACME-01 のデモ用アカウント。従来は手動作成で DB ボリュームにのみ存在し再現不能だった＝会社/control DB
# を drop すると復元できず、seed_demo.py の「ACME-01 の seed アカウント user/user2/user3/kanri …
# （bootstrap 既定）」という前提も崩れていた。bootstrap seed に昇格して再現可能にする（非prod のみ・冪等）。
# kanri は company_account_admin（SC-94 会社のLLM設定 等の会社管理操作の実行主体）。
SEED_DEMO_USER2 = {
    "login_id": "user2@acme.example",
    "email": "user2@acme.example",
    "display_name": "チャット 太郎",
    "password": "Passw0rd!",
    "locale": "ja",
    "system_role": "general",
    "status": "active",
}
SEED_DEMO_USER3 = {
    "login_id": "user3@acme.example",
    "email": "user3@acme.example",
    "display_name": "アイデア 出す像",
    "password": "Passw0rd!",
    "locale": "ja",
    "system_role": "general",
    "status": "active",
}
SEED_DEMO_KANRI = {
    "login_id": "kanri@acme.example",
    "email": "kanri@acme.example",
    "display_name": "ACME 管理者",
    "password": "Passw0rd!",
    "locale": "ja",
    "system_role": "company_account_admin",
    "status": "active",
}

_SEEDS = [
    (SEED_COMPANY, SEED_ACCOUNT),
    (SEED_COMPANY, SEED_E2E_SESSION_ACCOUNT),
    (SEED_COMPANY, SEED_E2E_PWRESET_ACCOUNT),
    (SEED_COMPANY, SEED_DEMO_USER2),
    (SEED_COMPANY, SEED_DEMO_USER3),
    (SEED_COMPANY, SEED_DEMO_KANRI),
    (SEED_MFA_COMPANY, SEED_MFA_ACCOUNT),
    (SEED_DEMO_COMPANY, SEED_DEMO_ADMIN),  # FR-48② デモ公開会社（public＋self_signup・§8.3）
]

# e2e 並列隔離用のワーカ会社（ACME-W0..W{N-1}）。Playwright の各ワーカに専用会社DBを割り当て、
# 並列実行時の共有会社DB競合（通知 count・添付・一覧等）を断つ。各ワーカ会社は ACME-01 と同じ
# login_id 群を持つ（login_id は会社単位一意＝使い回せる＝spec は会社コード/DB名の差し替えのみで済む）。
# env `E2E_WORKER_COMPANIES`（既定0）かつ非prod のときだけ seed＝通常スタック/本番は不変。
_WORKER_ACCOUNT_DEFS = [
    SEED_ACCOUNT, SEED_E2E_SESSION_ACCOUNT, SEED_E2E_PWRESET_ACCOUNT,
    SEED_DEMO_USER2, SEED_DEMO_USER3, SEED_DEMO_KANRI,
]


def _worker_company_def(i: int) -> dict:
    return {
        "company_code": f"ACME-W{i}",
        "name": f"E2E Worker {i}",
        "db_identifier": f"ideaquest_company_acme_w{i}",
        "status": "active",
        "mfa_required": False,
    }


def _worker_company_defs() -> list[dict]:
    """seed 対象のワーカ会社 def 一覧（非prod・env>0 のときだけ・それ以外は空）。"""
    s = get_settings()
    n = s.e2e_worker_companies if _seed_demo_enabled(s.app_env) else 0
    return [_worker_company_def(i) for i in range(n)]


def _worker_seeds() -> list[tuple[dict, dict]]:
    """ワーカ会社×アカウントの (company_def, account_def) タプル（seed_control 用）。"""
    return [(cdef, adef) for cdef in _worker_company_defs() for adef in _WORKER_ACCOUNT_DEFS]


def _demo_db_identifiers() -> list[str]:
    """demo seed（discovery/info/filler）対象の会社DB識別子＝ACME-01 ＋（有効なら）ワーカ会社。"""
    codes = [SEED_COMPANY["company_code"], *(c["company_code"] for c in _worker_company_defs())]
    with control_session() as session:
        by_code = {c.company_code: c.db_identifier for c in session.query(Company).all()}
    return [by_code[c] for c in codes if c in by_code]


def _seed_demo_enabled(app_env: str) -> bool:
    """demo 会社/アカウント（`_SEEDS`）を seed してよいか（本番デプロイ要件 §5）。

    prod では既定PW のデモアカウント/会社を作らない（OPS テナント＋system_admin＋migration のみ）。
    非 prod（dev/e2e/test）は従来どおり demo を seed する（テスト/開発の前提データ）。
    """
    return app_env != "prod"


def _server_conninfo(dbname: str) -> str:
    s = get_settings()
    return f"host={s.postgres_host} port={s.postgres_port} user={s.postgres_user} password={s.postgres_password} dbname={dbname}"


# DDL に補間される DB 名の二重検証（defense-in-depth・AUDIT-008）。
# 入力の第一ゲートは CompanyCreateRequest.db_identifier の validator。ここは prefix 付き全体を許容する最小 allowlist。
_DBNAME_RE = re.compile(r"[a-z][a-z0-9_]{0,96}")


def create_database(dbname: str) -> None:
    """存在しなければ CREATE DATABASE（autocommit・冪等）。dbname は allowlist 検証（DDL 補間）。"""
    if not _DBNAME_RE.fullmatch(dbname):
        raise ValueError(f"unsafe database name: {dbname!r}")
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
        for company_def, account_def in _SEEDS + _worker_seeds():
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


def seed_quest_create_capabilities() -> None:
    """seed ユーザに quest_create 能力を付与（FR-47・決定K・冪等）。

    クエスト作成を②会社レベル能力 `quest_create` でゲートするため、デモ/e2e の seed 一般ユーザが
    従来どおりクエストを作れるよう明示付与（migration 0051 は既存クエスト作成者を自動付与するが、まだ
    作っていない seed ユーザ向けにここで補完＝「作れていた人は作れ続ける」をデモでも担保）。管理者は
    アプリ側ゲートで常時可のため付与不要。運営テナント（OPS）は対象外。
    """
    from app.tenant.capabilities import repository as caps_repo
    with control_session() as session:
        db_ids = [c.db_identifier for c in session.query(Company).filter(Company.company_code != "OPS").all()]
    for db_id in db_ids:
        with get_tenant_session(db_id) as ts:
            for user in ts.query(User).all():
                caps_repo.grant(ts, user.id, "quest_create", granted_by_id=None)
            ts.commit()
    print("[bootstrap] seeded quest_create capabilities for seed users")


# 発見カタログ（SC-13・FR-40）デモ用の固定 seed（非prod のみ）。固定 UUID＝冪等・DB リセットでも安定再現。
# ゼロ部署＝全社公開（`can_discover_quest` は 0 部署を全社として可視）＝seed 一般ユーザーが非メンバーで発見できる。
# owner は合成ユーザー（seed 一般ユーザーとは別）＝seed ユーザーの `my_state=none`。公開アイデア＋直近チャットで活発度スパークを見せる。
DEMO_DISCOVERY_OWNER_ID = uuid.UUID("d15c0000-0000-4000-a000-000000000001")
DEMO_DISCOVERY_QUEST_ID = uuid.UUID("d15c0000-0000-4000-a000-000000000002")
DEMO_DISCOVERY_IDEA_IDS = (
    uuid.UUID("d15c0000-0000-4000-a000-000000000101"),
    uuid.UUID("d15c0000-0000-4000-a000-000000000102"),
)
# 経営資料整合デモ（R.4b「方針まわりの語像」用）＝経営資料1件＋コンセプト2件。発見デモクエストに適用し
# recompute で idea_alignment を作る＝語像が info＋idea＋concept で充実する（§7②・FR-44）。
DEMO_STRATEGY_DOC_ID = uuid.UUID("d15c0000-0000-4000-a000-000000000201")
DEMO_CONCEPT_IDS = (
    uuid.UUID("d15c0000-0000-4000-a000-000000000301"),
    uuid.UUID("d15c0000-0000-4000-a000-000000000302"),
)

# 情報インプット（ドメイン N・SC-50）デモ。frontend fixtures（i1〜i5）相当。
DEMO_INFO_AUTHOR_IDS = {
    "hanako": uuid.UUID("14f00000-0000-4000-a000-000000000001"),  # 情報 花子
    "taro": uuid.UUID("14f00000-0000-4000-a000-000000000002"),    # 開発 太郎
    "jiro": uuid.UUID("14f00000-0000-4000-a000-000000000003"),    # 営業 次郎
}
DEMO_INFO_IDS = {
    "i1": uuid.UUID("14f00000-0000-4000-a000-000000000011"),
    "i2": uuid.UUID("14f00000-0000-4000-a000-000000000012"),
    "i3": uuid.UUID("14f00000-0000-4000-a000-000000000013"),
    "i4": uuid.UUID("14f00000-0000-4000-a000-000000000014"),
    "i5": uuid.UUID("14f00000-0000-4000-a000-000000000015"),
}


# クエストグループのデモ seed（非prod のみ・固定 UUID＝冪等）。多くの e2e ヘルパ（createRecruiting 等・
# 16 spec）と受入が「GET /quest-groups が最低1件返す」＝dev seed のデモグループを前提にする。従来は手動
# 作成で DB ボリュームにのみ存在し再現不能だった（会社DB を drop すると消え、`groups.data[0]` が undefined
# になり広範に落ちる）。bootstrap seed に昇格して再現可能にする。GET /quest-groups は「自分が有効所属する
# グループ」のみ返す（repository.get_quest_groups）ため、ACME-01 の seed ユーザーを所属させる。
# コードは cleanup（QG/QGN/SCDEV 接頭辞のみ削除）が温存する `DEV-` 系にして衝突を避ける。
DEMO_QUEST_GROUP_ID = uuid.UUID("de500000-0000-4000-a000-000000000001")


def _seed_quest_group_for(company_code: str) -> None:
    """指定会社にデモ用クエストグループ＋seed ユーザーの所属を seed（冪等）。"""
    from app.tenant.quest_group.orm import QuestGroup, QuestGroupMember

    with control_session() as session:
        company = session.query(Company).filter_by(company_code=company_code).one_or_none()
        db_identifier = company.db_identifier if company else None
    if db_identifier is None:
        return
    # seed ユーザーを member で所属させる＝GET /quest-groups に出す（createRecruiting 等が前提）。
    # admin にはしない＝SC-90 の「非QG管理者」テスト（B-TC-119/123・is_qg_admin=false 前提）を壊さない。
    # QG 管理者が要るテスト（B-TC-120 等）は各自 OPS 編集で admin を作る。
    member_logins = {
        SEED_ACCOUNT["login_id"]: "member",
        SEED_DEMO_USER2["login_id"]: "member",
        SEED_DEMO_USER3["login_id"]: "member",
        SEED_DEMO_KANRI["login_id"]: "member",
    }
    with get_tenant_session(db_identifier) as ts:
        if ts.get(QuestGroup, DEMO_QUEST_GROUP_ID) is None:
            ts.add(QuestGroup(id=DEMO_QUEST_GROUP_ID, quest_group_code="DEV-DEMO", name="デモグループ"))
            ts.flush()
            print(f"[bootstrap] seeded demo quest group in {db_identifier}")
        for login_id, role in member_logins.items():
            user = ts.query(User).filter_by(login_id=login_id).one_or_none()
            if user is None:
                continue
            existing = (
                ts.query(QuestGroupMember)
                .filter_by(quest_group_id=DEMO_QUEST_GROUP_ID, user_id=user.id, removed_at=None)
                .one_or_none()
            )
            if existing is None:
                ts.add(QuestGroupMember(quest_group_id=DEMO_QUEST_GROUP_ID, user_id=user.id, role=role))
        ts.commit()


def seed_demo_quest_group() -> None:
    """ACME-01＋（有効なら）ワーカ会社にデモ用クエストグループを seed（冪等・非prod）。"""
    s = get_settings()
    if not _seed_demo_enabled(s.app_env):
        return
    _seed_quest_group_for(SEED_COMPANY["company_code"])
    for cdef in _worker_company_defs():
        _seed_quest_group_for(cdef["company_code"])


def _ensure_idea_tokens_from_text(ts, iid, text) -> bool:
    """idea に idea トークンが無ければ `text` をトークン化して永続（冪等・追加したら True）。

    **ライブ `persist_entity_tokens` と同一トークナイザ**（`info.derive`）で抽出＝経営資料/コンセプトの
    トークンと素性が揃い、整合率 recompute（R.4b 語像の idea 由来）でも一致判定が効く（§5.36b）。既存の idea
    トークン（ライブ書込 or 既 seed）があれば触らない＝全置換（`replace_tokens`）でライブ分を潰さない。
    """
    from app.tenant.info import application as info_app
    from app.tenant.tokens.orm import EntityToken
    if ts.query(EntityToken.id).filter_by(owner_type="idea", owner_id=iid).first() is not None:
        return False
    info_app.persist_entity_tokens(ts, "idea", iid, text)
    return True


def _ensure_discovery_idea_tokens(ts) -> None:
    """発見デモの公開アイデアに idea トークンを冪等 seed（SC-12「議論の主題」ワードクラウド用・DFT）。

    過去の seed は idea トークンを一切書いていなかったため **fresh な demo 会社ではクエストの語像が常に空**
    だった（info の N-TC-334 の兄弟・§5.36b）。既存 demo DB にも後追いで補えるよう、クエスト生成の有無に
    依らず冪等に補完する（トークンはアイデア本文＝title+value+body から抽出）。
    """
    from app.tenant.ideas.orm import Idea
    for iid in DEMO_DISCOVERY_IDEA_IDS:
        idea = ts.get(Idea, iid)
        if idea is not None:
            _ensure_idea_tokens_from_text(ts, iid, " ".join(x for x in (idea.title, idea.value, idea.body) if x))


def seed_demo_discovery(db_identifier: str | None = None) -> None:
    """発見デモの discoverable クエスト（全社公開）＋活発度用の公開アイデア/チャットを seed（冪等・非prod）。

    db_identifier 未指定なら ACME-01。ワーカ会社にも seed するため main() から各会社DBを渡してループする。
    """
    from datetime import datetime, timedelta, timezone

    from app.tenant.chat import repository as chat_repo
    from app.tenant.chat.orm import ChatGroup, ChatMessage
    from app.tenant.ideas.orm import Idea
    from app.tenant.quests import repository as quest_repo
    from app.tenant.quests.orm import Quest

    s = get_settings()
    if not _seed_demo_enabled(s.app_env):
        return
    if db_identifier is None:
        with control_session() as session:
            company = session.query(Company).filter_by(company_code=SEED_COMPANY["company_code"]).one_or_none()
            db_identifier = company.db_identifier if company else None
    if db_identifier is None:
        return
    with get_tenant_session(db_identifier) as ts:
        if ts.get(Quest, DEMO_DISCOVERY_QUEST_ID) is not None:
            # 既存 demo にも idea トークンを後追い補完（過去の seed は未投入＝語像が空だった DFT の自己修復）。
            _ensure_discovery_idea_tokens(ts)
            ts.commit()
            return  # 冪等＝クエスト本体は seed 済み
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
            # チャット独立化（§5.14b）後はメッセージは thread_id 所属＝idea ホストの thread を用意する。
            groups.append(chat_repo.ensure_chat_thread(ts, "idea", cgid).id)
        for off, cnt in {0: 4, 1: 2, 2: 5, 3: 1, 5: 3, 7: 2, 9: 1}.items():
            for k in range(cnt):
                ts.add(ChatMessage(id=uuid.uuid4(), thread_id=groups[(off + k) % len(groups)],
                                   author_id=DEMO_DISCOVERY_OWNER_ID, body="（発見デモ・議論サンプル）",
                                   created_at=now - timedelta(days=off, hours=k)))
        # 「議論の主題」ワードクラウド用に公開アイデアの idea トークンを seed（読取＝entity_tokens 一本・DFT）。
        _ensure_discovery_idea_tokens(ts)
        ts.commit()
        print(f"[bootstrap] seeded discovery demo quest in {db_identifier}")


def seed_demo_info(db_identifier: str | None = None) -> None:
    """情報インプット（SC-50）デモを seed（冪等・非prod）＝frontend fixtures i1〜i5 相当。

    i2 は i1 の続報（parent_info_id）。機会/脅威・関連リンク（未棄却/棄却）・カテゴリ・ワードクラウド用トークンを含む。
    書き込み API（Phase C）はまだ無いため DB 直挿し。created_by は専用のデモ author を用意する。
    db_identifier 未指定なら ACME-01。ワーカ会社にも seed するため main() から各会社DBを渡してループする
    （InfoLink は同一会社DBの discovery seed を指すため、discovery を先に seed すること）。
    """
    from datetime import datetime, timezone
    from decimal import Decimal

    from app.tenant.info.orm import InfoItem, InfoItemCategory, InfoLink
    from app.tenant.tokens.orm import EntityToken

    s = get_settings()
    if not _seed_demo_enabled(s.app_env):
        return
    if db_identifier is None:
        with control_session() as session:
            company = session.query(Company).filter_by(company_code=SEED_COMPANY["company_code"]).one_or_none()
            db_identifier = company.db_identifier if company else None
    if db_identifier is None:
        return
    ids = DEMO_INFO_IDS
    authors = DEMO_INFO_AUTHOR_IDS

    def _dt(day: int) -> datetime:
        return datetime(2026, 9, day, tzinfo=timezone.utc)

    with get_tenant_session(db_identifier) as ts:
        if ts.get(InfoItem, ids["i1"]) is not None:
            return  # 冪等＝既に seed 済み
        # デモ author（会社DB users・情報の登録者表示名）。
        for key, name in (("hanako", "情報 花子"), ("taro", "開発 太郎"), ("jiro", "営業 次郎")):
            if ts.get(User, authors[key]) is None:
                ts.add(User(id=authors[key], account_id=uuid.uuid4(), display_name=name,
                            locale="ja", status="active"))
        ts.flush()
        ts.add(InfoItem(
            id=ids["i1"], created_by_id=authors["hanako"], title="生成AIの業務利用が急拡大（○○総研レポート）",
            body_html="<p>国内企業の<strong>生成AI導入率</strong>が前年比 2.4倍。</p>",
            body_text="国内企業の生成AI導入率が前年比2.4倍。文書作成・要約・コード支援での定着が進む。全社展開フェーズへ。",
            summary="国内企業の生成AI導入率が前年比2.4倍。文書作成・要約・コード支援での定着が進む。",
            source_url="https://example.com/genai-report", due_date=datetime(2026, 12, 31).date(),
            status="curated", priority="high", source="market_research", classification="information",
            scope="external", target_business="software_dev", impact_level="major", impact_class="opportunity",
            impact_timing="within_1y", triaged_on=_dt(17).date(), triage="innovation",
            triage_reason="新規事業の機会。社内AI活用支援サービスに接続可能。", created_at=_dt(16)))
        ts.add(InfoItem(
            id=ids["i2"], created_by_id=authors["taro"], parent_info_id=ids["i1"],
            title="生成AI 社内ガイドライン整備の動き（続報）",
            body_html="<p>大手数社が<strong>生成AI利用ガイドライン</strong>を公開。</p>",
            body_text="大手数社が生成AI利用ガイドラインを相次いで公開。入力禁止データの線引きと監査が論点。",
            summary="大手数社が生成AI利用ガイドラインを公開。情報分類と入力禁止データの線引きが論点。",
            source_url="https://example.com/genai-guideline", status="raw", source="news",
            scope="external", created_at=_dt(18)))
        ts.add(InfoItem(
            id=ids["i3"], created_by_id=authors["hanako"], title="競合A社が類似SaaSを大幅値下げ",
            body_html="<p><strong>競合A社</strong>が同カテゴリSaaSを 30% 値下げ。</p>",
            body_text="競合A社が同カテゴリSaaSを30%値下げ。価格競争が加速。既存商談の失注リスクと採算見直しが必要。",
            summary="競合A社が同カテゴリSaaSを30%値下げ。既存商談の失注リスクと採算見直しが必要。",
            source_url="https://example.com/competitor-price", due_date=datetime(2026, 10, 15).date(),
            status="curated", priority="highest", source="competitor", classification="information",
            scope="external", target_business="software_dev", impact_level="severe", impact_class="threat",
            impact_timing="within_3m", triaged_on=_dt(15).date(), triage="improve_business",
            triage_reason="採算前提を揺さぶる。価格戦略コンセプトの再評価が必要。", created_at=_dt(14)))
        ts.add(InfoItem(
            id=ids["i4"], created_by_id=authors["jiro"], title="展示会メモ：ノーコード需要の高まり",
            body_html="<p>展示会での聞き取り。中小の情シス人材不足でノーコード需要が強い。</p>",
            body_text="展示会での聞き取り。中小の情シス人材不足でノーコード需要が強い。",
            status="raw", source="event", scope="external", created_at=_dt(13)))
        ts.add(InfoItem(
            id=ids["i5"], created_by_id=authors["taro"], title="自社の画像処理基盤は横展開の余地あり",
            body_html="<p>既存の<strong>画像処理基盤</strong>は他事業へ転用可能。</p>",
            body_text="既存の画像処理基盤（社内資産）は他事業へ転用可能。実現可能性のヒントとして有望。",
            summary="既存の画像処理基盤（社内資産）は他事業へ転用可能。実現可能性ヒントとして有望。",
            status="curated", priority="normal", source="employee", classification="knowledge",
            scope="internal", target_business="software_dev", impact_level="moderate", impact_class="opportunity",
            impact_timing="within_1y", triaged_on=_dt(12).date(), triage="innovation",
            triage_reason="自社技術知見。アイデアの実現可能性根拠。", created_at=_dt(11)))
        ts.flush()
        # カテゴリ（#8）。
        for iid, cats in ((ids["i1"], ["ext_technology", "ext_industry"]),
                          (ids["i3"], ["ext_competitor", "ext_economy"]),
                          (ids["i5"], ["internal_tech", "internal_capability"])):
            for cat in cats:
                ts.add(InfoItemCategory(info_item_id=iid, category=cat))
        # 関連リンク（未棄却＝link_count に計上／棄却は除外）。target_id は多態参照（物理FKなし）。
        # 詳細で target_title を解決できるよう ideas/quests は実 seed（発見デモ）を指す。concepts は未実装ドメイン。
        ts.add(InfoLink(info_item_id=ids["i1"], target_type="ideas", target_id=DEMO_DISCOVERY_IDEA_IDS[0],
                        kind="supporting", origin="auto", score=Decimal("0.82")))
        ts.add(InfoLink(info_item_id=ids["i1"], target_type="quests", target_id=DEMO_DISCOVERY_QUEST_ID,
                        kind="related", origin="auto", score=Decimal("0.61")))
        ts.add(InfoLink(info_item_id=ids["i2"], target_type="ideas", target_id=DEMO_DISCOVERY_IDEA_IDS[0],
                        kind="related", origin="auto", score=Decimal("0.74")))
        ts.add(InfoLink(info_item_id=ids["i3"], target_type="concepts", target_id=uuid.uuid4(),
                        kind="refuting", origin="manual", score=Decimal("0.68")))
        ts.add(InfoLink(info_item_id=ids["i5"], target_type="ideas", target_id=DEMO_DISCOVERY_IDEA_IDS[1],
                        kind="supporting", origin="auto", score=Decimal("0.79")))
        # ワードクラウド用トークン（保存済み集計・§5.36）。
        tokens = {
            ids["i1"]: [("生成ai", 6), ("導入", 4), ("業務", 3)],
            ids["i2"]: [("ガイドライン", 3), ("監査", 2)],
            ids["i3"]: [("競合", 5), ("値下げ", 4), ("価格", 3)],
            ids["i4"]: [("ノーコード", 3), ("需要", 2)],
            ids["i5"]: [("画像処理", 4), ("転用", 2)],
        }
        for iid, toks in tokens.items():
            for tok, cnt in toks:
                # トークンは entity_tokens（owner_type='info'）へ＝ライブ書込経路（repo.replace_tokens）と一致。
                # 旧 info_tokens 直書きは読取（word_cloud/類似度=entity_tokens）とズレてワードクラウドが空になった（DFT・N-TC-334）。
                ts.add(EntityToken(owner_type="info", owner_id=iid, token=tok, count=cnt))
        ts.commit()
        print(f"[bootstrap] seeded info-input demo in {db_identifier}")


# スクロール/ページング確認用のフィラー件数（core i1〜i5 に加算）。
DEMO_INFO_FILLER_N = 30


def seed_demo_info_filler(db_identifier: str | None = None) -> None:
    """情報インプットのスクロール確認用フィラー（冪等・非prod）＝多数のバリエーション行を追加。

    core（i1〜i5）とは別に DEMO_INFO_FILLER_N 件を per-record 冪等で投入（既存はスキップ）。状態/優先度/
    影響分類/情報ソース/登録者/登録日を循環させ、一覧のソート・絞込・ページング・ヘッダー固定の確認に使う。
    全文検索テストと干渉しないよう本文は中立語彙のみ（「ブロックチェーン」等の検証キーワードは使わない）。
    db_identifier 未指定なら ACME-01。ワーカ会社にも seed するため main() から各会社DBを渡してループする。
    """
    from datetime import datetime, timedelta, timezone

    from app.tenant.info.orm import InfoItem
    from app.tenant.tokens.orm import EntityToken

    s = get_settings()
    if not _seed_demo_enabled(s.app_env):
        return
    if db_identifier is None:
        with control_session() as session:
            company = session.query(Company).filter_by(company_code=SEED_COMPANY["company_code"]).one_or_none()
            db_identifier = company.db_identifier if company else None
    if db_identifier is None:
        return

    authors = list(DEMO_INFO_AUTHOR_IDS.values())
    statuses = ["curated", "raw", "curated", "raw", "curated"]
    priorities = ["highest", "high", "normal", "low", "lowest", None]
    impacts = ["opportunity", "threat", "other", None]
    sources = ["market_research", "news", "event", "customer", "competitor",
               "employee", "research", "public_data", "other"]
    topics = ["顧客動向", "業務効率化", "コスト構造", "人材・組織", "規制・法令",
              "海外市場", "品質・不具合", "提携・M&A", "サプライチェーン", "新技術評価"]
    vocab = ["市場", "動向", "顧客", "業務", "改善", "コスト", "品質", "納期", "人材", "投資",
             "規制", "標準化", "自動化", "分析", "戦略", "提携", "海外", "国内", "供給", "効率"]
    base = datetime(2026, 9, 8, tzinfo=timezone.utc)

    added = 0
    with get_tenant_session(db_identifier) as ts:
        # authors は core seeder が作るが、フィラー単独実行にも耐えるよう保険で確認。
        for key, name in (("hanako", "情報 花子"), ("taro", "開発 太郎"), ("jiro", "営業 次郎")):
            if ts.get(User, DEMO_INFO_AUTHOR_IDS[key]) is None:
                ts.add(User(id=DEMO_INFO_AUTHOR_IDS[key], account_id=uuid.uuid4(),
                            display_name=name, locale="ja", status="active"))
        ts.flush()
        for n in range(1, DEMO_INFO_FILLER_N + 1):
            fid = uuid.UUID(f"14f00000-0000-4000-b000-{n:012d}")
            if ts.get(InfoItem, fid) is not None:
                continue
            topic = topics[n % len(topics)]
            title = f"市場・業務メモ {n:02d}：{topic}"
            body = f"{topic}に関する社内外メモ。{vocab[n % len(vocab)]}と{vocab[(n + 7) % len(vocab)]}の観点で整理。"
            ts.add(InfoItem(
                id=fid, created_by_id=authors[n % len(authors)], title=title,
                body_html=f"<p>{body}</p>", body_text=body, summary=body[:60],
                status=statuses[n % len(statuses)], priority=priorities[n % len(priorities)],
                source=sources[n % len(sources)], classification="information",
                scope="internal" if n % 2 else "external", impact_class=impacts[n % len(impacts)],
                created_at=base - timedelta(days=n)))
            for tok in (vocab[n % len(vocab)], vocab[(n + 7) % len(vocab)]):
                ts.add(EntityToken(owner_type="info", owner_id=fid, token=tok, count=1))
            added += 1
        ts.commit()
    if added:
        print(f"[bootstrap] seeded {added} info-input filler items in {db_identifier}")


def seed_demo_strategy(db_identifier: str | None = None) -> None:
    """経営資料整合デモ（冪等・非prod）＝経営資料1件＋コンセプト2件を発見デモクエストに適用し、R.4b「方針まわりの
    語像」が info＋idea＋concept で充実するようにする（FR-44・設計§7②）。

    - トークンは全てライブと同一トークナイザ（`persist_entity_tokens`）で付与＝経営資料⇔情報/アイデア/コンセプト
      の一致判定（整合率 recompute・関連コンセプト・関連情報）が素性の揃った状態で効く。
    - 発見デモクエスト（`seed_demo_discovery`）とそのアイデア（idea トークン）が前提＝main() で後に呼ぶこと。
    """
    from app.tenant.concepts import application as concepts_app
    from app.tenant.concepts import repository as concepts_repo
    from app.tenant.concepts.orm import Concept
    from app.tenant.info import application as info_app
    from app.tenant.quests.orm import Quest
    from app.tenant.strategy import alignment as strat_align
    from app.tenant.strategy import application as strat_app
    from app.tenant.strategy import repository as strat_repo
    from app.tenant.strategy.orm import StrategyDocument

    s = get_settings()
    if not _seed_demo_enabled(s.app_env):
        return
    with control_session() as session:
        if db_identifier is None:
            company = session.query(Company).filter_by(company_code=SEED_COMPANY["company_code"]).one_or_none()
            db_identifier = company.db_identifier if company else None
            company_obj = company
        else:
            company_obj = session.query(Company).filter_by(db_identifier=db_identifier).one_or_none()
    if db_identifier is None or company_obj is None:
        return

    with get_tenant_session(db_identifier) as ts:
        if ts.get(Quest, DEMO_DISCOVERY_QUEST_ID) is None:
            return  # 発見デモが無い会社はスキップ（前提の公開アイデアが無い）
        if strat_repo.get_document(ts, DEMO_STRATEGY_DOC_ID) is not None:
            return  # 冪等＝既に seed 済み
        # (1) 経営資料（ISO 構造化項目・本文は発見デモのアイデア/情報と語彙を重ねて関連付けが効くようにする）。
        #     固定ID で冪等にするため ORM を直接構築（repo.create_document は id をランダム採番するため使わない）。
        doc = StrategyDocument(
            id=DEMO_STRATEGY_DOC_ID, created_by_id=DEMO_DISCOVERY_OWNER_ID,
            title="【デモ】全社DX中期経営方針 2026–2028", doc_kind="midterm_plan",
            intent="部署を越えた情報共有と業務の自動化を進め、顧客への価値提供を加速する。",
            policy_commitment="現場主導の業務改善を支援し、オンボーディングと新人の人材育成に継続投資する。",
            strategy="市場動向と競合の価格戦略を踏まえ、ノーコードと生成AIの導入で業務効率を高める。",
            objectives="情報共有の自動化率を引き上げ、新人の立ち上がり期間を短縮する。",
            focus_areas=["業務効率化", "顧客価値", "人材・組織"],
            body_md="部署横断の情報共有基盤を整備し、業務プロセスの自動化と顧客対応の効率化を全社で推進する。",
            status="active",
        )
        ts.add(doc)
        ts.flush()
        doc.body_text = strat_app._compose_body_text(doc)
        ts.flush()
        info_app.persist_entity_tokens(ts, "strategy_doc", doc.id, doc.body_text)  # ライブと同一（_persist_tokens 相当）

        # (2) コンセプト2件（発見デモクエスト配下・本文は経営資料/アイデアと語彙を重ねる）。総合ルーム＋版＋トークン。
        concept_defs = [
            dict(id=DEMO_CONCEPT_IDS[0], title="部署横断の情報共有プラットフォーム",
                 problem="部署間で情報が分断し業務が重複している",
                 value_proposition="情報共有を自動化し業務効率を高める", target="全社員",
                 differentiation="既存の業務ツールと連携", solution_form="ノーコードで構築"),
            dict(id=DEMO_CONCEPT_IDS[1], title="オンボーディング自動化で新人定着",
                 problem="新人の立ち上がりに時間がかかり負担が大きい",
                 value_proposition="オンボーディングを自動化し新人の定着率を高める", target="新入社員と受入部署",
                 differentiation="動画と対話で現場に適応", solution_form="生成AIを活用"),
        ]
        for cdef in concept_defs:
            if concepts_repo.get_concept(ts, cdef["id"]) is not None:
                continue
            concept = Concept(quest_id=DEMO_DISCOVERY_QUEST_ID, author_id=DEMO_DISCOVERY_OWNER_ID,
                              viability={}, **cdef)  # 固定ID（冪等）＝ORM 直接構築
            ts.add(concept)
            ts.flush()
            concepts_repo.create_chat_scope(ts, concept_id=concept.id, kind="overall", position=0)  # 総合ルーム
            concepts_app._snapshot_revision(ts, concept, DEMO_DISCOVERY_OWNER_ID, 1)  # 初版
            info_app.persist_entity_tokens(ts, "concept", concept.id, concepts_app._concept_text(concept))

        # (3) 経営資料を発見デモクエストに適用＋整合率 recompute（idea_alignment を作る＝R.4b の idea 由来）。
        strat_repo.reconcile_quest_docs(ts, DEMO_DISCOVERY_QUEST_ID, [DEMO_STRATEGY_DOC_ID])
        strat_align.recompute_for_quest(ts, DEMO_DISCOVERY_QUEST_ID, company=company_obj, award=False)
        ts.commit()
        print(f"[bootstrap] seeded strategy/concept demo in {db_identifier}")


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
    seed_quest_create_capabilities()  # FR-47＝seed ユーザに quest_create 付与（e2e createRecruiting 等が前提・冪等）
    seed_demo_quest_group()  # クエストグループのデモ（e2e createRecruiting 等が前提・非prod・冪等。内部で ACME-01＋ワーカ会社をループ）
    # 発見カタログ（SC-13）／情報インプット（SC-50・ドメイン N）デモを ACME-01 ＋（有効なら）ワーカ会社の
    # 各会社DBへ seed（冪等）。info の InfoLink は同一会社DBの discovery を指すため discovery を先に呼ぶ。
    for db_identifier in _demo_db_identifiers():
        seed_demo_discovery(db_identifier)
        seed_demo_info(db_identifier)
        seed_demo_info_filler(db_identifier)
        seed_demo_strategy(db_identifier)  # 経営資料＋コンセプト（R.4b 語像）＝discovery/info の後（アイデア/情報が前提）
    print("[bootstrap] done")


if __name__ == "__main__":
    main()
