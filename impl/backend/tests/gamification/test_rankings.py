"""G-TC-401〜405: ランキング API（SC-41／SC-12・G.5・§7）。

スコア＝期間内 獲得XP＋獲得コイン（activities 集計・SP 対象外）。決定性のため scope=quest:{id} で集計を隔離。
throwaway アカウントでログイン（me）。他ユーザー・付与は ORM/ledger で seed し teardown で物理削除。
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.control_plane.auth.orm import Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.gamification import ledger
from app.tenant.gamification.orm import Activity
from app.tenant.profile.orm import User
from app.tenant.profile.repository import get_user_by_account
from app.tenant.quest_group.orm import QuestGroup
from app.tenant.quests import repository as quests_repo
from app.tenant.quests.orm import Quest, QuestMember, QuestMemberPermission
from tests.admin.test_admin_accounts import _login
from tests.conftest import SEED_COMPANY_CODE

RANK = "/api/v1/rankings"


def _db() -> str:
    with control_session() as s:
        return s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().db_identifier


def _login_new(client, factory):
    acc = factory.make_seed_company_account()
    _login(client, SEED_COMPANY_CODE, acc["login_id"], acc["password"])
    with get_tenant_session(_db()) as s:
        return get_user_by_account(s, acc["id"]).id


def _grant(user_id, *, kind, amount, quest_id, when=None):
    with get_tenant_session(_db()) as s:
        u = s.get(User, user_id)
        act = ledger.grant(s, u, kind=kind, amount=amount, reason="idea_post" if kind == "xp_gain" else "evaluation_coin",
                           ref_type="ideas", ref_id=uuid.uuid4(), quest_id=quest_id)
        if when is not None:
            act.created_at = when
        s.commit()


def _make_quest_with(me_id, members: list) -> tuple:
    """quest（owner=me）＋追加ユーザーをパーティーに。返り値＝(quest_id, [extra_user_ids])。"""
    gid, qid = uuid.uuid4(), uuid.uuid4()
    extra = []
    with get_tenant_session(_db()) as ts:
        ts.add(QuestGroup(id=gid, quest_group_code=f"QG-{uuid.uuid4().hex[:6].upper()}", name="G"))
        for name in members:
            uid = uuid.uuid4()
            ts.add(User(id=uid, account_id=uuid.uuid4(), display_name=name, locale="ja", status="active"))
            extra.append(uid)
        ts.flush()
        quests_repo.create_quest(ts, quest_id=qid, quest_group_id=gid, owner_id=me_id, title="Q", color="#3B82F6", status="in_progress")
        quests_repo.add_member(ts, qid, me_id, permissions=["owner"])
        for uid in extra:
            quests_repo.add_member(ts, qid, uid, permissions=["vote"])
        ts.commit()
    return qid, gid, extra


def _cleanup(qid, gid, extra):
    with get_tenant_session(_db()) as ts:
        ts.execute(Activity.__table__.delete().where(Activity.quest_id == qid))
        mids = list(ts.execute(select(QuestMember.id).where(QuestMember.quest_id == qid)).scalars())
        if mids:
            ts.execute(QuestMemberPermission.__table__.delete().where(QuestMemberPermission.quest_member_id.in_(mids)))
        ts.execute(QuestMember.__table__.delete().where(QuestMember.quest_id == qid))
        ts.execute(Quest.__table__.delete().where(Quest.id == qid))
        ts.execute(QuestGroup.__table__.delete().where(QuestGroup.id == gid))
        if extra:
            ts.execute(User.__table__.delete().where(User.id.in_(extra)))
        ts.commit()


def test_g_tc_401_ranking_order_and_me(client, factory):
    me = _login_new(client, factory)
    qid, gid, (u1,) = _make_quest_with(me, ["U1"])
    try:
        _grant(me, kind="xp_gain", amount=50, quest_id=qid)
        _grant(me, kind="coin_gain", amount=30, quest_id=qid)  # me score 80
        _grant(u1, kind="xp_gain", amount=20, quest_id=qid)     # U1 score 20
        r = client.get(f"{RANK}?scope=quest:{qid}")
        assert r.status_code == 200, r.text
        body = r.json()
        assert [row["score"] for row in body["data"]] == [80, 20]
        assert body["data"][0]["user"]["id"] == str(me) and body["data"][0]["xp"] == 50 and body["data"][0]["coin"] == 30
        assert body["me"]["rank"] == 1 and body["me"]["total_users"] == 2
    finally:
        _cleanup(qid, gid, [u1])


def test_g_tc_402_period_bounds(client, factory):
    me = _login_new(client, factory)
    qid, gid, extra = _make_quest_with(me, [])
    try:
        _grant(me, kind="xp_gain", amount=10, quest_id=qid)  # 今週
        # 先週内に確実に入る日時＝今週月曜(JST 00:00)の3日前（先週金曜昼）。
        JST = timezone(timedelta(hours=9))
        now_jst = datetime.now(JST)
        this_mon = now_jst.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=now_jst.weekday())
        last_week = (this_mon - timedelta(days=3)).astimezone(timezone.utc)
        _grant(me, kind="xp_gain", amount=99, quest_id=qid, when=last_week)  # 先週（backdate）
        tw = client.get(f"{RANK}?scope=quest:{qid}&period=this_week").json()
        assert tw["me"]["xp"] == 10  # 今週分のみ
        lw = client.get(f"{RANK}?scope=quest:{qid}&period=last_week").json()
        assert lw["me"]["xp"] == 99  # 先週分のみ
    finally:
        _cleanup(qid, gid, extra)


def test_g_tc_403_me_out_of_rank(client, factory):
    me = _login_new(client, factory)
    qid, gid, (u1,) = _make_quest_with(me, ["U1"])
    try:
        _grant(u1, kind="xp_gain", amount=20, quest_id=qid)  # 他者のみ・me は 0
        body = client.get(f"{RANK}?scope=quest:{qid}").json()
        assert body["me"]["rank"] is None and body["me"]["score"] == 0 and body["me"]["total_users"] == 1
    finally:
        _cleanup(qid, gid, [u1])


def test_g_tc_404_quest_gate(client, factory):
    me = _login_new(client, factory)
    # me が参加していないクエスト（owner=別ユーザー・me 非メンバー）。
    other = uuid.uuid4()
    gid, qid = uuid.uuid4(), uuid.uuid4()
    with get_tenant_session(_db()) as ts:
        ts.add(QuestGroup(id=gid, quest_group_code=f"QG-{uuid.uuid4().hex[:6].upper()}", name="G"))
        ts.add(User(id=other, account_id=uuid.uuid4(), display_name="Other", locale="ja", status="active"))
        ts.flush()
        quests_repo.create_quest(ts, quest_id=qid, quest_group_id=gid, owner_id=other, title="Q", color="#3B82F6", status="in_progress")
        quests_repo.add_member(ts, qid, other, permissions=["owner"])
        ts.commit()
    try:
        assert client.get(f"{RANK}?scope=quest:{qid}").status_code == 404
    finally:
        _cleanup(qid, gid, [other])


def test_g_tc_405_invalid_period(client, factory):
    _login_new(client, factory)
    assert client.get(f"{RANK}?period=xxx").status_code == 422
