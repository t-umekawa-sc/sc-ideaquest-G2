"""F-TC-101〜120: 評価の取得/登録/更新・選定・投稿者コイン確定 API（SC-25/SC-22・F.1〜F.4）。

seed 一般ユーザー（ACME-01）でログインし、会社DB にクエスト＋パーティー参加＋権限を seed。門番（パーティー所属）＋
権限（evaluator／owner・quest_admin）・状態機械・可視性・XP/コイン冪等を検証。teardown で作成データ＋活動を物理削除。
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.control_plane.auth.orm import Account, Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.evaluations import repository as repo
from app.tenant.evaluations.orm import Evaluation, EvaluationScore
from app.tenant.gamification.orm import Activity
from app.tenant.ideas.orm import Idea
from app.tenant.profile.orm import User
from app.tenant.profile.repository import get_user_by_account
from app.tenant.quest_group.orm import QuestGroup
from app.tenant.quests import repository as quests_repo
from app.tenant.quests.orm import Quest, QuestMember, QuestMemberPermission
from tests.admin.test_admin_accounts import _login
from tests.conftest import SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD

FULL = {"novelty": 4, "impact": 4, "feasibility": 4, "fit": 4, "cost": 4}
EVAL_ME = lambda i: f"/api/v1/ideas/{i}/evaluation/me"  # noqa: E731
EVAL = lambda i: f"/api/v1/ideas/{i}/evaluation"  # noqa: E731
SELECT = lambda i: f"/api/v1/ideas/{i}/select"  # noqa: E731


def _csrf(client) -> dict:
    return {"X-CSRF-Token": client.cookies.get("iq_csrf")}


def _login_seed(client) -> None:
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)


@pytest.fixture
def env():
    with control_session() as s:
        db_identifier = s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().db_identifier
        account = s.execute(select(Account).where(Account.login_id == SEED_LOGIN)).scalars().one()
    with get_tenant_session(db_identifier) as ts:
        user_id = get_user_by_account(ts, account.id).id

    group_id, other_id, third_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    quests: list[uuid.UUID] = []
    ideas: list[uuid.UUID] = []

    with get_tenant_session(db_identifier) as ts:
        ts.add(QuestGroup(id=group_id, quest_group_code=f"QG-{uuid.uuid4().hex[:6].upper()}", name="G"))
        ts.add(User(id=other_id, account_id=uuid.uuid4(), display_name="Other", locale="ja", status="active"))
        ts.add(User(id=third_id, account_id=uuid.uuid4(), display_name="Third", locale="ja", status="active"))
        ts.commit()

    def make_quest(*, owner=None, status="recruiting", seed_perms=None, seed_member=True) -> uuid.UUID:
        qid = uuid.uuid4()
        the_owner = owner or user_id
        with get_tenant_session(db_identifier) as ts:
            quests_repo.create_quest(ts, quest_id=qid, quest_group_id=group_id, owner_id=the_owner, title="Q", color="#3B82F6", status=status)
            quests_repo.add_member(ts, qid, the_owner, permissions=["owner"])
            if seed_member and the_owner != user_id:
                quests_repo.add_member(ts, qid, user_id, permissions=seed_perms or ["evaluator", "vote"])
            ts.commit()
        quests.append(qid)
        return qid

    def add_member(quest_id, uid, perms):
        with get_tenant_session(db_identifier) as ts:
            quests_repo.add_member(ts, quest_id, uid, permissions=perms)
            ts.commit()

    def make_idea(*, quest_id, author=None, status="published") -> uuid.UUID:
        iid = uuid.uuid4()
        with get_tenant_session(db_identifier) as ts:
            ts.add(Idea(id=iid, quest_id=quest_id, author_id=author or user_id, title="I", body="b", value="v", status=status))
            ts.commit()
        ideas.append(iid)
        return iid

    def seed_evaluation(idea_id, evaluator_id, *, val=4, visibility="party", status="submitted"):
        with get_tenant_session(db_identifier) as ts:
            ev, _ = repo.upsert_evaluation(ts, idea_id, evaluator_id, overall_comment="seed", status=status, visibility=visibility)
            repo.replace_scores(ts, ev.id, [(a, val, None) for a in repo.ASPECTS])
            if status == "submitted":
                ev.submitted_at = datetime.now(timezone.utc)
            ts.commit()

    yield SimpleNamespace(
        db_identifier=db_identifier, user_id=user_id, other_id=other_id, third_id=third_id,
        make_quest=make_quest, add_member=add_member, make_idea=make_idea, seed_evaluation=seed_evaluation,
    )

    with get_tenant_session(db_identifier) as ts:
        if ideas:
            eval_ids = [e.id for i in ideas for e in repo.list_evaluations_for_idea(ts, i)]
            if eval_ids:
                ts.execute(EvaluationScore.__table__.delete().where(EvaluationScore.evaluation_id.in_(eval_ids)))
                ts.execute(Activity.__table__.delete().where(Activity.ref_id.in_(eval_ids)))
            ts.execute(Evaluation.__table__.delete().where(Evaluation.idea_id.in_(ideas)))
            ts.execute(Activity.__table__.delete().where(Activity.ref_id.in_(ideas)))
            # 公開で作られる chat_groups（E・§5.15）も掃除（FK: chat_groups.idea_id）。
            from app.tenant.chat.orm import ChatGroup
            ts.execute(ChatGroup.__table__.delete().where(ChatGroup.idea_id.in_(ideas)))
            ts.execute(Idea.__table__.delete().where(Idea.id.in_(ideas)))
        if quests:
            member_ids = list(ts.execute(select(QuestMember.id).where(QuestMember.quest_id.in_(quests))).scalars())
            if member_ids:
                ts.execute(QuestMemberPermission.__table__.delete().where(QuestMemberPermission.quest_member_id.in_(member_ids)))
            ts.execute(QuestMember.__table__.delete().where(QuestMember.quest_id.in_(quests)))
            ts.execute(Quest.__table__.delete().where(Quest.id.in_(quests)))
        ts.execute(QuestGroup.__table__.delete().where(QuestGroup.id == group_id))
        ts.execute(User.__table__.delete().where(User.id.in_([other_id, third_id])))
        ts.commit()


def _activity_count(env, *, kind, reason, ref_id) -> int:
    with get_tenant_session(env.db_identifier) as ts:
        return len(list(ts.execute(
            select(Activity).where(Activity.kind == kind, Activity.reason == reason, Activity.ref_id == ref_id)
        ).scalars()))


# ---- F.1 取得 ----

def test_f_tc_101_get_me_empty(client, env):
    _login_seed(client)
    idea = env.make_idea(quest_id=env.make_quest())
    r = client.get(EVAL_ME(idea))
    assert r.status_code == 200, r.text
    assert r.json()["status"] is None


def test_f_tc_110_aggregate(client, env):
    _login_seed(client)
    qid = env.make_quest()
    idea = env.make_idea(quest_id=qid)
    env.add_member(qid, env.other_id, ["evaluator"])
    env.seed_evaluation(idea, env.user_id, val=4)
    env.seed_evaluation(idea, env.other_id, val=2)
    r = client.get(EVAL(idea))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["evaluator_count"] == 2
    assert body["aspects"]["novelty"] == 3.0  # (4+2)/2
    assert body["overall_avg"] == 3.0
    assert body["coin"]["projected"] == 30  # round(3.0*10)


def test_f_tc_111_limited_hidden_but_coin_counts(client, env):
    """F-TC-111/112: limited は範囲外に非表示（集計分母外）だが coin.projected は全 submitted で算定。"""
    _login_seed(client)
    # ACME-01 は party だが非owner/admin・非author・非当該評価者＝limited の範囲外。
    qid = env.make_quest(owner=env.other_id, seed_perms=["vote"])
    idea = env.make_idea(quest_id=qid, author=env.other_id)
    env.add_member(qid, env.third_id, ["evaluator"])
    env.seed_evaluation(idea, env.other_id, val=2, visibility="party")     # 可視（owner の評価）
    env.seed_evaluation(idea, env.third_id, val=4, visibility="limited")   # 範囲外には非表示
    r = client.get(EVAL(idea))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["evaluator_count"] == 1          # party の1件のみ
    assert body["aspects"]["novelty"] == 2.0     # limited を分母に入れない
    assert body["coin"]["projected"] == 30       # visibility 無視＝(2+4)/2=3 → 30


# ---- F.2 登録/更新 ----

def test_f_tc_102_draft_partial_no_grant(client, env):
    _login_seed(client)
    idea = env.make_idea(quest_id=env.make_quest())
    r = client.put(EVAL(idea), json={"scores": {"novelty": 3}, "status": "draft"}, headers=_csrf(client))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "draft"
    me = client.get(EVAL_ME(idea)).json()
    assert me["scores"]["novelty"] == 3


def test_f_tc_103_submit_grants_xp30(client, env):
    _login_seed(client)
    idea = env.make_idea(quest_id=env.make_quest())
    r = client.put(EVAL(idea), json={"scores": FULL, "overall_comment": "総評", "status": "submitted"}, headers=_csrf(client))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "submitted" and r.json()["submitted_at"]
    with get_tenant_session(env.db_identifier) as ts:
        ev = repo.get_evaluation(ts, idea, env.user_id)
        assert _activity_count(env, kind="xp_gain", reason="evaluation", ref_id=ev.id) == 1


def test_f_tc_104_submit_requires_all(client, env):
    _login_seed(client)
    idea = env.make_idea(quest_id=env.make_quest())
    r1 = client.put(EVAL(idea), json={"scores": {"novelty": 4}, "overall_comment": "x", "status": "submitted"}, headers=_csrf(client))
    assert r1.status_code == 422, r1.text
    r2 = client.put(EVAL(idea), json={"scores": FULL, "overall_comment": "", "status": "submitted"}, headers=_csrf(client))
    assert r2.status_code == 422, r2.text


def test_f_tc_105_submit_xp_once(client, env):
    _login_seed(client)
    idea = env.make_idea(quest_id=env.make_quest())
    body = {"scores": FULL, "overall_comment": "総評", "status": "submitted"}
    assert client.put(EVAL(idea), json=body, headers=_csrf(client)).status_code == 200
    assert client.put(EVAL(idea), json={**body, "overall_comment": "改訂"}, headers=_csrf(client)).status_code == 200
    with get_tenant_session(env.db_identifier) as ts:
        ev = repo.get_evaluation(ts, idea, env.user_id)
        assert _activity_count(env, kind="xp_gain", reason="evaluation", ref_id=ev.id) == 1


def test_f_tc_141_submit_response_carries_xp_delta(client, env):
    """F-TC-141 確定応答に xp_delta を載せる（初回確定=+30／再確定=0／下書き=0・#8 獲得フィードバック）。"""
    _login_seed(client)
    idea = env.make_idea(quest_id=env.make_quest())
    body = {"scores": FULL, "overall_comment": "総評", "status": "submitted"}
    first = client.put(EVAL(idea), json=body, headers=_csrf(client))
    assert first.status_code == 200 and first.json()["xp_delta"] == 30   # 初回確定＝実付与額
    again = client.put(EVAL(idea), json={**body, "overall_comment": "改訂"}, headers=_csrf(client))
    assert again.status_code == 200 and again.json()["xp_delta"] == 0     # 再確定は冪等（追加なし）
    # 別アイデアの下書き保存はアクション付与なし＝0
    idea2 = env.make_idea(quest_id=env.make_quest())
    draft = client.put(EVAL(idea2), json={"scores": {"novelty": 3}, "status": "draft"}, headers=_csrf(client))
    assert draft.status_code == 200 and draft.json()["xp_delta"] == 0


