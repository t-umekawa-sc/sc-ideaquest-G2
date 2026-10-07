"""②会社レベル能力（user_capabilities）API＋quest_create ゲート（FR-47・API T.4・doc/テスト/T_アイデアコンテスト.md §3）。

付与/剥奪は管理者のみ（一般は 403）。クエスト作成は管理者 OR `quest_create` 保持者のみ（決定K・移行は
既存作成者に自動付与）。共有 dev DB を汚さないよう作成物は finally で物理掃除。
"""
from __future__ import annotations

import uuid

from app.db.tenant import get_tenant_session
from tests.admin.test_admin_accounts import _login
from tests.admin.test_admin_issue import _csrf
from tests.conftest import SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD


def _admin(client, factory) -> dict:
    a = factory.make_seed_company_account(system_role="company_account_admin",
                                          display_name=f"能力管理_{uuid.uuid4().hex[:6]}")
    _login(client, SEED_COMPANY_CODE, a["login_id"], a["password"])
    return a


def _seed_db() -> str:
    from app.control_plane.auth.orm import Company
    from app.db.control import control_session
    with control_session() as s:
        return s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().db_identifier


def test_t_tc_121_capability_grant_revoke_admin_only(client, factory):
    """T-TC-121: ②能力の付与/剥奪は admin のみ・一般は 403／未知能力は 422／剥奪は論理（GET から消える）。"""
    target = factory.make_seed_company_account(display_name=f"対象_{uuid.uuid4().hex[:6]}")
    # 一般ユーザーは付与不可（403）。
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    assert client.post(f"/api/v1/admin/accounts/{target['id']}/capabilities",
                       json={"capability": "contest_evaluator"}, headers=_csrf(client)).status_code == 403
    # 管理者は付与できる＝GET に出る。
    _admin(client, factory)
    r = client.post(f"/api/v1/admin/accounts/{target['id']}/capabilities",
                    json={"capability": "contest_evaluator"}, headers=_csrf(client))
    assert r.status_code == 200, r.text
    assert "contest_evaluator" in r.json()["capabilities"]
    assert "contest_evaluator" in client.get(f"/api/v1/admin/accounts/{target['id']}/capabilities").json()["capabilities"]
    # 未知能力は 422。
    assert client.post(f"/api/v1/admin/accounts/{target['id']}/capabilities",
                       json={"capability": "bogus"}, headers=_csrf(client)).status_code == 422
    # 剥奪＝論理・GET から消える。
    rd = client.delete(f"/api/v1/admin/accounts/{target['id']}/capabilities/contest_evaluator", headers=_csrf(client))
    assert rd.status_code == 200 and "contest_evaluator" not in rd.json()["capabilities"]


def test_t_tc_208_capability_holders_list(client, factory):
    """T-TC-208: 能力保有者一覧（汎用付与UI）＝任意能力の保有者を氏名/付与者/付与日つきで返す・管理者のみ・剥奪で消える。"""
    from sqlalchemy import text as _text

    dn = f"保有者_{uuid.uuid4().hex[:6]}"
    target = factory.make_seed_company_account(display_name=dn)
    # 一般ユーザーは一覧不可（403）。
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    assert client.get("/api/v1/admin/capabilities/contest_create/holders").status_code == 403
    # 管理者で付与 → 一覧に出る（付与者名＋付与日時つき）。
    adn = f"能力管理_{uuid.uuid4().hex[:6]}"
    admin = factory.make_seed_company_account(system_role="company_account_admin", display_name=adn)
    _login(client, SEED_COMPANY_CODE, admin["login_id"], admin["password"])
    assert client.post(f"/api/v1/admin/accounts/{target['id']}/capabilities",
                       json={"capability": "contest_create"}, headers=_csrf(client)).status_code == 200
    r = client.get("/api/v1/admin/capabilities/contest_create/holders")
    assert r.status_code == 200, r.text
    rows = r.json()["data"]
    mine = [h for h in rows if h["account_id"] == str(target["id"])]
    assert len(mine) == 1, rows
    assert mine[0]["display_name"] == dn
    assert mine[0]["granted_by"] == adn  # 付与者=ログイン中の管理者
    assert mine[0]["granted_at"]
    # 未知能力は 422。
    assert client.get("/api/v1/admin/capabilities/bogus/holders").status_code == 422
    # 剥奪すると一覧から消える（revoked_at・論理）。
    assert client.delete(f"/api/v1/admin/accounts/{target['id']}/capabilities/contest_create",
                         headers=_csrf(client)).status_code == 200
    r2 = client.get("/api/v1/admin/capabilities/contest_create/holders")
    assert str(target["id"]) not in [h["account_id"] for h in r2.json()["data"]]
    # 共有 dev DB を汚さないよう物理掃除（account は既存テスト同様残置）。
    with get_tenant_session(_seed_db()) as ts:
        ts.execute(_text("DELETE FROM user_capabilities WHERE user_id IN "
                         "(SELECT id FROM users WHERE account_id = :a)"), {"a": target["id"]})
        ts.commit()


def test_t_tc_123_quest_create_capability_gate(client, factory):
    """T-TC-123: クエスト作成は quest_create 保持者のみ（決定K）＝非保持の一般は 403・付与後は 201・管理者は常時可。"""
    from sqlalchemy import text as _text

    creator = factory.make_seed_company_account(display_name=f"作成者_{uuid.uuid4().hex[:6]}")
    _login(client, SEED_COMPANY_CODE, creator["login_id"], creator["password"])
    body = {"title": f"能力ゲート_{uuid.uuid4().hex[:6]}", "color": "#3B82F6", "quest_group_ids": [], "categories": []}
    # 非保持＝403（capability_required）。
    r = client.post("/api/v1/quests", json=body, headers=_csrf(client))
    assert r.status_code == 403, r.text
    assert r.json()["errors"][0]["code"] == "capability_required"
    # quest_create を付与 → 201。
    factory.grant_capability(creator["id"], "quest_create")
    r2 = client.post("/api/v1/quests", json=body, headers=_csrf(client))
    assert r2.status_code == 201, r2.text
    qid = r2.json()["id"]
    try:
        # 管理者は能力行なしでも作成可（常時保持）。
        _admin(client, factory)
        r3 = client.post("/api/v1/quests", json={**body, "title": f"管理者_{uuid.uuid4().hex[:6]}"}, headers=_csrf(client))
        assert r3.status_code == 201, r3.text
        qid_admin = r3.json()["id"]
    finally:
        with get_tenant_session(_seed_db()) as ts:
            for q in (qid, locals().get("qid_admin")):
                if not q:
                    continue
                ts.execute(_text("DELETE FROM quest_member_permissions WHERE quest_member_id IN "
                                 "(SELECT id FROM quest_members WHERE quest_id = :q)"), {"q": q})
                for tbl in ("quest_revisions", "quest_categories", "quest_members", "quest_group_links"):
                    ts.execute(_text(f"DELETE FROM {tbl} WHERE quest_id = :q"), {"q": q})
                ts.execute(_text("DELETE FROM quests WHERE id = :q"), {"q": q})
            ts.commit()
