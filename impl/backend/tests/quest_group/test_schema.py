"""B-TC-060〜063: 会社DB quest_groups/quest_group_members のスキーマ制約（データモデル §5.4/§5.5）。

B と C の境界＝所属（`quest_group_members`）は会社DB（テナントプレーン）に置く（§8-①）。
本スライスはテーブルとスキーマ制約のみを検証（int）。所属の割当操作（B.5/B.3）は後続スライス。
ACME-01 会社DB を使い、作成した行は teardown で物理削除する。
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy.exc import IntegrityError

from app.control_plane.auth.orm import Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.profile.orm import User
from app.tenant.quest_group.orm import QuestGroup, QuestGroupMember
from tests.conftest import SEED_COMPANY_CODE


def _add_member(env, group_id: uuid.UUID, *, role: str | None = None,
                removed_at: datetime | None = None) -> uuid.UUID:
    """所属を1行追加してコミットし、id を返す（role 未指定なら列既定に委ねる）。"""
    mid = uuid.uuid4()
    kwargs: dict = {}
    if role is not None:
        kwargs["role"] = role
    with get_tenant_session(env.db_identifier) as ts:
        ts.add(QuestGroupMember(
            id=mid, quest_group_id=group_id, user_id=env.user_id, removed_at=removed_at, **kwargs,
        ))
        ts.commit()
    return mid


@pytest.fixture
def qg_env():
    """ACME-01 会社DB に検証用ユーザー1件を用意。作成した group/member/user は teardown で物理削除。"""
    with control_session() as s:
        db_identifier = s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().db_identifier

    created_groups: list[uuid.UUID] = []
    user_id = uuid.uuid4()
    with get_tenant_session(db_identifier) as ts:
        ts.add(User(id=user_id, account_id=uuid.uuid4(), display_name="QG Test",
                    locale="ja", status="active"))
        ts.commit()

    def make_group(code: str | None = None, name: str = "G") -> uuid.UUID:
        gid = uuid.uuid4()
        with get_tenant_session(db_identifier) as ts:
            ts.add(QuestGroup(
                id=gid, quest_group_code=code or f"QG-{uuid.uuid4().hex[:8].upper()}", name=name,
            ))
            ts.commit()
        created_groups.append(gid)
        return gid

    yield SimpleNamespace(db_identifier=db_identifier, user_id=user_id, make_group=make_group)

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


def test_b_tc_060_quest_group_code_unique(qg_env):
    """B-TC-060 quest_group_code は会社内一意（§5.4）。"""
    code = f"DUP-{uuid.uuid4().hex[:6].upper()}"
    qg_env.make_group(code=code)
    with pytest.raises(IntegrityError):
        qg_env.make_group(code=code)


def test_b_tc_061_active_membership_unique(qg_env):
    """B-TC-061 有効な所属（removed_at IS NULL）は (group,user) で一意＝重複不可（§5.5）。"""
    gid = qg_env.make_group()
    _add_member(qg_env, gid)
    with pytest.raises(IntegrityError):
        _add_member(qg_env, gid)


def test_b_tc_062_readd_after_removed(qg_env):
    """B-TC-062 解除（removed_at 設定）後は同一 (group,user) の再所属を許容（§5.5）。"""
    gid = qg_env.make_group()
    mid = _add_member(qg_env, gid)
    with get_tenant_session(qg_env.db_identifier) as ts:
        ts.get(QuestGroupMember, mid).removed_at = datetime.now(timezone.utc)
        ts.commit()
    # 部分ユニークは removed_at 有りの行を無視するため、有効な再所属を作れる（例外にならない）
    _add_member(qg_env, gid)


def test_b_tc_063_role_default_member(qg_env):
    """B-TC-063 role を指定しない所属の既定は member（§5.5・quest_group_role default）。"""
    gid = qg_env.make_group()
    mid = _add_member(qg_env, gid)
    with get_tenant_session(qg_env.db_identifier) as ts:
        assert ts.get(QuestGroupMember, mid).role == "member"
