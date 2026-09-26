"""P-TC-401〜410 / 451〜455: コンセプト評価（P.5）＋投票＋XP（P.5b）。

seed 一般ユーザー（ACME-01）でログイン。評価は evaluator（owner 含む）・submitted は中核5＋総評＋推奨検証・
visibility は limited を範囲外に非表示。投票は賛成/反対・各コンセプト初回のみ XP+5（切替/取消/再投票で追加なし）。
"""
from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.control_plane.auth.orm import Account, Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.concepts import repository as repo
from app.tenant.concepts.orm import (
    ConceptDecisionLog,
    ConceptRevision,
    Assumption,
    AssumptionValidation,
    Concept,
    ConceptAssumptionLink,
    ConceptChatScope,
    ConceptEvaluation,
    ConceptEvaluationScore,
    ConceptVote,
)
from app.tenant.gamification.orm import Activity
from app.tenant.profile.orm import User
from app.tenant.profile.repository import get_user_by_account
from app.tenant.quest_group.orm import QuestGroup
from app.tenant.quests import repository as quests_repo
from app.tenant.quests.orm import Quest, QuestMember, QuestMemberPermission
from tests.admin.test_admin_accounts import _login
from tests.conftest import SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD

CORE = repo.CORE_ASPECTS


def _csrf(client) -> dict:
    return {"X-CSRF-Token": client.cookies.get("iq_csrf")}


@pytest.fixture
def env():
    with control_session() as s:
        db_identifier = s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().db_identifier
        account = s.execute(select(Account).where(Account.login_id == SEED_LOGIN)).scalars().one()
    with get_tenant_session(db_identifier) as ts:
        user_id = get_user_by_account(ts, account.id).id
    group_id, other_id = uuid.uuid4(), uuid.uuid4()
    quests: list[uuid.UUID] = []
    with get_tenant_session(db_identifier) as ts:
        ts.add(QuestGroup(id=group_id, quest_group_code=f"QG-{uuid.uuid4().hex[:6].upper()}", name="G"))
        ts.add(User(id=other_id, account_id=uuid.uuid4(), display_name="Other", locale="ja", status="active"))
        ts.commit()

    def make_quest(*, owner=None, status="evaluating", seed_perms=None) -> uuid.UUID:
        qid = uuid.uuid4()
        the_owner = owner or user_id
        with get_tenant_session(db_identifier) as ts:
            quests_repo.create_quest(ts, quest_id=qid, owner_id=the_owner, title="Q", color="#3B82F6", status=status)
            quests_repo.add_member(ts, qid, the_owner, permissions=["owner"])
            if the_owner != user_id:
                quests_repo.add_member(ts, qid, user_id, permissions=seed_perms or ["evaluator", "vote"])
            ts.commit()
        quests.append(qid)
        return qid

    def seed_active_concept(qid, *, author=None) -> uuid.UUID:
        cid = uuid.uuid4()
        with get_tenant_session(db_identifier) as ts:
            c = repo.create_concept(ts, quest_id=qid, author_id=author or user_id, title="C")
            c.status = "active"
            cid = c.id
            repo.create_chat_scope(ts, concept_id=cid, kind="overall", position=0)
            ts.commit()
        return cid

    def seed_eval(cid, evaluator, *, recommendation, visibility="party", score=4):
        with get_tenant_session(db_identifier) as ts:
            ev, _ = repo.upsert_evaluation(ts, cid, evaluator, overall_comment="x", recommendation=recommendation,
                                           status="submitted", visibility=visibility)
            repo.replace_scores(ts, ev.id, [(a, score, None) for a in CORE])
            ts.commit()

    yield SimpleNamespace(db_identifier=db_identifier, user_id=user_id, other_id=other_id,
                          make_quest=make_quest, seed_active_concept=seed_active_concept, seed_eval=seed_eval, quests=quests)

    with get_tenant_session(db_identifier) as ts:
        cids = [c.id for c in ts.query(Concept).filter(Concept.quest_id.in_(quests or [uuid.uuid4()])).all()]
        aids = [a.id for a in ts.query(Assumption).filter(Assumption.quest_id.in_(quests or [uuid.uuid4()])).all()]
        eids = [e.id for e in ts.query(ConceptEvaluation).filter(ConceptEvaluation.concept_id.in_(cids or [uuid.uuid4()])).all()]
        ts.execute(Activity.__table__.delete().where(Activity.ref_type == "concepts", Activity.ref_id.in_(cids or [uuid.uuid4()])))
        if eids:
            ts.execute(ConceptEvaluationScore.__table__.delete().where(ConceptEvaluationScore.concept_evaluation_id.in_(eids)))
        ts.execute(ConceptEvaluation.__table__.delete().where(ConceptEvaluation.concept_id.in_(cids or [uuid.uuid4()])))
        ts.execute(ConceptVote.__table__.delete().where(ConceptVote.concept_id.in_(cids or [uuid.uuid4()])))
        ts.execute(ConceptChatScope.__table__.delete().where(ConceptChatScope.concept_id.in_(cids or [uuid.uuid4()])))
        ts.execute(ConceptAssumptionLink.__table__.delete().where(ConceptAssumptionLink.assumption_id.in_(aids or [uuid.uuid4()])))
        ts.execute(AssumptionValidation.__table__.delete().where(AssumptionValidation.assumption_id.in_(aids or [uuid.uuid4()])))
        ts.execute(Assumption.__table__.delete().where(Assumption.quest_id.in_(quests or [uuid.uuid4()])))
        ts.execute(ConceptRevision.__table__.delete().where(ConceptRevision.concept_id.in_(cids or [uuid.uuid4()])))
        ts.execute(ConceptDecisionLog.__table__.delete().where(ConceptDecisionLog.concept_id.in_(cids or [uuid.uuid4()])))
        ts.execute(Concept.__table__.delete().where(Concept.quest_id.in_(quests or [uuid.uuid4()])))
        for qid in quests:
            ts.execute(QuestMemberPermission.__table__.delete().where(
                QuestMemberPermission.quest_member_id.in_(select(QuestMember.id).where(QuestMember.quest_id == qid))))
            ts.execute(QuestMember.__table__.delete().where(QuestMember.quest_id == qid))
            ts.execute(Quest.__table__.delete().where(Quest.id == qid))
        ts.execute(User.__table__.delete().where(User.id == other_id))
        ts.execute(QuestGroup.__table__.delete().where(QuestGroup.id == group_id))
        ts.commit()


