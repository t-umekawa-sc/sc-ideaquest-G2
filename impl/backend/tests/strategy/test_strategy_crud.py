"""経営資料 CRUD API テスト（ドメイン R.1・FR-44・doc/テスト/R_経営資料.md §1）。

権限＝company_account_admin/system_admin のみ変更可（一般は 403）。選択用一覧（?for=selection）は
クエスト作成者（require_me）に開放（active のみ・軽量）。body_text 連結＋entity_tokens（owner_type='strategy_doc'）同期。
"""
from __future__ import annotations

import uuid

import pytest

from app.control_plane.auth.orm import Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.strategy.orm import IdeaAlignment, StrategyDocument
from app.tenant.tokens import repository as tokens_repo
from app.tenant.tokens.orm import EntityToken
from tests.admin.test_admin_accounts import _login
from tests.admin.test_admin_issue import _csrf
from tests.conftest import SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD

BASE = "/api/v1/strategy-documents"


def _seed_db() -> str:
    with control_session() as s:
        return s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().db_identifier


@pytest.fixture
def docs():
    """作成した経営資料の掃除（共有 dev DB 汚染防止）＝従属（tokens/alignment）も含めて物理削除。"""
    ids: list[uuid.UUID] = []
    yield ids
    db = _seed_db()
    with get_tenant_session(db) as ts:
        for did in ids:
            ts.execute(IdeaAlignment.__table__.delete().where(IdeaAlignment.strategy_document_id == did))
            ts.execute(EntityToken.__table__.delete().where(EntityToken.owner_type == "strategy_doc", EntityToken.owner_id == did))
            ts.execute(StrategyDocument.__table__.delete().where(StrategyDocument.id == did))
        ts.commit()


def _admin(client, factory):
    a = factory.make_seed_company_account(system_role="company_account_admin", display_name=f"経営管理_{uuid.uuid4().hex[:6]}")
    _login(client, SEED_COMPANY_CODE, a["login_id"], a["password"])
    return a


def _body(title: str) -> dict:
    return {
        "title": title, "doc_kind": "midterm_plan",
        "intent": "脱炭素で地域に貢献する", "policy_commitment": "全社で環境技術に投資する",
        "strategy": "再生可能エネルギーの内製化", "focus_areas": ["脱炭素", "地域貢献"],
        "objectives": "2030年までにCO2排出を半減", "body_md": "補足の全文テキスト",
        "period_from": "2027-04-01", "period_to": "2030-03-31",
    }


def test_r_tc_101_create_persists_tokens(client, factory, docs):
    """R-TC-101 経営資料作成＝201＋body_text 連結＋entity_tokens（owner='strategy_doc'）永続化。"""
    _admin(client, factory)
    r = client.post(BASE, json=_body(f"中期計画_{uuid.uuid4().hex[:6]}"), headers=_csrf(client))
    assert r.status_code == 201, r.text
    did = uuid.UUID(r.json()["id"]); docs.append(did)
    assert r.json()["doc_kind"] == "midterm_plan" and r.json()["status"] == "active"
    with get_tenant_session(_seed_db()) as ts:
        assert tokens_repo.tokens_for(ts, "strategy_doc", did), "本文トークンが entity_tokens に永続化される"


def test_r_tc_102_list_and_authz(client, factory, docs):
    """R-TC-102 管理一覧に作成分が出る／一般ユーザーは 403（管理者スコープ）。"""
    _admin(client, factory)
    title = f"方針_{uuid.uuid4().hex[:6]}"
    did = uuid.UUID(client.post(BASE, json=_body(title), headers=_csrf(client)).json()["id"]); docs.append(did)
    body = client.get(f"{BASE}?q={title}").json()
    assert any(d["id"] == str(did) for d in body["data"]) and body["page_info"]["total"] >= 1
    # 一般ユーザーは管理一覧 403。
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    assert client.get(BASE).status_code == 403


