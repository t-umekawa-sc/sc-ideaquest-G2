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