def test_f_tc_106_score_range(client, env):
    _login_seed(client)
    idea = env.make_idea(quest_id=env.make_quest())
    assert client.put(EVAL(idea), json={"scores": {**FULL, "cost": 6}, "overall_comment": "x", "status": "draft"}, headers=_csrf(client)).status_code == 422


def test_f_tc_107_requires_evaluator(client, env):
    _login_seed(client)
    qid = env.make_quest(owner=env.other_id, seed_perms=["vote"])  # ACME-01 は evaluator 権限なし
    idea = env.make_idea(quest_id=qid, author=env.other_id)
    assert client.put(EVAL(idea), json={"scores": FULL, "overall_comment": "x", "status": "submitted"}, headers=_csrf(client)).status_code == 403


def test_f_tc_108_gate_nonparty_and_draft(client, env):
    _login_seed(client)
    q2 = env.make_quest(owner=env.other_id, seed_member=False)  # ACME-01 は非パーティー
    non_party = env.make_idea(quest_id=q2, author=env.other_id)
    assert client.get(EVAL_ME(non_party)).status_code == 404
    draft = env.make_idea(quest_id=env.make_quest(), status="draft")  # 下書きは評価対象外
    assert client.get(EVAL_ME(draft)).status_code == 404


def test_f_tc_109_completed_frozen(client, env):
    _login_seed(client)
    qid = env.make_quest(status="completed")
    idea = env.make_idea(quest_id=qid)
    assert client.put(EVAL(idea), json={"scores": FULL, "overall_comment": "x", "status": "submitted"}, headers=_csrf(client)).status_code == 409


