"""P-TC-201〜207 / 301〜304: 前提＝検証プール（P.3）＋コンセプト↔前提リンク（P.4）・反証波及（P.7）。

seed 一般ユーザー（ACME-01）でログイン。前提の作成/検証/編集はプール所有（owner/quest_admin）。リンクは作成者/manager。
verdict=refuted で反証波及＝リンク先の全リンクが要再評価(stale)。teardown で作成データを物理削除。
"""
from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.control_plane.auth.orm import Account, Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.concepts.orm import (
    ConceptDecisionLog,
    ConceptRevision,
    Assumption,
    AssumptionValidation,
    Concept,
    ConceptAssumptionLink,
    ConceptChatScope,
    ConceptSourceIdea,
)
from app.tenant.profile.orm import User
from app.tenant.profile.repository import get_user_by_account
from app.tenant.quest_group.orm import QuestGroup
from app.tenant.quests import repository as quests_repo
from app.tenant.quests.orm import Quest, QuestMember, QuestMemberPermission
from tests.admin.test_admin_accounts import _login
from tests.conftest import SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD


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
                quests_repo.add_member(ts, qid, user_id, permissions=seed_perms or ["vote"])
            ts.commit()
        quests.append(qid)
        return qid

    yield SimpleNamespace(db_identifier=db_identifier, user_id=user_id, other_id=other_id, make_quest=make_quest, quests=quests)

    with get_tenant_session(db_identifier) as ts:
        cids = [c.id for c in ts.query(Concept).filter(Concept.quest_id.in_(quests or [uuid.uuid4()])).all()]
        aids = [a.id for a in ts.query(Assumption).filter(Assumption.quest_id.in_(quests or [uuid.uuid4()])).all()]
        ts.execute(ConceptChatScope.__table__.delete().where(ConceptChatScope.concept_id.in_(cids or [uuid.uuid4()])))
        ts.execute(ConceptAssumptionLink.__table__.delete().where(ConceptAssumptionLink.assumption_id.in_(aids or [uuid.uuid4()])))
        ts.execute(AssumptionValidation.__table__.delete().where(AssumptionValidation.assumption_id.in_(aids or [uuid.uuid4()])))
        ts.execute(ConceptSourceIdea.__table__.delete().where(ConceptSourceIdea.concept_id.in_(cids or [uuid.uuid4()])))
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


def _concept(client, qid) -> str:
    return client.post(f"/api/v1/quests/{qid}/concepts", json={"title": "C"}, headers=_csrf(client)).json()["id"]


def _assumption(client, qid, statement="市場がある") -> str:
    r = client.post(f"/api/v1/quests/{qid}/assumptions", json={"statement": statement}, headers=_csrf(client))
    return r.json()["id"]


def _validate(client, aid, verdict, on="2026-03-01", method="interview"):
    return client.post(f"/api/v1/assumptions/{aid}/validations",
                       json={"method": method, "verdict": verdict, "validated_on": on}, headers=_csrf(client))


def test_p_tc_257_link_validation_bump_concept_revision(env, client):
    """P-TC-257: 前提リンク・実績（検証）・解除でコンセプトの版が増える（版管理・§4.4・assumptions フィールド）。"""
    _login_seed(client)
    qid = env.make_quest()
    cid = _concept(client, qid)
    aid = _assumption(client, qid, "想定顧客は月1回この課題に直面する")
    # リンク → 版2（assumptions 変化＝どの前提が紐づいたかを版に残す）。
    r = client.post(f"/api/v1/concepts/{cid}/assumptions", json={"assumption_id": aid, "criticality": "major"}, headers=_csrf(client))
    assert r.status_code == 201, r.text
    data = client.get(f"/api/v1/concepts/{cid}/revisions").json()["data"]
    assert data[0]["revision"] == 2 and "assumptions" in data[0]["changed_fields"]
    # 実績（反証）→ 判定が保留→反証に変化して版3。
    v = _validate(client, aid, "refuted", on="2026-09-26")
    assert v.status_code == 201, v.text
    data2 = client.get(f"/api/v1/concepts/{cid}/revisions").json()["data"]
    assert data2[0]["revision"] == 3 and "assumptions" in data2[0]["changed_fields"]
    # リンク解除 → 版4。
    u = client.delete(f"/api/v1/concepts/{cid}/assumptions/{aid}", headers=_csrf(client))
    assert u.status_code == 204, u.text
    data3 = client.get(f"/api/v1/concepts/{cid}/revisions").json()["data"]
    assert data3[0]["revision"] == 4 and "assumptions" in data3[0]["changed_fields"]


