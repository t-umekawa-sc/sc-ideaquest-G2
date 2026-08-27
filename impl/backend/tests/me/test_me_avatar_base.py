"""PUT /me/avatar-base（3D アバターの男女2ベース選択）のテスト（doc/テスト/K_プロフィール.md §1・API設計 K.4.1）。

avatar_base は会社DB `users` 所有の profile 属性＝画像（K.4）と同じく直接更新（identity ではない＝outbox 非経由）。
`base` は avatar_base enum（male/female）を検証・allowlist 外/未対応値は 422（Mass Assignment 防止・§2.2）。
発行アカウント・users ミラーは factory teardown が掃除する。
"""
from __future__ import annotations

from app.db.tenant import get_tenant_session
from app.tenant.profile.repository import get_user_by_account
from tests.me.test_me import _csrf, _db_identifier, _login_seed, _outbox

ME = "/api/v1/me"
AVATAR_BASE = "/api/v1/me/avatar-base"


def _user_avatar_base(account_id) -> str:
    with get_tenant_session(_db_identifier()) as ts:
        return get_user_by_account(ts, account_id).avatar_base


def test_k_tc_011_put_avatar_base_updates_users(client, factory):
    """K-TC-011 male→female＝200・会社DB users.avatar_base 反映・outbox 非経由（identity でない）。"""
    acc = _login_seed(client, factory)
    assert _user_avatar_base(acc["id"]) == "male"  # 既定

    r = client.put(AVATAR_BASE, json={"base": "female"}, headers=_csrf(client))
    assert r.status_code == 200, r.text
    assert r.json()["profile"]["avatar_base"] == "female"  # 更新後 /me（K.1 形）

    assert _user_avatar_base(acc["id"]) == "female"  # 会社DB users に直接反映
    # identity ではないため account_sync_outbox に avatar_base 行は積まれない（K.4.1）
    assert not any("avatar_base" in x.payload for x in _outbox(acc["id"]))


def test_k_tc_012_avatar_base_enum_and_allowlist(client, factory):
    """K-TC-012 未対応値／allowlist 外プロパティは 422（enum＋extra=forbid・§2.2）・値は不変。"""
    acc = _login_seed(client, factory)
    # 未対応 enum 値
    assert client.put(AVATAR_BASE, json={"base": "animal_dog"}, headers=_csrf(client)).status_code == 422
    # allowlist 外プロパティ同梱（Mass Assignment 防止）
    assert client.put(AVATAR_BASE, json={"base": "female", "xp": 999}, headers=_csrf(client)).status_code == 422
    assert _user_avatar_base(acc["id"]) == "male"  # いずれも不変


def test_k_tc_013_avatar_base_auth_and_csrf(client, factory):
    """K-TC-013 未認証は 401（先）／ログイン済み CSRF 無しは 403（変更系・A.0）。"""
    assert client.put(AVATAR_BASE, json={"base": "female"}).status_code == 401
    _login_seed(client, factory)
    assert client.put(AVATAR_BASE, json={"base": "female"}).status_code == 403  # CSRF 無し


def test_k_tc_014_get_me_includes_avatar_base(client, factory):
    """K-TC-014 GET /me が profile.avatar_base を同梱（未設定は既定 male）。"""
    _login_seed(client, factory)
    body = client.get(ME).json()
    assert body["profile"]["avatar_base"] == "male"
