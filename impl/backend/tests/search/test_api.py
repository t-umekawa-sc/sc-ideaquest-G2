"""J-TC-101〜131: 全文検索 GET /api/v1/quests/{id}/search（SC-12・PGroonga・J.1〜J.5）。

seed 会社 ACME-01 に quest＋グループ/パーティー所属＋公開アイデア/チャット/添付（共通の検索語を含む）＋
下書き/削除（対象外確認）を seed。throwaway 実アカウントでログインして検索結果を照合。PGroonga 索引は
migration 0018 で作成済み（同期更新）。可視範囲は WHERE 述語で強制（J.0）。
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.control_plane.auth.orm import Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.chat.orm import ChatGroup, ChatMessage
from app.tenant.ideas.orm import Attachment, Idea
from app.tenant.profile.orm import User
from app.tenant.profile.repository import get_user_by_account
from app.tenant.quest_group import repository as qg_repo
from app.tenant.quest_group.orm import QuestGroup, QuestGroupMember
from app.tenant.quests import repository as quests_repo
from app.tenant.quests.orm import Quest, QuestMember, QuestMemberPermission
from tests.admin.test_admin_accounts import _login
from tests.conftest import SEED_COMPANY_CODE

NEEDLE = "ズンドコ検索語"  # PGroonga TokenBigram で確実にヒットする distinctive な語


def _db() -> str:
    with control_session() as s:
        return s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().db_identifier


def _search(client, qid, q=NEEDLE, **params):
    query = {"q": q, **params}
    return client.get(f"/api/v1/quests/{qid}/search", params=query)


def _login_user(client, factory):
    acc = factory.make_seed_company_account()
    _login(client, SEED_COMPANY_CODE, acc["login_id"], acc["password"])
    with get_tenant_session(_db()) as s:
        return acc, get_user_by_account(s, acc["id"]).id


@pytest.fixture
def env(factory):
    db = _db()
    gid, qid = uuid.uuid4(), uuid.uuid4()
    other = uuid.uuid4()
    pub, draft, deleted = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    cg = uuid.uuid4()
    msg, att = uuid.uuid4(), uuid.uuid4()

    def build(user_id):
        with get_tenant_session(db) as ts:
            ts.add(QuestGroup(id=gid, quest_group_code=f"QG-{uuid.uuid4().hex[:6].upper()}", name="G"))
            ts.add(User(id=other, account_id=uuid.uuid4(), display_name="Other", locale="ja", status="active"))
            quests_repo.create_quest(ts, quest_id=qid, quest_group_id=gid, owner_id=user_id,
                                     title="検索クエスト", color="#3B82F6", status="recruiting")
            quests_repo.add_member(ts, qid, user_id, permissions=["owner", "comment", "vote"])
            qg_repo.upsert_membership(ts, gid, user_id, "member")
            # 公開アイデア（本文に検索語）／下書き（対象外）／削除（対象外）。
            ts.add(Idea(id=pub, quest_id=qid, author_id=other, title="公開", body=f"本文に{NEEDLE}を含む", value="v", status="published"))
            ts.add(Idea(id=draft, quest_id=qid, author_id=user_id, title="下書き", body=f"{NEEDLE}", value="v", status="draft"))
            ts.add(Idea(id=deleted, quest_id=qid, author_id=other, title="削除", body=f"{NEEDLE}", value="v", status="published"))
            ts.flush()
            from datetime import datetime, timezone
            ts.query(Idea).filter_by(id=deleted).update({"deleted_at": datetime.now(timezone.utc)})
            # チャット（可視アイデア配下・本文に検索語）＋トゥームストーン（対象外）。
            ts.add(ChatGroup(id=cg, idea_id=pub))
            ts.add(ChatMessage(id=msg, chat_group_id=cg, author_id=other, body=f"チャットに{NEEDLE}"))
            ts.add(ChatMessage(id=uuid.uuid4(), chat_group_id=cg, author_id=other, body=f"消済{NEEDLE}", is_deleted=True))
            # 添付（可視アイデア・ファイル名に検索語）。
            ts.add(Attachment(id=att, idea_id=pub, object_key="k", original_name=f"{NEEDLE}_資料.pdf",
                              size_bytes=1, mime_type="application/pdf", uploaded_by_id=other))
            ts.commit()

    yield {"build": build, "qid": qid, "gid": gid}

    with get_tenant_session(db) as ts:
        ts.execute(Attachment.__table__.delete().where(Attachment.idea_id.in_([pub, draft, deleted])))
        ts.execute(ChatMessage.__table__.delete().where(ChatMessage.chat_group_id == cg))
        ts.execute(ChatGroup.__table__.delete().where(ChatGroup.id == cg))
        ts.execute(Idea.__table__.delete().where(Idea.id.in_([pub, draft, deleted])))
        ts.execute(QuestMemberPermission.__table__.delete().where(
            QuestMemberPermission.quest_member_id.in_(select(QuestMember.id).where(QuestMember.quest_id == qid))))
        ts.execute(QuestMember.__table__.delete().where(QuestMember.quest_id == qid))
        ts.execute(Quest.__table__.delete().where(Quest.id == qid))
        ts.execute(QuestGroupMember.__table__.delete().where(QuestGroupMember.quest_group_id == gid))
        ts.execute(QuestGroup.__table__.delete().where(QuestGroup.id == gid))
        ts.execute(User.__table__.delete().where(User.id == other))
        ts.commit()


def test_j_tc_101_to_104_hits_union(client, factory, env):
    """J-TC-101〜104 idea/chat/attachment がヒットし単一リストに合成（下書き/削除/トゥームストーンは除外）。"""
    acc, uid = _login_user(client, factory)
    env["build"](uid)
    b = _search(client, env["qid"]).json()
    types = {r["type"] for r in b["data"]}
    assert {"idea", "chat", "attachment"} <= types
    # 下書き/削除アイデアは idea ヒットに出ない（公開1件のみ）。
    idea_titles = {r["idea_title"] for r in b["data"] if r["type"] == "idea"}
    assert idea_titles == {"公開"}
    # 各行に snippet_html / score / quest。
    assert all("snippet_html" in r and "score" in r and r["quest"]["id"] for r in b["data"])


def test_j_tc_105_types_filter(client, factory, env):
    """J-TC-105 types=idea は idea のみ。"""
    acc, uid = _login_user(client, factory)
    env["build"](uid)
    b = _search(client, env["qid"], types="idea").json()
    assert {r["type"] for r in b["data"]} == {"idea"}


def test_j_tc_106_paging_total(client, factory, env):
    """J-TC-106 オフセットページング＋total（idea/chat/attachment=3件）。"""
    acc, uid = _login_user(client, factory)
    env["build"](uid)
    p1 = _search(client, env["qid"], per_page=2, page=1).json()
    assert len(p1["data"]) == 2 and p1["page_info"]["total"] == 3
    p2 = _search(client, env["qid"], per_page=2, page=2).json()
    assert len(p2["data"]) == 1


def test_j_tc_107_empty_result(client, factory, env):
    """J-TC-107 ヒットしない語は 0 件。"""
    acc, uid = _login_user(client, factory)
    env["build"](uid)
    b = _search(client, env["qid"], q="該当しない語ヌルポ").json()
    assert b["data"] == [] and b["page_info"]["total"] == 0


def test_j_tc_108_empty_query_422(client, factory, env):
    """J-TC-108 空クエリは 422。"""
    acc, uid = _login_user(client, factory)
    env["build"](uid)
    assert _search(client, env["qid"], q="   ").status_code == 422


def test_j_tc_121_gate_404_for_non_member(client, factory, env):
    """J-TC-121 パーティー非参加は 404（存在秘匿）。"""
    # env は別ユーザー(owner=env build 実行者)で構築。ここは build せず別 account で検索＝非メンバー。
    owner_client_acc, owner_uid = _login_user(client, factory)
    env["build"](owner_uid)
    outsider = factory.make_seed_company_account()
    _login(client, SEED_COMPANY_CODE, outsider["login_id"], outsider["password"])  # 非メンバーに切替
    assert _search(client, env["qid"]).status_code == 404


def test_j_tc_124_unauthenticated(client, factory, env):
    """J-TC-124 未認証は 401。"""
    acc, uid = _login_user(client, factory)
    env["build"](uid)
    client.cookies.clear()
    assert _search(client, env["qid"]).status_code == 401


def test_j_tc_131_snippet_highlight_and_escape(client, factory):
    """J-TC-131 スニペットはハイライト span 生・ユーザー文中の < はエスケープ。"""
    db = _db()
    gid, qid, pub = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    acc, uid = _login_user(client, factory)
    with get_tenant_session(db) as ts:
        ts.add(QuestGroup(id=gid, quest_group_code=f"QG-{uuid.uuid4().hex[:6].upper()}", name="G"))
        quests_repo.create_quest(ts, quest_id=qid, quest_group_id=gid, owner_id=uid,
                                 title="Q", color="#3B82F6", status="recruiting")
        quests_repo.add_member(ts, qid, uid, permissions=["owner"])
        qg_repo.upsert_membership(ts, gid, uid, "member")
        ts.add(Idea(id=pub, quest_id=qid, author_id=uid,
                    title="XSS", body=f"<script>alert(1)</script> {NEEDLE}", value="v", status="published"))
        ts.commit()
    try:
        b = _search(client, qid).json()
        snip = next(r["snippet_html"] for r in b["data"] if r["type"] == "idea")
        assert '<span class="keyword">' in snip           # ハイライトタグは生
        assert "&lt;script&gt;" in snip and "<script>" not in snip  # ユーザー文はエスケープ
    finally:
        with get_tenant_session(db) as ts:
            ts.execute(Idea.__table__.delete().where(Idea.id == pub))
            ts.execute(QuestMemberPermission.__table__.delete().where(
                QuestMemberPermission.quest_member_id.in_(select(QuestMember.id).where(QuestMember.quest_id == qid))))
            ts.execute(QuestMember.__table__.delete().where(QuestMember.quest_id == qid))
            ts.execute(Quest.__table__.delete().where(Quest.id == qid))
            ts.execute(QuestGroupMember.__table__.delete().where(QuestGroupMember.quest_group_id == gid))
            ts.execute(QuestGroup.__table__.delete().where(QuestGroup.id == gid))
            ts.commit()


def test_j_tc_141_query_injection_safe(client, factory, env):
    """J-TC-141 q に PGroonga 演算子/SQL メタ文字を入れても 5xx にならず 200（バインド変数・§2.2③）。"""
    acc, uid = _login_user(client, factory)
    env["build"](uid)
    for q in ['"(', ')\\', 'a OR b', '*', "'; DROP TABLE ideas; --", '&@~ (( ']:
        r = _search(client, env["qid"], q=q)
        assert r.status_code == 200, f"q={q!r} -> {r.status_code} {r.text}"
        assert isinstance(r.json().get("data"), list)
