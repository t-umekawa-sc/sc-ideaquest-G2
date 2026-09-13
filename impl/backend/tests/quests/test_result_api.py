"""C-TC-240〜242: クエスト最終結果＝検証済みコンセプト票（FR-39・ISO 56002・SC-12 結果タブ）。

seed 一般ユーザー（ACME-01）でログインし、会社DB にクエスト＋公開アイデア＋選定＋submitted 評価＋投票を seed。
GET /quests/{id}/result（合成）・門番（非パーティー 404）・PUT /quests/{id}/result（総括保存・owner/quest_admin）を検証。
"""
from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.control_plane.auth.orm import Account, Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.evaluations import repository as eval_repo
from app.tenant.ideas import repository as ideas_repo
from app.tenant.ideas.orm import Idea, IdeaRevision, Vote
from app.tenant.evaluations.orm import Evaluation, EvaluationScore
from app.tenant.gamification.orm import Activity
from app.tenant.notifications.orm import Notification
from app.tenant.profile.orm import User
from app.tenant.profile.repository import get_user_by_account
from app.tenant.quests import repository as quests_repo
from app.tenant.quests.orm import Quest, QuestMember, QuestMemberPermission, QuestOutcome
from tests.admin.test_admin_accounts import _login
from tests.conftest import SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD


def _csrf(client) -> dict:
    return {"X-CSRF-Token": client.cookies.get("iq_csrf")}


def _login_seed(client) -> None:
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)


RESULT = lambda qid: f"/api/v1/quests/{qid}/result"  # noqa: E731
TRANSITION = lambda qid: f"/api/v1/quests/{qid}/transition"  # noqa: E731


@pytest.fixture
def env():
    with control_session() as s:
        db_identifier = s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().db_identifier
        account = s.execute(select(Account).where(Account.login_id == SEED_LOGIN)).scalars().one()
    with get_tenant_session(db_identifier) as ts:
        user_id = get_user_by_account(ts, account.id).id

    other_id = uuid.uuid4()
    quests: list[uuid.UUID] = []
    ideas: list[uuid.UUID] = []

    with get_tenant_session(db_identifier) as ts:
        ts.add(User(id=other_id, account_id=uuid.uuid4(), display_name="Other", locale="ja", status="active"))
        ts.commit()

    def make_quest(*, owner=None, seed_member=True, seed_perms=None, status="completed") -> uuid.UUID:
        qid = uuid.uuid4()
        the_owner = owner or user_id
        with get_tenant_session(db_identifier) as ts:
            quests_repo.create_quest(ts, quest_id=qid, owner_id=the_owner, title="Q", color="#3B82F6", status=status)
            quests_repo.add_member(ts, qid, the_owner, permissions=["owner"])
            if seed_member and the_owner != user_id:
                quests_repo.add_member(ts, qid, user_id, permissions=seed_perms or ["vote", "idea_create", "comment"])
            ts.commit()
        quests.append(qid)
        return qid

    def make_idea(*, quest_id, author=None, selected=False, title="I", value="v") -> uuid.UUID:
        iid = uuid.uuid4()
        with get_tenant_session(db_identifier) as ts:
            idea = ideas_repo.create_idea(ts, idea_id=iid, quest_id=quest_id, author_id=author or user_id, title=title, value=value, body="b", status="published")
            ts.flush()
            ideas_repo.add_revision(ts, iid, revision=idea.current_revision, editor_id=author or user_id,
                                    changes={"title": title, "value": value, "body": "b", "time_limit": None, "note": None, "stakeholders": []})
            if selected:
                idea.is_selected = True
            ts.commit()
        ideas.append(iid)
        return iid

    def submit_eval(*, idea_id, evaluator=None, score=4) -> None:
        with get_tenant_session(db_identifier) as ts:
            ev, _ = eval_repo.upsert_evaluation(ts, idea_id, evaluator or user_id, overall_comment="総評", status="submitted", visibility="party")
            eval_repo.replace_scores(ts, ev.id, [(a, score, None) for a in eval_repo.ASPECTS])
            ts.commit()

    def add_vote(*, idea_id, voter=None) -> None:
        with get_tenant_session(db_identifier) as ts:
            ideas_repo.upsert_vote(ts, idea_id, voter or user_id, type="approve", voted_revision=1)
            ts.commit()

    def add_chat(*, idea_id, body, author=None) -> uuid.UUID:
        """当該アイデアの chat_group を用意し、通常メッセージを1件 seed（FR-39 (c) 自動要約の入力）。"""
        from app.tenant.chat.orm import ChatGroup, ChatMessage
        mid = uuid.uuid4()
        with get_tenant_session(db_identifier) as ts:
            cg = ts.execute(select(ChatGroup).where(ChatGroup.idea_id == idea_id)).scalars().first()
            if cg is None:
                cg = ChatGroup(id=uuid.uuid4(), idea_id=idea_id)
                ts.add(cg)
                ts.flush()
            ts.add(ChatMessage(id=mid, chat_group_id=cg.id, author_id=author or user_id, body=body))
            ts.commit()
        return mid

    def pin_chat(*, idea_id, body="重要な論点", author=None) -> uuid.UUID:
        """当該アイデアの chat_group を用意し、ピン留め済みメッセージを1件 seed（FR-39 (b)）。"""
        from app.tenant.chat.orm import ChatGroup, ChatMessage
        mid = uuid.uuid4()
        with get_tenant_session(db_identifier) as ts:
            cg = ts.execute(select(ChatGroup).where(ChatGroup.idea_id == idea_id)).scalars().first()
            if cg is None:
                cg = ChatGroup(id=uuid.uuid4(), idea_id=idea_id)
                ts.add(cg)
                ts.flush()
            ts.add(ChatMessage(id=mid, chat_group_id=cg.id, author_id=author or user_id, body=body, is_pinned=True))
            ts.commit()
        return mid

    yield SimpleNamespace(
        db_identifier=db_identifier, user_id=user_id, other_id=other_id,
        make_quest=make_quest, make_idea=make_idea, submit_eval=submit_eval, add_vote=add_vote,
        pin_chat=pin_chat, add_chat=add_chat,
    )

    with get_tenant_session(db_identifier) as ts:
        iids = list(ts.execute(select(Idea.id).where(Idea.quest_id.in_(quests or [uuid.uuid4()]))).scalars())
        iids = list(set(ideas) | set(iids))
        if iids:
            evids = list(ts.execute(select(Evaluation.id).where(Evaluation.idea_id.in_(iids))).scalars())
            if evids:
                ts.execute(EvaluationScore.__table__.delete().where(EvaluationScore.evaluation_id.in_(evids)))
            ts.execute(Evaluation.__table__.delete().where(Evaluation.idea_id.in_(iids)))
            ts.execute(Vote.__table__.delete().where(Vote.idea_id.in_(iids)))
            ts.execute(IdeaRevision.__table__.delete().where(IdeaRevision.idea_id.in_(iids)))
            from app.tenant.chat.orm import ChatGroup, ChatMessage
            cgids = list(ts.execute(select(ChatGroup.id).where(ChatGroup.idea_id.in_(iids))).scalars())
            if cgids:
                ts.execute(ChatMessage.__table__.delete().where(ChatMessage.chat_group_id.in_(cgids)))
            ts.execute(ChatGroup.__table__.delete().where(ChatGroup.idea_id.in_(iids)))
            ts.execute(Idea.__table__.delete().where(Idea.id.in_(iids)))
        if quests:
            ts.execute(Notification.__table__.delete().where(Notification.ref_quest_id.in_(quests)))
            ts.execute(Activity.__table__.delete().where(Activity.quest_id.in_(quests)))
            ts.execute(QuestOutcome.__table__.delete().where(QuestOutcome.quest_id.in_(quests)))
            mids = list(ts.execute(select(QuestMember.id).where(QuestMember.quest_id.in_(quests))).scalars())
            if mids:
                ts.execute(QuestMemberPermission.__table__.delete().where(QuestMemberPermission.quest_member_id.in_(mids)))
            ts.execute(QuestMember.__table__.delete().where(QuestMember.quest_id.in_(quests)))
            ts.execute(Quest.__table__.delete().where(Quest.id.in_(quests)))
        ts.execute(User.__table__.delete().where(User.id == other_id))
        ts.commit()


