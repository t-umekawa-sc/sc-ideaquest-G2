"""会社 CRUD のユースケース（ドメイン B.1・system_admin・SC-91/92）。

会社は管理DB `companies`。DBプロビジョニングは MVP 手動（§8-⑫）＝作成は `status=suspended` で
コントロールDB に行を作るのみ（会社DB作成/`active` 化は運用）。`group_count`（会社DB `quest_groups`）は
ドメインC実装時に付与する（本スライスは `account_count` のみ）。
"""
from __future__ import annotations

import uuid

from sqlalchemy import func, or_, select

from app.control_plane.auth.orm import Account, Company
from app.core.errors import AppError
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.quest_group.orm import QuestGroup, QuestGroupMember

_MAX_PER_PAGE = 100
_DEFAULT_PER_PAGE = 20
_SETTINGS_FIELDS = ("vote_anonymized", "hide_voters_from_managers", "mfa_required")
_PROFILE_FIELDS = ("name", "color", "icon_image_path")


def _account_counts(session) -> dict:
    rows = session.execute(select(Account.company_id, func.count()).group_by(Account.company_id)).all()
    return {cid: n for cid, n in rows}


def _item(c: Company, account_count: int) -> dict:
    return {
        "company_id": str(c.id), "company_code": c.company_code, "name": c.name,
        "db_identifier": c.db_identifier, "status": c.status, "color": c.color,
        "icon_image_path": c.icon_image_path, "account_count": account_count,
    }


def _detail(c: Company, account_count: int) -> dict:
    return {
        **_item(c, account_count),
        "mfa_required": c.mfa_required,
        "vote_anonymized": c.vote_anonymized,
        "hide_voters_from_managers": c.hide_voters_from_managers,
    }


def list_companies(*, q: str | None = None, status: str | None = None,
                   page: int = 1, per_page: int = _DEFAULT_PER_PAGE) -> dict:
    """会社一覧（SC-91・オフセット・§1.8）。"""
    per_page = max(1, min(per_page, _MAX_PER_PAGE))
    page = max(1, page)
    with control_session() as session:
        conds = []
        if status in ("active", "suspended"):
            conds.append(Company.status == status)
        if q:
            like = f"%{q}%"
            conds.append(or_(Company.name.ilike(like), Company.company_code.ilike(like),
                             Company.db_identifier.ilike(like)))
        total = session.execute(select(func.count()).select_from(Company).where(*conds)).scalar_one()
        rows = session.execute(
            select(Company).where(*conds).order_by(Company.created_at, Company.id)
            .offset((page - 1) * per_page).limit(per_page)
        ).scalars().all()
        counts = _account_counts(session)
        data = [_item(c, counts.get(c.id, 0)) for c in rows]
    return {"data": data, "page_info": {"total": total, "page": page, "per_page": per_page}}


def create_company(*, name: str, company_code: str, db_identifier: str,
                   color: str | None = None, icon_image_path: str | None = None) -> dict:
    """会社作成（SC-91）。`status=suspended`（準備中）で作成。code/db_identifier は全社一意（409）。"""
    with control_session() as session:
        clash = session.execute(
            select(Company).where(
                or_(Company.company_code == company_code, Company.db_identifier == db_identifier)
            )
        ).scalars().first()
        if clash is not None:
            field = "company_code" if clash.company_code == company_code else "db_identifier"
            raise AppError(409, "conflict", extra={"errors": [{"field": field}]})
        company = Company(
            id=uuid.uuid4(), company_code=company_code, name=name, db_identifier=db_identifier,
            status="suspended", color=color or "#6366F1", icon_image_path=icon_image_path,
        )
        session.add(company)
        session.commit()
        return _detail(company, 0)


def get_company_detail(company_id: uuid.UUID) -> dict:
    with control_session() as session:
        company = session.get(Company, company_id)
        if company is None:
            raise AppError(404, "not_found")
        count = session.execute(
            select(func.count()).select_from(Account).where(Account.company_id == company_id)
        ).scalar_one()
        return _detail(company, count)


