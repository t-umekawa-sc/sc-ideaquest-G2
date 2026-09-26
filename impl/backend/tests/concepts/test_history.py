"""P-TC-250〜256: コンセプトの変更履歴（内容の版＋意思決定ログ・変更履歴標準 §3.1/§3.2・migration 0037）。

作成で初版・内容編集で版増・空更新は版なし・版差分・判断材料スナップ・総合判定/ステータスの意思決定ログ・門番。
seed ユーザーはクエスト owner（総合判定/活性化＝owner/quest_admin）。teardown で作成データを物理削除。
"""
from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.control_plane.auth.orm import Account, Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.main import app
from app.tenant.concepts.orm import (
    Concept,
    ConceptChatScope,
    ConceptDecisionLog,
    ConceptRevision,
)
from app.tenant.profile.orm import User
from app.tenant.profile.repository import get_user_by_account
from app.tenant.quests import repository as quests_repo
from app.tenant.quests.orm import Quest, QuestMember, QuestMemberPermission
from tests.conftest import SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD
from tests.admin.test_admin_accounts import _login


def _csrf(client) -> dict:
    return {"X-CSRF-Token": client.cookies.get("iq_csrf")}


@pytest.fixture
def client():
    with TestClient(app) as c:
        _login(c, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
        yield c


@pytest.fixture
def env():
    with control_session() as s:
        db_identifier = s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().db_identifier
        account = s.execute(select(Account).where(Account.login_id == SEED_LOGIN)).scalars().one()
    with get_tenant_session(db_identifier) as ts:
        user_id = get_user_by_account(ts, account.id).id
    other_id = uuid.uuid4()
    with get_tenant_session(db_identifier) as ts:
        ts.add(User(id=other_id, account_id=uuid.uuid4(), display_name="Other", locale="ja", status="active"))
        ts.commit()
    quests: list[uuid.UUID] = []

    def make_quest(*, owner=None) -> uuid.UUID:
        qid = uuid.uuid4()
        with get_tenant_session(db_identifier) as ts:
            quests_repo.create_quest(ts, quest_id=qid, owner_id=owner or user_id, title="Q", color="#3B82F6", status="evaluating")
            quests_repo.add_member(ts, qid, owner or user_id, permissions=["owner", "comment", "vote"])
            ts.commit()
        quests.append(qid)
        return qid

    yield SimpleNamespace(db_identifier=db_identifier, user_id=user_id, other_id=other_id, make_quest=make_quest, quests=quests)

    with get_tenant_session(db_identifier) as ts:
        cids = [c.id for c in ts.query(Concept).filter(Concept.quest_id.in_(quests or [uuid.uuid4()])).all()]
        ts.execute(ConceptRevision.__table__.delete().where(ConceptRevision.concept_id.in_(cids or [uuid.uuid4()])))
        ts.execute(ConceptDecisionLog.__table__.delete().where(ConceptDecisionLog.concept_id.in_(cids or [uuid.uuid4()])))
        ts.execute(ConceptChatScope.__table__.delete().where(ConceptChatScope.concept_id.in_(cids or [uuid.uuid4()])))
        ts.execute(Concept.__table__.delete().where(Concept.quest_id.in_(quests or [uuid.uuid4()])))
        for qid in quests:
            ts.execute(QuestMemberPermission.__table__.delete().where(
                QuestMemberPermission.quest_member_id.in_(select(QuestMember.id).where(QuestMember.quest_id == qid))))
            ts.execute(QuestMember.__table__.delete().where(QuestMember.quest_id == qid))
            ts.execute(Quest.__table__.delete().where(Quest.id == qid))
        ts.execute(User.__table__.delete().where(User.id == other_id))
        ts.commit()


def _create(client, qid, **body) -> str:
    body.setdefault("title", "C1")
    r = client.post(f"/api/v1/quests/{qid}/concepts", json=body, headers=_csrf(client))
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_p_tc_250_initial_and_edit_bump(env, client):
    """P-TC-250: 作成で初版・内容編集で版が増える（新しい順・changed_fields）。"""
    cid = _create(client, env.make_quest(), title="旧タイトル")
    client.patch(f"/api/v1/concepts/{cid}", json={"title": "新タイトル"}, headers=_csrf(client))
    data = client.get(f"/api/v1/concepts/{cid}/revisions").json()["data"]
    assert [r["revision"] for r in data] == [2, 1]  # 新しい順
    assert data[1]["changed_fields"] == []  # 初版
    assert "title" in data[0]["changed_fields"]


def test_p_tc_251_empty_update_no_bump(env, client):
    """P-TC-251: 内容が変わらない更新は版を進めない（既存仕様踏襲）。"""
    cid = _create(client, env.make_quest(), title="同じ")
    client.patch(f"/api/v1/concepts/{cid}", json={"title": "同じ"}, headers=_csrf(client))  # 同値
    data = client.get(f"/api/v1/concepts/{cid}/revisions").json()["data"]
    assert [r["revision"] for r in data] == [1]  # 初版のみ


def test_p_tc_252_revision_diff(env, client):
    """P-TC-252: 版差分（前版比較・title は text segments）。"""
    cid = _create(client, env.make_quest(), title="AAA")
    client.patch(f"/api/v1/concepts/{cid}", json={"title": "AAB"}, headers=_csrf(client))
    diff = client.get(f"/api/v1/concepts/{cid}/revisions/2/diff").json()
    assert diff["from_revision"] == 1 and diff["to_revision"] == 2
    assert diff["fields"]["title"]["kind"] == "text"
    assert diff["fields"]["title"]["segments"]


def test_p_tc_253_context_snapshot(env, client):
    """P-TC-253: 各版に判断材料スナップショット（投票/評価/前提）を凍結。"""
    cid = _create(client, env.make_quest())
    data = client.get(f"/api/v1/concepts/{cid}/revisions").json()["data"]
    ctx = data[0]["context_snapshot"]
    assert set(ctx.keys()) == {"votes", "eval", "assumptions"}
    assert set(ctx["votes"].keys()) == {"approve", "oppose"}
    assert set(ctx["assumptions"].keys()) == {"supported", "refuted", "inconclusive"}


def test_p_tc_254_decision_log(env, client):
    """P-TC-254: 総合判定の意思決定ログ（kind=decision・from/to・reason・材料凍結）。"""
    qid = env.make_quest()
    cid = _create(client, qid)
    client.post(f"/api/v1/concepts/{cid}/activate", headers=_csrf(client))
    r = client.put(f"/api/v1/concepts/{cid}/decision", json={"decision": "go", "decision_rationale": "筋が良い"}, headers=_csrf(client))
    assert r.status_code == 200, r.text
    log = client.get(f"/api/v1/concepts/{cid}/decision-log").json()["data"]
    dec = [e for e in log if e["kind"] == "decision"]
    assert dec and dec[0]["from_value"] == "undecided" and dec[0]["to_value"] == "go"
    assert dec[0]["reason"] == "筋が良い" and dec[0]["context_snapshot"] is not None


def test_p_tc_255_status_log(env, client):
    """P-TC-255: ステータス遷移の意思決定ログ（kind=status・draft→active）。"""
    cid = _create(client, env.make_quest())
    client.post(f"/api/v1/concepts/{cid}/activate", headers=_csrf(client))
    log = client.get(f"/api/v1/concepts/{cid}/decision-log").json()["data"]
    st = [e for e in log if e["kind"] == "status"]
    assert st and st[0]["from_value"] == "draft" and st[0]["to_value"] == "active"


def test_p_tc_256_gatekeeper_non_party(env, client):
    """P-TC-256: 非パーティーは履歴を参照不可（404 秘匿）。"""
    qid = env.make_quest(owner=env.other_id)  # seed は非メンバー
    with get_tenant_session(env.db_identifier) as ts:
        from app.tenant.concepts import repository as repo
        c = repo.create_concept(ts, quest_id=qid, author_id=env.other_id, title="他人")
        c.status = "active"
        cid = str(c.id)
        ts.commit()
    assert client.get(f"/api/v1/concepts/{cid}/revisions").status_code == 404
    assert client.get(f"/api/v1/concepts/{cid}/decision-log").status_code == 404
