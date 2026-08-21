"""C-TC-001〜009: quests repository の永続化プリミティブ（API設計 C.1〜C.3・§5.6〜§5.9）。

対象＝`app/tenant/quests/repository.py`。前提条件（グループ/ユーザー/既存パーティー行）は SUT を介さず
ORM で直接 seed して独立させる。repository 関数は呼び出し側 Tx に相乗（自身では commit しない）ため、
テストが `commit()` し、別セッションで再取得して検証する。ACME-01 会社DB を使い teardown で物理削除。
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.control_plane.auth.orm import Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.profile.orm import User
from app.tenant.quest_group.orm import QuestGroup
from app.tenant.quests import repository as repo
from app.tenant.quests.orm import Quest, QuestCategory, QuestMember, QuestMemberPermission
from tests.conftest import SEED_COMPANY_CODE


@pytest.fixture
def env():
    """ACME-01 会社DB にグループ1件・ユーザー数名を用意。teardown で作成データを物理削除。"""
    with control_session() as s:
        db_identifier = s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().db_identifier

    group_id = uuid.uuid4()
    other_group_id = uuid.uuid4()
    owner_id = uuid.uuid4()
    member_id = uuid.uuid4()
    outsider_id = uuid.uuid4()
    created_quests: list[uuid.UUID] = []

    with get_tenant_session(db_identifier) as ts:
        ts.add(QuestGroup(id=group_id, quest_group_code=f"QG-{uuid.uuid4().hex[:6].upper()}", name="G"))
        ts.add(QuestGroup(id=other_group_id, quest_group_code=f"QG-{uuid.uuid4().hex[:6].upper()}", name="G2"))
        for uid, name in ((owner_id, "Owner"), (member_id, "Member"), (outsider_id, "Outsider")):
            ts.add(User(id=uid, account_id=uuid.uuid4(), display_name=name, locale="ja", status="active"))
        ts.commit()

    def new_quest(*, status="recruiting", group=None, owner=None, quest_id=None, party=True) -> uuid.UUID:
        """クエストを1件 seed。`party=True`（既定）で作成者をパーティー参加させる（C.0＝作成者は常にパーティー員）。"""
        qid = quest_id or uuid.uuid4()
        the_owner = owner or owner_id
        with get_tenant_session(db_identifier) as ts:
            repo.create_quest(
                ts, quest_id=qid, quest_group_id=group or group_id, owner_id=the_owner,
                title="Q", color="#3B82F6", status=status,
            )
            if party:
                repo.add_member(ts, qid, the_owner, permissions=["owner"])
            ts.commit()
        created_quests.append(qid)
        return qid

    yield SimpleNamespace(
        db_identifier=db_identifier, group_id=group_id, other_group_id=other_group_id,
        owner_id=owner_id, member_id=member_id, outsider_id=outsider_id, new_quest=new_quest,
        created_quests=created_quests,
    )

    with get_tenant_session(db_identifier) as ts:
        qids = list(created_quests)
        if qids:
            mids = list(ts.execute(select(QuestMember.id).where(QuestMember.quest_id.in_(qids))).scalars())
            if mids:
                ts.execute(
                    QuestMemberPermission.__table__.delete().where(
                        QuestMemberPermission.quest_member_id.in_(mids)
                    )
                )
            ts.execute(QuestMember.__table__.delete().where(QuestMember.quest_id.in_(qids)))
            ts.execute(QuestCategory.__table__.delete().where(QuestCategory.quest_id.in_(qids)))
            ts.execute(Quest.__table__.delete().where(Quest.id.in_(qids)))
        ts.execute(QuestGroup.__table__.delete().where(QuestGroup.id.in_([group_id, other_group_id])))
        ts.execute(User.__table__.delete().where(User.id.in_([owner_id, member_id, outsider_id])))
        ts.commit()


def test_c_tc_001_create_and_get_active(env):
    """C-TC-001: create_quest で作成→get_quest は有効行を返す。deleted は None（トゥームストーン除外）。"""
    qid = env.new_quest()
    with get_tenant_session(env.db_identifier) as ts:
        got = repo.get_quest(ts, qid)
        assert got is not None and got.owner_id == env.owner_id
        got.deleted_at = datetime.now(timezone.utc)
        ts.commit()
    with get_tenant_session(env.db_identifier) as ts:
        assert repo.get_quest(ts, qid) is None


def test_c_tc_002_list_visibility(env):
    """C-TC-002: 一覧は (A) 可視グループの非 draft ＋ (B) 自分の下書き のみ。他人の下書き/範囲外/削除は除外。"""
    public = env.new_quest(status="recruiting", group=env.group_id)
    my_draft = env.new_quest(status="draft", owner=env.owner_id)
    others_draft = env.new_quest(status="draft", owner=env.member_id)
    out_of_scope = env.new_quest(status="recruiting", group=env.other_group_id)
    with get_tenant_session(env.db_identifier) as ts:
        ids = {
            q.id
            for q in repo.list_quests_for_user(
                ts, user_id=env.owner_id, visible_group_ids=[env.group_id], limit=50
            )
        }
    assert public in ids
    assert my_draft in ids
    assert others_draft not in ids
    assert out_of_scope not in ids


def test_c_tc_002b_list_requires_party_membership(env):
    """C-TC-002b: 可視グループの公開クエストでも、自分がパーティー非参加なら除外（C.0 パーティー門番）。"""
    # member_id が作成者＝パーティー員。owner_id は非パーティー。
    not_my_party = env.new_quest(status="recruiting", group=env.group_id, owner=env.member_id)
    with get_tenant_session(env.db_identifier) as ts:
        ids = {
            q.id
            for q in repo.list_quests_for_user(
                ts, user_id=env.owner_id, visible_group_ids=[env.group_id], limit=50
            )
        }
    assert not_my_party not in ids


def test_c_tc_003_list_cursor_pagination(env):
    """C-TC-003: カーソルページング＝(created_at,id) DESC で重複なく続きを返す。"""
    for _ in range(3):
        env.new_quest(status="recruiting", group=env.group_id)
    with get_tenant_session(env.db_identifier) as ts:
        page1 = repo.list_quests_for_user(
            ts, user_id=env.owner_id, visible_group_ids=[env.group_id], limit=2
        )
        assert len(page1) == 2
        last = page1[-1]
        page2 = repo.list_quests_for_user(
            ts, user_id=env.owner_id, visible_group_ids=[env.group_id],
            cursor=(last.created_at, last.id), limit=2,
        )
    ids1 = {q.id for q in page1}
    ids2 = {q.id for q in page2}
    assert ids1.isdisjoint(ids2)


def test_c_tc_004_replace_categories(env):
    """C-TC-004: replace_categories は置換セット（旧を消して新のみ残る・重複なし）。"""
    qid = env.new_quest()
    with get_tenant_session(env.db_identifier) as ts:
        repo.replace_categories(ts, qid, [("UX", False), ("Custom", True)])
        ts.commit()
    with get_tenant_session(env.db_identifier) as ts:
        repo.replace_categories(ts, qid, [("Infra", False)])
        ts.commit()
    with get_tenant_session(env.db_identifier) as ts:
        labels = [c.label for c in repo.list_categories(ts, qid)]
    assert labels == ["Infra"]


def test_c_tc_005_add_member_default_permissions(env):
    """C-TC-005: add_member（権限省略）は既定 vote+idea_create+comment を付与。"""
    qid = env.new_quest()
    with get_tenant_session(env.db_identifier) as ts:
        m = repo.add_member(ts, qid, env.member_id)
        ts.commit()
        perms = set(repo.get_permissions(ts, m.id))
    assert perms == {"vote", "idea_create", "comment"}


def test_c_tc_006_add_member_reuses_tombstone(env):
    """C-TC-006: 再追加は既存トゥームストーン行を再利用（同一 id・removed_at→NULL・権限再付与）。"""
    qid = env.new_quest()
    with get_tenant_session(env.db_identifier) as ts:
        m1 = repo.add_member(ts, qid, env.member_id)
        first_id = m1.id
        ts.commit()
    with get_tenant_session(env.db_identifier) as ts:
        repo.remove_member(ts, qid, env.member_id)
        ts.commit()
    with get_tenant_session(env.db_identifier) as ts:
        m2 = repo.add_member(ts, qid, env.member_id, permissions=["vote"])
        ts.commit()
        assert m2.id == first_id
        assert m2.removed_at is None
        assert set(repo.get_permissions(ts, m2.id)) == {"vote"}
        # 物理的に行が増えていない（有効行は1つ）
        total = ts.execute(
            select(QuestMember).where(QuestMember.quest_id == qid, QuestMember.user_id == env.member_id)
        ).scalars().all()
        assert len(total) == 1


def test_c_tc_007_remove_member_drops_permissions(env):
    """C-TC-007: remove_member は removed_at 設定＋権限行を削除（門番/候補から外れる）。"""
    qid = env.new_quest()
    with get_tenant_session(env.db_identifier) as ts:
        m = repo.add_member(ts, qid, env.member_id)
        mid = m.id
        ts.commit()
    with get_tenant_session(env.db_identifier) as ts:
        repo.remove_member(ts, qid, env.member_id)
        ts.commit()
    with get_tenant_session(env.db_identifier) as ts:
        assert repo.get_active_member(ts, qid, env.member_id) is None
        assert repo.get_permissions(ts, mid) == []


def test_c_tc_008_set_member_permissions_replaces(env):
    """C-TC-008: set_member_permissions は権限セットを置換（追加/削除の差分適用）。"""
    qid = env.new_quest()
    with get_tenant_session(env.db_identifier) as ts:
        m = repo.add_member(ts, qid, env.member_id)  # 既定3権限
        ts.commit()
    with get_tenant_session(env.db_identifier) as ts:
        repo.set_member_permissions(ts, qid, env.member_id, ["vote", "evaluator"])
        ts.commit()
        perms = set(repo.get_permissions(ts, m.id))
    assert perms == {"vote", "evaluator"}


def test_c_tc_009_count_active_members(env):
    """C-TC-009: count_active_members は有効参加のみ計上（除外者は含めない）。"""
    qid = env.new_quest(party=False)  # 作成者を入れず、明示追加分だけを数える
    with get_tenant_session(env.db_identifier) as ts:
        repo.add_member(ts, qid, env.member_id)
        repo.add_member(ts, qid, env.outsider_id)
        ts.commit()
    with get_tenant_session(env.db_identifier) as ts:
        repo.remove_member(ts, qid, env.outsider_id)
        ts.commit()
    with get_tenant_session(env.db_identifier) as ts:
        assert repo.count_active_members(ts, qid) == 1
