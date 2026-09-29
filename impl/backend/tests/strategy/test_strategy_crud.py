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
