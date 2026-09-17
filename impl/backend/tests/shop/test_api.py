"""G-TC-301〜308: ショップ/装備 API（SC-30/SC-31・G.1/G.2）。

throwaway アカウントを作成しログイン（他 gamification テストと同方式）。コインは会社DB で直接設定して購入/装備を検証。
購入＝残高検証＋コイン消費（ledger）＋所有行。装備＝部分マップ（各スロット1点）。
"""
from __future__ import annotations

from sqlalchemy import select

from app.control_plane.auth.orm import Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.gamification.orm import Activity
from app.tenant.profile.orm import User
from app.tenant.profile.repository import get_user_by_account
from app.tenant.shop.orm import Item, UserItem
from tests.admin.test_admin_accounts import _login
from tests.conftest import SEED_COMPANY_CODE

ITEMS = "/api/v1/items"


def _db() -> str:
    with control_session() as s:
        return s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().db_identifier


def _csrf(client) -> dict:
    return {"X-CSRF-Token": client.cookies.get("iq_csrf")}


def _login_new(client, factory) -> str:
    acc = factory.make_seed_company_account()
    _login(client, SEED_COMPANY_CODE, acc["login_id"], acc["password"])
    return acc["id"]


def _set_coins(account_id, coins: int) -> None:
    with get_tenant_session(_db()) as s:
        u = get_user_by_account(s, account_id)
        u.coin_balance = coins
        s.commit()


def _item(code: str) -> Item:
    with get_tenant_session(_db()) as s:
        return s.execute(select(Item).where(Item.code == code)).scalars().one()


def _own(account_id, code: str, *, equipped=False) -> None:
    with get_tenant_session(_db()) as s:
        u = get_user_by_account(s, account_id)
        it = s.execute(select(Item).where(Item.code == code)).scalars().one()
        s.add(UserItem(user_id=u.id, item_id=it.id, slot=it.slot, is_equipped=equipped))
        s.commit()


def test_g_tc_301_list_items(client, factory):
    _login_new(client, factory)
    r = client.get(ITEMS)
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["data"]) == 19 and "coin_balance" in body
    assert all("owned" in d and "is_equipped" in d for d in body["data"])


def test_g_tc_302_purchase_success(client, factory):
    acc = _login_new(client, factory)
    _set_coins(acc, 100)
    item = _item("cap")  # price 20
    r = client.post(f"{ITEMS}/{item.id}/purchase", headers=_csrf(client))
    assert r.status_code == 200 and r.json()["owned"] is True and r.json()["coin_balance"] == 80, r.text
    with get_tenant_session(_db()) as s:
        u = get_user_by_account(s, acc)
        assert s.execute(select(UserItem).where(UserItem.user_id == u.id, UserItem.item_id == item.id)).scalars().first() is not None
        assert s.execute(select(Activity).where(Activity.user_id == u.id, Activity.reason == "shop_purchase", Activity.ref_id == item.id)).scalars().first() is not None


def test_g_tc_303_insufficient_balance(client, factory):
    acc = _login_new(client, factory)
    _set_coins(acc, 5)
    item = _item("cap")  # price 20
    r = client.post(f"{ITEMS}/{item.id}/purchase", headers=_csrf(client))
    assert r.status_code == 409 and r.json()["errors"][0]["reason"] == "insufficient_balance"


def test_g_tc_304_already_owned(client, factory):
    acc = _login_new(client, factory)
    _set_coins(acc, 100)
    _own(acc, "cap")
    item = _item("cap")
    r = client.post(f"{ITEMS}/{item.id}/purchase", headers=_csrf(client))
    assert r.status_code == 409 and r.json()["errors"][0]["reason"] == "already_owned"


def test_g_tc_305_my_items(client, factory):
    acc = _login_new(client, factory)
    _own(acc, "cap", equipped=True)
    _own(acc, "glasses")
    r = client.get("/api/v1/me/items")
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body["slots"].keys()) == {"head", "face", "body", "hand", "background"}
    assert body["equipped"]["head"] == str(_item("cap").id)


def test_g_tc_306_equip_switch_unequip(client, factory):
    acc = _login_new(client, factory)
    _own(acc, "cap")   # head
    _own(acc, "crown")  # head
    cap, crown = str(_item("cap").id), str(_item("crown").id)
    # 装備。
    assert client.put("/api/v1/me/equipment", json={"head": cap}, headers=_csrf(client)).json()["equipped"]["head"] == cap
    # 切替（同スロット1点）。
    assert client.put("/api/v1/me/equipment", json={"head": crown}, headers=_csrf(client)).json()["equipped"]["head"] == crown
    with get_tenant_session(_db()) as s:
        u = get_user_by_account(s, acc)
        eq = [ui for ui in s.execute(select(UserItem).where(UserItem.user_id == u.id, UserItem.slot == "head", UserItem.is_equipped.is_(True))).scalars()]
        assert len(eq) == 1  # 部分ユニーク＝1点のみ
    # 解除（null）。
    assert client.put("/api/v1/me/equipment", json={"head": None}, headers=_csrf(client)).json()["equipped"]["head"] is None


