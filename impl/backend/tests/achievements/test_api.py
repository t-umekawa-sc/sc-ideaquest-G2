"""G-TC-501〜506: 実績 API（SC-40・G.4・§8-⑲）。

throwaway アカウントでログイン（決定性）。付与は ledger.grant（judge=True）で行い、engine の後フックが自動判定する。
コイン/進捗/シークレット伏せ/冪等/全種系/自分の獲得を検証。
"""
from __future__ import annotations

import uuid

from sqlalchemy import select

from app.control_plane.auth.orm import Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.achievements.orm import Achievement
from app.tenant.gamification import ledger
from app.tenant.gamification.orm import Activity
from app.tenant.chat.orm import Spell, UserSpell
from app.tenant.profile.orm import User
from app.tenant.profile.repository import get_user_by_account
from tests.admin.test_admin_accounts import _login
from tests.conftest import SEED_COMPANY_CODE

ACH = "/api/v1/achievements"


def _db() -> str:
    with control_session() as s:
        return s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().db_identifier


def _login_new(client, factory):
    acc = factory.make_seed_company_account()
    _login(client, SEED_COMPANY_CODE, acc["login_id"], acc["password"])
    with get_tenant_session(_db()) as s:
        return get_user_by_account(s, acc["id"]).id


def _grant_evaluation(user_id, n: int):
    """評価付与（reason=evaluation）を n 回＝engine 後フックで evaluator_3 等を判定。"""
    for _ in range(n):
        with get_tenant_session(_db()) as s:
            u = s.get(User, user_id)
            ledger.grant(s, u, kind=ledger.XP_GAIN, amount=30, reason="evaluation", ref_type="evaluations", ref_id=uuid.uuid4())
            s.commit()


def _ach_id(code: str):
    with get_tenant_session(_db()) as s:
        return s.execute(select(Achievement.id).where(Achievement.code == code)).scalars().one()


def _reward_count(user_id, ach_id) -> int:
    with get_tenant_session(_db()) as s:
        return len(list(s.execute(select(Activity).where(
            Activity.user_id == user_id, Activity.reason == "achievement_reward", Activity.ref_id == ach_id)).scalars()))


def test_g_tc_501_list_and_secret_hidden(client, factory):
    _login_new(client, factory)
    r = client.get(ACH)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["summary"]["total"] == 12 and body["summary"]["unlocked"] == 0
    by_id = {d["id"]: d for d in body["data"]}
    secret = next(d for d in body["data"] if d.get("is_secret") and not d["unlocked"])
    assert secret["name"] == "？？？" and secret["tier"] is None
    assert len(by_id) == 12


def test_g_tc_502_auto_unlock_via_ledger_hook(client, factory):
    acc = _login_new(client, factory)
    _grant_evaluation(acc, 3)  # evaluator_3（target 3）達成
    body = client.get(ACH).json()
    ev = next(d for d in body["data"] if d.get("code") == "evaluator_3")
    assert ev["unlocked"] is True and body["summary"]["coin_earned"] >= 20
    assert _reward_count(acc, _ach_id("evaluator_3")) == 1
    with get_tenant_session(_db()) as s:
        assert s.get(User, acc).coin_balance >= 20


def test_g_tc_503_progress_not_met(client, factory):
    acc = _login_new(client, factory)
    _grant_evaluation(acc, 2)  # 未達（2/3）
    body = client.get(ACH).json()
    ev = next(d for d in body["data"] if d.get("code") == "evaluator_3")
    assert ev["unlocked"] is False and ev["progress"] == {"current": 2, "target": 3}


def test_g_tc_504_reward_once(client, factory):
    acc = _login_new(client, factory)
    _grant_evaluation(acc, 4)  # 3で達成、4件目でも再付与しない
    assert _reward_count(acc, _ach_id("evaluator_3")) == 1


def test_g_tc_505_all_spells(client, factory):
    acc = _login_new(client, factory)
    # 全魔法を seed（user_spells 6件）→ spell_unlock 付与で all_spells 判定。
    with get_tenant_session(_db()) as s:
        for sid in s.execute(select(Spell.id)).scalars().all():
            s.add(UserSpell(id=uuid.uuid4(), user_id=acc, spell_id=sid))
        s.commit()
    with get_tenant_session(_db()) as s:
        u = s.get(User, acc)
        ledger.grant(s, u, kind=ledger.SP_SPEND, amount=1, reason="spell_unlock", ref_type="spells", ref_id=uuid.uuid4())
        s.commit()
    body = client.get(ACH).json()
    sm = next(d for d in body["data"] if d.get("code") == "spellmaster")
    assert sm["unlocked"] is True
    assert _reward_count(acc, _ach_id("spellmaster")) == 1


def test_g_tc_506_my_achievements(client, factory):
    acc = _login_new(client, factory)
    _grant_evaluation(acc, 3)
    r = client.get("/api/v1/me/achievements")
    assert r.status_code == 200, r.text
    codes = {d["code"] for d in r.json()["data"]}
    assert "evaluator_3" in codes
