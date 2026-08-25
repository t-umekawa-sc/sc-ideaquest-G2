"""ショップ/装備ルータ（`/api/v1`・テナントプレーン・ドメイン G）＝SC-30/SC-31。

認可＝Depends(require_me)。残高/所有/状態機械はサーバー強制。変更系は Origin/CSRF（A.0）。会社/アカウントはセッション由来。
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Request

from app.control_plane.me.deps import require_me
from app.core.deps import verify_csrf, verify_origin
from app.tenant.shop import application as shop_service
from app.tenant.shop.schemas import (
    EquipmentRequest,
    EquipmentResponse,
    ItemListResponse,
    MyItemsResponse,
    PurchaseResponse,
)

router = APIRouter(prefix="/api/v1", tags=["shop"])


@router.get("/items", response_model=ItemListResponse)
def list_items(request: Request, session: dict = Depends(require_me)) -> ItemListResponse:
    """装備マスタ＋自分の所有/装備＋コイン残高（SC-30/SC-31・G.1）。読取専用。"""
    result = shop_service.get_items(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]))
    return ItemListResponse(**result)


@router.post("/items/{item_id}/purchase", response_model=PurchaseResponse)
def purchase_item(item_id: str, request: Request, session: dict = Depends(require_me)) -> PurchaseResponse:
    """装備を購入（G.1・コイン消費）。残高不足/所有済みはサーバー権威（409）。"""
    verify_origin(request)
    verify_csrf(request)
    result = shop_service.purchase_item(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), item_id)
    return PurchaseResponse(**result)


@router.get("/me/items", response_model=MyItemsResponse)
def get_my_items(request: Request, session: dict = Depends(require_me)) -> MyItemsResponse:
    """自分の所有装備（スロット別）＋装備中（SC-31・G.2）。読取専用。"""
    result = shop_service.get_my_items(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]))
    return MyItemsResponse(**result)


@router.put("/me/equipment", response_model=EquipmentResponse)
def update_equipment(body: EquipmentRequest, request: Request, session: dict = Depends(require_me)) -> EquipmentResponse:
    """装備スロットを更新（SC-31・G.2・部分マップ）。各スロット1点はサーバー強制。"""
    verify_origin(request)
    verify_csrf(request)
    result = shop_service.update_equipment(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]),
        equipment=body.model_dump(exclude_unset=True),  # 未指定=不変／null=外す
    )
    return EquipmentResponse(**result)