def _login_seed(client):
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)


def _active_concept(client, qid) -> str:
    cid = client.post(f"/api/v1/quests/{qid}/concepts", json={"title": "C"}, headers=_csrf(client)).json()["id"]
    client.post(f"/api/v1/concepts/{cid}/activate", headers=_csrf(client))
    return cid


def _full_submit(**over):
    body = {"scores": {a: 4 for a in CORE}, "overall_comment": "総評", "recommendation": "go", "status": "submitted"}
    body.update(over)
    return body


def test_p_tc_401_get_me_empty(env, client):
    """P-TC-401: 未作成は空（status=null）。"""
    _login_seed(client)
    cid = _active_concept(client, env.make_quest())
    r = client.get(f"/api/v1/concepts/{cid}/evaluation/me")
    assert r.status_code == 200 and r.json()["status"] is None


def test_p_tc_402_draft_save(env, client):
    """P-TC-402: 下書き保存（部分可）・読み戻せる。"""
    _login_seed(client)
    cid = _active_concept(client, env.make_quest())
    r = client.put(f"/api/v1/concepts/{cid}/evaluation",
                   json={"scores": {"desirability": 3}, "status": "draft"}, headers=_csrf(client))
    assert r.status_code == 200 and r.json()["status"] == "draft"
    assert client.get(f"/api/v1/concepts/{cid}/evaluation/me").json()["scores"]["desirability"] == 3


def test_p_tc_403_submit_full(env, client):
    """P-TC-403: 確定（中核5＋総評＋推奨）→ submitted・submitted_at。"""
    _login_seed(client)
    cid = _active_concept(client, env.make_quest())
    r = client.put(f"/api/v1/concepts/{cid}/evaluation", json=_full_submit(), headers=_csrf(client))
    assert r.status_code == 200 and r.json()["status"] == "submitted" and r.json()["submitted_at"] is not None


def test_p_tc_404_submit_missing_required(env, client):
    """P-TC-404: 中核欠け／総評空／推奨欠けは 422。"""
    _login_seed(client)
    cid = _active_concept(client, env.make_quest())
    put = lambda b: client.put(f"/api/v1/concepts/{cid}/evaluation", json=b, headers=_csrf(client))  # noqa: E731
    assert put(_full_submit(scores={"desirability": 4})).status_code == 422  # 中核欠け
    assert put(_full_submit(overall_comment="")).status_code == 422  # 総評空
    assert put(_full_submit(recommendation=None)).status_code == 422  # 推奨欠け


def test_p_tc_405_score_out_of_range(env, client):
    """P-TC-405: スコア範囲外（6）は 422。"""
    _login_seed(client)
    cid = _active_concept(client, env.make_quest())
    body = _full_submit()
    body["scores"]["desirability"] = 6
    r = client.put(f"/api/v1/concepts/{cid}/evaluation", json=body, headers=_csrf(client))
    assert r.status_code == 422


def test_p_tc_406_aux_optional(env, client):
    """P-TC-406: 補助3は任意（中核5のみで確定可）。"""
    _login_seed(client)
    cid = _active_concept(client, env.make_quest())
    r = client.put(f"/api/v1/concepts/{cid}/evaluation", json=_full_submit(), headers=_csrf(client))
    assert r.status_code == 200


def test_p_tc_407_aggregate_two_evaluators(env, client):
    """P-TC-407: 集計（観点別平均・中核5総合・推奨分布・評価者数）。"""
    _login_seed(client)
    qid = env.make_quest()
    cid = _active_concept(client, qid)
    env.seed_eval(cid, env.other_id, recommendation="pivot", score=2)  # 他評価者
    client.put(f"/api/v1/concepts/{cid}/evaluation", json=_full_submit(), headers=_csrf(client))  # 自分 go/4
    agg = client.get(f"/api/v1/concepts/{cid}/evaluation").json()
    assert agg["evaluator_count"] == 2
    assert agg["aspects"]["desirability"] == 3.0 and agg["overall_avg"] == 3.0
    assert agg["recommendations"] == {"go": 1, "pivot": 1}


