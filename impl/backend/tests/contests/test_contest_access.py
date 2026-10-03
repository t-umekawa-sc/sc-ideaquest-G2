"""アイデアコンテストの単一アクセスポリシー（設計 §2.3・Step2b-2・doc/テスト/T_アイデアコンテスト.md）。

コンテスト配下（backing quest）のアイデアは、可視/投票/チャット/評価のゲートが通常クエストと変わる:
- 可視   ＝ 会社全体（テナント内なら誰でも・パーティー/部署非依存）
- 投票   ＝ Tier1 参加者（`contest_participants` approved・案X）
- チャット＝ Tier2 承認者（`idea_participants` approved・投稿者承認）
- 評価   ＝ `contest_evaluator` 保持者のみ（運営指名の審査員・投稿者でも非保持は不可）

共有 dev DB を汚さないよう、生成した子行（votes/evaluations/chat/participants/notifications/activities/
idea）＋contest＋backing quest を finally で物理掃除する。
"""
from __future__ import annotations

import uuid

from sqlalchemy import text as _text

from app.db.tenant import get_tenant_session
from app.tenant.contests import access as contest_access
from app.tenant.contests import repository as contest_repo
from app.tenant.quests import repository as quests_repo
from tests.admin.test_admin_accounts import _login
from tests.admin.test_admin_issue import _csrf
from tests.conftest import SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD
from tests.contests.test_contests import (
    BASE,
    _admin,
    _body,
    _cleanup_contest,
    _seed_db,
    _user_id,
)


def _seed_published_idea(qid: str, author_uid) -> uuid.UUID:
    iid = uuid.uuid4()
    with get_tenant_session(_seed_db()) as ts:
        ts.execute(_text(
            "INSERT INTO ideas (id, quest_id, author_id, title, body, value, status, created_at, updated_at) "
            "VALUES (:i, :q, :a, 'コンテスト案', 'b', 'v', 'published', now(), now())"),
            {"i": str(iid), "q": qid, "a": str(author_uid)})
        ts.commit()
    return iid


def _approve_tier1(cid: str, user_id) -> None:
    with get_tenant_session(_seed_db()) as ts:
        contest_repo.upsert_contest_participation(ts, uuid.UUID(cid), user_id, status="approved")
        ts.commit()


def _approve_tier2(iid: uuid.UUID, user_id) -> None:
    with get_tenant_session(_seed_db()) as ts:
        contest_repo.upsert_idea_participation(ts, iid, user_id, status="approved")
        ts.commit()