# ---- F.3 選定 ----

def test_f_tc_113_select_grants_xp200(client, env):
    _login_seed(client)
    idea = env.make_idea(quest_id=env.make_quest())  # ACME-01 owner＝author
    r = client.post(SELECT(idea), headers=_csrf(client))
    assert r.status_code == 200 and r.json()["is_selected"] is True, r.text
    assert _activity_count(env, kind="xp_gain", reason="selection", ref_id=idea) == 1


def test_f_tc_114_unselect_keeps_xp(client, env):
    _login_seed(client)
    idea = env.make_idea(quest_id=env.make_quest())
    client.post(SELECT(idea), headers=_csrf(client))
    r = client.delete(SELECT(idea), headers=_csrf(client))
    assert r.status_code == 200 and r.json()["is_selected"] is False, r.text
    assert _activity_count(env, kind="xp_gain", reason="selection", ref_id=idea) == 1  # 剥奪しない


def test_f_tc_115_select_xp_once(client, env):
    _login_seed(client)
    idea = env.make_idea(quest_id=env.make_quest())
    client.post(SELECT(idea), headers=_csrf(client))
    client.delete(SELECT(idea), headers=_csrf(client))
    client.post(SELECT(idea), headers=_csrf(client))  # 再選定でも再付与しない
    assert _activity_count(env, kind="xp_gain", reason="selection", ref_id=idea) == 1