def test_r_tc_103_selection_active_only(client, factory, docs):
    """R-TC-103 選択用一覧（?for=selection）は一般ユーザー可・active のみ（archived 除外・軽量）。"""
    _admin(client, factory)
    title = f"選択_{uuid.uuid4().hex[:6]}"
    did = uuid.UUID(client.post(BASE, json=_body(title), headers=_csrf(client)).json()["id"]); docs.append(did)
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)  # 一般ユーザー
    sel = client.get(f"{BASE}?for=selection&q={title}")
    assert sel.status_code == 200
    hit = [d for d in sel.json()["data"] if d["id"] == str(did)]
    assert hit and set(hit[0].keys()) == {"id", "title", "doc_kind", "period_from", "period_to"}  # 軽量（全文/率なし）


def test_r_tc_104_update_and_validation(client, factory, docs):
    """R-TC-104 更新＝反映＋トークン再永続化／doc_kind 不正・期間逆転は 422。"""
    _admin(client, factory)
    did = uuid.UUID(client.post(BASE, json=_body(f"更新_{uuid.uuid4().hex[:6]}"), headers=_csrf(client)).json()["id"]); docs.append(did)
    r = client.patch(f"{BASE}/{did}", json={"strategy": "水素エネルギーへ転換", "focus_areas": ["水素"]}, headers=_csrf(client))
    assert r.status_code == 200 and r.json()["strategy"] == "水素エネルギーへ転換"
    assert client.patch(f"{BASE}/{did}", json={"doc_kind": "bogus"}, headers=_csrf(client)).status_code == 422
    assert client.patch(f"{BASE}/{did}", json={"period_from": "2030-01-01", "period_to": "2027-01-01"}, headers=_csrf(client)).status_code == 422


def test_r_tc_105_authz_and_csrf(client, factory, docs):
    """R-TC-105 一般ユーザーの作成は 403／CSRF 無しは 403。"""
    _admin(client, factory)
    # CSRF 無し（ヘッダー未付与）は 403。
    assert client.post(BASE, json=_body("csrfなし")).status_code == 403
    # 一般ユーザーは作成 403。
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    assert client.post(BASE, json=_body("一般"), headers=_csrf(client)).status_code == 403


def test_r_tc_106_archive_excluded_from_selection(client, factory, docs):
    """R-TC-106 アーカイブ＝status=archived・選択用一覧から除外される（物理削除はしない＝論理削除）。"""
    _admin(client, factory)
    title = f"アーカイブ_{uuid.uuid4().hex[:6]}"
    did = uuid.UUID(client.post(BASE, json=_body(title), headers=_csrf(client)).json()["id"]); docs.append(did)
    assert client.post(f"{BASE}/{did}/archive", headers=_csrf(client)).json()["status"] == "archived"
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    sel = client.get(f"{BASE}?for=selection&q={title}").json()["data"]
    assert not any(d["id"] == str(did) for d in sel), "archived は選択用一覧に出ない"


