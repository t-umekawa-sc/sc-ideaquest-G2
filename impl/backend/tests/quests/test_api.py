"""C-TC-101〜105: GET /quests・GET /quest-groups の API（SC-10・API設計 C.1/C.4・FR-15）。

seed 一般ユーザー（ACME-01）でログインし、会社DB にグループ/クエスト/パーティーを直接 seed して
参照制限（(A) 所属グループ×パーティー参加中／(B) 自分の下書き）と DTO 形状・カーソルを検証する。
teardown で seed 行を物理削除。未認証は 401。
"""
from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.control_plane.auth.orm import Account, Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.profile.orm import User
from app.tenant.profile.repository import get_user_by_account
from app.tenant.quest_group import repository as qg_repo
from app.tenant.quest_group.orm import QuestGroup, QuestGroupMember
from app.tenant.quests import repository as repo
from app.tenant.quests.orm import Quest, QuestCategory, QuestMember, QuestMemberPermission
from tests.admin.test_admin_accounts import _login
from tests.conftest import SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD

QUESTS = "/api/v1/quests"
GROUPS = "/api/v1/quest-groups"


def _seed_user_id(db_identifier: str) -> uuid.UUID:
    with control_session() as s:
        account = s.execute(select(Account).where(Account.login_id == SEED_LOGIN)).scalars().one()
    with get_tenant_session(db_identifier) as ts:
        user = get_user_by_account(ts, account.id)
        assert user is not None, "seed 一般ユーザーの会社DB ミラーが無い"
        return user.id


@pytest.fixture
def env():
    with control_session() as s:
        db_identifier = s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().db_identifier
    user_id = _seed_user_id(db_identifier)

    group_id = uuid.uuid4()
    other_user_id = uuid.uuid4()
    created_quests: list[uuid.UUID] = []
    created_group_member_ids: list[uuid.UUID] = []

    with get_tenant_session(db_identifier) as ts:
        # 他人（他クエストの owner/パーティー用）の実ユーザー＝FK(quests.owner_id→users) を満たす。
        ts.add(User(id=other_user_id, account_id=uuid.uuid4(), display_name="Other", locale="ja", status="active"))
        ts.add(QuestGroup(id=group_id, quest_group_code=f"QG-{uuid.uuid4().hex[:6].upper()}", name="C-TC Group"))
        ts.flush()
        for uid in (user_id, other_user_id):  # 両者とも同一グループに所属＝可視グループ条件を満たす
            m = qg_repo.upsert_membership(ts, group_id, uid)
            ts.flush()
            created_group_member_ids.append(m.id)
        ts.commit()

    def make_quest(*, status="recruiting", party=True, owner=None, title="C-TC Quest") -> uuid.UUID:
        qid = uuid.uuid4()
        the_owner = owner or user_id
        with get_tenant_session(db_identifier) as ts:
            repo.create_quest(
                ts, quest_id=qid, quest_group_id=group_id, owner_id=the_owner,
                title=title, color="#3B82F6", status=status,
            )
            repo.replace_categories(ts, qid, [("UX", False)])
            if party:
                repo.add_member(ts, qid, the_owner, permissions=["owner"])
            ts.commit()
        created_quests.append(qid)
        return qid

    yield SimpleNamespace(
        db_identifier=db_identifier, user_id=user_id, group_id=group_id,
        other_user_id=other_user_id, make_quest=make_quest,
    )

    with get_tenant_session(db_identifier) as ts:
        if created_quests:
            mids = list(ts.execute(select(QuestMember.id).where(QuestMember.quest_id.in_(created_quests))).scalars())
            if mids:
                ts.execute(QuestMemberPermission.__table__.delete().where(QuestMemberPermission.quest_member_id.in_(mids)))
            ts.execute(QuestMember.__table__.delete().where(QuestMember.quest_id.in_(created_quests)))
            ts.execute(QuestCategory.__table__.delete().where(QuestCategory.quest_id.in_(created_quests)))
            ts.execute(Quest.__table__.delete().where(Quest.id.in_(created_quests)))
        ts.execute(QuestGroupMember.__table__.delete().where(QuestGroupMember.quest_group_id == group_id))
        ts.execute(QuestGroup.__table__.delete().where(QuestGroup.id == group_id))
        ts.execute(User.__table__.delete().where(User.id == other_user_id))
        ts.commit()


def test_c_tc_101_list_returns_joined_quest(client, env):
    """C-TC-101: 所属グループ×パーティー参加中の公開クエストが DTO 形状で返る。"""
    qid = env.make_quest(status="recruiting")
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    r = client.get(QUESTS)
    assert r.status_code == 200, r.text
    body = r.json()
    card = next((c for c in body["data"] if c["id"] == str(qid)), None)
    assert card is not None
    assert card["status"] == "recruiting"
    assert card["member_count"] == 1
    assert card["idea_count"] == 0
    assert card["categories"] == ["UX"]
    assert card["owner"]["user_id"] == str(env.user_id)
    assert card["quest_group"]["id"] == str(env.group_id)
    assert card["my_state"] == "member"
    assert "next_cursor" in body["page_info"] and "has_next" in body["page_info"]


def test_c_tc_102_hides_non_party_quest(client, env):
    """C-TC-102: 同じ可視グループでも自分がパーティー非参加のクエストは出さない（C.0 門番）。"""
    hidden = env.make_quest(status="recruiting", owner=env.other_user_id, party=True)  # 他人だけがパーティー
    # other_user_id は会社DB users に存在しないが、パーティー門番（自分=seed user が非参加）だけで除外される
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    r = client.get(QUESTS)
    assert r.status_code == 200, r.text
    ids = {c["id"] for c in r.json()["data"]}
    assert str(hidden) not in ids


def test_c_tc_103_status_filter_validation(client, env):
    """C-TC-103: 想定外の status 値は 422（enum 限定・§C.6 入力検証）。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    r = client.get(QUESTS, params={"status": "bogus"})
    assert r.status_code == 422, r.text
    assert r.json()["code"] == "validation_error"


def test_c_tc_104_groups_returns_membership(client, env):
    """C-TC-104: GET /quest-groups は自分が有効所属するグループを返す。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    r = client.get(GROUPS)
    assert r.status_code == 200, r.text
    ids = {g["id"] for g in r.json()["data"]}
    assert str(env.group_id) in ids


def test_c_tc_105_requires_auth(client, env):
    """C-TC-105: 未認証は 401（require_me・P1）。"""
    r = client.get(QUESTS)
    assert r.status_code == 401, r.text
