"""B-TC-064〜068: quest_group repository の所属永続化プリミティブ（API設計 B.3/B.4/B.5・§5.5）。

対象＝`app/tenant/quest_group/repository.py`。前提条件（既存 active 行・解除済み行）は SUT を介さず
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
from app.tenant.quest_group import repository as repo
from app.tenant.quest_group.orm import QuestGroup, QuestGroupMember
from tests.conftest import SEED_COMPANY_CODE


@pytest.fixture
def env():
    """ACME-01 会社DB に検証用ユーザー1件を用意。group/member を直接 seed でき、teardown で物理削除。"""
    with control_session() as s:
        db_identifier = s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().db_identifier

    created_groups: list[uuid.UUID] = []
    user_id = uuid.uuid4()
    with get_tenant_session(db_identifier) as ts:
        ts.add(User(id=user_id, account_id=uuid.uuid4(), display_name="Repo Test",
                    locale="ja", status="active"))
        ts.commit()

    def make_group() -> uuid.UUID:
        gid = uuid.uuid4()
        with get_tenant_session(db_identifier) as ts:
            ts.add(QuestGroup(id=gid, quest_group_code=f"QG-{uuid.uuid4().hex[:8].upper()}", name="G"))
            ts.commit()
        created_groups.append(gid)
        return gid

    def seed_member(group_id: uuid.UUID, *, role: str = "member", removed: bool = False,
                    user: uuid.UUID | None = None) -> uuid.UUID:
        """SUT を介さず所属を直接1行 seed（前提条件用）。"""
        mid = uuid.uuid4()
        with get_tenant_session(db_identifier) as ts:
            ts.add(QuestGroupMember(
                id=mid, quest_group_id=group_id, user_id=user or user_id, role=role,
                removed_at=datetime.now(timezone.utc) if removed else None,
            ))
            ts.commit()
        return mid

    def rows(group_id: uuid.UUID) -> list[QuestGroupMember]:
        with get_tenant_session(db_identifier) as ts:
            return list(ts.execute(
                select(QuestGroupMember).where(
                    QuestGroupMember.quest_group_id == group_id,
                    QuestGroupMember.user_id == user_id,
                )
            ).scalars())

    yield SimpleNamespace(db_identifier=db_identifier, user_id=user_id,
                          make_group=make_group, seed_member=seed_member, rows=rows)

    with get_tenant_session(db_identifier) as ts:
        if created_groups:
            ts.query(QuestGroupMember).filter(
                QuestGroupMember.quest_group_id.in_(created_groups)
            ).delete(synchronize_session=False)
            ts.query(QuestGroup).filter(
                QuestGroup.id.in_(created_groups)
            ).delete(synchronize_session=False)
        ts.query(User).filter_by(id=user_id).delete()
        ts.commit()


def test_b_tc_064_upsert_creates_active(env):
    """B-TC-064 所属なし→upsert で有効所属を1行作成（removed_at NULL・role 反映）。"""
    gid = env.make_group()
    with get_tenant_session(env.db_identifier) as ts:
        repo.upsert_membership(ts, gid, env.user_id, role="member")
        ts.commit()
    rows = env.rows(gid)
    assert len(rows) == 1
    assert rows[0].removed_at is None
    assert rows[0].role == "member"


def test_b_tc_065_upsert_updates_role_idempotent(env):
    """B-TC-065 既存 active の role を更新・行数不変（冪等＝再適用で増えない）。"""
    gid = env.make_group()
    env.seed_member(gid, role="member")
    with get_tenant_session(env.db_identifier) as ts:
        repo.upsert_membership(ts, gid, env.user_id, role="admin")
        ts.commit()
    with get_tenant_session(env.db_identifier) as ts:  # 同値で再適用
        repo.upsert_membership(ts, gid, env.user_id, role="admin")
        ts.commit()
    rows = env.rows(gid)
    assert len(rows) == 1
    assert rows[0].role == "admin"
    assert rows[0].removed_at is None


def test_b_tc_066_upsert_reactivates_tombstone(env):
    """B-TC-066 解除済み行があれば removed_at を NULL に戻して再有効化（新規行を増やさない・§5.5）。"""
    gid = env.make_group()
    env.seed_member(gid, role="member", removed=True)
    with get_tenant_session(env.db_identifier) as ts:
        repo.upsert_membership(ts, gid, env.user_id, role="member")
        ts.commit()
    rows = env.rows(gid)
    assert len(rows) == 1  # 再利用＝新規行を増やさない
    assert rows[0].removed_at is None  # 再有効化


def test_b_tc_067_remove_tombstones_idempotent(env):
    """B-TC-067 remove で active をトゥームストーン・2回目は no-op（None 返し・§5.5）。"""
    gid = env.make_group()
    env.seed_member(gid, role="member")
    with get_tenant_session(env.db_identifier) as ts:
        removed = repo.remove_membership(ts, gid, env.user_id)
        ts.commit()
        assert removed is not None
    active = [r for r in env.rows(gid) if r.removed_at is None]
    assert active == []
    with get_tenant_session(env.db_identifier) as ts:  # 2回目＝既に解除済み
        again = repo.remove_membership(ts, gid, env.user_id)
        ts.commit()
        assert again is None


def test_b_tc_068_list_active_group_ids(env):
    """B-TC-068 有効所属のみ返す（解除済み除外）・role フィルタで admin のみ（§5.5・門番材料）。"""
    g1, g2, g3 = env.make_group(), env.make_group(), env.make_group()
    env.seed_member(g1, role="admin")
    env.seed_member(g2, role="member")
    env.seed_member(g3, role="member", removed=True)
    with get_tenant_session(env.db_identifier) as ts:
        all_ids = set(repo.list_active_group_ids_for_user(ts, env.user_id))
        admin_ids = set(repo.list_active_group_ids_for_user(ts, env.user_id, role="admin"))
    assert all_ids == {g1, g2}  # g3（解除済み）は含まない
    assert admin_ids == {g1}
