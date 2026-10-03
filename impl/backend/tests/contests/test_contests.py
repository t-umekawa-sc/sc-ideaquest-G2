"""アイデアコンテスト CRUD＋backing quest＋会期状態機械（FR-46・API T.1・doc/テスト/T_アイデアコンテスト.md §1）。

アーキ＝クエストを器に再利用（contests.quest_id が backing quest を 1:1 で指す）。作成/編集は contest_create
（または管理者）。共有 dev DB を汚さないよう contest＋backing quest を finally で物理掃除。
"""
from __future__ import annotations

import uuid

from sqlalchemy import text as _text

from app.db.tenant import get_tenant_session
from tests.admin.test_admin_accounts import _login
from tests.admin.test_admin_issue import _csrf
from tests.conftest import SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD

BASE = "/api/v1/contests"


def _seed_db() -> str:
    from app.control_plane.auth.orm import Company
    from app.db.control import control_session
    with control_session() as s:
        return s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().db_identifier


def _admin(client, factory) -> dict:
    a = factory.make_seed_company_account(system_role="company_account_admin",
                                          display_name=f"ｺﾝﾃｽﾄ管理_{uuid.uuid4().hex[:6]}")
    _login(client, SEED_COMPANY_CODE, a["login_id"], a["password"])
    return a


def _cleanup_contest(cid: str) -> None:
    """contest＋backing quest（＋子行）を物理掃除。"""
    with get_tenant_session(_seed_db()) as ts:
        qid = ts.execute(_text("SELECT quest_id FROM contests WHERE id = :c"), {"c": cid}).scalar()
        ts.execute(_text("DELETE FROM contests WHERE id = :c"), {"c": cid})
        if qid:
            ts.execute(_text("DELETE FROM quest_member_permissions WHERE quest_member_id IN "
                             "(SELECT id FROM quest_members WHERE quest_id = :q)"), {"q": qid})
            for tbl in ("quest_revisions", "quest_categories", "quest_members", "quest_group_links"):
                ts.execute(_text(f"DELETE FROM {tbl} WHERE quest_id = :q"), {"q": qid})
            ts.execute(_text("DELETE FROM quests WHERE id = :q"), {"q": qid})
        ts.commit()


def _body(**over) -> dict:
    b = {"theme": f"アイデア募集_{uuid.uuid4().hex[:6]}", "mode": "bounded", "status": "draft"}
    b.update(over)
    return b


def test_t_tc_101_create_requires_capability_and_makes_backing_quest(client, factory):
    """T-TC-101: 作成は contest_create 保持者のみ・backing quest を 1:1 生成／一般は 403。"""
    # 一般（能力なし）は 403。
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    # SEED ユーザは bootstrap で quest_create は持つが contest_create は持たない＝403。
    r = client.post(BASE, json=_body(), headers=_csrf(client))
    assert r.status_code == 403, r.text
    assert r.json()["errors"][0]["code"] == "capability_required"
    # 管理者は作成でき、backing quest が 1:1 で生成される（status=draft→quest=draft）。
    _admin(client, factory)
    r2 = client.post(BASE, json=_body(), headers=_csrf(client))
    assert r2.status_code == 201, r2.text
    cid = r2.json()["id"]
    try:
        qid = r2.json()["quest_id"]
        assert qid
        with get_tenant_session(_seed_db()) as ts:
            qstatus = ts.execute(_text("SELECT status FROM quests WHERE id = :q"), {"q": qid}).scalar()
            assert qstatus == "draft"  # draft contest → draft quest
            n = ts.execute(_text("SELECT count(*) FROM contests WHERE quest_id = :q"), {"q": qid}).scalar()
            assert n == 1  # 1:1
    finally:
        _cleanup_contest(cid)


def test_t_tc_101b_create_with_granted_capability(client, factory):
    """T-TC-101(補): contest_create を付与した一般ユーザーは作成できる（決定I）。"""
    creator = factory.make_seed_company_account(display_name=f"主催_{uuid.uuid4().hex[:6]}")
    factory.grant_capability(creator["id"], "contest_create")
    _login(client, SEED_COMPANY_CODE, creator["login_id"], creator["password"])
    r = client.post(BASE, json=_body(status="open"), headers=_csrf(client))
    assert r.status_code == 201, r.text
    cid = r.json()["id"]
    try:
        assert r.json()["status"] == "open"
        with get_tenant_session(_seed_db()) as ts:
            qstatus = ts.execute(_text("SELECT status FROM quests WHERE id = :q"), {"q": r.json()["quest_id"]}).scalar()
            assert qstatus == "recruiting"  # open contest → recruiting quest
    finally:
        _cleanup_contest(cid)


