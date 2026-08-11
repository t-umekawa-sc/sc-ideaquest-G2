"""アカウント管理のユースケース（ドメイン B・コントロールプレーン中心）。

本体は管理DB `accounts`。氏名・所属は会社DB `users`/`quest_group_members`（B.2）。本スライスは
一覧の読み取り（`GET /admin/companies/{company_id}/accounts`）＝管理DB `accounts` から射影する。
所属グループ（会社DB）付与は後続スライス。
"""
from __future__ import annotations

import uuid

from sqlalchemy import func, or_, select

from app.control_plane.auth.orm import Account, Company
from app.core.errors import AppError
from app.db.control import control_session

_MAX_PER_PAGE = 100
_DEFAULT_PER_PAGE = 20


def list_company_accounts(
    company_id: uuid.UUID,
    *,
    q: str | None = None,
    status: str | None = None,
    page: int = 1,
    per_page: int = _DEFAULT_PER_PAGE,
) -> dict:
    """会社のアカウント一覧（オフセット・§1.8）。対象会社が無ければ 404（存在秘匿・B.2）。"""
    per_page = max(1, min(per_page, _MAX_PER_PAGE))
    page = max(1, page)
    with control_session() as session:
        company = session.get(Company, company_id)
        if company is None:
            raise AppError(404, "not_found")  # 対象会社の実在（B.2・§1.6）

        conds = [Account.company_id == company_id]
        if status in ("active", "disabled"):
            conds.append(Account.status == status)
        if q:
            like = f"%{q}%"
            conds.append(
                or_(Account.display_name.ilike(like), Account.login_id.ilike(like), Account.email.ilike(like))
            )

        total = session.execute(select(func.count()).select_from(Account).where(*conds)).scalar_one()
        rows = session.execute(
            select(Account)
            .where(*conds)
            .order_by(Account.created_at, Account.id)
            .offset((page - 1) * per_page)
            .limit(per_page)
        ).scalars().all()
        data = [_account_item(a) for a in rows]

    return {"data": data, "page_info": {"total": total, "page": page, "per_page": per_page}}


def _account_item(a: Account) -> dict:
    return {
        "account_id": str(a.id),
        "display_name": a.display_name,
        "login_id": a.login_id,
        "email": a.email,
        "system_role": a.system_role,
        "status": a.status,
        "last_login_at": a.last_login_at.isoformat() if a.last_login_at else None,
    }