def _purge_contest_idea(cid: str, iid: uuid.UUID) -> None:
    """アイデアに紐づく子行→idea→contest_participants→contest＋backing quest を物理掃除。"""
    i, c = str(iid), cid
    with get_tenant_session(_seed_db()) as ts:
        qid = ts.execute(_text("SELECT quest_id FROM contests WHERE id = :c"), {"c": c}).scalar()
        # 通知（chat_message/idea/quest を参照＝子行削除より先に消す）
        ts.execute(_text("DELETE FROM notifications WHERE ref_idea_id=:i OR ref_quest_id=:q OR "
                         "ref_chat_message_id IN (SELECT m.id FROM chat_messages m JOIN chat_thread t ON "
                         "m.thread_id=t.id JOIN chat_groups g ON t.owner_type='idea' AND t.owner_id=g.id "
                         "WHERE g.idea_id=:i)"), {"i": i, "q": qid})
        # チャット（reactions/mentions/quotes/reads → messages → thread → group）
        ts.execute(_text("DELETE FROM reactions WHERE chat_message_id IN (SELECT m.id FROM chat_messages m "
                         "JOIN chat_thread t ON m.thread_id=t.id JOIN chat_groups g ON t.owner_type='idea' "
                         "AND t.owner_id=g.id WHERE g.idea_id=:i)"), {"i": i})
        ts.execute(_text("DELETE FROM chat_mentions WHERE chat_message_id IN (SELECT m.id FROM chat_messages m "
                         "JOIN chat_thread t ON m.thread_id=t.id JOIN chat_groups g ON t.owner_type='idea' "
                         "AND t.owner_id=g.id WHERE g.idea_id=:i)"), {"i": i})
        ts.execute(_text("DELETE FROM chat_message_quotes WHERE chat_message_id IN (SELECT m.id FROM chat_messages m "
                         "JOIN chat_thread t ON m.thread_id=t.id JOIN chat_groups g ON t.owner_type='idea' "
                         "AND t.owner_id=g.id WHERE g.idea_id=:i)"), {"i": i})
        ts.execute(_text("DELETE FROM chat_reads WHERE thread_id IN (SELECT t.id FROM chat_thread t "
                         "JOIN chat_groups g ON t.owner_type='idea' AND t.owner_id=g.id WHERE g.idea_id=:i)"), {"i": i})
        ts.execute(_text("DELETE FROM chat_messages WHERE thread_id IN (SELECT t.id FROM chat_thread t "
                         "JOIN chat_groups g ON t.owner_type='idea' AND t.owner_id=g.id WHERE g.idea_id=:i)"), {"i": i})
        ts.execute(_text("DELETE FROM chat_thread WHERE owner_type='idea' AND owner_id IN "
                         "(SELECT id FROM chat_groups WHERE idea_id=:i)"), {"i": i})
        ts.execute(_text("DELETE FROM chat_groups WHERE idea_id=:i"), {"i": i})
        # 評価
        ts.execute(_text("DELETE FROM evaluation_scores WHERE evaluation_id IN "
                         "(SELECT id FROM evaluations WHERE idea_id=:i)"), {"i": i})
        ts.execute(_text("DELETE FROM evaluation_revisions WHERE evaluation_id IN "
                         "(SELECT id FROM evaluations WHERE idea_id=:i)"), {"i": i})
        ts.execute(_text("DELETE FROM evaluations WHERE idea_id=:i"), {"i": i})
        # 投票・参加・通知・活動台帳
        ts.execute(_text("DELETE FROM votes WHERE idea_id=:i"), {"i": i})
        ts.execute(_text("DELETE FROM idea_participants WHERE idea_id=:i"), {"i": i})
        ts.execute(_text("DELETE FROM follows WHERE idea_id=:i"), {"i": i})
        ts.execute(_text("DELETE FROM activities WHERE ref_id=:i OR quest_id=:q"), {"i": i, "q": qid})
        # 公開アイデアは版（idea_revisions）＋利害関係者を持ち得る＝ideas 削除前に掃除。
        ts.execute(_text("DELETE FROM idea_revisions WHERE idea_id=:i"), {"i": i})
        ts.execute(_text("DELETE FROM idea_stakeholders WHERE idea_id=:i"), {"i": i})
        ts.execute(_text("DELETE FROM contest_idea_flags WHERE idea_id=:i"), {"i": i})
        ts.execute(_text("DELETE FROM ideas WHERE id=:i"), {"i": i})
        ts.execute(_text("DELETE FROM contest_participants WHERE contest_id=:c"), {"c": c})
        ts.commit()
    _cleanup_contest(c)


def test_t_tc_113_resolve_access_company_wide_under_contest(client, factory):
    """T-TC-113(int): コンテスト配下は会社全体可視（非パーティー員でも可）・通常クエストは contest_of=None で従来ゲート。"""
    _admin(client, factory)
    cid = client.post(BASE, json=_body(status="open"), headers=_csrf(client)).json()["id"]
    qid = client.get(f"{BASE}/{cid}").json()["quest_id"]
    outsider = factory.make_seed_company_account(display_name=f"社外観覧_{uuid.uuid4().hex[:6]}")
    ouid = _user_id(outsider["id"])
    try:
        with get_tenant_session(_seed_db()) as ts:
            quest = quests_repo.get_quest(ts, uuid.UUID(qid))
            # コンテスト配下＝backing quest は contest を引けて、非パーティー員でも可視（会社全体）。
            assert contest_access.contest_of(ts, uuid.UUID(qid)) is not None
            assert quests_repo.can_access_quest(ts, quest, ouid) is True
            # 通常クエスト（コンテスト非配下）は contest_of=None＝従来のパーティー＋部署ゲートに委譲。
            normal_qid = ts.execute(_text(
                "SELECT id FROM quests WHERE deleted_at IS NULL AND id NOT IN "
                "(SELECT quest_id FROM contests) LIMIT 1")).scalar()
            assert normal_qid is not None
            assert contest_access.contest_of(ts, normal_qid) is None
    finally:
        _cleanup_contest(cid)