def test_r_tc_108_quest_link_and_revision(client, factory, docs):
    """R-TC-108 経営資料←→クエストの紐づけ＝候補検索/追加/解除＋クエスト版履歴に記録（R.1b・§5.56/§3.1）。"""
    from sqlalchemy import select as _select
    from app.tenant.quests.orm import Quest, QuestRevision

    adm = _admin(client, factory)  # このadminがクエストの作成者=owner（後で削除できる）
    stamp = uuid.uuid4().hex[:6]
    did = uuid.UUID(client.post(BASE, json=_body(f"紐付_{stamp}"), headers=_csrf(client)).json()["id"]); docs.append(did)
    # 紐づけ対象のクエストを作成（kanri＝active ユーザーで可）。
    qr = client.post("/api/v1/quests", headers=_csrf(client), json={
        "title": f"紐付クエスト_{stamp}", "color": "#0D9488", "quest_group_ids": [], "categories": ["業務改善"],
        "deadline": "2026-12-31", "purpose": "目的", "status": "recruiting"})
    assert qr.status_code == 201, qr.text
    qid = qr.json()["id"]
    try:
        # 候補検索に出る。
        cand = client.get(f"{BASE}/quest-candidates?q=紐付クエスト_{stamp}").json()["data"]
        assert any(c["id"] == qid for c in cand)
        # 紐づけ追加＝linked に出る。
        add = client.post(f"{BASE}/{did}/quests", json={"quest_ids": [qid]}, headers=_csrf(client))
        assert add.status_code == 200 and any(x["id"] == qid for x in add.json()["data"])
        assert any(x["id"] == qid for x in client.get(f"{BASE}/{did}/quests").json()["data"])
        # 版履歴＝クエストの最新版 changes に strategy_documents（資料タイトル）が載る。
        with get_tenant_session(_seed_db()) as ts:
            rev = ts.execute(_select(QuestRevision).where(QuestRevision.quest_id == uuid.UUID(qid))
                             .order_by(QuestRevision.revision.desc())).scalars().first()
            assert rev is not None and f"紐付_{stamp}" in (rev.changes.get("strategy_documents") or []), "版履歴に適用資料が記録される"
        # 解除＝linked から消える。
        rm = client.delete(f"{BASE}/{did}/quests/{qid}", headers=_csrf(client))
        assert rm.status_code == 200 and not any(x["id"] == qid for x in rm.json()["data"])
        # 認可＝一般ユーザーは紐づけ一覧 403。
        _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
        assert client.get(f"{BASE}/{did}/quests").status_code == 403
    finally:
        # クエスト＋子行を物理掃除（quest_revisions.editor_id 等が factory の user 削除を阻害しないよう）。
        from sqlalchemy import text as _text
        with get_tenant_session(_seed_db()) as ts:
            ts.execute(_text("DELETE FROM quest_member_permissions WHERE quest_member_id IN "
                             "(SELECT id FROM quest_members WHERE quest_id = :q)"), {"q": qid})
            for tbl in ("quest_strategy_documents", "quest_revisions", "quest_categories", "quest_members",
                        "quest_group_links", "quest_decision_log", "quest_outcome_revisions"):
                ts.execute(_text(f"DELETE FROM {tbl} WHERE quest_id = :q"), {"q": qid})
            ts.execute(_text("DELETE FROM quests WHERE id = :q"), {"q": qid})
            ts.commit()


def test_r_tc_109_quest_candidates_icon_url(client, factory, docs):
    """R-TC-109 クエスト候補にアイコン署名URLを載せる（ピッカー行頭表示・未設定は null）。"""
    from app.tenant.profile.orm import User
    from app.tenant.quests.orm import Quest

    _admin(client, factory)  # 候補検索は管理者スコープ（require_company_account_admin）
    stamp = uuid.uuid4().hex[:6]
    owner, qic, qno = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    db = _seed_db()
    with get_tenant_session(db) as ts:
        ts.add(User(id=owner, account_id=uuid.uuid4(), display_name=f"候補owner_{stamp}", locale="ja", status="active"))
        ts.flush()
        ts.add(Quest(id=qic, owner_id=owner, title=f"アイコン有Q_{stamp}", color="#0D9488", status="recruiting",
                     icon_image_path="quest-icons/r109-zz"))
        ts.add(Quest(id=qno, owner_id=owner, title=f"アイコン無Q_{stamp}", color="#0D9488", status="recruiting"))
        ts.commit()
    try:
        cand = {c["id"]: c for c in client.get(f"{BASE}/quest-candidates?q=Q_{stamp}").json()["data"]}
        icon = cand[str(qic)]["icon_image_url"]
        assert icon and "quest-icons/r109-zz" in icon  # 署名URL にアイコンキーが載る
        assert cand[str(qno)]["icon_image_url"] is None  # 未設定は null＝頭文字タイル
    finally:
        with get_tenant_session(db) as ts:
            ts.execute(Quest.__table__.delete().where(Quest.id.in_([qic, qno])))
            ts.execute(User.__table__.delete().where(User.id == owner))
            ts.commit()


def test_r_tc_107_unarchive_restores(client, factory, docs):
    """R-TC-107 復元（アーカイブ解除）＝status=active に戻り、選択用一覧に再び出る（誤アーカイブの復元）。"""
    _admin(client, factory)
    title = f"復元_{uuid.uuid4().hex[:6]}"
    did = uuid.UUID(client.post(BASE, json=_body(title), headers=_csrf(client)).json()["id"]); docs.append(did)
    client.post(f"{BASE}/{did}/archive", headers=_csrf(client))
    r = client.post(f"{BASE}/{did}/unarchive", headers=_csrf(client))
    assert r.status_code == 200 and r.json()["status"] == "active"
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    sel = client.get(f"{BASE}?for=selection&q={title}").json()["data"]
    assert any(d["id"] == str(did) for d in sel), "復元後は選択用一覧に再び出る"