def test_g_tc_307_equip_not_owned_or_wrong_slot(client, factory):
    acc = _login_new(client, factory)
    crown = str(_item("crown").id)  # 未所有
    assert client.put("/api/v1/me/equipment", json={"head": crown}, headers=_csrf(client)).status_code == 422
    _own(acc, "cap")  # head を所有
    cap = str(_item("cap").id)
    # cap は head なのに face に付けようとする＝スロット不一致。
    assert client.put("/api/v1/me/equipment", json={"face": cap}, headers=_csrf(client)).status_code == 422


def test_g_tc_308_csrf_and_unauth(client, factory):
    item = _item("cap")
    assert client.post(f"{ITEMS}/{item.id}/purchase").status_code == 401
    _login_new(client, factory)
    assert client.post(f"{ITEMS}/{item.id}/purchase").status_code == 403
    assert client.put("/api/v1/me/equipment", json={"head": None}).status_code == 403


def _set_locale(account_id, locale: str) -> None:
    with get_tenant_session(_db()) as s:
        get_user_by_account(s, account_id).locale = locale
        s.commit()


def test_g_tc_309_my_items_name_locale(client, factory):
    """G-TC-309: 所有装備一覧のマスタ名 locale 出し分け（§2.1・crown=王冠/Crown）。"""
    acc = _login_new(client, factory)
    _own(acc, "crown", equipped=True)  # head

    def _crown_name() -> str:
        body = client.get("/api/v1/me/items").json()
        return next(x["name"] for x in body["slots"]["head"] if x["item_id"] == str(_item("crown").id))

    assert _crown_name() == "王冠"  # 既定 ja
    _set_locale(acc, "en")
    assert _crown_name() == "Crown"  # 受信者 locale=en で英語名


def test_g_tc_307_equip_idempotent(client, factory):
    """G-TC-307: 同じ item を再 PUT しても no-op＝装備維持・二重装備しない（G.2 冪等）。"""
    acc = _login_new(client, factory)
    _own(acc, "cap")
    cap = str(_item("cap").id)
    assert client.put("/api/v1/me/equipment", json={"head": cap}, headers=_csrf(client)).json()["equipped"]["head"] == cap
    r = client.put("/api/v1/me/equipment", json={"head": cap}, headers=_csrf(client))  # 同じ item 再PUT
    assert r.status_code == 200 and r.json()["equipped"]["head"] == cap  # no-op・装備維持
    cap_item = next(d for d in client.get(ITEMS).json()["data"] if d["id"] == cap)
    assert cap_item["is_equipped"] is True  # 解除や重複になっていない


# ---- G-TC-310〜316: GET /items サーバー契約（DataTable・§1.8.1・G.1 拡張・2026-09-17） ----

def _all_items(client):
    return client.get(ITEMS).json()["data"]


def test_g_tc_310_filter_slot_rarity_q(client, factory):
    """G-TC-310: slot/rarity（enum 多値）・q（名前部分一致）フィルタ（§1.8.1②）。"""
    _login_new(client, factory)
    alld = _all_items(client)
    slot = alld[0]["slot"]
    r = client.get(ITEMS, params={"slot": slot}).json()
    assert r["data"] and all(d["slot"] == slot for d in r["data"])
    assert r["page_info"]["total"] == sum(1 for d in alld if d["slot"] == slot)
    r2 = client.get(ITEMS, params={"rarity": "common,rare"}).json()["data"]
    assert r2 and all(d["rarity"] in ("common", "rare") for d in r2)
    name = alld[0]["name_ja"]
    r3 = client.get(ITEMS, params={"q": name}).json()["data"]
    assert any(d["id"] == alld[0]["id"] for d in r3)
    assert all((name in d["name_ja"]) or (name in d["name_en"]) for d in r3)


def test_g_tc_311_filter_owned_affordable(client, factory):
    """G-TC-311: owned/affordable は閲覧者依存（所有・価格≤残高）。SC-30 の状態は owned+affordable で全表現。"""
    acc = _login_new(client, factory)
    _set_coins(acc, 25)
    _own(acc, "cap")
    cap_id = str(_item("cap").id)
    owned = client.get(ITEMS, params={"owned": "true"}).json()["data"]
    assert {d["id"] for d in owned} == {cap_id} and all(d["owned"] for d in owned)
    not_owned = client.get(ITEMS, params={"owned": "false"}).json()["data"]
    assert cap_id not in {d["id"] for d in not_owned} and all(not d["owned"] for d in not_owned)
    aff = client.get(ITEMS, params={"affordable": "true"}).json()["data"]
    assert aff and all(d["price_coin"] <= 25 for d in aff)
    short = client.get(ITEMS, params={"affordable": "false"}).json()["data"]
    assert all(d["price_coin"] > 25 for d in short)


