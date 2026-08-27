"""ドメイン G（ショップ/装備）の application（G.1/G.2）。

購入＝残高検証＋コイン消費（ledger COIN_SPEND・reason=shop_purchase）＋所有行作成を同一 UoW。
装備＝部分マップ更新（各スロット1点・旧装備を外して新装備を付ける）。認可＝自分のみ（テナント内・§1.5）。
"""
from __future__ import annotations

import uuid

from app.control_plane.auth.orm import Company
from app.core.errors import AppError
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.gamification import ledger
from app.tenant.profile import repository as profile_repo
from app.tenant.shop import repository as repo
from app.tenant.shop.repository import SLOTS


def _resolve_company(company_id: uuid.UUID) -> Company | None:
    with control_session() as s:
        return s.get(Company, company_id)


def _parse_uuid(value: str, *, field: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except (ValueError, AttributeError):
        raise AppError(422, "validation_error", detail=f"{field} が不正です", errors=[{"field": field}])


def get_items(account_id, company_id) -> dict:
    """装備マスタ＋自分の所有/装備状況＋コイン残高（SC-30／SC-31・G.1）。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        owned = {ui.item_id: ui for ui in repo.list_user_items(ts, user.id)}
        data = [_item_dto(it, owned.get(it.id)) for it in repo.list_items(ts)]
        return {"data": data, "coin_balance": user.coin_balance}


def purchase_item(account_id, company_id, item_id) -> dict:
    """装備を購入（G.1・コイン消費・恒久）。残高不足/所有済みは 409。副作用＝coin_spend＋所有行作成。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    iid = _parse_uuid(item_id, field="item_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        item = repo.get_item(ts, iid)
        if item is None:
            raise AppError(404, "not_found")
        if repo.get_user_item(ts, user.id, item.id) is not None:
            raise AppError(409, "conflict", detail="すでに所有しています", extra={"errors": [{"reason": "already_owned"}]})
        if user.coin_balance < item.price_coin:
            raise AppError(409, "conflict", detail="コインが不足しています", extra={"errors": [{"reason": "insufficient_balance"}]})
        ledger.grant(ts, user, kind=ledger.COIN_SPEND, amount=item.price_coin, reason="shop_purchase",
                     ref_type="items", ref_id=item.id)
        repo.create_user_item(ts, user.id, item)
        balance = user.coin_balance
        ts.commit()
    return {"item_id": str(iid), "owned": True, "coin_balance": balance}


def get_my_items(account_id, company_id) -> dict:
    """自分の所有装備（スロット別）＋装備中（SC-31・G.2）。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        en = user.locale == "en"  # 受信者 locale でマスタ名を出し分け（§2.1・既定 ja）
        items = {it.id: it for it in repo.list_items(ts)}
        slots: dict[str, list] = {s: [] for s in SLOTS}
        equipped: dict[str, str | None] = {s: None for s in SLOTS}
        for ui in repo.list_user_items(ts, user.id):
            it = items.get(ui.item_id)
            if it is None or ui.slot not in slots:
                continue
            slots[ui.slot].append({"item_id": str(it.id), "name": it.name_en if en else it.name_ja,
                                   "rarity": it.rarity, "is_equipped": ui.is_equipped})
            if ui.is_equipped:
                equipped[ui.slot] = str(it.id)
        return {"slots": slots, "equipped": equipped}


def update_equipment(account_id, company_id, *, equipment: dict) -> dict:
    """装備スロットを更新（G.2・部分マップ）。各スロット1点＝旧装備を外して新装備を付ける（同一 UoW）。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        for slot, raw in (equipment or {}).items():
            if slot not in SLOTS:
                raise AppError(422, "validation_error", detail="スロットが不正です", errors=[{"field": slot}])
            current = repo.get_equipped_in_slot(ts, user.id, slot)
            if raw is None:  # 外す
                if current is not None:
                    current.is_equipped = False
                continue
            target_id = _parse_uuid(str(raw), field=slot)
            target = repo.get_user_item(ts, user.id, target_id)
            if target is None or target.slot != slot:
                raise AppError(422, "validation_error", detail="所有していない/スロット不一致の装備です", errors=[{"field": slot}])
            if current is not None and current.item_id != target_id:
                current.is_equipped = False
                ts.flush()  # 部分ユニーク（同スロット1点）を満たすため旧装備を先に外す
            target.is_equipped = True
        equipped: dict[str, str | None] = {s: None for s in SLOTS}
        for ui in repo.list_user_items(ts, user.id):
            if ui.is_equipped and ui.slot in equipped:
                equipped[ui.slot] = str(ui.item_id)
        ts.commit()
    return {"equipped": equipped}


def _item_dto(item, ui) -> dict:
    return {
        "id": str(item.id),
        "code": item.code,
        "name_ja": item.name_ja,
        "name_en": item.name_en,
        "slot": item.slot,
        "rarity": item.rarity,
        "price_coin": item.price_coin,
        "owned": ui is not None,
        "is_equipped": bool(ui.is_equipped) if ui is not None else False,
    }
