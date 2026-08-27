"""G 台帳サービス（残高 write の canonical）の DB テスト（データモデル §7／API設計 G.0）。

`activities` 追記＋`users` 残高更新を同一 Tx で行い、XP 付与でレベル再計算＋`levelup_sp` を連動発行する。
ログイン XP はユーザー×JST日で1回（冪等）。会社DB は seed 会社（factory の実アカウント＋users ミラー）。
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.exc import IntegrityError

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


def test_g_tc_107_balance_check_nonneg(factory):
    """G-TC-107 残高列は DB CHECK(>=0)＝負残高への更新は拒否（並行オーバースペンドの最終防御・データモデル §5/G.0・M6）。"""
    dbid = _db_identifier()
    acc = factory.make_seed_company_account()
    for field in ("coin_balance", "skill_point_balance", "xp"):
        with get_tenant_session(dbid) as s:
            user = get_user_by_account(s, acc["id"])
            setattr(user, field, -1)
            with pytest.raises(IntegrityError):
                s.commit()  # CHECK(>=0) で拒否


def test_g_tc_108_activities_grant_ref_unique(factory):
    """G-TC-108 activities の付与は (user,kind,reason,ref_type,ref_id) が ref付きで部分ユニーク＝並行二重付与を DB で拒否（F.4・M6）。

    ref_id NULL（login/levelup_sp）は重複可＝日次ログイン等が複数行入る。
    """
    dbid = _db_identifier()
    acc = factory.make_seed_company_account()
    with get_tenant_session(dbid) as s:
        uid = get_user_by_account(s, acc["id"]).id
    ref = uuid.uuid4()
    # 同一 ref の二重付与＝DB で拒否（exists_ref の SELECT を抜けた並行 INSERT の最終防御）
    with get_tenant_session(dbid) as s:
        s.add(Activity(id=uuid.uuid4(), user_id=uid, kind="xp_gain", amount=5, reason="vote", ref_type="ideas", ref_id=ref))
        s.add(Activity(id=uuid.uuid4(), user_id=uid, kind="xp_gain", amount=5, reason="vote", ref_type="ideas", ref_id=ref))
        with pytest.raises(IntegrityError):
            s.commit()
    # ref_id NULL は重複可（login を2件入れても通る）
    with get_tenant_session(dbid) as s:
        s.add(Activity(id=uuid.uuid4(), user_id=uid, kind="xp_gain", amount=10, reason="login", ref_type=None, ref_id=None))
        s.add(Activity(id=uuid.uuid4(), user_id=uid, kind="xp_gain", amount=10, reason="login", ref_type=None, ref_id=None))
        s.commit()  # 例外なし


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
