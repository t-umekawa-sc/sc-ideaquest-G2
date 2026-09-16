"""G-TC-501〜506: 実績 API（SC-40・G.4・§8-⑲）。

throwaway アカウントでログイン（決定性）。付与は ledger.grant（judge=True）で行い、engine の後フックが自動判定する。
コイン/進捗/シークレット伏せ/冪等/全種系/自分の獲得を検証。
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.control_plane.auth.orm import Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.achievements.orm import Achievement
from app.tenant.gamification import ledger
from app.tenant.gamification.orm import Activity
from app.tenant.chat.orm import Spell, UserSpell
from app.tenant.shop.orm import Item, UserItem
from app.tenant.profile.orm import User
from app.tenant.profile.repository import get_user_by_account
from tests.admin.test_admin_accounts import _login
from tests.conftest import SEED_COMPANY_CODE

ACH = "/api/v1/achievements"
_JST = timezone(timedelta(hours=9))


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
        u.skill_point_balance = 6  # 解放前提の SP を保持（CHECK(>=0)・実運用はレベルアップで獲得）
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


def _grant(user_id, *, reason: str, kind=ledger.XP_GAIN, amount: int = 1, n: int = 1):
    """任意 reason/kind の付与を n 回（engine 後フックで当該実績を再判定）。"""
    for _ in range(n):
        with get_tenant_session(_db()) as s:
            u = s.get(User, user_id)
            ledger.grant(s, u, kind=kind, amount=amount, reason=reason, ref_type="t", ref_id=uuid.uuid4())
            s.commit()


def _code_row(body, code):
    return next(d for d in body["data"] if d.get("code") == code)


# G-TC-509: count 条件の他理由（vote/selection/chat）＝各理由が閾値ちょうどで解除される（reason ルーティング）。
# 評価カウントは G-TC-502 済み。ここは投票/選定/チャットの reason 配線＋閾値到達を担保。
def test_g_tc_509_count_reasons_unlock_at_threshold(client, factory):
    acc = _login_new(client, factory)
    _grant(acc, reason="vote", n=5)       # voter_5（target 5）
    _grant(acc, reason="selection", n=2)  # selector_2（target 2）
    _grant(acc, reason="chat", n=9)       # chatty_10（target 10）＝9 では未達
    body = client.get(ACH).json()
    assert _code_row(body, "voter_5")["unlocked"] is True
    assert _code_row(body, "selector_2")["unlocked"] is True
    chatty = _code_row(body, "chatty_10")
    assert chatty["unlocked"] is False and chatty["progress"] == {"current": 9, "target": 10}  # 閾値手前は未解除
    _grant(acc, reason="chat", n=1)       # 10 件目でちょうど解除
    assert _code_row(client.get(ACH).json(), "chatty_10")["unlocked"] is True


# G-TC-510: level 条件＝XP 付与で到達レベルに応じて解除（level_5=Lv5・level_10=Lv10）。境界（Lv4 では未解除）。
# レベル必要 XP（§7 累積）＝Lv5:700 / Lv10:2700。
def test_g_tc_510_level_unlock_at_threshold(client, factory):
    acc = _login_new(client, factory)
    _grant(acc, reason="idea_post", amount=650)  # Lv4（<700）＝level_5 未達
    b1 = client.get(ACH).json()
    assert _code_row(b1, "level_5")["unlocked"] is False
    _grant(acc, reason="idea_post", amount=50)   # 累計 700＝Lv5 到達で level_5 解除・level_10 は未達
    b2 = client.get(ACH).json()
    assert _code_row(b2, "level_5")["unlocked"] is True
    assert _code_row(b2, "level_10")["unlocked"] is False
    _grant(acc, reason="idea_post", amount=2000)  # 累計 2700＝Lv10 到達で level_10 解除
    assert _code_row(client.get(ACH).json(), "level_10")["unlocked"] is True


# G-TC-511: streak_login 条件＝連続ログイン日数で解除（streak_7）。6 日連続では未解除・7 日目で解除。
def _seed_login(user_id, days_ago: int):
    with get_tenant_session(_db()) as s:
        s.add(Activity(id=uuid.uuid4(), user_id=user_id, kind=ledger.XP_GAIN, amount=5, reason="login",
                       created_at=datetime.now(timezone.utc) - timedelta(days=days_ago)))
        s.commit()


def test_g_tc_511_streak_login_unlock_at_threshold(client, factory):
    acc = _login_new(client, factory)
    for d in range(1, 6):  # 昨日〜5日前＝5日分を先に seed（今日を足すと 6 日連続＝streak_7 未達）
        _seed_login(acc, d)
    _grant(acc, reason="login", amount=5)  # 今日のログイン＝計6日連続 → 未解除
    b1 = client.get(ACH).json()
    s7 = _code_row(b1, "streak_7")
    assert s7["unlocked"] is False and s7["progress"] == {"current": 6, "target": 7}
    _seed_login(acc, 6)  # 6日前を追加＝7日連続（6日前〜今日）
    _grant(acc, reason="login", amount=5)  # 再ログイン付与で再判定 → 解除
    assert _code_row(client.get(ACH).json(), "streak_7")["unlocked"] is True


# G-TC-512: all_items 条件＝全装備所有で解除（collector）。shop_purchase 付与で判定。
def test_g_tc_512_all_items_unlock(client, factory):
    acc = _login_new(client, factory)
    with get_tenant_session(_db()) as s:
        items = s.execute(select(Item)).scalars().all()
        assert len(items) > 0  # カタログに装備がある前提（0016 相当の seed）
        for it in items:
            s.add(UserItem(id=uuid.uuid4(), user_id=acc, item_id=it.id, slot=it.slot))
        s.get(User, acc).coin_balance = 100  # shop_purchase（COIN_SPEND）の残高
        s.commit()
    _grant(acc, reason="shop_purchase", kind=ledger.COIN_SPEND, amount=1)  # 判定トリガー
    col = _code_row(client.get(ACH).json(), "collector")
    assert col["unlocked"] is True
    assert _reward_count(acc, _ach_id("collector")) == 1


def _set_locale(user_id, locale: str) -> None:
    with get_tenant_session(_db()) as s:
        s.get(User, user_id).locale = locale
        s.commit()


def test_g_tc_507_achievement_name_locale(client, factory):
    """G-TC-507: 実績一覧のマスタ名/説明 locale 出し分け（§2.1・evaluator_3=評価者/Evaluator）。"""
    uid = _login_new(client, factory)  # 非シークレット実績は未獲得でも実名で返る

    def _row():
        return next(a for a in client.get(ACH).json()["data"] if a.get("code") == "evaluator_3")

    r_ja = _row()  # 既定 ja
    assert r_ja["name"] == "評価者"
    assert r_ja["description"] == "評価を3件確定する" and r_ja["condition_label"] == "評価を3件確定する"
    _set_locale(uid, "en")
    r_en = _row()  # 受信者 locale=en
    assert r_en["name"] == "Evaluator"
    assert r_en["description"] == "Submit 3 evaluations" and r_en["condition_label"] == "Submit 3 evaluations"
