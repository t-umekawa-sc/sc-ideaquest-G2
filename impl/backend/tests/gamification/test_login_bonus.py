"""ログイン XP 付与の統合テスト（API設計 G.6・A.1／データモデル §7）。

ログイン成功時に日次ログイン XP（+10・ユーザー×JST日で1回）を台帳へ付与し、`GET /me` の残高に
反映されることを担保。付与は冪等（同 JST 日の再ログインで増えない）。
"""
from __future__ import annotations

from tests.admin.test_admin_accounts import _login
from tests.conftest import SEED_COMPANY_CODE

ME = "/api/v1/me"


def test_login_grants_daily_xp_reflected_in_me(client, factory):
    """G-TC-login-01 ログイン成功→GET /me の balance.xp が +10（Lv1/進捗 90）。"""
    acc = factory.make_seed_company_account()
    _login(client, SEED_COMPANY_CODE, acc["login_id"], acc["password"])

    bal = client.get(ME).json()["balance"]
    assert bal["xp"] == 10
    assert bal["level"] == 1 and bal["xp_to_next"] == 90  # Lv1→2 は 100 必要・残 90


def test_relogin_same_day_does_not_double_grant(client, factory):
    """G-TC-login-02 同 JST 日の再ログインは XP を二重付与しない（冪等・台帳存在チェック）。"""
    acc = factory.make_seed_company_account()
    _login(client, SEED_COMPANY_CODE, acc["login_id"], acc["password"])
    assert client.get(ME).json()["balance"]["xp"] == 10

    client.cookies.clear()
    _login(client, SEED_COMPANY_CODE, acc["login_id"], acc["password"])  # 2回目
    assert client.get(ME).json()["balance"]["xp"] == 10  # 増えない
