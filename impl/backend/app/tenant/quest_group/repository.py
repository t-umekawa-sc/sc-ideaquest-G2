"""会社DB `quest_group_members` の永続化プリミティブ（所属割当・API設計 B.3/B.4/B.5・§5.5）。

割当の差分適用（application）と QG 門番（deps）はこれらを組み合わせる後続スライス。
再有効化の意味論＝解除済み（tombstone）行があれば `removed_at` を NULL に戻して再有効化
（1 (group,user) 1行の不変条件・監査は別テーブル `system_audit_logs`＝B.6 に残す前提）。
いずれも呼び出し側の Tx に相乗（自身では commit しない＝profile.upsert_user_mirror と同方針・§4.6）。
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.tenant.quest_group.orm import QuestGroupMember


def get_active_membership(
    session: Session, quest_group_id: uuid.UUID, user_id: uuid.UUID
) -> QuestGroupMember | None:
    """有効な所属（`removed_at IS NULL`）を返す。無ければ None（部分ユニークで高々1件）。"""
    return session.execute(
        select(QuestGroupMember).where(
            QuestGroupMember.quest_group_id == quest_group_id,
            QuestGroupMember.user_id == user_id,
            QuestGroupMember.removed_at.is_(None),
        )
    ).scalars().first()


def upsert_membership(
    session: Session, quest_group_id: uuid.UUID, user_id: uuid.UUID, role: str = "member"
) -> QuestGroupMember:
    """所属を冪等に設定（B.3/B.4/B.5）。

    有効所属があれば `role` を更新／解除済み行があれば `removed_at` を NULL に戻して再有効化
    （新規行を増やさない・1 (group,user) 1行の不変条件）／どちらも無ければ新規作成。
    """
    active = get_active_membership(session, quest_group_id, user_id)
    if active is not None:
        active.role = role
        return active
    # 解除済み（tombstone）行があれば再有効化（最新の1件）。無ければ新規作成。
    tombstoned = session.execute(
        select(QuestGroupMember)
        .where(
            QuestGroupMember.quest_group_id == quest_group_id,
            QuestGroupMember.user_id == user_id,
            QuestGroupMember.removed_at.is_not(None),
        )
        .order_by(QuestGroupMember.removed_at.desc())
    ).scalars().first()
    if tombstoned is not None:
        tombstoned.removed_at = None
        tombstoned.role = role
        return tombstoned
    member = QuestGroupMember(
        id=uuid.uuid4(), quest_group_id=quest_group_id, user_id=user_id, role=role,
    )
    session.add(member)
    return member


def remove_membership(
    session: Session, quest_group_id: uuid.UUID, user_id: uuid.UUID
) -> QuestGroupMember | None:
    """有効所属をトゥームストーン（`removed_at` 設定・論理削除・監査保持）。

    既に解除済み（有効所属なし）なら no-op で None を返す（冪等）。アカウント本体には触れない（B.4 SoD）。
    """
    active = get_active_membership(session, quest_group_id, user_id)
    if active is None:
        return None
    active.removed_at = datetime.now(timezone.utc)
    return active


def list_active_group_ids_for_user(
    session: Session, user_id: uuid.UUID, *, role: str | None = None
) -> list[uuid.UUID]:
    """ユーザの有効所属グループID一覧（`removed_at IS NULL`）。`role` 指定でロール絞り込み。

    参照範囲判定（§5.5）と QG 門番の材料（`role='admin'` で管理グループ・B.0.1 P5）に使う。
    """
    stmt = select(QuestGroupMember.quest_group_id).where(
        QuestGroupMember.user_id == user_id,
        QuestGroupMember.removed_at.is_(None),
    )
    if role is not None:
        stmt = stmt.where(QuestGroupMember.role == role)
    return list(session.execute(stmt).scalars())
