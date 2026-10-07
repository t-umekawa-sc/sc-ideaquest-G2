"""アイデア→クエスト昇格（FR-47・API T.5・§7・決定H・doc/テスト/T_アイデアコンテスト.md §5）。

コンテストの有望アイデアを **別実体の独立業務クエスト** へ種継ぎ（内容コピー＋`quests.origin_idea_id` で
由来参照）。要 `quest_create`（②会社レベル能力・社内のみ）。public（コンテスト専用テナント）では
業務機能の昇格は存在しない＝404（存在秘匿・決定O/P'）。共有 dev DB を汚さないよう生成物を finally で掃除。
"""
from __future__ import annotations

import uuid

from sqlalchemy import text as _text

from app.db.tenant import get_tenant_session
from tests.admin.test_admin_accounts import _login
from tests.admin.test_admin_issue import _csrf
from tests.conftest import SEED_COMPANY_CODE
from tests.contests.test_contest_access import _purge_contest_idea, _seed_published_idea
from tests.contests.test_contests import BASE, _admin, _body, _seed_db, _user_id


def _cleanup_quest(qid: str) -> None:
    """昇格で生成した独立クエスト（＋付随行）を物理掃除。"""
    with get_tenant_session(_seed_db()) as ts:
        ts.execute(_text("DELETE FROM quest_member_permissions WHERE quest_member_id IN "
                         "(SELECT id FROM quest_members WHERE quest_id = :q)"), {"q": qid})
        for tbl in ("quest_revisions", "quest_categories", "quest_members", "quest_group_links"):
            ts.execute(_text(f"DELETE FROM {tbl} WHERE quest_id = :q"), {"q": qid})
        ts.execute(_text("DELETE FROM entity_tokens WHERE owner_type='quest' AND owner_id = :q"), {"q": qid})
        ts.execute(_text("DELETE FROM quests WHERE id = :q"), {"q": qid})
        ts.commit()


def test_t_tc_140_promote_idea_to_quest(client, factory):
    """T-TC-140: 昇格＝別実体の独立業務クエスト生成＋由来参照・要 `quest_create`・能力なしは 403。"""
    admin = _admin(client, factory)  # 主催者（管理者）でコンテスト作成→backing quest 取得。
    r = client.post(BASE, json=_body(status="open"), headers=_csrf(client))
    assert r.status_code == 201, r.text
    cid, qid = r.json()["id"], r.json()["quest_id"]
    iid = _seed_published_idea(qid, _user_id(admin["id"]))  # title=コンテスト案 / body=b / value=v
    new_qid = None
    try:
        # 能力あり（`quest_create` 付与）＝別実体の独立クエストを生成（title コピー＋origin_idea_id 保持）。
        promoter = factory.make_seed_company_account(display_name=f"昇格者_{uuid.uuid4().hex[:6]}")
        factory.grant_capability(promoter["id"], "quest_create")
        _login(client, SEED_COMPANY_CODE, promoter["login_id"], promoter["password"])
        rp = client.post(f"/api/v1/ideas/{iid}/promote-to-quest", headers=_csrf(client))
        assert rp.status_code == 201, rp.text
        new_qid = rp.json()["id"]
        assert new_qid != qid  # backing quest とは別実体（決定H）。
        with get_tenant_session(_seed_db()) as ts:
            origin, title, status = ts.execute(
                _text("SELECT origin_idea_id, title, status FROM quests WHERE id = :q"), {"q": new_qid}).one()
            assert str(origin) == str(iid)   # 由来参照を保持（トレーサビリティ）。
            assert title == "コンテスト案"    # 内容コピー。
            assert status == "draft"          # 昇格直後は下書き。
            # 作成者が owner でパーティー投入されている（全権限）。
            puid = _user_id(promoter["id"])
            n = ts.execute(_text("SELECT count(*) FROM quest_members WHERE quest_id = :q AND user_id = :u"),
                           {"q": new_qid, "u": str(puid)}).scalar()
            assert n == 1

        # 能力なし一般ユーザー＝403（capability_required）。
        general = factory.make_seed_company_account(display_name=f"一般_{uuid.uuid4().hex[:6]}")
        _login(client, SEED_COMPANY_CODE, general["login_id"], general["password"])
        r403 = client.post(f"/api/v1/ideas/{iid}/promote-to-quest", headers=_csrf(client))
        assert r403.status_code == 403, r403.text
        assert r403.json()["errors"][0]["code"] == "capability_required"
    finally:
        if new_qid:
            _cleanup_quest(new_qid)
        _purge_contest_idea(cid, iid)


def test_t_tc_140c_idea_detail_can_promote_flag(client, factory):
    """T-TC-140c: GET /ideas/{id}.can_promote＝コンテスト配下×`quest_create`/管理者に True・非保持は False（SC-22 出し分け・サーバー権威）。"""
    admin = _admin(client, factory)
    r = client.post(BASE, json=_body(status="open", auto_approve=True), headers=_csrf(client))
    assert r.status_code == 201, r.text
    cid, qid = r.json()["id"], r.json()["quest_id"]
    iid = _seed_published_idea(qid, _user_id(admin["id"]))
    try:
        # `quest_create` 保持者＝can_promote True（auto_approve コンテストなので閲覧可）。
        promoter = factory.make_seed_company_account(display_name=f"昇格者_{uuid.uuid4().hex[:6]}")
        factory.grant_capability(promoter["id"], "quest_create")
        _login(client, SEED_COMPANY_CODE, promoter["login_id"], promoter["password"])
        d = client.get(f"/api/v1/ideas/{iid}")
        assert d.status_code == 200, d.text
        assert d.json()["can_promote"] is True
        # 能力なし一般ユーザー＝can_promote False（閲覧はできるが昇格不可）。
        general = factory.make_seed_company_account(display_name=f"一般_{uuid.uuid4().hex[:6]}")
        _login(client, SEED_COMPANY_CODE, general["login_id"], general["password"])
        d2 = client.get(f"/api/v1/ideas/{iid}")
        assert d2.status_code == 200, d2.text
        assert d2.json()["can_promote"] is False
    finally:
        _purge_contest_idea(cid, iid)


def test_t_tc_140b_promote_blocked_in_public_mode(client, factory, monkeypatch):
    """T-TC-140(補): public（コンテスト専用テナント）では昇格は存在しない＝404（決定O/P'・社内のみ）。"""
    from app.tenant.quests import application as qapp

    promoter = factory.make_seed_company_account(display_name=f"昇格者_{uuid.uuid4().hex[:6]}")
    factory.grant_capability(promoter["id"], "quest_create")
    _login(client, SEED_COMPANY_CODE, promoter["login_id"], promoter["password"])

    # 共有 dev DB の access_mode は書き換えず、会社解決を public とみなす（§8.0・decided P'）。
    class _PublicCompany:
        access_mode = "public"
        db_identifier = None
        color = None

    monkeypatch.setattr(qapp, "_resolve_company", lambda cid: _PublicCompany())
    r = client.post(f"/api/v1/ideas/{uuid.uuid4()}/promote-to-quest", headers=_csrf(client))
    assert r.status_code == 404, r.text
    assert r.json()["code"] == "not_found"