def test_g_tc_312_price_range_and_sort(client, factory):
    """G-TC-312: 価格レンジ＋ソート（price/-price/既定 rarity 序列・§1.8.1①）。"""
    _login_new(client, factory)
    prices = sorted(d["price_coin"] for d in _all_items(client))
    lo, hi = prices[1], prices[-2]
    ranged = client.get(ITEMS, params={"price_min": lo, "price_max": hi}).json()["data"]
    assert ranged and all(lo <= d["price_coin"] <= hi for d in ranged)
    asc = [d["price_coin"] for d in client.get(ITEMS, params={"sort": "price"}).json()["data"]]
    assert asc == sorted(asc)
    desc = [d["price_coin"] for d in client.get(ITEMS, params={"sort": "-price"}).json()["data"]]
    assert desc == sorted(desc, reverse=True)
    rank = {"common": 0, "standard": 1, "rare": 2}
    default_ranks = [rank[d["rarity"]] for d in _all_items(client)]  # 既定＝rarity 昇順
    assert default_ranks == sorted(default_ranks)


def test_g_tc_313_offset_pagination(client, factory):
    """G-TC-313: 番号ページャ（offset page/per_page＋page_info.total）／未指定は全件（後方互換）。"""
    _login_new(client, factory)
    total = len(_all_items(client))
    p1 = client.get(ITEMS, params={"page": 1, "per_page": 5}).json()
    assert len(p1["data"]) == 5 and p1["page_info"] == {"total": total, "page": 1, "per_page": 5}
    p2 = client.get(ITEMS, params={"page": 2, "per_page": 5}).json()
    assert len(p2["data"]) == 5
    assert {d["id"] for d in p1["data"]}.isdisjoint({d["id"] for d in p2["data"]})
    allr = client.get(ITEMS).json()  # 未指定＝全件
    assert allr["page_info"]["total"] == total and len(allr["data"]) == total


def test_g_tc_314_pinned_resolved_and_excluded(client, factory):
    """G-TC-314: 固定行（pin_ids）は送信順で解決＋非固定母集合（data/total）から除外（§1.8.1④）。"""
    _login_new(client, factory)
    alld = _all_items(client)
    p1, p2 = alld[0]["id"], alld[1]["id"]
    r = client.get(ITEMS, params={"pin_ids": f"{p1},{p2}"}).json()
    assert [d["id"] for d in r["pinned"]] == [p1, p2]
    ids = {d["id"] for d in r["data"]}
    assert p1 not in ids and p2 not in ids
    assert r["page_info"]["total"] == len(alld) - 2


def test_g_tc_315_validation_422(client, factory):
    """G-TC-315: 未知の sort キー/enum 値はホワイトリスト検証で 422（§1.8.1・§2.2）。"""
    _login_new(client, factory)
    assert client.get(ITEMS, params={"sort": "bogus"}).status_code == 422
    assert client.get(ITEMS, params={"slot": "wing"}).status_code == 422
    assert client.get(ITEMS, params={"rarity": "legendary"}).status_code == 422


def test_g_tc_316_csv_export(client, factory):
    """G-TC-316: format=csv で同一絞込/ソートの全件を CSV（UTF-8 BOM・ヘッダ・§1.8.1③）。"""
    _login_new(client, factory)
    r = client.get(ITEMS, params={"format": "csv"})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/csv")
    assert r.content.startswith(b"\xef\xbb\xbf")  # UTF-8 BOM（Excel 互換）
    assert "名称" in r.content.decode("utf-8-sig").splitlines()[0]  # ヘッダ行


def test_g_tc_317_state_multi_enum(client, factory):
    """G-TC-317: 状態列（state）多値 enum＝各述語の OR（所有／未所有かつ購入可／未所有かつ不足・§1.8.1②）。"""
    acc = _login_new(client, factory)
    _set_coins(acc, 25)
    _own(acc, "cap")  # price 20 ≤ 25
    cap_id = str(_item("cap").id)
    owned = {d["id"] for d in client.get(ITEMS, params={"state": "owned"}).json()["data"]}
    assert owned == {cap_id}
    short = client.get(ITEMS, params={"state": "short"}).json()["data"]
    assert short and all((not d["owned"]) and d["price_coin"] > 25 for d in short)
    both = client.get(ITEMS, params={"state": "owned,short"}).json()["data"]
    ids = {d["id"] for d in both}
    assert cap_id in ids and all(d["owned"] or d["price_coin"] > 25 for d in both)  # 所有 ∪ 不足
    assert client.get(ITEMS, params={"state": "bogus"}).status_code == 422
