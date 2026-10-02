"""②会社レベル能力（user_capabilities）のユースケース（FR-47・API設計 T.4）。

付与/剥奪は **company_account_admin / system_admin**（認可は router の依存で担保＝二重防御）。対象は account_id
（`/admin/accounts/{uid}/capabilities`）。能力チェック（`require_capability` 等）は他ドメイン（クエスト作成・
コンテスト）のゲートからも使う共通関数。
"""
from __future__ import annotations

import uuid

from app.control_plane.auth.orm import Company
from app.core.errors import AppError
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.capabilities import repository as repo
from app.tenant.capabilities.orm import CAPABILITIES
from app.tenant.profile import repository as profile_repo


def _resolve_company(company_id: uuid.UUID) -> Company | None:
    with control_session() as s:
        return s.get(Company, company_id)


def _require_known_capability(capability: str) -> None:
    if capability not in CAPABILITIES:
        raise AppError(422, "validation_error", detail="不正な能力です",
                       errors=[{"field": "capability", "code": "invalid_capability"}])


def _resolve_target_user(ts, target_account_id: str):
    user = profile_repo.get_user_by_account(ts, uuid.UUID(target_account_id))
    if user is None:
        raise AppError(404, "not_found")  # 他テナント/不在は存在秘匿
    return user


def list_capabilities(account_id: uuid.UUID, company_id: uuid.UUID, target_account_id: str) -> dict:
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        user = _resolve_target_user(ts, target_account_id)
        return {"capabilities": repo.list_for_user(ts, user.id)}


def grant_capability(account_id: uuid.UUID, company_id: uuid.UUID, target_account_id: str,
                     *, capability: str) -> dict:
    _require_known_capability(capability)
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        granter = profile_repo.get_user_by_account(ts, account_id)
        target = _resolve_target_user(ts, target_account_id)
        repo.grant(ts, target.id, capability, granted_by_id=granter.id if granter else None)
        out = {"capabilities": repo.list_for_user(ts, target.id)}
        ts.commit()
    return out


def revoke_capability(account_id: uuid.UUID, company_id: uuid.UUID, target_account_id: str,
                      capability: str) -> dict:
    _require_known_capability(capability)
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        target = _resolve_target_user(ts, target_account_id)
        repo.revoke(ts, target.id, capability)
        out = {"capabilities": repo.list_for_user(ts, target.id)}
        ts.commit()
    return out


# ---- 他ドメインのゲートから使う能力チェック（§5.3） ----

def user_has_capability(ts, user_id: uuid.UUID, capability: str) -> bool:
    """当該 Tx 上で能力保持を判定（repo の薄いラッパ＝呼び出し側の import を1本に）。"""
    return repo.has_capability(ts, user_id, capability)