def update_company_profile(company_id: uuid.UUID, changes: dict) -> dict:
    """会社プロフィール更新（SC-92・name/color/icon）。"""
    with control_session() as session:
        company = session.get(Company, company_id)
        if company is None:
            raise AppError(404, "not_found")
        for field in _PROFILE_FIELDS:
            if field in changes:
                setattr(company, field, changes[field])
        session.commit()
        count = session.execute(
            select(func.count()).select_from(Account).where(Account.company_id == company_id)
        ).scalar_one()
        return _detail(company, count)


def list_company_quest_groups(company_id: uuid.UUID) -> dict:
    """会社のクエストグループ候補一覧（system_admin・所属割当の候補・B.3）。

    会社が無ければ 404（存在秘匿）。対象会社DB `quest_groups` を列挙し、有効メンバー数を付す。
    グループ作成 EP は API 設計に未定義＝ここでは一覧のみ（プロビジョニングは別途）。
    """
    with control_session() as session:
        company = session.get(Company, company_id)
        if company is None:
            raise AppError(404, "not_found")  # 対象会社の実在（B.3・§1.6）
        db_identifier = company.db_identifier
    with get_tenant_session(db_identifier) as ts:
        groups = ts.execute(
            select(QuestGroup).order_by(QuestGroup.quest_group_code)
        ).scalars().all()
        counts = dict(ts.execute(
            select(QuestGroupMember.quest_group_id, func.count())
            .where(QuestGroupMember.removed_at.is_(None))
            .group_by(QuestGroupMember.quest_group_id)
        ).all())
        data = [
            {"group_id": str(g.id), "quest_group_code": g.quest_group_code,
             "name": g.name, "member_count": counts.get(g.id, 0)}
            for g in groups
        ]
    return {"data": data}


def create_company_quest_group(company_id: uuid.UUID, *, quest_group_code: str, name: str) -> dict:
    """クエストグループを作成（system_admin・B.3・§5.4）。会社構造の変更＝会社設定と同格の権限帯。

    会社が無ければ 404。`quest_group_code` は会社内一意（会社DB 内で一意）＝重複は 409（DB 一意制約でも担保）。
    code の大文字正規化/形式検証は schema 側（`QuestGroupCreateRequest`）で実施済み。
    """
    with control_session() as session:
        company = session.get(Company, company_id)
        if company is None:
            raise AppError(404, "not_found")  # 対象会社の実在（B.3・§1.6）
        db_identifier = company.db_identifier
    with get_tenant_session(db_identifier) as ts:
        clash = ts.execute(
            select(QuestGroup).where(QuestGroup.quest_group_code == quest_group_code)
        ).scalars().first()
        if clash is not None:
            raise AppError(409, "conflict", extra={"errors": [{"field": "quest_group_code"}]})
        group = QuestGroup(id=uuid.uuid4(), quest_group_code=quest_group_code, name=name)
        ts.add(group)
        ts.commit()
        return {"group_id": str(group.id), "quest_group_code": group.quest_group_code,
                "name": group.name, "member_count": 0}


def update_company_settings(company_id: uuid.UUID, changes: dict) -> dict:
    """会社設定フラグ更新（SC-92）。**記名（`vote_anonymized=false`）時は `hide_voters_from_managers`
    を無効化して保存**（サーバー整合・B.1）。設定は login/表示時に DB を直参照＝キャッシュ未実装のため
    Redis `company_config` 無効化は現状 no-op（§1.14 キャッシュ導入時にここへ）。
    """
    with control_session() as session:
        company = session.get(Company, company_id)
        if company is None:
            raise AppError(404, "not_found")
        for field in _SETTINGS_FIELDS:
            if field in changes:
                setattr(company, field, changes[field])
        if not company.vote_anonymized:  # 記名時は投票者非開示を無効化（整合）
            company.hide_voters_from_managers = False
        session.commit()
        count = session.execute(
            select(func.count()).select_from(Account).where(Account.company_id == company_id)
        ).scalar_one()
        return _detail(company, count)