def test_p_tc_258_validation_edit_delete_versioned(env, client):
    """P-TC-258: 実績（検証）の編集/削除が可能で、判定変化がコンセプトの版に記録される（編集可＋版管理・ユーザー決定 2026-09-26）。"""
    _login_seed(client)
    qid = env.make_quest()
    cid = _concept(client, qid)
    aid = _assumption(client, qid, "顧客は課金に前向き")
    client.post(f"/api/v1/concepts/{cid}/assumptions", json={"assumption_id": aid, "criticality": "major"}, headers=_csrf(client))  # rev2
    v0 = _validate(client, aid, "supported", on="2026-09-01").json()["validation"]  # rev3（保留→支持）
    vid = v0["id"]
    # 判定を変えず「規模だけ」修正でもコンセプト版が増える（＝ユーザー報告のバグ回帰）。
    r0 = client.patch(f"/api/v1/assumptions/{aid}/validations/{vid}",
                      json={"method": v0["method"], "verdict": "supported", "validated_on": "2026-09-01", "scale": "n=99"}, headers=_csrf(client))
    assert r0.status_code == 200, r0.text
    data0 = client.get(f"/api/v1/concepts/{cid}/revisions").json()["data"]
    assert data0[0]["revision"] == 4 and "assumptions" in data0[0]["changed_fields"]
    # 編集（支持→反証）＝判定変化でも版が増える
    r = client.patch(f"/api/v1/assumptions/{aid}/validations/{vid}",
                     json={"method": "再確認", "verdict": "refuted", "validated_on": "2026-09-02", "scale": "n=30"}, headers=_csrf(client))
    assert r.status_code == 200, r.text
    assert r.json()["current_verdict"] == "refuted"
    data = client.get(f"/api/v1/concepts/{cid}/revisions").json()["data"]
    assert data[0]["revision"] == 5 and "assumptions" in data[0]["changed_fields"]
    # 削除＝検証0件で判定が保留に戻り版が増える
    d = client.delete(f"/api/v1/assumptions/{aid}/validations/{vid}", headers=_csrf(client))
    assert d.status_code == 204, d.text
    data2 = client.get(f"/api/v1/concepts/{cid}/revisions").json()["data"]
    assert data2[0]["revision"] == 6 and "assumptions" in data2[0]["changed_fields"]


def test_p_tc_202_create_assumption_permission(env, client):
    """P-TC-202: 前提作成は プール所有=201 inconclusive／非 manager=403。"""
    _login_seed(client)
    qid = env.make_quest()
    r = client.post(f"/api/v1/quests/{qid}/assumptions", json={"statement": "s"}, headers=_csrf(client))
    assert r.status_code == 201 and r.json()["current_verdict"] == "inconclusive"
    q_other = env.make_quest(owner=env.other_id, seed_perms=["vote"])
    r2 = client.post(f"/api/v1/quests/{q_other}/assumptions", json={"statement": "s"}, headers=_csrf(client))
    assert r2.status_code == 403


def test_p_tc_201_list_pool(env, client):
    """P-TC-201: 検証プール一覧＝要約列（判定/検証件数/リンク数/最終検証日）。"""
    _login_seed(client)
    qid = env.make_quest()
    aid = _assumption(client, qid)
    _validate(client, aid, "supported", on="2026-02-10")
    r = client.get(f"/api/v1/quests/{qid}/assumptions")
    item = next(it for it in r.json()["items"] if it["id"] == aid)
    assert item["current_verdict"] == "supported" and item["validation_count"] == 1
    assert item["latest_validated_on"] == "2026-02-10" and item["linked_concept_count"] == 0


def test_p_tc_203_validation_required_fields(env, client):
    """P-TC-203: 検証追記の必須（validated_on 欠落）は 422。"""
    _login_seed(client)
    qid = env.make_quest()
    aid = _assumption(client, qid)
    r = client.post(f"/api/v1/assumptions/{aid}/validations",
                    json={"method": "m", "verdict": "supported"}, headers=_csrf(client))
    assert r.status_code == 422


def test_p_tc_204_add_validation_recompute(env, client):
    """P-TC-204: 検証追記→current_verdict=最新・履歴は実施日降順。"""
    _login_seed(client)
    qid = env.make_quest()
    aid = _assumption(client, qid)
    _validate(client, aid, "supported", on="2026-01-10")
    r = _validate(client, aid, "refuted", on="2026-03-20")
    assert r.status_code == 201 and r.json()["current_verdict"] == "refuted"
    hist = client.get(f"/api/v1/assumptions/{aid}/validations").json()["items"]
    assert [h["verdict"] for h in hist] == ["refuted", "supported"]