def test_t_tc_102_status_transition_maps_backing_quest(client, factory):
    """T-TC-102: 状態遷移 draft→open→judging→closed→archived が backing quest.status にマップ・不正遷移は 409。"""
    _admin(client, factory)
    cid = client.post(BASE, json=_body(), headers=_csrf(client)).json()["id"]
    try:
        # 不正遷移（draft→judging）は 409。
        bad = client.patch(f"{BASE}/{cid}", json={"status": "judging"}, headers=_csrf(client))
        assert bad.status_code == 409, bad.text
        # 正しい前進＝各段で quest.status が対応値に。
        expect = {"open": "recruiting", "judging": "evaluating", "closed": "completed", "archived": "completed"}
        for st, qst in [("open", "recruiting"), ("judging", "evaluating"), ("closed", "completed"), ("archived", "completed")]:
            r = client.patch(f"{BASE}/{cid}", json={"status": st}, headers=_csrf(client))
            assert r.status_code == 200 and r.json()["status"] == st, r.text
            with get_tenant_session(_seed_db()) as ts:
                qid = ts.execute(_text("SELECT quest_id FROM contests WHERE id = :c"), {"c": cid}).scalar()
                assert ts.execute(_text("SELECT status FROM quests WHERE id = :q"), {"q": qid}).scalar() == qst
    finally:
        _cleanup_contest(cid)


def test_t_tc_103_list_with_status_filter(client, factory):
    """T-TC-103: 一覧＝会期タブ（status 絞り込み）・新着降順。"""
    _admin(client, factory)
    cid = client.post(BASE, json=_body(status="open"), headers=_csrf(client)).json()["id"]
    try:
        allc = client.get(BASE).json()["data"]
        assert any(c["id"] == cid for c in allc)
        openc = client.get(BASE, params={"status": "open"}).json()["data"]
        assert any(c["id"] == cid for c in openc)
        draftc = client.get(BASE, params={"status": "draft"}).json()["data"]
        assert not any(c["id"] == cid for c in draftc)  # open なので draft タブには出ない
    finally:
        _cleanup_contest(cid)


def test_t_tc_105_no_visibility_param(client, factory):
    """T-TC-105: 公開性は会社 access_mode 一本化＝contest に visibility を送ると 422（extra forbid）。"""
    _admin(client, factory)
    r = client.post(BASE, json=_body(visibility="public"), headers=_csrf(client))
    assert r.status_code == 422, r.text


def test_t_tc_106_delete_requires_capability_and_soft_deletes(client, factory):
    """T-TC-106: 削除は contest_create/管理者のみ・論理削除（一覧/詳細から消える）／一般は403。"""
    admin = _admin(client, factory)
    cid = client.post(BASE, json=_body(status="open"), headers=_csrf(client)).json()["id"]
    try:
        # 一般（能力なし）は 403。
        _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
        assert client.delete(f"{BASE}/{cid}", headers=_csrf(client)).status_code == 403
        # 管理者は 204＝論理削除。
        _login(client, SEED_COMPANY_CODE, admin["login_id"], admin["password"])
        assert client.delete(f"{BASE}/{cid}", headers=_csrf(client)).status_code == 204
        # 一覧・詳細から消える（deleted_at）＝backing quest も論理削除。
        assert client.get(f"{BASE}/{cid}").status_code == 404
        assert not any(c["id"] == cid for c in client.get(BASE).json()["data"])
        with get_tenant_session(_seed_db()) as ts:
            qdel = ts.execute(_text("SELECT q.deleted_at FROM quests q JOIN contests c ON c.quest_id=q.id "
                                    "WHERE c.id=:c"), {"c": cid}).scalar()
            assert qdel is not None  # backing quest も論理削除
    finally:
        _cleanup_contest(cid)


