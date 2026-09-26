"""P-TC-101〜112: コンセプト取得/登録/編集/遷移/選定/判定 API（SC-61/SC-60/SC-12・P.1/P.2）。

seed 一般ユーザー（ACME-01）でログインし、会社DB にクエスト＋パーティー参加＋権限を seed。門番（パーティー所属）
＋権限（作成者／owner・quest_admin）・状態機械・draft 可視性・CSRF を検証。teardown で作成データを物理削除。
（P-TC-111 limited 評価の可視性は評価 EP 実装スライスで追加。）
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
    Concept,
    ConceptAssumptionLink,
    ConceptChatScope,
    ConceptSourceIdea,
)
from app.tenant.ideas.orm import Idea
from app.tenant.profile.orm import User
from app.tenant.profile.repository import get_user_by_account
from app.tenant.quest_group.orm import QuestGroup
from app.tenant.quests import repository as quests_repo
from app.tenant.quests.orm import Quest, QuestMember, QuestMemberPermission
from tests.admin.test_admin_accounts import _login
from tests.conftest import SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD


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
                quests_repo.add_member(ts, qid, user_id, permissions=seed_perms or ["vote"])
            ts.commit()
        quests.append(qid)
        return qid

    def make_idea(qid, *, author=None) -> uuid.UUID:
        iid = uuid.uuid4()
        with get_tenant_session(db_identifier) as ts:
            ts.add(Idea(id=iid, quest_id=qid, author_id=author or user_id, title="I", body="b", value="v", status="published"))
            ts.commit()
        return iid

    yield SimpleNamespace(
        db_identifier=db_identifier, user_id=user_id, other_id=other_id, group_id=group_id,
        make_quest=make_quest, make_idea=make_idea, quests=quests,
    )

    with get_tenant_session(db_identifier) as ts:
        cids = [c.id for c in ts.query(Concept).filter(Concept.quest_id.in_(quests or [uuid.uuid4()])).all()]
        aids = [a.id for a in ts.query(Assumption).filter(Assumption.quest_id.in_(quests or [uuid.uuid4()])).all()]
        ts.execute(ConceptChatScope.__table__.delete().where(ConceptChatScope.concept_id.in_(cids or [uuid.uuid4()])))
        ts.execute(ConceptAssumptionLink.__table__.delete().where(ConceptAssumptionLink.assumption_id.in_(aids or [uuid.uuid4()])))
        ts.execute(ConceptSourceIdea.__table__.delete().where(ConceptSourceIdea.concept_id.in_(cids or [uuid.uuid4()])))
        ts.execute(Assumption.__table__.delete().where(Assumption.quest_id.in_(quests or [uuid.uuid4()])))
        ts.execute(ConceptRevision.__table__.delete().where(ConceptRevision.concept_id.in_(cids or [uuid.uuid4()])))
        ts.execute(ConceptDecisionLog.__table__.delete().where(ConceptDecisionLog.concept_id.in_(cids or [uuid.uuid4()])))
        ts.execute(Concept.__table__.delete().where(Concept.quest_id.in_(quests or [uuid.uuid4()])))
        ts.execute(Idea.__table__.delete().where(Idea.quest_id.in_(quests or [uuid.uuid4()])))
        for qid in quests:
            ts.execute(QuestMemberPermission.__table__.delete().where(
                QuestMemberPermission.quest_member_id.in_(select(QuestMember.id).where(QuestMember.quest_id == qid))))
            ts.execute(QuestMember.__table__.delete().where(QuestMember.quest_id == qid))
            ts.execute(Quest.__table__.delete().where(Quest.id == qid))
        ts.execute(User.__table__.delete().where(User.id == other_id))
        ts.execute(QuestGroup.__table__.delete().where(QuestGroup.id == group_id))
        ts.commit()


def _create(client, qid, **body) -> dict:
    body.setdefault("title", "C")
    r = client.post(f"/api/v1/quests/{qid}/concepts", json=body, headers=_csrf(client))
    return r


def test_p_tc_103_create_defaults_and_overall_scope(env, client):
    """P-TC-103: 作成は 201・draft・総合ルーム自動生成・作成者は詳細取得可。"""
    _login_seed(client)
    qid = env.make_quest()
    r = _create(client, qid, viability={"roi": "10%"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["status"] == "draft" and body["decision"] == "undecided" and body["is_selected"] is False
    assert any(s["kind"] == "overall" for s in body["chat_scopes"])  # 総合ルーム自動生成
    got = client.get(f"/api/v1/concepts/{body['id']}")
    assert got.status_code == 200  # 作成者は draft を取得可


def test_p_tc_102_detail_composition(env, client):
    """P-TC-102: 詳細は合成キー（source_ideas/assumptions/evaluation/chat_scopes/my_permissions）を返す。"""
    _login_seed(client)
    qid = env.make_quest()
    iid = env.make_idea(qid)
    cid = _create(client, qid, source_idea_ids=[str(iid)]).json()["id"]
    body = client.get(f"/api/v1/concepts/{cid}").json()
    for key in ("source_ideas", "assumptions", "evaluation", "chat_scopes", "my_permissions"):
        assert key in body
    assert body["source_ideas"][0]["idea_id"] == str(iid)
    assert "edit" in body["my_permissions"] and "manage" in body["my_permissions"]


def test_p_tc_101_list_includes_own_draft_excludes_others(env, client):
    """P-TC-101: 一覧は自分の draft を含み、他人の draft は除外。"""
    _login_seed(client)
    qid = env.make_quest()
    mine = _create(client, qid).json()["id"]
    with get_tenant_session(env.db_identifier) as ts:
        other_c = repo.create_concept(ts, quest_id=qid, author_id=env.other_id, title="OtherDraft")
        ts.commit()
        other_cid = str(other_c.id)
    r = client.get(f"/api/v1/quests/{qid}/concepts")
    ids = {it["id"] for it in r.json()["items"]}
    assert mine in ids and other_cid not in ids


def test_p_tc_104_source_idea_other_quest_rejected(env, client):
    """P-TC-104: 由来アイデアが他クエストのものは 422。"""
    _login_seed(client)
    q1 = env.make_quest()
    q2 = env.make_quest()
    other_idea = env.make_idea(q2)
    r = _create(client, q1, source_idea_ids=[str(other_idea)])
    assert r.status_code == 422


def test_p_tc_105_patch_updates(env, client):
    """P-TC-105: 編集（viability 更新＋由来差替）。"""
    _login_seed(client)
    qid = env.make_quest()
    i1, i2 = env.make_idea(qid), env.make_idea(qid)
    cid = _create(client, qid, source_idea_ids=[str(i1)]).json()["id"]
    r = client.patch(f"/api/v1/concepts/{cid}", json={"viability": {"roi": "20%"}, "source_idea_ids": [str(i2)]},
                     headers=_csrf(client))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["viability"] == {"roi": "20%"}
    assert [s["idea_id"] for s in body["source_ideas"]] == [str(i2)]


def test_p_tc_106_activate_permission(env, client):
    """P-TC-106: 活性化(公開)は作成者=200 active／非作成者かつ非manager=403（アイデアの publish と同型）。"""
    _login_seed(client)
    # 正: 自分が作成した draft は自分で公開できる（owner でも author でも可）
    q_own = env.make_quest()
    cid = _create(client, q_own).json()["id"]
    r = client.post(f"/api/v1/concepts/{cid}/activate", headers=_csrf(client))
    assert r.status_code == 200 and r.json()["status"] == "active"
    # 否: 他人 owner のクエストで、他人が作成した draft を自分(vote のみ・非作成者)が公開＝403
    q_other = env.make_quest(owner=env.other_id, seed_perms=["vote"])
    with get_tenant_session(env.db_identifier) as ts:
        other_c = repo.create_concept(ts, quest_id=q_other, author_id=env.other_id, title="OtherDraft")
        ts.commit()
        cid2 = str(other_c.id)
    r2 = client.post(f"/api/v1/concepts/{cid2}/activate", headers=_csrf(client))
    assert r2.status_code == 403


def test_p_tc_107_archive(env, client):
    """P-TC-107: 活性化→保管（archived）。"""
    _login_seed(client)
    qid = env.make_quest()
    cid = _create(client, qid).json()["id"]
    client.post(f"/api/v1/concepts/{cid}/activate", headers=_csrf(client))
    r = client.post(f"/api/v1/concepts/{cid}/archive", headers=_csrf(client))
    assert r.status_code == 200 and r.json()["status"] == "archived"


def test_p_tc_108_select_toggle(env, client):
    """P-TC-108: 選定/解除（owner・複数可）。"""
    _login_seed(client)
    qid = env.make_quest()
    cid = _create(client, qid).json()["id"]
    r = client.post(f"/api/v1/concepts/{cid}/select", headers=_csrf(client))
    assert r.status_code == 200 and r.json()["is_selected"] is True
    r2 = client.delete(f"/api/v1/concepts/{cid}/select", headers=_csrf(client))
    assert r2.status_code == 200 and r2.json()["is_selected"] is False


def test_p_tc_109_decision_permission(env, client):
    """P-TC-109: 総合判定（owner=go＋根拠／非 manager=403）。"""
    _login_seed(client)
    qid = env.make_quest()
    cid = _create(client, qid).json()["id"]
    r = client.put(f"/api/v1/concepts/{cid}/decision", json={"decision": "go", "decision_rationale": "筋が良い"},
                   headers=_csrf(client))
    assert r.status_code == 200 and r.json()["decision"] == "go"
    q_other = env.make_quest(owner=env.other_id, seed_perms=["vote"])
    cid2 = _create(client, q_other).json()["id"]
    r2 = client.put(f"/api/v1/concepts/{cid2}/decision", json={"decision": "kill"}, headers=_csrf(client))
    assert r2.status_code == 403


def test_p_tc_110_draft_hidden_from_others(env, client):
    """P-TC-110: 他人の draft は 404（存在秘匿）。"""
    _login_seed(client)
    qid = env.make_quest()
    with get_tenant_session(env.db_identifier) as ts:
        other_c = repo.create_concept(ts, quest_id=qid, author_id=env.other_id, title="OtherDraft")
        ts.commit()
        cid = str(other_c.id)
    r = client.get(f"/api/v1/concepts/{cid}")
    assert r.status_code == 404


def test_p_tc_112_csrf_and_unauth(env, client):
    """P-TC-112: 変更系は CSRF 必須（403）・未認証は 401。"""
    _login_seed(client)
    qid = env.make_quest()
    # CSRF なし
    r = client.post(f"/api/v1/quests/{qid}/concepts", json={"title": "C"})
    assert r.status_code == 403
    # 未認証
    client.cookies.clear()
    r2 = client.post(f"/api/v1/quests/{qid}/concepts", json={"title": "C"})
    assert r2.status_code == 401
