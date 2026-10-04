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


def test_t_tc_118_participants_list_admin_only(client, factory):
    """T-TC-118: 参加者一覧（パーティタブ）は運営のみ・承認待ち先頭／一般は403・can_manage も分岐。"""
    admin = _admin(client, factory)
    cid = client.post(BASE, json=_body(status="open"), headers=_csrf(client)).json()["id"]
    part = factory.make_seed_company_account(display_name=f"参加_{uuid.uuid4().hex[:6]}")
    try:
        # 本人がリクエスト（requested）。
        _login(client, SEED_COMPANY_CODE, part["login_id"], part["password"])
        client.post(f"{BASE}/{cid}/participation", headers=_csrf(client))
        # 一般は参加者一覧403・一覧EP の can_manage=false（承認制で未承認の本人は詳細に入れないため can_manage は一覧EPで確認）。
        assert client.get(f"{BASE}/{cid}/participants").status_code == 403
        assert client.get(BASE).json()["can_manage"] is False
        # 管理者は一覧200（requested を含む）・一覧EP の can_manage=true。
        _login(client, SEED_COMPANY_CODE, admin["login_id"], admin["password"])
        r = client.get(f"{BASE}/{cid}/participants")
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        assert any(p["status"] == "requested" for p in data)
        assert client.get(BASE).json()["can_manage"] is True
    finally:
        with get_tenant_session(_seed_db()) as ts:
            ts.execute(_text("DELETE FROM contest_participants WHERE contest_id = :c"), {"c": cid})
            ts.commit()
        _cleanup_contest(cid)


def test_t_tc_119_party_manage_evaluator_owner_remove(client, factory):
    """T-TC-119: パーティ運営＝審査員付与/剥奪・is_evaluator・詳細の主催者・排除(論理)。"""
    admin = _admin(client, factory)
    cid = client.post(BASE, json=_body(status="open"), headers=_csrf(client)).json()["id"]
    part = factory.make_seed_company_account(display_name=f"参加_{uuid.uuid4().hex[:6]}")
    puid = _user_id(part["id"])
    try:
        # 参加を承認（approved）。
        client.patch(f"{BASE}/{cid}/participation/{puid}", json={"status": "approved"}, headers=_csrf(client))
        # 審査員 付与→is_evaluator=true。
        assert client.patch(f"{BASE}/{cid}/participants/{puid}/evaluator", json={"granted": True},
                            headers=_csrf(client)).status_code == 200
        plist = client.get(f"{BASE}/{cid}/participants").json()["data"]
        assert any(p["user_id"] == str(puid) and p["is_evaluator"] for p in plist)
        # 審査員 剥奪→false。
        client.patch(f"{BASE}/{cid}/participants/{puid}/evaluator", json={"granted": False}, headers=_csrf(client))
        plist2 = client.get(f"{BASE}/{cid}/participants").json()["data"]
        assert all(not (p["user_id"] == str(puid) and p["is_evaluator"]) for p in plist2)
        # 詳細に主催者（owner）表示。
        detail = client.get(f"{BASE}/{cid}").json()
        assert detail["owner_display_name"]
        # 排除（rejected）＝論理削除。一般は403。
        _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
        assert client.patch(f"{BASE}/{cid}/participants/{puid}/evaluator", json={"granted": True},
                            headers=_csrf(client)).status_code == 403
        _login(client, SEED_COMPANY_CODE, admin["login_id"], admin["password"])
        assert client.patch(f"{BASE}/{cid}/participation/{puid}", json={"status": "rejected"},
                            headers=_csrf(client)).status_code == 200
    finally:
        with get_tenant_session(_seed_db()) as ts:
            ts.execute(_text("DELETE FROM contest_participants WHERE contest_id = :c"), {"c": cid})
            ts.execute(_text("DELETE FROM user_capabilities WHERE user_id = :u"), {"u": str(puid)})
            ts.commit()
        _cleanup_contest(cid)