def _user_id(account_id: str):
    from app.tenant.profile import repository as profile_repo
    import uuid as _uuid
    with get_tenant_session(_seed_db()) as ts:
        return profile_repo.get_user_by_account(ts, _uuid.UUID(str(account_id))).id


def test_t_tc_110_tier1_participation_request_and_approve(client, factory):
    """T-TC-110: Tier1 参加リクエスト（本人）→ 管理者承認（private 会社＝requested→approved）。"""
    admin = _admin(client, factory)
    cid = client.post(BASE, json=_body(status="open"), headers=_csrf(client)).json()["id"]
    part = factory.make_seed_company_account(display_name=f"参加者_{uuid.uuid4().hex[:6]}")
    puid = _user_id(part["id"])
    try:
        # 本人がリクエスト＝requested（private 会社なので自動承認はされない）。
        _login(client, SEED_COMPANY_CODE, part["login_id"], part["password"])
        r = client.post(f"{BASE}/{cid}/participation", headers=_csrf(client))
        assert r.status_code == 200 and r.json()["status"] == "requested", r.text
        # 管理者が承認＝approved。
        _login(client, SEED_COMPANY_CODE, admin["login_id"], admin["password"])
        d = client.patch(f"{BASE}/{cid}/participation/{puid}", json={"status": "approved"}, headers=_csrf(client))
        assert d.status_code == 200 and d.json()["status"] == "approved", d.text
        # 一般ユーザーは承認できない（403）。
        _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
        assert client.patch(f"{BASE}/{cid}/participation/{puid}", json={"status": "rejected"},
                            headers=_csrf(client)).status_code == 403
    finally:
        with get_tenant_session(_seed_db()) as ts:
            ts.execute(_text("DELETE FROM contest_participants WHERE contest_id = :c"), {"c": cid})
            ts.commit()
        _cleanup_contest(cid)


def test_t_tc_111_tier2_participation_author_approves(client, factory):
    """T-TC-111: Tier2 参加リクエスト→**アイデア投稿者**が承認（投稿者以外は 403）。"""
    admin = _admin(client, factory)
    cid = client.post(BASE, json=_body(status="open"), headers=_csrf(client)).json()["id"]
    detail = client.get(f"{BASE}/{cid}").json()
    author = factory.make_seed_company_account(display_name=f"投稿者_{uuid.uuid4().hex[:6]}")
    auid = _user_id(author["id"])
    iid = uuid.uuid4()
    try:
        # コンテストの backing quest にアイデアを seed（投稿者=author）。
        with get_tenant_session(_seed_db()) as ts:
            ts.execute(_text("INSERT INTO ideas (id, quest_id, author_id, title, body, value, status, created_at, updated_at) "
                             "VALUES (:i, :q, :a, 'アイデア', 'b', 'v', 'published', now(), now())"),
                       {"i": str(iid), "q": detail["quest_id"], "a": str(auid)})
            ts.commit()
        # 参加希望者がリクエスト。
        req = factory.make_seed_company_account(display_name=f"議論希望_{uuid.uuid4().hex[:6]}")
        ruid = _user_id(req["id"])
        _login(client, SEED_COMPANY_CODE, req["login_id"], req["password"])
        r = client.post(f"/api/v1/ideas/{iid}/participation", headers=_csrf(client))
        assert r.status_code == 200 and r.json()["status"] == "requested", r.text
        # 投稿者以外（admin）は承認不可（403）。
        _login(client, SEED_COMPANY_CODE, admin["login_id"], admin["password"])
        assert client.patch(f"/api/v1/ideas/{iid}/participation/{ruid}", json={"status": "approved"},
                            headers=_csrf(client)).status_code == 403
        # 投稿者は承認可（approved）。
        _login(client, SEED_COMPANY_CODE, author["login_id"], author["password"])
        d = client.patch(f"/api/v1/ideas/{iid}/participation/{ruid}", json={"status": "approved"}, headers=_csrf(client))
        assert d.status_code == 200 and d.json()["status"] == "approved", d.text
    finally:
        with get_tenant_session(_seed_db()) as ts:
            ts.execute(_text("DELETE FROM idea_participants WHERE idea_id = :i"), {"i": str(iid)})
            ts.execute(_text("DELETE FROM ideas WHERE id = :i"), {"i": str(iid)})
            ts.commit()
        _cleanup_contest(cid)