def test_t_tc_112_vote_tier1_open_chat_tier2_approval(client, factory):
    """T-TC-112(api): 投票＝Tier1 参加者に開放・チャット＝Tier2 承認者のみ（案X の分岐）。"""
    _admin(client, factory)
    cid = client.post(BASE, json=_body(status="open"), headers=_csrf(client)).json()["id"]
    qid = client.get(f"{BASE}/{cid}").json()["quest_id"]
    author = factory.make_seed_company_account(display_name=f"投稿_{uuid.uuid4().hex[:6]}")
    iid = _seed_published_idea(qid, _user_id(author["id"]))
    voter = factory.make_seed_company_account(display_name=f"投票_{uuid.uuid4().hex[:6]}")
    outsider = factory.make_seed_company_account(display_name=f"非参加_{uuid.uuid4().hex[:6]}")
    chatter = factory.make_seed_company_account(display_name=f"議論_{uuid.uuid4().hex[:6]}")
    try:
        # --- 投票（Tier1）---
        _approve_tier1(cid, _user_id(voter["id"]))
        _login(client, SEED_COMPANY_CODE, voter["login_id"], voter["password"])
        rv = client.post(f"/api/v1/ideas/{iid}/vote", json={"type": "approve"}, headers=_csrf(client))
        assert rv.status_code == 200, rv.text  # Tier1 承認済み＝投票可
        # 非参加（Tier1 でない）は 403。
        _login(client, SEED_COMPANY_CODE, outsider["login_id"], outsider["password"])
        rv2 = client.post(f"/api/v1/ideas/{iid}/vote", json={"type": "approve"}, headers=_csrf(client))
        assert rv2.status_code == 403, rv2.text
        # --- チャット（Tier2）---
        _approve_tier2(iid, _user_id(chatter["id"]))
        _login(client, SEED_COMPANY_CODE, chatter["login_id"], chatter["password"])
        rc = client.post("/api/v1/chat-messages", data={"idea_id": str(iid), "body": "議論します"},
                         headers=_csrf(client))
        assert rc.status_code == 201, rc.text  # Tier2 承認済み＝チャット可
        # Tier2 未承認（Tier1 の voter でも）はチャット 403。
        _login(client, SEED_COMPANY_CODE, voter["login_id"], voter["password"])
        rc2 = client.post("/api/v1/chat-messages", data={"idea_id": str(iid), "body": "入れない"},
                          headers=_csrf(client))
        assert rc2.status_code == 403, rc2.text
    finally:
        _purge_contest_idea(cid, iid)


def test_t_tc_115_post_idea_open_to_tier1(client, factory):
    """T-TC-115(api): コンテスト配下のアイデア投稿＝Tier1 参加者に開放（member/idea_create 権限は不要）・未参加は 403。"""
    _admin(client, factory)
    cid = client.post(BASE, json=_body(status="open"), headers=_csrf(client)).json()["id"]
    qid = client.get(f"{BASE}/{cid}").json()["quest_id"]
    poster = factory.make_seed_company_account(display_name=f"応募_{uuid.uuid4().hex[:6]}")
    outsider = factory.make_seed_company_account(display_name=f"未参加_{uuid.uuid4().hex[:6]}")
    payload = {"title": "応募アイデア", "value": "提案価値", "body": "本文", "status": "published"}
    created_iid = None
    try:
        # Tier1 承認済み＝非クエストメンバーでも投稿可（201）。
        _approve_tier1(cid, _user_id(poster["id"]))
        _login(client, SEED_COMPANY_CODE, poster["login_id"], poster["password"])
        r = client.post(f"/api/v1/quests/{qid}/ideas", json=payload, headers=_csrf(client))
        assert r.status_code == 201, r.text
        created_iid = r.json()["id"]
        # 未参加（Tier1 でない）は 403。
        _login(client, SEED_COMPANY_CODE, outsider["login_id"], outsider["password"])
        r2 = client.post(f"/api/v1/quests/{qid}/ideas", json=payload, headers=_csrf(client))
        assert r2.status_code == 403, r2.text
    finally:
        if created_iid:
            _purge_contest_idea(cid, uuid.UUID(created_iid))
        else:
            _cleanup_contest(cid)