def test_p_tc_205_assumption_detail(env, client):
    """P-TC-205: 前提詳細＝検証履歴＋リンク先＋related_info＋my_permissions。"""
    _login_seed(client)
    qid = env.make_quest()
    aid = _assumption(client, qid)
    cid = _concept(client, qid)
    client.post(f"/api/v1/concepts/{cid}/assumptions", json={"assumption_id": aid}, headers=_csrf(client))
    _validate(client, aid, "supported")
    body = client.get(f"/api/v1/assumptions/{aid}").json()
    assert len(body["validations"]) == 1
    assert body["linked_concepts"][0]["concept_id"] == cid
    assert "related_info" in body and "curate" in body["my_permissions"]


def test_p_tc_206_delete_blocked_when_linked(env, client):
    """P-TC-206: リンク中の前提削除は 409／解除後は 204。"""
    _login_seed(client)
    qid = env.make_quest()
    aid = _assumption(client, qid)
    cid = _concept(client, qid)
    client.post(f"/api/v1/concepts/{cid}/assumptions", json={"assumption_id": aid}, headers=_csrf(client))
    r = client.delete(f"/api/v1/assumptions/{aid}", headers=_csrf(client))
    assert r.status_code == 409
    client.delete(f"/api/v1/concepts/{cid}/assumptions/{aid}", headers=_csrf(client))
    r2 = client.delete(f"/api/v1/assumptions/{aid}", headers=_csrf(client))
    assert r2.status_code == 204


def test_p_tc_207_refute_propagates_stale(env, client):
    """P-TC-207: 反証波及＝リンク先の全コンセプトが要再評価(stale)・応答に波及先。"""
    _login_seed(client)
    qid = env.make_quest()
    aid = _assumption(client, qid)
    c1, c2 = _concept(client, qid), _concept(client, qid)
    for cid in (c1, c2):
        client.post(f"/api/v1/concepts/{cid}/assumptions", json={"assumption_id": aid}, headers=_csrf(client))
    r = _validate(client, aid, "refuted")
    assert set(r.json()["stale_concept_ids"]) == {c1, c2}
    for cid in (c1, c2):
        detail = client.get(f"/api/v1/concepts/{cid}").json()
        link = next(a for a in detail["assumptions"] if a["assumption_id"] == aid)
        assert link["is_stale"] is True and link["current_verdict"] == "refuted"


def test_p_tc_301_link_creates_assumption_scope(env, client):
    """P-TC-301: リンク（重要度付き）＝201・前提スレッド（assumption スコープ）生成。"""
    _login_seed(client)
    qid = env.make_quest()
    aid = _assumption(client, qid)
    cid = _concept(client, qid)
    r = client.post(f"/api/v1/concepts/{cid}/assumptions",
                    json={"assumption_id": aid, "criticality": "critical"}, headers=_csrf(client))
    assert r.status_code == 201 and r.json()["criticality"] == "critical"
    detail = client.get(f"/api/v1/concepts/{cid}").json()
    assert any(s["kind"] == "assumption" and s["assumption_id"] == aid for s in detail["chat_scopes"])


def test_p_tc_302_link_other_quest_rejected(env, client):
    """P-TC-302: 他クエストの前提はリンク不可（422）。"""
    _login_seed(client)
    q1, q2 = env.make_quest(), env.make_quest()
    aid_other = _assumption(client, q2)
    cid = _concept(client, q1)
    r = client.post(f"/api/v1/concepts/{cid}/assumptions", json={"assumption_id": aid_other}, headers=_csrf(client))
    assert r.status_code == 422


def test_p_tc_303_patch_link(env, client):
    """P-TC-303: 重要度変更／stale 解除。"""
    _login_seed(client)
    qid = env.make_quest()
    aid = _assumption(client, qid)
    cid = _concept(client, qid)
    client.post(f"/api/v1/concepts/{cid}/assumptions", json={"assumption_id": aid}, headers=_csrf(client))
    r = client.patch(f"/api/v1/concepts/{cid}/assumptions/{aid}",
                     json={"criticality": "minor", "is_stale": False}, headers=_csrf(client))
    assert r.status_code == 200 and r.json()["criticality"] == "minor" and r.json()["is_stale"] is False


def test_p_tc_304_unlink(env, client):
    """P-TC-304: リンク解除（前提本体は残す）・前提スレッドも除去。"""
    _login_seed(client)
    qid = env.make_quest()
    aid = _assumption(client, qid)
    cid = _concept(client, qid)
    client.post(f"/api/v1/concepts/{cid}/assumptions", json={"assumption_id": aid}, headers=_csrf(client))
    r = client.delete(f"/api/v1/concepts/{cid}/assumptions/{aid}", headers=_csrf(client))
    assert r.status_code == 204
    detail = client.get(f"/api/v1/concepts/{cid}").json()
    assert all(a["assumption_id"] != aid for a in detail["assumptions"])
    assert not any(s["kind"] == "assumption" and s["assumption_id"] == aid for s in detail["chat_scopes"])
    # 前提本体は残る（単一ソース）
    assert client.get(f"/api/v1/assumptions/{aid}").status_code == 200
