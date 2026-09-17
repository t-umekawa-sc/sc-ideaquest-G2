"""ドメイン G（ショップ/装備）の application（G.1/G.2）。

購入＝残高検証＋コイン消費（ledger COIN_SPEND・reason=shop_purchase）＋所有行作成を同一 UoW。
装備＝部分マップ更新（各スロット1点・旧装備を外して新装備を付ける）。認可＝自分のみ（テナント内・§1.5）。
"""
from __future__ import annotations

import uuid

from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import aliased

from app.control_plane.auth.orm import Company
from app.core import list_query as lq
from app.core.errors import AppError
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.gamification import ledger
from app.tenant.profile import repository as profile_repo
from app.tenant.shop import repository as repo
from app.tenant.shop.orm import Item, UserItem
from app.tenant.shop.repository import SLOTS


def _resolve_company(company_id: uuid.UUID) -> Company | None:
    with control_session() as s:
        return s.get(Company, company_id)


def _parse_uuid(value: str, *, field: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except (ValueError, AttributeError):
        raise AppError(422, "validation_error", detail=f"{field} が不正です", errors=[{"field": field}])


# ---- 一覧サーバー契約（G.1・§1.8.1・DataTable サーバーモード） ----
# ソート可能キー→ORDER BY 式（rarity/slot はレアリティ/スロット序列・§1.8.1①ホワイトリスト）。
_RARITY_RANK = case((Item.rarity == "common", 0), (Item.rarity == "standard", 1), (Item.rarity == "rare", 2), else_=99)
_SLOT_RANK = case(
    (Item.slot == "head", 0), (Item.slot == "face", 1), (Item.slot == "body", 2),
    (Item.slot == "hand", 3), (Item.slot == "background", 4), else_=99,
)
_ITEM_SORT_COLUMNS = {"rarity": _RARITY_RANK, "price": Item.price_coin, "slot": _SLOT_RANK, "name": Item.name_ja}
ITEM_RARITIES = ("common", "standard", "rare")
ITEM_STATES = ("owned", "affordable", "short")  # SC-30 状態列（多値・§1.8.1②）
# CSV 表示可能列とラベル（§1.8.1③・列順は ?columns= が正）。
_CSV_COLUMNS = {"name": "名称", "slot": "スロット", "rarity": "レアリティ", "price_coin": "価格", "owned": "所有"}
_CSV_DEFAULT_ORDER = ["name", "slot", "rarity", "price_coin", "owned"]


def _items_query(*, user_id, coin_balance, q, slots, rarities, owned, affordable,
                 states, price_min, price_max, sort, exclude_ids):
    """(rows_stmt〔order 済み・offset/limit 未適用〕, count_stmt) を返す（companies と同型・§1.8.1）。

    `owned`/`affordable` は閲覧者依存＝`user_items`（所有）と価格≤残高で解決。`states`＝SC-30 の状態列の
    多値（owned/affordable/short）＝各述語の OR（DataTable の enum 多値・§1.8.1②）。`sort` は
    _ITEM_SORT_COLUMNS のホワイトリスト（未知は 422）。`exclude_ids`＝固定行を非固定母集合から除外（§1.8.1④）。
    """
    uitem = aliased(UserItem)
    owned_expr = uitem.id.isnot(None)
    conds = []
    if slots:
        conds.append(Item.slot.in_(slots))
    if rarities:
        conds.append(Item.rarity.in_(rarities))
    if q:
        like = f"%{q}%"
        conds.append(or_(Item.name_ja.ilike(like), Item.name_en.ilike(like)))
    if price_min is not None:
        conds.append(Item.price_coin >= price_min)
    if price_max is not None:
        conds.append(Item.price_coin <= price_max)
    if owned is True:
        conds.append(owned_expr)
    elif owned is False:
        conds.append(~owned_expr)
    if affordable is True:
        conds.append(Item.price_coin <= coin_balance)
    elif affordable is False:
        conds.append(Item.price_coin > coin_balance)
    if states:  # 状態列（多値 OR）＝所有／未所有かつ購入可／未所有かつ不足（§1.8.1②）
        _state_pred = {
            "owned": owned_expr,
            "affordable": and_(~owned_expr, Item.price_coin <= coin_balance),
            "short": and_(~owned_expr, Item.price_coin > coin_balance),
        }
        conds.append(or_(*[_state_pred[s] for s in states]))
    if exclude_ids:
        conds.append(Item.id.notin_(exclude_ids))

    def _join(stmt):
        return stmt.outerjoin(uitem, and_(uitem.item_id == Item.id, uitem.user_id == user_id)).where(*conds)

    order = lq.parse_sort(sort, _ITEM_SORT_COLUMNS)
    rows_stmt = _join(select(Item, uitem))
    # 明示ソートはキー順＋末尾 id で一意化／無指定は rarity→slot→sort_order の決定的順序（G.1 既定＝rarity）。
    rows_stmt = (rows_stmt.order_by(*order, Item.id) if order
                 else rows_stmt.order_by(_RARITY_RANK, _SLOT_RANK, Item.sort_order, Item.id))
    count_stmt = _join(select(func.count()).select_from(Item))
    return rows_stmt, count_stmt


def _fetch_pinned_items(ts, user_id, ids):
    """固定行（ピン）を絞込/ページに関係なく解決（送信 ID 順を保持・§1.8.1④）。"""
    if not ids:
        return []
    uitem = aliased(UserItem)
    rows = ts.execute(
        select(Item, uitem).outerjoin(uitem, and_(uitem.item_id == Item.id, uitem.user_id == user_id))
        .where(Item.id.in_(ids))
    ).all()
    by_id = {it.id: (it, ui) for it, ui in rows}
    return [_item_dto(*by_id[i]) for i in ids if i in by_id]


def query_items(account_id, company_id, *, q=None, slot=None, rarity=None, owned=None, affordable=None,
                state=None, price_min=None, price_max=None, sort=None, pin_ids=None, page=None, per_page=None) -> dict:
    """装備一覧（SC-30／SC-31・G.1・DataTable サーバー契約）＝絞込/複数ソート/番号ページャ/固定行/残高。

    `page`/`per_page` 未指定＝全件（client モード後方互換・小カタログ）／指定時は offset ページング。
    """
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    slots = lq.parse_enum(slot, "slot", SLOTS)      # 未知値は 422（ホワイトリスト・§1.8.1②）
    rarities = lq.parse_enum(rarity, "rarity", ITEM_RARITIES)
    states = lq.parse_enum(state, "state", ITEM_STATES)
    pins = lq.parse_pin_ids(pin_ids)
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        bal = user.coin_balance
        pinned = _fetch_pinned_items(ts, user.id, pins)  # 絞込/ページに関係なく解決・§1.8.1④
        rows_stmt, count_stmt = _items_query(
            user_id=user.id, coin_balance=bal, q=q, slots=slots, rarities=rarities,
            owned=owned, affordable=affordable, states=states, price_min=price_min, price_max=price_max,
            sort=sort, exclude_ids=pins)
        total = ts.execute(count_stmt).scalar_one()
        if page is None and per_page is None:  # ページ指定なし＝全件（後方互換）
            rows = ts.execute(rows_stmt).all()
            eff_page, eff_per = 1, total or 1
        else:
            eff_page = max(1, page or 1)
            eff_per = max(1, min(per_page or lq.DEFAULT_PER_PAGE, lq.MAX_PER_PAGE))
            rows = ts.execute(rows_stmt.offset((eff_page - 1) * eff_per).limit(eff_per)).all()
        data = [_item_dto(it, ui) for it, ui in rows]
    return {"data": data, "pinned": pinned,
            "page_info": {"total": total, "page": eff_page, "per_page": eff_per}, "coin_balance": bal}


def _csv_cell(key, item, ui) -> str:
    if key == "owned":
        return "1" if ui is not None else "0"
    if key == "name":
        return item.name_ja
    return str(getattr(item, key))


def export_items_csv(account_id, company_id, *, q=None, slot=None, rarity=None, owned=None, affordable=None,
                     state=None, price_min=None, price_max=None, sort=None, columns=None) -> tuple[bytes, str]:
    """同一フィルタ/ソートの全件を CSV で出力（ページング無視・§1.8.1③・UTF-8 BOM）。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    slots = lq.parse_enum(slot, "slot", SLOTS)
    rarities = lq.parse_enum(rarity, "rarity", ITEM_RARITIES)
    states = lq.parse_enum(state, "state", ITEM_STATES)
    keys = lq.parse_columns(columns, _CSV_COLUMNS, _CSV_DEFAULT_ORDER)
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        rows_stmt, _ = _items_query(
            user_id=user.id, coin_balance=user.coin_balance, q=q, slots=slots, rarities=rarities,
            owned=owned, affordable=affordable, states=states, price_min=price_min, price_max=price_max,
            sort=sort, exclude_ids=None)
        rows = ts.execute(rows_stmt).all()
    header = [_CSV_COLUMNS[k] for k in keys]
    body = ([_csv_cell(k, it, ui) for k in keys] for it, ui in rows)
    return lq.to_csv_bytes(header, body), "items.csv"


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
