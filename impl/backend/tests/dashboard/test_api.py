"""I-TC-101〜143: ダッシュボード集約 GET /api/v1/dashboard（SC-01・I.1〜I.4）。

seed 会社 ACME-01 に quest＋パーティー＋アイデア（下書き/公開）＋投票/フォロー/下書き評価を seed し、
throwaway 実アカウントでログインして集約結果を照合。全て自分スコープ（§1.5）。
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.control_plane.auth.orm import Account, Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.evaluations import repository as evals_repo
from app.tenant.evaluations.orm import Evaluation, EvaluationScore
from app.tenant.ideas.orm import Follow, Idea, Vote
from app.tenant.notifications.orm import Notification
from app.tenant.profile.orm import User
from app.tenant.profile.repository import get_user_by_account
from app.tenant.quest_group import repository as qg_repo
from app.tenant.quest_group.orm import QuestGroup, QuestGroupMember
from app.tenant.quests import repository as quests_repo
from app.tenant.quests.orm import Quest, QuestMember, QuestMemberPermission
from tests.admin.test_admin_accounts import _login
from tests.conftest import SEED_COMPANY_CODE

DASH = "/api/v1/dashboard"


def _db() -> str:
    with control_session() as s:
        return s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().db_identifier


def _login_dash(client, factory):
    acc = factory.make_seed_company_account()
    _login(client, SEED_COMPANY_CODE, acc["login_id"], acc["password"])
    with get_tenant_session(_db()) as s:
        uid = get_user_by_account(s, acc["id"]).id
        # login が発火する security_new_device を除去（ダッシュボードの通知パネル検証を切り分け）。
        s.query(Notification).filter_by(recipient_id=uid, type="security_new_device").delete()
        s.commit()
        return acc, uid


@pytest.fixture
def seeded(factory):
    """メインユーザーのダッシュボード素材を seed して (client 用 acc, user_id, ids) を返す。"""
    db = _db()
    gid, qid = uuid.uuid4(), uuid.uuid4()
    other_id = uuid.uuid4()
    draft_idea, pub_a, pub_b = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    yield_ctx: dict = {}

    def build(user_id: uuid.UUID) -> None:
        with get_tenant_session(db) as ts:
            ts.add(QuestGroup(id=gid, quest_group_code=f"QG-{uuid.uuid4().hex[:6].upper()}", name="G"))
            ts.add(User(id=other_id, account_id=uuid.uuid4(), display_name="Other", locale="ja", status="active"))
            quests_repo.create_quest(ts, quest_id=qid, quest_group_id=gid, owner_id=user_id,
                                     title="集約クエスト", color="#3B82F6", status="recruiting")
            quests_repo.add_member(ts, qid, user_id, permissions=["owner", "comment", "vote"])
            qg_repo.upsert_membership(ts, gid, user_id, "member")  # get_quests (A) は所属グループ必須
            # 下書きアイデア（本人）＋公開アイデア2（other 作）。
            ts.add(Idea(id=draft_idea, quest_id=qid, author_id=user_id, title="下書きアイデア", body="b", value="v", status="draft"))
            ts.add(Idea(id=pub_a, quest_id=qid, author_id=other_id, title="公開A", body="b", value="va", status="published"))
            ts.add(Idea(id=pub_b, quest_id=qid, author_id=other_id, title="公開B", body="b", value="vb", status="published"))
            ts.flush()
            # A に投票済み → B が未投票。B をフォロー。
            ts.add(Vote(id=uuid.uuid4(), idea_id=pub_a, user_id=user_id, type="approve", voted_revision=1))
            ts.add(Follow(id=uuid.uuid4(), user_id=user_id, idea_id=pub_b))
            # A に下書き評価（scored 2/5）。
            ev, _ = evals_repo.upsert_evaluation(ts, pub_a, user_id, overall_comment=None, status="draft", visibility="party")
            evals_repo.replace_scores(ts, ev.id, [("novelty", 4, None), ("impact", 3, None)])
            ts.commit()

    yield_ctx["build"] = build
    yield_ctx["ids"] = {"gid": gid, "qid": qid, "other_id": other_id,
                        "draft_idea": draft_idea, "pub_a": pub_a, "pub_b": pub_b}
    yield yield_ctx

    with get_tenant_session(db) as ts:
        idea_ids = [draft_idea, pub_a, pub_b]
        ev_ids = [e.id for e in ts.execute(select(Evaluation).where(Evaluation.idea_id.in_(idea_ids))).scalars()]
        if ev_ids:
            ts.execute(EvaluationScore.__table__.delete().where(EvaluationScore.evaluation_id.in_(ev_ids)))
            ts.execute(Evaluation.__table__.delete().where(Evaluation.id.in_(ev_ids)))
        ts.execute(Vote.__table__.delete().where(Vote.idea_id.in_(idea_ids)))
        ts.execute(Follow.__table__.delete().where(Follow.idea_id.in_(idea_ids)))
        ts.execute(Idea.__table__.delete().where(Idea.id.in_(idea_ids)))
        ts.execute(QuestMemberPermission.__table__.delete().where(
            QuestMemberPermission.quest_member_id.in_(select(QuestMember.id).where(QuestMember.quest_id == qid))))
        ts.execute(QuestMember.__table__.delete().where(QuestMember.quest_id == qid))
        ts.execute(Quest.__table__.delete().where(Quest.id == qid))
        ts.execute(QuestGroupMember.__table__.delete().where(QuestGroupMember.quest_group_id == gid))
        ts.execute(QuestGroup.__table__.delete().where(QuestGroup.id == gid))
        ts.execute(User.__table__.delete().where(User.id == other_id))
        ts.commit()


def test_i_tc_101_empty_dashboard(client, factory):
    """I-TC-101 新規ユーザー＝各パネル空・hero あり・200。"""
    _login_dash(client, factory)
    b = client.get(DASH).json()
    assert b["hero"] is not None
    assert b["drafts"] == [] and b["unvoted_ideas"] == [] and b["quests"] == []
    assert b["followed_ideas"] == [] and b["notifications"]["data"] == []


def test_i_tc_102_hero(client, factory):
    """I-TC-102 ヒーロー＝残高＋level 純粋算出。"""
    _login_dash(client, factory)
    hero = client.get(DASH).json()["hero"]
    assert hero["level"] >= 1 and "xp_to_next" in hero and "level_span" in hero
    assert "coin_balance" in hero and "skill_point_balance" in hero


def test_i_tc_103_to_106_panels(client, factory, seeded):
    """I-TC-103/104/105/106 下書き（idea/eval）・未投票・参加中クエスト・フォロー中。"""
    acc, uid = _login_dash(client, factory)
    seeded["build"](uid)
    b = client.get(DASH).json()
    # 下書き＝アイデア＋評価（進捗 2/5）。
    kinds = {d["kind"] for d in b["drafts"]}
    assert "idea" in kinds and "evaluation" in kinds
    ev = next(d for d in b["drafts"] if d["kind"] == "evaluation")
    assert ev["progress"] == {"scored": 2, "total": 5}
    # 未投票＝公開B のみ（A は投票済み）。
    unvoted_titles = {i["title"] for i in b["unvoted_ideas"]}
    assert "公開B" in unvoted_titles and "公開A" not in unvoted_titles
    # 参加中クエスト。
    assert any(q["title"] == "集約クエスト" for q in b["quests"])
    # フォロー中＝公開B。
    assert any(i["title"] == "公開B" and i["following"] is True for i in b["followed_ideas"])


def test_i_tc_109_roles_general(client, factory):
    """I-TC-109 一般ユーザーは roles すべて false。"""
    _login_dash(client, factory)
    roles = client.get(DASH).json()["roles"]
    assert roles == {"is_qg_admin": False, "is_company_account_admin": False, "is_system_admin": False}


def test_i_tc_110_login_bonus_one_shot(client, factory):
    """I-TC-110 当日初回ログインで login_bonus が1度だけ返る（2回目は消費済み）。"""
    _login_dash(client, factory)  # 初回ログイン＝日次ログイン XP 付与→ワンショット mark
    first = client.get(DASH).json()
    assert first["login_bonus"] and first["login_bonus"]["xp"] > 0
    second = client.get(DASH).json()
    assert second["login_bonus"] is None  # 消費済み


def test_i_tc_121_unauthenticated(client):
    """I-TC-121 未認証は 401。"""
    client.cookies.clear()
    assert client.get(DASH).status_code == 401