def test_t_tc_117_detail_my_participating_idea_ids(client, factory):
    """T-TC-117: 詳細の my_participating_idea_ids＝自分が投稿者 or Tier2承認のアイデア（新着の議論の限定根拠）。"""
    _admin(client, factory)
    cid = client.post(BASE, json=_body(status="open"), headers=_csrf(client)).json()["id"]
    qid = client.get(f"{BASE}/{cid}").json()["quest_id"]
    author = factory.make_seed_company_account(display_name=f"投稿_{uuid.uuid4().hex[:6]}")
    iid = _seed_published_idea(qid, _user_id(author["id"]))
    chatter = factory.make_seed_company_account(display_name=f"参加_{uuid.uuid4().hex[:6]}")
    outsider = factory.make_seed_company_account(display_name=f"非参加_{uuid.uuid4().hex[:6]}")
    try:
        _approve_tier2(iid, _user_id(chatter["id"]))
        # 投稿者本人の応答には自分のアイデアが含まれる。
        _login(client, SEED_COMPANY_CODE, author["login_id"], author["password"])
        assert str(iid) in client.get(f"{BASE}/{cid}").json()["my_participating_idea_ids"]
        # Tier2 承認者の応答にも含まれる。
        _login(client, SEED_COMPANY_CODE, chatter["login_id"], chatter["password"])
        assert str(iid) in client.get(f"{BASE}/{cid}").json()["my_participating_idea_ids"]
        # 未参加者には含まれない。
        _login(client, SEED_COMPANY_CODE, outsider["login_id"], outsider["password"])
        assert str(iid) not in client.get(f"{BASE}/{cid}").json()["my_participating_idea_ids"]
    finally:
        _purge_contest_idea(cid, iid)


def test_t_tc_126_manual_idea_flags(client, factory):
    """T-TC-126: 運営がアイデアを入賞/殿堂入り/お蔵入りへ手動振り分け・一般は403。"""
    _admin(client, factory)
    cid = client.post(BASE, json=_body(status="open"), headers=_csrf(client)).json()["id"]
    qid = client.get(f"{BASE}/{cid}").json()["quest_id"]
    author = factory.make_seed_company_account(display_name=f"投稿_{uuid.uuid4().hex[:6]}")
    iid = _seed_published_idea(qid, _user_id(author["id"]))
    FLAGS = f"{BASE}/{cid}/ideas/{iid}/flags"
    try:
        # 殿堂入り 付与→詳細 flags に反映。
        assert client.patch(FLAGS, json={"flag": "hall_of_fame", "on": True}, headers=_csrf(client)).status_code == 200
        assert any(f["idea_id"] == str(iid) and f["flag"] == "hall_of_fame" for f in client.get(f"{BASE}/{cid}").json()["flags"])
        # 排他＝入賞（selected）を ON にすると殿堂入りは自動解除される（1アイデア1状態）。
        assert client.patch(FLAGS, json={"flag": "selected", "on": True}, headers=_csrf(client)).status_code == 200
        assert client.get(f"/api/v1/ideas/{iid}").json()["is_selected"] is True
        assert not any(f["flag"] == "hall_of_fame" for f in client.get(f"{BASE}/{cid}").json()["flags"])
        # さらにお蔵入り ON で入賞（is_selected）も解除される。
        assert client.patch(FLAGS, json={"flag": "shelved", "on": True}, headers=_csrf(client)).status_code == 200
        assert client.get(f"/api/v1/ideas/{iid}").json()["is_selected"] is False
        assert any(f["flag"] == "shelved" for f in client.get(f"{BASE}/{cid}").json()["flags"])
        # 一般は403。
        _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
        assert client.patch(FLAGS, json={"flag": "shelved", "on": True}, headers=_csrf(client)).status_code == 403
    finally:
        _purge_contest_idea(cid, iid)


