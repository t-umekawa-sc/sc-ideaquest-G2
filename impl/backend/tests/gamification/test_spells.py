"""G-TC-101〜106: 魔法カタログ・解放 API（SC-32・E.4 前提）。

throwaway アカウントを作成しログイン（他 gamification テストと同方式）。SP は会社DB で直接設定して解放を検証。
解放＝SP 消費（ledger SP_SPEND・reason=spell_unlock）＋user_spells 追加。前提/SP/二重解放はサーバー強制。
"""
from __future__ import annotations

from sqlalchemy import select

from app.control_plane.auth.orm import Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.chat.orm import Spell, UserSpell
from app.tenant.gamification.orm import Activity
from app.tenant.profile.repository import get_user_by_account
from tests.admin.test_admin_accounts import _login
from tests.conftest import SEED_COMPANY_CODE

SPELLS = "/api/v1/spells"


def _db_identifier() -> str:
    with control_session() as s:
        return s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().db_identifier


def _csrf(client) -> dict:
    return {"X-CSRF-Token": client.cookies.get("iq_csrf")}


def _login_new(client, factory) -> str:
    acc = factory.make_seed_company_account()
    _login(client, SEED_COMPANY_CODE, acc["login_id"], acc["password"])
    return acc["id"]


def _set_sp(account_id, sp: int) -> None:
    with get_tenant_session(_db_identifier()) as s:
        u = get_user_by_account(s, account_id)
        u.skill_point_balance = sp
        s.commit()


def _spell(code: str) -> Spell:
    with get_tenant_session(_db_identifier()) as s:
        return s.execute(select(Spell).where(Spell.code == code)).scalars().one()


def _unlock(client, spell_id) -> "object":
    return client.post(f"{SPELLS}/{spell_id}/unlock", headers=_csrf(client))


def test_g_tc_101_catalog(client, factory):
    acc = _login_new(client, factory)
    _set_sp(acc, 0)
    r = client.get(SPELLS)
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["data"]) == 6 and body["skill_point_balance"] == 0
    by_code = {s["code"]: s for s in body["data"]}
    assert by_code["flame_1"]["unlocked"] is False and by_code["flame_1"]["requires_spell_id"] is None
    assert by_code["flame_1"]["can_unlock"] is False  # SP 0 で不足


def test_g_tc_102_unlock_success(client, factory):
    acc = _login_new(client, factory)
    _set_sp(acc, 3)
    sid = _spell("flame_1").id  # cost 1
    r = _unlock(client, sid)
    assert r.status_code == 200, r.text
    assert r.json()["unlocked"] is True and r.json()["skill_point_balance"] == 2
    with get_tenant_session(_db_identifier()) as s:
        u = get_user_by_account(s, acc)
        assert s.execute(select(UserSpell).where(UserSpell.user_id == u.id, UserSpell.spell_id == sid)).scalars().first() is not None
        assert s.execute(select(Activity).where(Activity.user_id == u.id, Activity.reason == "spell_unlock", Activity.ref_id == sid)).scalars().first() is not None


def test_g_tc_103_insufficient_sp(client, factory):
    acc = _login_new(client, factory)
    _set_sp(acc, 0)
    r = _unlock(client, _spell("flame_1").id)
    assert r.status_code == 409 and r.json()["errors"][0]["reason"] == "insufficient_sp"


def test_g_tc_104_prerequisite_not_met(client, factory):
    acc = _login_new(client, factory)
    _set_sp(acc, 5)
    r = _unlock(client, _spell("flame_2").id)  # requires flame_1（未解放）
    assert r.status_code == 409 and r.json()["errors"][0]["reason"] == "prerequisite_not_met"


def test_g_tc_105_already_unlocked(client, factory):
    acc = _login_new(client, factory)
    _set_sp(acc, 3)
    sid = _spell("flame_1").id
    assert _unlock(client, sid).status_code == 200
    r = _unlock(client, sid)
    assert r.status_code == 409 and r.json()["errors"][0]["reason"] == "already_unlocked"


def test_g_tc_106_csrf_and_unauth(client, factory):
    sid = _spell("flame_1").id
    assert client.post(f"{SPELLS}/{sid}/unlock").status_code == 401
    acc = _login_new(client, factory)
    _set_sp(acc, 3)
    assert client.post(f"{SPELLS}/{sid}/unlock").status_code == 403