def test_c_tc_240_result_compose(client, env):
    """C-TC-240: GET result＝既存集計の合成（選定/評価平均/観点別平均/投票/参加指標）＋can_edit（owner）。"""
    _login_seed(client)
    qid = env.make_quest()
    sel = env.make_idea(quest_id=qid, selected=True, title="採用案")
    env.make_idea(quest_id=qid, selected=False, title="不採用案")
    env.submit_eval(idea_id=sel, score=4)
    env.add_vote(idea_id=sel)
    r = client.get(RESULT(qid))
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["participation"]["idea_count"] == 2
    assert b["participation"]["selected_count"] == 1
    assert b["participation"]["vote_total"] == 1
    assert b["participation"]["evaluation_count"] == 1
    assert b["aspect_averages"]["fit"] == 4.0
    dec = {d["idea_id"]: d for d in b["decisions"]}
    assert dec[str(sel)]["is_selected"] is True
    assert dec[str(sel)]["overall_avg"] == 4.0
    assert b["can_edit"] is True  # 作成者＝編集可
    assert b["purpose"] is None or isinstance(b["purpose"], str)


def test_c_tc_241_result_gate_non_party(client, env):
    """C-TC-241: 非パーティー（seed user が member でない他人のクエスト）は結果を参照不可＝404（存在秘匿・C.0）。"""
    _login_seed(client)
    qid = env.make_quest(owner=env.other_id, seed_member=False)
    r = client.get(RESULT(qid))
    assert r.status_code == 404, r.text


