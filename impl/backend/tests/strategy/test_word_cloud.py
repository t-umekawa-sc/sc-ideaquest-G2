"""この方針まわりの語像（R.4b・Step4・設計§7＝集約でのみ UI 化・doc/テスト/R_経営資料.md §3）。

`GET /strategy-documents/{id}/word-cloud`（管理者スコープ）＝関連情報（R.4 母集団）＋関連アイデア（idea_alignment）＋
関連コンセプト（トークン重なり）の entity_tokens を頻度集約。weight は最頻値を 1.0 とした正規化。決定的。
**共有 dev DB を汚さぬよう、ユニーク語で母集団を投入分に限定**して検証する。
"""
from __future__ import annotations

import uuid

from app.control_plane.auth.orm import Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.concepts.orm import Concept
from app.tenant.ideas.orm import Idea
from app.tenant.info.orm import InfoItem
from app.tenant.profile.orm import User
from app.tenant.quests.orm import Quest
from app.tenant.strategy import application as strategy_app
from app.tenant.strategy.orm import IdeaAlignment, StrategyDocument
from app.tenant.tokens.orm import EntityToken
from tests.admin.test_admin_accounts import _login
from tests.conftest import SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD

BASE = "/api/v1/strategy-documents"


def _seed_company() -> Company:
    with control_session() as s:
        return s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one()


def _admin(client, factory):
    a = factory.make_seed_company_account(system_role="company_account_admin",
                                          display_name=f"wc_admin_{uuid.uuid4().hex[:6]}")
    _login(client, SEED_COMPANY_CODE, a["login_id"], a["password"])
    return a


def _tok(ot, oid, pairs):
    return [EntityToken(owner_type=ot, owner_id=oid, token=t, count=n) for t, n in pairs]


def test_r_tc_114_word_cloud_aggregates_related(client, factory):
    """R-TC-114 方針まわりの語像＝関連情報＋アイデア＋コンセプトの語を頻度集約・weight 正規化／認可。"""
    db = _seed_company().db_identifier
    u = uuid.uuid4().hex[:8]
    shared = f"語像{u}共有"  # 資料と関連判定に使う共有語（info/concept が共有＝関連に入る）
    w_info, w_idea, w_con = f"語像{u}情報", f"語像{u}案", f"語像{u}構想"
    owner = uuid.uuid4()
    qid, did, iid, cid = (uuid.uuid4() for _ in range(4))
    info_id = uuid.uuid4()
    try:
        with get_tenant_session(db) as ts:
            ts.add(User(id=owner, account_id=uuid.uuid4(), display_name="wc作者", locale="ja", status="active"))
            ts.flush()
            ts.add(Quest(id=qid, owner_id=owner, title="wcクエスト", color="#0D9488", status="recruiting"))
            ts.add(StrategyDocument(id=did, title=f"wc方針_{u}", doc_kind="policy",
                                    created_by_id=owner, body_text=shared, status="active"))
            ts.flush()
            ts.add(Idea(id=iid, quest_id=qid, author_id=owner, title="wcアイデア", body="本文", value="価値", status="published"))
            ts.add(Concept(id=cid, quest_id=qid, author_id=owner, title="wcコンセプト"))
            ts.add(InfoItem(id=info_id, title="wc情報", created_by_id=owner, status="curated", impact_class="opportunity"))
            ts.flush()
            ts.add(IdeaAlignment(idea_id=iid, strategy_document_id=did, score=0.8, method="keyword"))
            ts.add_all(_tok("strategy_doc", did, [(shared, 1)]))
            ts.add_all(_tok("info", info_id, [(shared, 1), (w_info, 1)]))  # 関連（shared 共有）
            ts.add_all(_tok("concept", cid, [(shared, 1), (w_con, 1)]))     # 関連（shared 共有）
            ts.add_all(_tok("idea", iid, [(shared, 1), (w_idea, 1)]))       # 関連（idea_alignment）
            ts.commit()

        _admin(client, factory)
        r = client.get(f"{BASE}/{did}/word-cloud")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["related_count"] == 3, body  # info + idea + concept
        toks = {t["token"]: t for t in body["tokens"]}
        # 共有語は 3 owner で最頻＝weight 1.0。各固有語も tokens に出る。
        assert toks[shared]["count"] == 3 and toks[shared]["weight"] == 1.0, toks.get(shared)
        for w in (w_info, w_idea, w_con):
            assert w in toks, w
            assert toks[w]["weight"] == round(1 / 3, 3)

        # 認可：一般は 403・不明 ID は 404。
        _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
        assert client.get(f"{BASE}/{did}/word-cloud").status_code == 403
        _admin(client, factory)
        assert client.get(f"{BASE}/{uuid.uuid4()}/word-cloud").status_code == 404
    finally:
        with get_tenant_session(db) as ts:
            ts.execute(IdeaAlignment.__table__.delete().where(IdeaAlignment.strategy_document_id == did))
            ts.execute(EntityToken.__table__.delete().where(EntityToken.owner_id.in_([did, info_id, iid, cid])))
            ts.execute(InfoItem.__table__.delete().where(InfoItem.id == info_id))
            ts.execute(Concept.__table__.delete().where(Concept.id == cid))
            ts.execute(Idea.__table__.delete().where(Idea.id == iid))
            ts.execute(StrategyDocument.__table__.delete().where(StrategyDocument.id == did))
            ts.execute(Quest.__table__.delete().where(Quest.id == qid))
            ts.execute(User.__table__.delete().where(User.id == owner))
            ts.commit()


def test_r_tc_115_word_cloud_empty_when_no_related():
    """R-TC-115 関連 0 は空 tokens・related_count=0（例外なし）。"""
    company = _seed_company()
    db = company.db_identifier
    u = uuid.uuid4().hex[:8]
    owner = uuid.uuid4()
    did = uuid.uuid4()
    try:
        with get_tenant_session(db) as ts:
            ts.add(User(id=owner, account_id=uuid.uuid4(), display_name="wc0作者", locale="ja", status="active"))
            ts.flush()
            ts.add(StrategyDocument(id=did, title="wc0方針", doc_kind="policy",
                                    created_by_id=owner, body_text=f"孤立語{u}", status="active"))
            ts.flush()
            ts.add_all(_tok("strategy_doc", did, [(f"孤立語{u}", 1)]))  # 誰とも重ならない
            ts.commit()
        with get_tenant_session(db) as ts:
            doc = ts.get(StrategyDocument, did)
            wc = strategy_app._word_cloud(ts, doc, company)
            assert wc["tokens"] == [] and wc["related_count"] == 0, wc
    finally:
        with get_tenant_session(db) as ts:
            ts.execute(EntityToken.__table__.delete().where(EntityToken.owner_id == did))
            ts.execute(StrategyDocument.__table__.delete().where(StrategyDocument.id == did))
            ts.execute(User.__table__.delete().where(User.id == owner))
            ts.commit()