def test_t_tc_127_idea_participation_context(client, factory):
    """T-TC-127: Tier2 参加文脈＝投稿者は is_author＋申請一覧・希望者はリクエスト→requested→投稿者承認で approved。"""
    _admin(client, factory)
    cid = client.post(BASE, json=_body(status="open"), headers=_csrf(client)).json()["id"]
    qid = client.get(f"{BASE}/{cid}").json()["quest_id"]
    author = factory.make_seed_company_account(display_name=f"投稿_{uuid.uuid4().hex[:6]}")
    iid = _seed_published_idea(qid, _user_id(author["id"]))
    req = factory.make_seed_company_account(display_name=f"希望_{uuid.uuid4().hex[:6]}")
    ruid = _user_id(req["id"])
    PART = f"/api/v1/ideas/{iid}/participation"
    try:
        # 希望者：最初は none → リクエスト → requested。
        _login(client, SEED_COMPANY_CODE, req["login_id"], req["password"])
        assert client.get(PART).json()["my_status"] == "none"
        assert client.post(PART, headers=_csrf(client)).status_code == 200
        ctx = client.get(PART).json()
        assert ctx["is_contest"] is True and ctx["my_status"] == "requested" and ctx["is_author"] is False
        # 投稿者：is_author＋requests に希望者（requested）。承認で approved。
        _login(client, SEED_COMPANY_CODE, author["login_id"], author["password"])
        ac = client.get(PART).json()
        assert ac["is_author"] is True and any(r["user_id"] == str(ruid) and r["status"] == "requested" for r in ac["requests"])
        assert client.patch(f"{PART}/{ruid}", json={"status": "approved"}, headers=_csrf(client)).status_code == 200
        _login(client, SEED_COMPANY_CODE, req["login_id"], req["password"])
        assert client.get(PART).json()["my_status"] == "approved"
    finally:
        with get_tenant_session(_seed_db()) as ts:
            ts.execute(_text("DELETE FROM idea_participants WHERE idea_id=:i"), {"i": str(iid)})
            ts.commit()
        _purge_contest_idea(cid, iid)


def test_t_tc_125_idea_detail_is_contest_flag(client, factory):
    """T-TC-125: コンテスト配下アイデアの詳細は is_contest=true（SC-22 で関連情報非表示）・通常は false。"""
    _admin(client, factory)
    cid = client.post(BASE, json=_body(status="open"), headers=_csrf(client)).json()["id"]
    qid = client.get(f"{BASE}/{cid}").json()["quest_id"]
    author = factory.make_seed_company_account(display_name=f"投稿_{uuid.uuid4().hex[:6]}")
    iid = _seed_published_idea(qid, _user_id(author["id"]))
    try:
        # コンテスト配下＝is_contest true（管理者は会社全体可視で参照可）。
        d = client.get(f"/api/v1/ideas/{iid}")
        assert d.status_code == 200 and d.json()["is_contest"] is True, d.text
        # 通常クエストのアイデア（非コンテスト）＝false。seed データから1件取得。
        with get_tenant_session(_seed_db()) as ts:
            row = ts.execute(_text(
                "SELECT i.id FROM ideas i WHERE i.status='published' AND i.quest_id NOT IN "
                "(SELECT quest_id FROM contests) LIMIT 1")).scalar()
        if row is not None:
            d2 = client.get(f"/api/v1/ideas/{row}")
            if d2.status_code == 200:
                assert d2.json()["is_contest"] is False, d2.text
    finally:
        _purge_contest_idea(cid, iid)


def test_t_tc_120_evaluate_requires_contest_evaluator(client, factory):
    """T-TC-120(api): 評価は `contest_evaluator` 保持者のみ・投稿者でも非保持は 403（運営指名のみ）。"""
    _admin(client, factory)
    cid = client.post(BASE, json=_body(status="open"), headers=_csrf(client)).json()["id"]
    qid = client.get(f"{BASE}/{cid}").json()["quest_id"]
    author = factory.make_seed_company_account(display_name=f"投稿_{uuid.uuid4().hex[:6]}")
    iid = _seed_published_idea(qid, _user_id(author["id"]))
    judge = factory.make_seed_company_account(display_name=f"審査_{uuid.uuid4().hex[:6]}")
    factory.grant_capability(judge["id"], "contest_evaluator")
    try:
        # 審査員能力あり＝評価可（draft で下書き保存）。
        _login(client, SEED_COMPANY_CODE, judge["login_id"], judge["password"])
        re = client.put(f"/api/v1/ideas/{iid}/evaluation", json={"status": "draft"}, headers=_csrf(client))
        assert re.status_code == 200, re.text
        # 投稿者本人でも能力なしは 403（偏り防止・運営指名のみ）。
        _login(client, SEED_COMPANY_CODE, author["login_id"], author["password"])
        re2 = client.put(f"/api/v1/ideas/{iid}/evaluation", json={"status": "draft"}, headers=_csrf(client))
        assert re2.status_code == 403, re2.text
    finally:
        _purge_contest_idea(cid, iid)