def test_t_tc_124_participant_candidates_and_add(client, factory):
    """T-TC-124: パーティ直接追加＝会社ユーザー候補（主催者/既参加除外・運営のみ）＋PATCH approved で参加。"""
    admin = _admin(client, factory)
    cid = client.post(BASE, json=_body(status="open"), headers=_csrf(client)).json()["id"]
    name = f"候補_{uuid.uuid4().hex[:6]}"
    cand = factory.make_seed_company_account(display_name=name)
    cuid = _user_id(cand["id"])
    try:
        CAND = f"{BASE}/{cid}/participant-candidates"
        qp = {"q": name}
        # 候補（氏名検索）に対象ユーザーを含む・主催者（admin）は含まない。
        data = client.get(CAND, params=qp).json()["data"]
        ids = {u["user_id"] for u in data}
        assert str(cuid) in ids and str(_user_id(admin["id"])) not in ids
        # 一般は候補取得403。
        _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
        assert client.get(CAND, params=qp).status_code == 403
        # 運営が追加（PATCH approved）＝候補から消え、参加者一覧に入る。
        _login(client, SEED_COMPANY_CODE, admin["login_id"], admin["password"])
        assert client.patch(f"{BASE}/{cid}/participation/{cuid}", json={"status": "approved"},
                            headers=_csrf(client)).status_code == 200
        assert str(cuid) not in {u["user_id"] for u in client.get(CAND, params=qp).json()["data"]}
        plist = client.get(f"{BASE}/{cid}/participants").json()["data"]
        assert any(p["user_id"] == str(cuid) and p["status"] == "approved" for p in plist)
    finally:
        with get_tenant_session(_seed_db()) as ts:
            ts.execute(_text("DELETE FROM contest_participants WHERE contest_id = :c"), {"c": cid})
            ts.commit()
        _cleanup_contest(cid)


def test_t_tc_116_auto_approve_opens_participation(client, factory):
    """T-TC-116: auto_approve=true のコンテストは社内でも参加リクエストが即 approved（オープン参加）。"""
    _admin(client, factory)
    cid = client.post(BASE, json=_body(status="open", auto_approve=True), headers=_csrf(client)).json()["id"]
    part = factory.make_seed_company_account(display_name=f"即参加_{uuid.uuid4().hex[:6]}")
    try:
        assert client.get(f"{BASE}/{cid}").json()["auto_approve"] is True
        _login(client, SEED_COMPANY_CODE, part["login_id"], part["password"])
        r = client.post(f"{BASE}/{cid}/participation", headers=_csrf(client))
        assert r.status_code == 200 and r.json()["status"] == "approved", r.text  # 承認待ちにならず即 approved
    finally:
        with get_tenant_session(_seed_db()) as ts:
            ts.execute(_text("DELETE FROM contest_participants WHERE contest_id = :c"), {"c": cid})
            ts.commit()
        _cleanup_contest(cid)


def test_t_tc_107_status_can_revert_adjacent(client, factory):
    """T-TC-107: 状態は隣接1段で前進・後退とも可／非隣接は409。backing quest.status も同期。"""
    _admin(client, factory)
    cid = client.post(BASE, json=_body(status="open"), headers=_csrf(client)).json()["id"]
    try:
        # open→judging（前進）→ open（後退）→ draft（後退）。
        assert client.patch(f"{BASE}/{cid}", json={"status": "judging"}, headers=_csrf(client)).status_code == 200
        r = client.patch(f"{BASE}/{cid}", json={"status": "open"}, headers=_csrf(client))
        assert r.status_code == 200 and r.json()["status"] == "open", r.text
        with get_tenant_session(_seed_db()) as ts:
            qid = ts.execute(_text("SELECT quest_id FROM contests WHERE id=:c"), {"c": cid}).scalar()
            assert ts.execute(_text("SELECT status FROM quests WHERE id=:q"), {"q": qid}).scalar() == "recruiting"
        assert client.patch(f"{BASE}/{cid}", json={"status": "draft"}, headers=_csrf(client)).status_code == 200
        # 非隣接の後退（draft→judging 等）は 409。
        assert client.patch(f"{BASE}/{cid}", json={"status": "judging"}, headers=_csrf(client)).status_code == 409
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


