"""QG管理者 API のユースケース（ドメイン B.4・SC-90・参加選択専任＝SoD）。

QG管理者は per-group（`quest_group_members.role=admin`）で表す（`system_role` 非依存・B案）。
`company_id` はセッション会社固定（受け取らない）。参加追加/除外は会社DB `quest_group_members` の
per-group 行だけを操作＝**アカウント本体（`accounts`）には一切触れない**（SoD の肝・§8-⑯）。
グループ単位の admin 所属チェックはここで行い、権限外は 404（存在秘匿・B.0.1 §1.6）。
"""
from __future__ import annotations

import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.control_plane.audit import repository as audit
from app.control_plane.auth.orm import Company
from app.core.errors import AppError
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.profile import repository as user_repo
from app.tenant.profile.orm import User
from app.tenant.quest_group import repository as qg_repo
from app.tenant.quest_group.orm import QuestGroup, QuestGroupMember

_MAX_PER_PAGE = 100
_DEFAULT_PER_PAGE = 20


def _db_identifier(session: dict) -> str:
    """セッション会社の会社DB db_identifier を解決（QG系は company_id を受けず session 固定）。"""
    with control_session() as s:
        return s.get(Company, uuid.UUID(session["company_id"])).db_identifier


def _acting_user(tsession: Session, session: dict) -> User:
    """呼び出し元の会社DB users 行（ログイン済み＝ミラー存在が前提）。無ければ 403。"""
    actor = user_repo.get_user_by_account(tsession, uuid.UUID(session["account_id"]))
    if actor is None:
        raise AppError(403, "forbidden")
    return actor


def _require_group_admin(tsession: Session, actor_id: uuid.UUID, group_id: uuid.UUID) -> None:
    """呼び出し元が当該グループに有効 `admin` 所属を持つことを要求（無ければ 404＝存在秘匿・B.4）。

    所属ベース判定＝`system_admin`/`company_account_admin` でも `admin` 所属が無ければ 404。
    他会社・不明グループは、この会社DB に actor の admin 所属が無い＝同じく 404。
    """
    membership = qg_repo.get_active_membership(tsession, group_id, actor_id)
    if membership is None or membership.role != "admin":
        raise AppError(404, "not_found")


def list_admin_groups(session: dict) -> dict:
    """自分が `admin` のグループ一覧（メンバー数付き・SC-90）。admin 所属ゼロは 403（QG管理者でない）。"""
    with get_tenant_session(_db_identifier(session)) as ts:
        actor = _acting_user(ts, session)
        group_ids = qg_repo.list_active_group_ids_for_user(ts, actor.id, role="admin")
        if not group_ids:
            raise AppError(403, "forbidden")  # SC-90 に到達できない＝QG管理者でない
        groups = ts.execute(select(QuestGroup).where(QuestGroup.id.in_(group_ids))).scalars().all()
        counts = dict(ts.execute(
            select(QuestGroupMember.quest_group_id, func.count())
            .where(QuestGroupMember.quest_group_id.in_(group_ids), QuestGroupMember.removed_at.is_(None))
            .group_by(QuestGroupMember.quest_group_id)
        ).all())
        data = [
            {"group_id": str(g.id), "quest_group_code": g.quest_group_code,
             "name": g.name, "member_count": counts.get(g.id, 0)}
            for g in groups
        ]
    return {"data": data}


def list_members(session: dict, group_id: uuid.UUID, *, q: str | None = None) -> dict:
    """グループの参加メンバー一覧（`removed_at IS NULL`・`users` join）。非 admin/不明は 404。"""
    with get_tenant_session(_db_identifier(session)) as ts:
        actor = _acting_user(ts, session)
        _require_group_admin(ts, actor.id, group_id)
        conds = [QuestGroupMember.quest_group_id == group_id, QuestGroupMember.removed_at.is_(None)]
        if q:
            like = f"%{q}%"
            conds.append(or_(User.display_name.ilike(like), User.login_id.ilike(like)))
        rows = ts.execute(
            select(QuestGroupMember, User)
            .join(User, QuestGroupMember.user_id == User.id)
            .where(*conds)
            .order_by(User.display_name)
        ).all()
        data = [{"account_id": str(u.account_id), "display_name": u.display_name, "role": m.role}
                for m, u in rows]
    return {"data": data}


def company_directory(session: dict, *, q: str | None = None,
                      page: int = 1, per_page: int = _DEFAULT_PER_PAGE) -> dict:
    """自社アカウント・ディレクトリ（最小射影・B.4）。少なくとも 1 グループで `admin` でなければ 403。

    返すのは `account_id`/`display_name`/`avatar_url` のみ（`email`/`system_role`/所属は出さない）。`status=active`。
    """
    per_page = max(1, min(per_page, _MAX_PER_PAGE))
    page = max(1, page)
    with get_tenant_session(_db_identifier(session)) as ts:
        actor = _acting_user(ts, session)
        if not qg_repo.list_active_group_ids_for_user(ts, actor.id, role="admin"):
            raise AppError(403, "forbidden")  # QG管理者（1グループ以上で admin）でなければ不可
        conds = [User.status == "active"]
        if q:
            like = f"%{q}%"
            conds.append(or_(User.display_name.ilike(like), User.login_id.ilike(like)))
        total = ts.execute(select(func.count()).select_from(User).where(*conds)).scalar_one()
        rows = ts.execute(
            select(User).where(*conds).order_by(User.display_name, User.id)
            .offset((page - 1) * per_page).limit(per_page)
        ).scalars().all()
        data = [{"account_id": str(u.account_id), "display_name": u.display_name,
                 "avatar_url": u.avatar_image_path} for u in rows]
    return {"data": data, "page_info": {"total": total, "page": page, "per_page": per_page}}


def add_member(session: dict, group_id: uuid.UUID, target_account_id: uuid.UUID) -> dict:
    """既存アカウントを自グループに参加追加（会社DB `quest_group_members` upsert・`role=member` 固定）。

    per-group 行だけを操作＝アカウント本体には触れない（SoD）。当該グループ非 admin/不明は 404、
    対象が自社に居なければ 404（存在秘匿）。QG管理者は `admin` 任命不可＝常に `member`。
    """
    with get_tenant_session(_db_identifier(session)) as ts:
        actor = _acting_user(ts, session)
        _require_group_admin(ts, actor.id, group_id)
        target = user_repo.get_user_by_account(ts, target_account_id)
        if target is None:
            raise AppError(404, "not_found")  # 対象アカウントが自社に居ない
        membership = qg_repo.upsert_membership(ts, group_id, target.id, "member")
        role = membership.role
        ts.commit()
    audit.record("membership.add",  # 監査（B.6・独立記録＝会社DB 書込の後）
                 {"group_id": str(group_id), "account_id": str(target_account_id), "role": role})
    return {"account_id": str(target_account_id), "group_id": str(group_id), "role": role}


def remove_member(session: dict, group_id: uuid.UUID, target_account_id: uuid.UUID) -> None:
    """自グループから除外（per-group トゥームストーン・冪等）。アカウント本体は不変（SoD・§5.5）。"""
    with get_tenant_session(_db_identifier(session)) as ts:
        actor = _acting_user(ts, session)
        _require_group_admin(ts, actor.id, group_id)
        target = user_repo.get_user_by_account(ts, target_account_id)
        if target is None:
            raise AppError(404, "not_found")
        qg_repo.remove_membership(ts, group_id, target.id)  # 有効所属をトゥームストーン（冪等）
        ts.commit()
    audit.record("membership.remove",  # 監査（B.6・独立記録）
                 {"group_id": str(group_id), "account_id": str(target_account_id)})
