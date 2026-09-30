"""経営資料 AI 用 Markdown エクスポート（R.5・Step5・doc/テスト/R_経営資料.md §4）。

`GET /strategy-documents/{id}/export.md`（管理者スコープ）＝経営資料本体（ISO56001 項目立て）＋関連度上位のアイデア
＋関連情報（機会/脅威ラベル）＋関連コンセプトを構造化 Markdown に束ねて返す。**利用者の明示操作でのみ・外部送信しない**
（生成は利用者が任意 LLM に貼る＝データ主権・§8/§10）。決定的（整合率キャッシュ＋トークン重なり）。
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
from app.tenant.strategy import export as export_mod
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
                                          display_name=f"export_admin_{uuid.uuid4().hex[:6]}")
    _login(client, SEED_COMPANY_CODE, a["login_id"], a["password"])
    return a


def _tok(ot, oid, pairs):
    return [EntityToken(owner_type=ot, owner_id=oid, token=t, count=n) for t, n in pairs]


def test_r_tc_112_export_markdown_structure_and_authz(client, factory):
    """R-TC-112 export.md が構造化 Markdown を返す（本体＋関連情報の機会ラベル）／認可（一般403・不明404）。"""
    db = _seed_company().db_identifier
    u = uuid.uuid4().hex[:8]
    uA = f"輸出{u}a"  # ユニーク語＝母集団を投入分に限定
    owner = uuid.uuid4()
    did = uuid.uuid4()
    info_id = uuid.uuid4()
    info_title = f"太陽光の新規事業_{u}"
    try:
        with get_tenant_session(db) as ts:
            ts.add(User(id=owner, account_id=uuid.uuid4(), display_name="export作者", locale="ja", status="active"))
            ts.flush()
            ts.add(StrategyDocument(id=did, title=f"【輸出検証】脱炭素方針_{u}", doc_kind="policy",
                                    created_by_id=owner, intent="脱炭素で地域に貢献する",
                                    strategy="再生可能エネルギーの内製化", focus_areas=["脱炭素"],
                                    objectives="2030年までにCO2半減", body_text=f"{uA}", status="active"))
            ts.add(InfoItem(id=info_id, title=info_title, created_by_id=owner,
                            status="curated", impact_class="opportunity"))
            ts.flush()
            ts.add_all(_tok("strategy_doc", did, [(uA, 1)]))
            ts.add_all(_tok("info", info_id, [(uA, 1)]))  # 関連（同ユニーク語）
            ts.commit()

        _admin(client, factory)
        r = client.get(f"{BASE}/{did}/export.md")
        assert r.status_code == 200, r.text
        assert r.headers["content-type"].startswith("text/markdown")
        md = r.text
        assert f"# 【輸出検証】脱炭素方針_{u}" in md
        # ISO56001 項目立ての見出し。
        for h in ["イノベーションの意図", "イノベーション方針", "戦略・方向性", "重点領域", "イノベーション目標"]:
            assert h in md, h
        # 関連情報（機会ラベル付き）。
        assert "## 8. 関連情報" in md
        assert info_title in md and "機会" in md
        assert "## 7. 関連度上位のアイデア" in md and "## 9. 関連コンセプト" in md

        # 認可：一般ユーザーは 403。
        _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
        assert client.get(f"{BASE}/{did}/export.md").status_code == 403
        # 不明 ID は 404（管理者）。
        _admin(client, factory)
        assert client.get(f"{BASE}/{uuid.uuid4()}/export.md").status_code == 404
    finally:
        with get_tenant_session(db) as ts:
            ts.execute(EntityToken.__table__.delete().where(EntityToken.owner_id.in_([did, info_id])))
            ts.execute(InfoItem.__table__.delete().where(InfoItem.id == info_id))
            ts.execute(StrategyDocument.__table__.delete().where(StrategyDocument.id == did))
            ts.execute(User.__table__.delete().where(User.id == owner))
            ts.commit()


def test_r_tc_113_build_markdown_ideas_concepts_and_escaping():
    """R-TC-113 ビルダーが関連アイデア/コンセプトを載せ・パイプをエスケープ・未記入/機会ラベルを埋める（決定的）。"""
    company = _seed_company()
    db = company.db_identifier
    u = uuid.uuid4().hex[:8]
    uA = f"builder{u}a"
    owner = uuid.uuid4()
    qid, did, iid, cid = (uuid.uuid4() for _ in range(4))
    idea_title = f"アイデアX_{u}"
    concept_title = f"コンセプトY_{u}"
    try:
        with get_tenant_session(db) as ts:
            ts.add(User(id=owner, account_id=uuid.uuid4(), display_name="builder作者", locale="ja", status="active"))
            ts.flush()
            ts.add(Quest(id=qid, owner_id=owner, title="builderクエスト", color="#0D9488", status="recruiting"))
            # intent 空＝「（未記入）」を確認。
            ts.add(StrategyDocument(id=did, title="builder方針", doc_kind="policy", created_by_id=owner,
                                    intent=None, body_text=uA, status="active"))
            ts.flush()  # quest/doc を先に確定（idea/concept の FK 先）
            ts.add(Idea(id=iid, quest_id=qid, author_id=owner, title=idea_title, body="本文", value="価値", status="published"))
            ts.add(Concept(id=cid, quest_id=qid, author_id=owner, title=concept_title))
            ts.flush()
            ts.add(IdeaAlignment(idea_id=iid, strategy_document_id=did, score=0.82, method="keyword"))
            ts.add_all(_tok("strategy_doc", did, [(uA, 1)]))
            ts.add_all(_tok("concept", cid, [(uA, 1)]))  # 関連（同ユニーク語）
            ts.commit()
        with get_tenant_session(db) as ts:
            doc = ts.get(StrategyDocument, did)
            related_info = [{"id": str(uuid.uuid4()), "title": "機会|情報", "impact_class": "opportunity", "score": 0.5}]
            md = export_mod.build_markdown(ts, doc, company, related_info)
            assert idea_title in md, "関連アイデアが表に出る"
            assert concept_title in md, "関連コンセプトが表に出る"
            assert "機会\\|情報" in md, "テーブルセルのパイプはエスケープ"
            assert "（未記入）" in md, "空項目は（未記入）"
            assert "| 機会 |" in md, "関連情報の分類ラベル"
    finally:
        with get_tenant_session(db) as ts:
            ts.execute(IdeaAlignment.__table__.delete().where(IdeaAlignment.strategy_document_id == did))
            ts.execute(EntityToken.__table__.delete().where(EntityToken.owner_id.in_([did, cid])))
            ts.execute(Concept.__table__.delete().where(Concept.id == cid))
            ts.execute(Idea.__table__.delete().where(Idea.id == iid))
            ts.execute(StrategyDocument.__table__.delete().where(StrategyDocument.id == did))
            ts.execute(Quest.__table__.delete().where(Quest.id == qid))
            ts.execute(User.__table__.delete().where(User.id == owner))
            ts.commit()