def test_t_tc_134_list_item_meta_for_apply_dialog(client, factory):
    """T-TC-134(api): 一覧 item に応募導線用メタ（auto_approve/participant_count/my_status/description）＋直下 can_manage。"""
    _admin(client, factory)
    cid = client.post(BASE, json=_body(status="open", description="説明文X"), headers=_csrf(client)).json()["id"]  # 承認制
    participant = factory.make_seed_company_account(display_name=f"参加_{uuid.uuid4().hex[:6]}")
    puid = _user_id(participant["id"])
    try:
        # 運営（admin）が直接 approved で追加（参加人数=1 の素）。
        assert client.patch(f"{BASE}/{cid}/participation/{puid}", json={"status": "approved"},
                            headers=_csrf(client)).status_code == 200
        # 運営の一覧＝can_manage true・item にメタ。
        body = client.get(BASE).json()
        assert body["can_manage"] is True
        item = next(i for i in body["data"] if i["id"] == cid)
        assert item["auto_approve"] is False
        assert item["participant_count"] == 1
        assert item["description"] == "説明文X"
        assert item["my_status"] == "none"  # admin は作成者だが Tier1 参加者ではない
        # 一般（参加者本人）の一覧＝can_manage false・my_status=approved。
        _login(client, SEED_COMPANY_CODE, participant["login_id"], participant["password"])
        body2 = client.get(BASE).json()
        assert body2["can_manage"] is False
        item2 = next(i for i in body2["data"] if i["id"] == cid)
        assert item2["my_status"] == "approved"
    finally:
        with get_tenant_session(_seed_db()) as ts:
            ts.execute(_text("DELETE FROM contest_participants WHERE contest_id=:c"), {"c": cid})
            ts.commit()
        _cleanup_contest(cid)


def _purge_contest_notifs(cids: list[str]) -> None:
    """検証で生成したコンテスト参加通知を params.contest_id で物理掃除（共有dev DB）。"""
    with get_tenant_session(_seed_db()) as ts:
        ts.execute(_text("DELETE FROM notifications WHERE type LIKE 'contest_join_request_%' "
                         "AND params->>'contest_id' = ANY(:cids)"), {"cids": cids})
        ts.commit()


def test_t_tc_135_request_notifies_organizer(client, factory):
    """T-TC-135(api): 承認制の参加リクエストで運営（作成者）へ contest_join_request_received／auto_approve は通知0・申請者本人にも出ない。"""
    admin = _admin(client, factory)  # 作成者＝運営
    gated = client.post(BASE, json=_body(status="open"), headers=_csrf(client)).json()["id"]
    openc = client.post(BASE, json=_body(status="open", auto_approve=True), headers=_csrf(client)).json()["id"]
    applicant = factory.make_seed_company_account(display_name=f"応募_{uuid.uuid4().hex[:6]}")
    try:
        _login(client, SEED_COMPANY_CODE, applicant["login_id"], applicant["password"])
        assert client.post(f"{BASE}/{gated}/participation", headers=_csrf(client)).json()["status"] == "requested"
        assert client.post(f"{BASE}/{openc}/participation", headers=_csrf(client)).json()["status"] == "approved"
        # 申請者本人には received は出ない。
        my = client.get("/api/v1/notifications").json()["data"]
        assert not any(n["type"] == "contest_join_request_received" and n["ref"].get("contest_id") == gated for n in my)
        # 作成者（admin）に gated の received が1件・auto_approve(openc) は通知0。
        _login(client, SEED_COMPANY_CODE, admin["login_id"], admin["password"])
        recv = [n for n in client.get("/api/v1/notifications").json()["data"]
                if n["type"] == "contest_join_request_received"]
        assert any(n["ref"].get("contest_id") == gated for n in recv)
        assert not any(n["ref"].get("contest_id") == openc for n in recv)
    finally:
        with get_tenant_session(_seed_db()) as ts:
            for c in (gated, openc):
                ts.execute(_text("DELETE FROM contest_participants WHERE contest_id=:c"), {"c": c})
            ts.commit()
        _purge_contest_notifs([gated, openc])
        _cleanup_contest(gated)
        _cleanup_contest(openc)


