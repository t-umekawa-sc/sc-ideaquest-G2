"""プロフィール画像・背景画像（K.4・MinIO 署名URL）のテスト（API設計 K.4・§1.10）。

会社DB `users.avatar_image_path`/`background_image_path` を直接更新（identity ではない＝outbox なし）。
読取は短TTL 署名URL。ストレージは Fake（メモリ）に差し替え＝MinIO 非依存。
"""
from __future__ import annotations

from tests.admin.test_admin_accounts import _login
from tests.conftest import SEED_COMPANY_CODE

ME = "/api/v1/me"
AVATAR = "/api/v1/me/avatar-image"
BACKGROUND = "/api/v1/me/background-image"

# 最小の PNG（1x1・シグネチャ含む＝サーバーは MIME/サイズ＋マジックバイト §8 を検証）
PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d494844520000000100000001080600000"
    "01f15c4890000000a49444154789c6360000002000154a24f0e0000000049454e44ae426082"
)
# 最小の JPEG（SOI＋APP0 JFIF・シグネチャ \xff\xd8\xff で十分）
JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00" + b"\xff\xd9"


def _csrf(client) -> dict:
    return {"X-CSRF-Token": client.cookies.get("iq_csrf")}


def _login_seed(client, factory):
    acc = factory.make_seed_company_account()
    _login(client, SEED_COMPANY_CODE, acc["login_id"], acc["password"])
    return acc


def test_k_tc_avatar_put_sets_signed_url(client, factory, storage):
    """K-TC-avatar-01 アバター設定＝200＋署名URL、GET /me にも署名URL が出る。"""
    _login_seed(client, factory)
    r = client.put(AVATAR, files={"file": ("a.png", PNG, "image/png")}, headers=_csrf(client))
    assert r.status_code == 200, r.text
    url = r.json()["avatar_image_url"]
    assert url and url.startswith("https://minio.test/avatars/")
    assert len(storage.objects) == 1  # Fake に保存された
    # GET /me が署名URL を返す（パス直返しでない）
    assert client.get(ME).json()["profile"]["avatar_image_url"].startswith("https://minio.test/avatars/")


def test_k_tc_avatar_rejects_non_image(client, factory, storage):
    """K-TC-avatar-02 画像以外は 422（MIME allowlist・§2.2⑧）＝保存されない。"""
    _login_seed(client, factory)
    r = client.put(AVATAR, files={"file": ("a.txt", b"hello", "text/plain")}, headers=_csrf(client))
    assert r.status_code == 422
    assert len(storage.objects) == 0


def test_k_tc_avatar_rejects_empty(client, factory, storage):
    """K-TC-avatar-03 空ファイルは 422。"""
    _login_seed(client, factory)
    r = client.put(AVATAR, files={"file": ("a.png", b"", "image/png")}, headers=_csrf(client))
    assert r.status_code == 422


def test_k_tc_avatar_delete_resets(client, factory, storage):
    """K-TC-avatar-04 削除＝204、GET /me の avatar_image_url は None、旧オブジェクトも消える。"""
    _login_seed(client, factory)
    client.put(AVATAR, files={"file": ("a.png", PNG, "image/png")}, headers=_csrf(client))
    r = client.delete(AVATAR, headers=_csrf(client))
    assert r.status_code == 204
    assert client.get(ME).json()["profile"]["avatar_image_url"] is None
    assert len(storage.objects) == 0


def test_k_tc_background_put_and_delete(client, factory, storage):
    """K-TC-bg-01 背景画像 設定＝200＋署名URL、削除＝204＋None。"""
    _login_seed(client, factory)
    r = client.put(BACKGROUND, files={"file": ("b.jpg", JPEG, "image/jpeg")}, headers=_csrf(client))
    assert r.status_code == 200, r.text
    assert r.json()["background_image_url"].startswith("https://minio.test/backgrounds/")
    assert client.get(ME).json()["profile"]["background_image_url"].startswith("https://minio.test/backgrounds/")
    assert client.delete(BACKGROUND, headers=_csrf(client)).status_code == 204
    assert client.get(ME).json()["profile"]["background_image_url"] is None