def test_c_tc_242_result_put_and_permission(client, env):
    """C-TC-242: PUT result＝総括（振り返り/次アクション/KPI）を保存し GET に反映。非 owner/管理は 403。"""
    _login_seed(client)
    # (1) owner として保存→反映
    qid = env.make_quest()
    r = client.put(RESULT(qid), json={"summary": "成果あり", "next_actions": "後続クエスト起票",
                                      "metrics": [{"label": "削減工数", "value": "20h/月"}]}, headers=_csrf(client))
    assert r.status_code == 200, r.text
    assert r.json()["summary"] == "成果あり"
    got = client.get(RESULT(qid)).json()
    assert got["outcome"]["summary"] == "成果あり"
    assert got["outcome"]["next_actions"] == "後続クエスト起票"
    assert got["outcome"]["metrics"][0]["label"] == "削減工数"
    # (2) 権限なし（他人クエストの一般メンバー＝vote のみ）は 403
    qid2 = env.make_quest(owner=env.other_id, seed_member=True, seed_perms=["vote"])
    r2 = client.put(RESULT(qid2), json={"summary": "x"}, headers=_csrf(client))
    assert r2.status_code == 403, r2.text


def test_c_tc_245_result_includes_pinned_messages(client, env):
    """C-TC-245: 結果の④議論の要点(b)＝ピン留めチャットが pinned_messages に集約（抜粋＋投稿者＋所属アイデア）。"""
    _login_seed(client)
    qid = env.make_quest()
    iid = env.make_idea(quest_id=qid, title="採用案")
    env.pin_chat(idea_id=iid, body="この観点が決め手")
    r = client.get(RESULT(qid))
    assert r.status_code == 200, r.text
    pins = r.json()["pinned_messages"]
    assert len(pins) == 1
    assert pins[0]["idea_id"] == str(iid)
    assert pins[0]["idea_title"] == "採用案"
    assert pins[0]["excerpt"] == "この観点が決め手"


CHAT_SUMMARY = lambda qid: f"/api/v1/quests/{qid}/result/chat-summary"  # noqa: E731


def test_c_tc_246_chat_summary_offline(client, env):
    """C-TC-246: (c) 自動要約（抽出型・オフライン）を生成し chat_summary に保存（owner）。非管理は403。"""
    _login_seed(client)
    qid = env.make_quest()
    iid = env.make_idea(quest_id=qid)
    env.add_chat(idea_id=iid, body="配送コストの削減が最重要だ。")
    env.add_chat(idea_id=iid, body="夜間集約でCO2も減らせる。")
    r = client.post(CHAT_SUMMARY(qid), headers=_csrf(client))
    assert r.status_code == 200, r.text
    assert r.json()["chat_summary"]  # 非空（外部API不使用・オフライン抽出）
    got = client.get(RESULT(qid)).json()
    assert got["outcome"]["chat_summary"]
    # 権限なし（他人所有・comment のみ）は 403
    q2 = env.make_quest(owner=env.other_id, seed_member=True, seed_perms=["comment"])
    assert client.post(CHAT_SUMMARY(q2), headers=_csrf(client)).status_code == 403


def test_c_tc_243_completion_notifies_party_and_feed(client, env):
    """C-TC-243: evaluating→completed で ④パーティー（作成者以外）に quest_result_ready 通知＋quest_completed フィード活動（冪等）。"""
    _login_seed(client)
    qid = env.make_quest(status="evaluating")  # owner=seed
    with get_tenant_session(env.db_identifier) as ts:
        quests_repo.add_member(ts, qid, env.other_id, permissions=["vote", "comment"])  # 作成者以外のパーティー員
        ts.commit()
    r = client.post(TRANSITION(qid), json={"to": "completed"}, headers=_csrf(client))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "completed"
    with get_tenant_session(env.db_identifier) as ts:
        # ④ フィード＝quest_completed 活動が1件（作成者＝seed・冪等）。
        acts = ts.execute(select(Activity).where(Activity.quest_id == qid, Activity.reason == "quest_completed")).scalars().all()
        assert len(acts) == 1 and acts[0].user_id == env.user_id
        # ④ 通知＝作成者以外のパーティー員（other）に quest_result_ready。作成者（seed）には出さない。
        notes = ts.execute(select(Notification).where(Notification.ref_quest_id == qid, Notification.type == "quest_result_ready")).scalars().all()
        recipients = {n.recipient_id for n in notes}
        assert env.other_id in recipients
        assert env.user_id not in recipients


def test_c_tc_244_outcome_grants_xp_once(client, env):
    """C-TC-244: ⑥ 総括の初回記入で owner に少額XP付与（quest_result_summary・クエスト単位で本人1回・冪等）。"""
    _login_seed(client)
    qid = env.make_quest()
    client.put(RESULT(qid), json={"summary": "成果"}, headers=_csrf(client))
    client.put(RESULT(qid), json={"learnings": "学び追記"}, headers=_csrf(client))  # 2回目は加算しない
    with get_tenant_session(env.db_identifier) as ts:
        acts = ts.execute(select(Activity).where(Activity.quest_id == qid, Activity.reason == "quest_result_summary")).scalars().all()
        assert len(acts) == 1 and acts[0].user_id == env.user_id
        assert acts[0].amount == 20