def test_t_tc_136_decide_notifies_applicant(client, factory):
    """T-TC-136(api): 承認/却下で申請者へ contest_join_request_decided（運営自身には出ない）。"""
    admin = _admin(client, factory)
    cid = client.post(BASE, json=_body(status="open"), headers=_csrf(client)).json()["id"]
    applicant = factory.make_seed_company_account(display_name=f"応募_{uuid.uuid4().hex[:6]}")
    auid = _user_id(applicant["id"])
    try:
        _login(client, SEED_COMPANY_CODE, applicant["login_id"], applicant["password"])
        client.post(f"{BASE}/{cid}/participation", headers=_csrf(client))
        _login(client, SEED_COMPANY_CODE, admin["login_id"], admin["password"])
        assert client.patch(f"{BASE}/{cid}/participation/{auid}", json={"status": "approved"},
                            headers=_csrf(client)).status_code == 200
        # 申請者に decided 通知。
        _login(client, SEED_COMPANY_CODE, applicant["login_id"], applicant["password"])
        dec = [n for n in client.get("/api/v1/notifications").json()["data"]
               if n["type"] == "contest_join_request_decided" and n["ref"].get("contest_id") == cid]
        assert len(dec) == 1
        # 運営自身には decided は出ない。
        _login(client, SEED_COMPANY_CODE, admin["login_id"], admin["password"])
        assert not any(n["type"] == "contest_join_request_decided" and n["ref"].get("contest_id") == cid
                       for n in client.get("/api/v1/notifications").json()["data"])
    finally:
        with get_tenant_session(_seed_db()) as ts:
            ts.execute(_text("DELETE FROM contest_participants WHERE contest_id=:c"), {"c": cid})
            ts.commit()
        _purge_contest_notifs([cid])
        _cleanup_contest(cid)


def test_t_tc_137_dashboard_incoming_contest_requests(client, factory):
    """T-TC-137(api): ダッシュボード incoming_contest_requests＝運営に requested を返す・一般は空。"""
    admin = _admin(client, factory)
    cid = client.post(BASE, json=_body(status="open"), headers=_csrf(client)).json()["id"]
    applicant = factory.make_seed_company_account(display_name=f"応募_{uuid.uuid4().hex[:6]}")
    try:
        _login(client, SEED_COMPANY_CODE, applicant["login_id"], applicant["password"])
        client.post(f"{BASE}/{cid}/participation", headers=_csrf(client))
        # 運営（admin）のダッシュボードに当該コンテストの申請が出る。
        _login(client, SEED_COMPANY_CODE, admin["login_id"], admin["password"])
        items = client.get("/api/v1/dashboard").json()["incoming_contest_requests"]
        assert any(it["contest"]["id"] == cid and it["user"]["user_id"] == str(_user_id(applicant["id"]))
                   for it in items)
        # 一般（運営でない＝申請者本人）には出ない（空 or 当該なし）。
        _login(client, SEED_COMPANY_CODE, applicant["login_id"], applicant["password"])
        items2 = client.get("/api/v1/dashboard").json()["incoming_contest_requests"]
        assert all(it["contest"]["id"] != cid for it in items2)
    finally:
        with get_tenant_session(_seed_db()) as ts:
            ts.execute(_text("DELETE FROM contest_participants WHERE contest_id=:c"), {"c": cid})
            ts.commit()
        _purge_contest_notifs([cid])
        _cleanup_contest(cid)
