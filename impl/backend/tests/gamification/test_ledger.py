"""G 台帳サービス（残高 write の canonical）の DB テスト（データモデル §7／API設計 G.0）。

`activities` 追記＋`users` 残高更新を同一 Tx で行い、XP 付与でレベル再計算＋`levelup_sp` を連動発行する。
ログイン XP はユーザー×JST日で1回（冪等）。会社DB は seed 会社（factory の実アカウント＋users ミラー）。
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from app.control_plane.auth.orm import Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.gamification import ledger
from app.tenant.gamification.orm import Activity
from app.tenant.profile.repository import get_user_by_account
from tests.conftest import SEED_COMPANY_CODE


def _db_identifier() -> str:
    with control_session() as s:
        return s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().db_identifier


def _activities(dbid: str, user_id: uuid.UUID) -> list[Activity]:
    with get_tenant_session(dbid) as s:
        return list(s.query(Activity).filter_by(user_id=user_id).order_by(Activity.created_at).all())


def test_grant_xp_updates_balance_level_and_levelup_sp(factory):
    """XP 付与＝users.xp 更新＋レベル再計算＋上昇分の levelup_sp（SP+1/Lv）を同一 Tx で記帳。"""
    acc = factory.make_seed_company_account()
    dbid = _db_identifier()
    with get_tenant_session(dbid) as s:
        user = get_user_by_account(s, acc["id"])
        ledger.grant(s, user, kind=ledger.XP_GAIN, amount=100, reason="idea_post",
                     ref_type="ideas", ref_id=uuid.uuid4())  # xp 0→100＝Lv1→2
        s.commit()
        uid = user.id

    with get_tenant_session(dbid) as s:
        user = get_user_by_account(s, acc["id"])
        assert user.xp == 100 and user.level == 2 and user.skill_point_balance == 1

    acts = _activities(dbid, uid)
    assert [(a.kind, a.reason, a.amount) for a in acts] == [
        ("xp_gain", "idea_post", 100), ("sp_gain", "levelup_sp", 1)
    ]


def test_grant_coin_spend_decrements(factory):
    """コイン消費＝amount は正・kind で方向（coin_balance を減算）。"""
    acc = factory.make_seed_company_account()
    dbid = _db_identifier()
    with get_tenant_session(dbid) as s:
        user = get_user_by_account(s, acc["id"])
        user.coin_balance = 100
        ledger.grant(s, user, kind=ledger.COIN_SPEND, amount=30, reason="shop_purchase",
                     ref_type="items", ref_id=uuid.uuid4())
        s.commit()

    with get_tenant_session(dbid) as s:
        assert get_user_by_account(s, acc["id"]).coin_balance == 70


def test_grant_daily_login_is_idempotent_per_jst_day(factory):
    """ログイン XP＝同一 JST 日は1回だけ付与（2回目は None・no-op）、翌 JST 日で再付与。"""
    acc = factory.make_seed_company_account()
    dbid = _db_identifier()
    now = datetime.now(timezone.utc)
    with get_tenant_session(dbid) as s:
        user = get_user_by_account(s, acc["id"])
        first = ledger.grant_daily_login(s, user, now=now)
        s.commit()
        assert first is not None and user.xp == 10

    with get_tenant_session(dbid) as s:
        user = get_user_by_account(s, acc["id"])
        second = ledger.grant_daily_login(s, user, now=now)  # 同 JST 日＝no-op
        s.commit()
        assert second is None and user.xp == 10

    with get_tenant_session(dbid) as s:
        user = get_user_by_account(s, acc["id"])
        third = ledger.grant_daily_login(s, user, now=now + timedelta(days=1))  # 翌 JST 日＝再付与
        s.commit()
        assert third is not None and user.xp == 20
