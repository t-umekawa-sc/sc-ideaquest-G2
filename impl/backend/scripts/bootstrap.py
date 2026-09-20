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


def seed_demo_info() -> None:
    """ACME-01 に情報インプット（SC-50）デモを seed（冪等・非prod）＝frontend fixtures i1〜i5 相当。

    i2 は i1 の続報（parent_info_id）。機会/脅威・関連リンク（未棄却/棄却）・カテゴリ・ワードクラウド用トークンを含む。
    書き込み API（Phase C）はまだ無いため DB 直挿し。created_by は専用のデモ author を用意する。
    """
    from datetime import datetime, timezone
    from decimal import Decimal

    from app.tenant.info.orm import InfoItem, InfoItemCategory, InfoLink, InfoToken

    s = get_settings()
    if not _seed_demo_enabled(s.app_env):
        return
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
                ts.add(InfoToken(info_item_id=iid, token=tok, count=cnt))
        ts.commit()
        print(f"[bootstrap] seeded info-input demo in {db_identifier}")


# スクロール/ページング確認用のフィラー件数（core i1〜i5 に加算）。
DEMO_INFO_FILLER_N = 30


def seed_demo_info_filler() -> None:
    """情報インプットのスクロール確認用フィラー（冪等・非prod）＝多数のバリエーション行を追加。

    core（i1〜i5）とは別に DEMO_INFO_FILLER_N 件を per-record 冪等で投入（既存はスキップ）。状態/優先度/
    影響分類/情報ソース/登録者/登録日を循環させ、一覧のソート・絞込・ページング・ヘッダー固定の確認に使う。
    全文検索テストと干渉しないよう本文は中立語彙のみ（「ブロックチェーン」等の検証キーワードは使わない）。
    """
    from datetime import datetime, timedelta, timezone

    from app.tenant.info.orm import InfoItem, InfoToken

    s = get_settings()
    if not _seed_demo_enabled(s.app_env):
        return
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
                ts.add(InfoToken(info_item_id=fid, token=tok, count=1))
            added += 1
        ts.commit()
    if added:
        print(f"[bootstrap] seeded {added} info-input filler items in {db_identifier}")


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
    seed_demo_info()  # 情報インプット（SC-50・ドメイン N）デモ（非prod・冪等）
    seed_demo_info_filler()  # 情報インプットのスクロール確認用フィラー（非prod・冪等）
    print("[bootstrap] done")


if __name__ == "__main__":
    main()