def test_f_tc_116_select_requires_admin(client, env):
    _login_seed(client)
    qid = env.make_quest(owner=env.other_id, seed_perms=["evaluator", "vote"])  # ACME-01 は owner/quest_admin でない
    idea = env.make_idea(quest_id=qid, author=env.other_id)
    assert client.post(SELECT(idea), headers=_csrf(client)).status_code == 403


def test_f_tc_117_select_completed_409(client, env):
    _login_seed(client)
    qid = env.make_quest(status="completed")
    idea = env.make_idea(quest_id=qid)
    assert client.post(SELECT(idea), headers=_csrf(client)).status_code == 409
    assert client.delete(SELECT(idea), headers=_csrf(client)).status_code == 409


# ---- F.4 投稿者コイン確定 ----

def test_f_tc_118_coin_finalize_all_submitted(client, env):
    """(a) evaluator 全員提出でアイデア単位に1回確定（再判定で増えない）。"""
    _login_seed(client)
    qid = env.make_quest()  # ACME-01 owner＝evaluator＝author
    idea = env.make_idea(quest_id=qid)
    env.add_member(qid, env.other_id, ["evaluator"])
    env.seed_evaluation(idea, env.other_id, val=4)  # other は提出済み
    # ACME-01 が提出 → evaluator 全員(ACME-01, other)提出 → 確定。
    assert client.put(EVAL(idea), json={"scores": FULL, "overall_comment": "総評", "status": "submitted"}, headers=_csrf(client)).status_code == 200
    body = client.get(EVAL(idea)).json()
    assert body["coin"]["finalized"] == 40  # round(4*10)
    # 再提出しても二重確定しない。
    client.put(EVAL(idea), json={"scores": FULL, "overall_comment": "再", "status": "submitted"}, headers=_csrf(client))
    assert _activity_count(env, kind="coin_gain", reason="evaluation_coin", ref_id=idea) == 1


def test_f_tc_119_coin_finalize_on_completed(client, env):
    """(b) completed 遷移で未確定 published を一括確定（(a) 未達でも完了で確定）。"""
    _login_seed(client)
    qid = env.make_quest()
    idea = env.make_idea(quest_id=qid)
    env.add_member(qid, env.other_id, ["evaluator"])  # other は未提出＝(a) は未達
    assert client.put(EVAL(idea), json={"scores": FULL, "overall_comment": "総評", "status": "submitted"}, headers=_csrf(client)).status_code == 200
    assert _activity_count(env, kind="coin_gain", reason="evaluation_coin", ref_id=idea) == 0  # まだ未確定
    for to in ("in_progress", "evaluating", "completed"):
        assert client.post(f"/api/v1/quests/{qid}/transition", json={"to": to}, headers=_csrf(client)).status_code == 200
    assert _activity_count(env, kind="coin_gain", reason="evaluation_coin", ref_id=idea) == 1  # 完了で確定


# ---- 共通ガード ----

def test_f_tc_120_csrf_and_unauth(client, env):
    idea = env.make_idea(quest_id=env.make_quest())  # env は login 前でも seed 可
    # 未認証。
    assert client.put(EVAL(idea), json={"scores": FULL, "overall_comment": "x", "status": "submitted"}).status_code == 401
    _login_seed(client)
    # CSRF なし。
    assert client.put(EVAL(idea), json={"scores": FULL, "overall_comment": "x", "status": "submitted"}).status_code == 403


def test_d_tc_150_ideas_list_eval_aggregate(client, env):
    """D-TC-150 アイデア一覧カードに評価集計（評価済 n/5・未評価は評価待ち・F 可視のみ・SC-12 §69）。"""
    _login_seed(client)
    qid = env.make_quest()
    evaluated = env.make_idea(quest_id=qid)
    pending = env.make_idea(quest_id=qid)
    env.seed_evaluation(evaluated, env.other_id, val=4, visibility="party")  # 全観点4→overall 4.0
    cards = {c["id"]: c for c in client.get(f"/api/v1/quests/{qid}/ideas").json()["data"]}
    assert cards[str(evaluated)]["evaluation"] == {"state": "done", "overall_avg": 4.0, "evaluator_count": 1}
    assert cards[str(pending)]["evaluation"]["state"] == "pending"
    assert cards[str(pending)]["evaluation"]["overall_avg"] is None
