"""②会社レベル能力の付与/剥奪ルータ（`/api/v1/admin/accounts/{uid}/capabilities`・FR-47・API設計 T.4）。

認可＝`company_account_admin`/`system_admin`（`require_company_account_admin`・二重防御）。変更系は CSRF/Origin（A.0）。
対象 `{uid}` は account_id。付与UIは会社アカウント管理（SC-93）系を踏襲。
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Request

from app.control_plane.admin.deps import require_company_account_admin
from app.core.deps import verify_csrf, verify_origin
from app.tenant.capabilities import application as service
from app.tenant.capabilities.schemas import CapabilityGrantRequest, CapabilityListResponse

router = APIRouter(prefix="/api/v1", tags=["capabilities"])


@router.get("/admin/accounts/{uid}/capabilities", response_model=CapabilityListResponse)
def list_account_capabilities(uid: str, request: Request,
                              session: dict = Depends(require_company_account_admin)):
    return service.list_capabilities(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), uid)


@router.post("/admin/accounts/{uid}/capabilities", response_model=CapabilityListResponse,
             dependencies=[Depends(verify_origin), Depends(verify_csrf)])
def grant_account_capability(uid: str, body: CapabilityGrantRequest, request: Request,
                             session: dict = Depends(require_company_account_admin)):
    return service.grant_capability(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]),
                                    uid, capability=body.capability)


@router.delete("/admin/accounts/{uid}/capabilities/{capability}", response_model=CapabilityListResponse,
               dependencies=[Depends(verify_origin), Depends(verify_csrf)])
def revoke_account_capability(uid: str, capability: str, request: Request,
                              session: dict = Depends(require_company_account_admin)):
    return service.revoke_capability(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]),
                                     uid, capability)
