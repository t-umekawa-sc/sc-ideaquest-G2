"""参加部署アクセス門番の横断 red-green（`can_access_quest` を D/E/F/J/G で同一適用・C.0・FR-38 再設計）。

D-TC-222 / E-TC-204 / F-TC-204 / J-TC-142 / G-TC-508: 非作成者パーティー員が**全参加部署を離脱**すると、
名指しパーティー員でも各ドメインの参照が **404**（動的失効＝アクセスの都度、現所属で再判定）になることを担保する。

構成＝owner は別ユーザ（seeded）／seed ログインユーザーを参加部署 group_a の所属＋パーティー員（全権限）にし、
公開アイデアを1件置く。ベースライン（在籍中）は全 EP 200 → group_a を離脱させると全 EP 404。teardown で物理削除。
"""
from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.control_plane.auth.orm import Account, Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.ideas.orm import Idea
from app.tenant.profile.orm import User
from app.tenant.profile.repository import get_user_by_account
from app.tenant.quest_group import repository as qg_repo
from app.tenant.quest_group.orm import QuestGroup, QuestGroupMember
from app.tenant.quests import repository as repo
from app.tenant.quests.orm import (
    Quest,
    QuestCategory,
    QuestGroupLink,
    QuestMember,
    QuestMemberPermission,
)
from tests.admin.test_admin_accounts import _login
from tests.conftest import SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD

API = "/api/v1"


def _login_seed(client) -> None:
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)


@pytest.fixture
def gate_env():
    with control_session() as s:
        db_identifier = s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().db_identifier
        account = s.execute(select(Account).where(Account.login_id == SEED_LOGIN)).scalars().one()
    with get_tenant_session(db_identifier) as ts:
        seed_user = get_user_by_account(ts, account.id)
        assert seed_user is not None
        seed_uid = seed_user.id

    group_a = uuid.uuid4()
    owner_uid = uuid.uuid4()  # 別ユーザ（owner・seeded・非ログイン）
    quest_id = uuid.uuid4()
    idea_id = uuid.uuid4()

    with get_tenant_session(db_identifier) as ts:
        ts.add(User(id=owner_uid, account_id=uuid.uuid4(), display_name="Owner", locale="ja", status="active"))
        ts.add(QuestGroup(id=group_a, quest_group_code=f"QG-{uuid.uuid4().hex[:6].upper()}", name="Gate Dept"))
        ts.flush()
        qg_repo.upsert_membership(ts, group_a, owner_uid)
        qg_repo.upsert_membership(ts, group_a, seed_uid)   # seed user は group_a 所属（在籍中）
        repo.create_quest(ts, quest_id=quest_id, owner_id=owner_uid,
                          title="Gate Quest", color="#3B82F6", status="in_progress")
        repo.replace_categories(ts, quest_id, [("UX", False)])
        repo.create_group_links(ts, quest_id, group_ids=[group_a])   # 参加部署＝group_a（1件）
        repo.add_member(ts, quest_id, owner_uid, permissions=["owner"])
        # seed user を全権限のパーティー員に（idea_create/comment/evaluator/vote）。
        repo.add_member(ts, quest_id, seed_uid,
                        permissions=["idea_create", "comment", "evaluator", "vote"])
        ts.add(Idea(id=idea_id, quest_id=quest_id, author_id=owner_uid,
                    title="Gate Idea", body="body", value="value", status="published"))
        ts.commit()

    yield SimpleNamespace(
        db_identifier=db_identifier, seed_uid=seed_uid, owner_uid=owner_uid,
        group_a=group_a, quest_id=quest_id, idea_id=idea_id,
    )

    with get_tenant_session(db_identifier) as ts:
        # GET /ideas/{id}/chat がチャットグループを自動生成するため、アイデアより先に消す。
        from app.tenant.chat.orm import ChatGroup
        ts.execute(ChatGroup.__table__.delete().where(ChatGroup.idea_id == idea_id))
        ts.execute(Idea.__table__.delete().where(Idea.id == idea_id))
        mids = list(ts.execute(select(QuestMember.id).where(QuestMember.quest_id == quest_id)).scalars())
        if mids:
            ts.execute(QuestMemberPermission.__table__.delete().where(QuestMemberPermission.quest_member_id.in_(mids)))
        ts.execute(QuestMember.__table__.delete().where(QuestMember.quest_id == quest_id))
        ts.execute(QuestCategory.__table__.delete().where(QuestCategory.quest_id == quest_id))
        ts.execute(QuestGroupLink.__table__.delete().where(QuestGroupLink.quest_id == quest_id))
        ts.execute(Quest.__table__.delete().where(Quest.id == quest_id))
        ts.execute(QuestGroupMember.__table__.delete().where(QuestGroupMember.quest_group_id == group_a))
        ts.execute(QuestGroup.__table__.delete().where(QuestGroup.id == group_a))
        ts.execute(User.__table__.delete().where(User.id == owner_uid))
        ts.commit()


def _endpoints(env) -> list[tuple[str, dict]]:
    """(url, params) の門番対象 EP 群（D/E/F/J/G）。"""
    qid, iid = str(env.quest_id), str(env.idea_id)
    return [
        (f"{API}/quests/{qid}/ideas", {}),                 # D 一覧
        (f"{API}/ideas/{iid}", {}),                        # D 詳細
        (f"{API}/ideas/{iid}/chat", {}),                   # E チャット
        (f"{API}/ideas/{iid}/evaluation", {}),             # F 評価
        (f"{API}/quests/{qid}/search", {"q": "gate"}),     # J 全文検索
        (f"{API}/rankings", {"scope": f"quest:{qid}"}),    # G ランキング（クエスト内）
        (f"{API}/quests/{qid}/activities", {}),            # G クエストアクティビティ
    ]


def test_gate_baseline_member_can_access(client, gate_env):
    """ベースライン＝参加部署 group_a に在籍中の seed user（非作成者パーティー員）は全 EP 200。"""
    _login_seed(client)
    for url, params in _endpoints(gate_env):
        r = client.get(url, params=params)
        assert r.status_code == 200, f"{url} -> {r.status_code} {r.text}"


def test_gate_revoked_on_transfer_returns_404(client, gate_env):
    """D-TC-222/E-TC-204/F-TC-204/J-TC-142/G-TC-508: 全参加部署を離脱すると全 EP が 404（動的失効・C.0）。"""
    _login_seed(client)
    # seed user を group_a（唯一の参加部署）から外す＝異動。パーティー員行は残るが門番で失効する。
    with get_tenant_session(gate_env.db_identifier) as ts:
        qg_repo.remove_membership(ts, gate_env.group_a, gate_env.seed_uid)
        ts.commit()
    for url, params in _endpoints(gate_env):
        r = client.get(url, params=params)
        assert r.status_code == 404, f"{url} -> {r.status_code} {r.text}"