def test_p_tc_408_limited_hidden_from_outsider(env, client):
    """P-TC-408: limited は範囲外（非 manager/非 author/非当該評価者）に完全非表示。"""
    _login_seed(client)
    q_other = env.make_quest(owner=env.other_id, seed_perms=["evaluator", "vote"])
    cid = env.seed_active_concept(q_other, author=env.other_id)  # author=other・seed は非 author/非 manager
    env.seed_eval(cid, env.other_id, recommendation="go", visibility="limited")  # 範囲外に隠す
    client.put(f"/api/v1/concepts/{cid}/evaluation", json=_full_submit(), headers=_csrf(client))  # seed の party
    agg = client.get(f"/api/v1/concepts/{cid}/evaluation").json()
    assert agg["evaluator_count"] == 1  # seed の party のみ可視
    assert all(ev["evaluator_id"] != str(env.other_id) for ev in agg["evaluators"])


def test_p_tc_409_put_requires_evaluator(env, client):
    """P-TC-409: 評価入力は evaluator 権限必須（403）。"""
    _login_seed(client)
    q = env.make_quest(owner=env.other_id, seed_perms=["vote"])  # seed は vote のみ（evaluator でない）
    cid = env.seed_active_concept(q, author=env.other_id)
    r = client.put(f"/api/v1/concepts/{cid}/evaluation", json=_full_submit(), headers=_csrf(client))
    assert r.status_code == 403


def test_p_tc_410_stale_signal_after_refute(env, client):
    """P-TC-410: リンク前提の反証で集計に stale（要再評価）シグナル。"""
    _login_seed(client)
    qid = env.make_quest()
    cid = _active_concept(client, qid)
    aid = client.post(f"/api/v1/quests/{qid}/assumptions", json={"statement": "s"}, headers=_csrf(client)).json()["id"]
    client.post(f"/api/v1/concepts/{cid}/assumptions", json={"assumption_id": aid}, headers=_csrf(client))
    client.post(f"/api/v1/assumptions/{aid}/validations",
                json={"method": "m", "verdict": "refuted", "validated_on": "2026-03-01"}, headers=_csrf(client))
    assert client.get(f"/api/v1/concepts/{cid}/evaluation").json()["stale"] is True


def test_p_tc_451_vote_toggle(env, client):
    """P-TC-451: 投票（賛成→反対 切替・集計）。"""
    _login_seed(client)
    cid = _active_concept(client, env.make_quest())
    r = client.post(f"/api/v1/concepts/{cid}/vote", json={"type": "approve"}, headers=_csrf(client))
    assert r.status_code == 200 and r.json()["my_vote"] == "approve" and r.json()["summary"]["approve"] == 1
    r2 = client.post(f"/api/v1/concepts/{cid}/vote", json={"type": "oppose"}, headers=_csrf(client))
    assert r2.json()["summary"] == {"approve": 0, "oppose": 1}


def test_p_tc_452_unvote(env, client):
    """P-TC-452: 取消。"""
    _login_seed(client)
    cid = _active_concept(client, env.make_quest())
    client.post(f"/api/v1/concepts/{cid}/vote", json={"type": "approve"}, headers=_csrf(client))
    r = client.delete(f"/api/v1/concepts/{cid}/vote", headers=_csrf(client))
    assert r.status_code == 200 and r.json()["my_vote"] is None and r.json()["summary"]["approve"] == 0


def test_p_tc_453_454_xp_first_only(env, client):
    """P-TC-453/454: XP+5 は各コンセプト初回のみ・応答 xp_delta（切替/取消再投票で 0）。"""
    _login_seed(client)
    cid = _active_concept(client, env.make_quest())
    first = client.post(f"/api/v1/concepts/{cid}/vote", json={"type": "approve"}, headers=_csrf(client)).json()
    assert first["xp_awarded"] is True and first["xp_delta"] == 5
    switched = client.post(f"/api/v1/concepts/{cid}/vote", json={"type": "oppose"}, headers=_csrf(client)).json()
    assert switched["xp_delta"] == 0
    client.delete(f"/api/v1/concepts/{cid}/vote", headers=_csrf(client))
    revote = client.post(f"/api/v1/concepts/{cid}/vote", json={"type": "approve"}, headers=_csrf(client)).json()
    assert revote["xp_delta"] == 0  # 冪等（exists_ref）＝トグル稼ぎ防止


def test_p_tc_455_vote_csrf_unauth(env, client):
    """P-TC-455: 投票の CSRF 必須（403）・未認証（401）。"""
    _login_seed(client)
    cid = _active_concept(client, env.make_quest())
    assert client.post(f"/api/v1/concepts/{cid}/vote", json={"type": "approve"}).status_code == 403
    client.cookies.clear()
    assert client.post(f"/api/v1/concepts/{cid}/vote", json={"type": "approve"}).status_code == 401
