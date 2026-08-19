"""オブジェクトストレージ（MinIO・画像/添付・API設計 §1.10・コーディング規約 §3.4 infra）。

- 配送手段（put/署名GET/削除）を Protocol `ObjectStorage` で抽象化＝本番/dev は MinIO、テストは
  Fake（メモリ）に差し替える（`app.infra.mail` と同じ流儀）。業務ロジック（誰の何を保存するか）は
  application 層が決める（§3.1）。
- **非公開バケット＋短TTL 署名URL**＝恒久公開URLは作らない（§1.10・直リンク流出耐性）。物理名はハッシュ
  （元名を露出しない・列挙不可）。署名鍵はサーバー専任（規約 §2.2）。
- **署名URL のホスト問題（dev）**: 署名は host を含むため、backend→MinIO 内部（`minio:9000`）で put しつつ、
  ブラウザが到達できる公開ホスト（`localhost:9000`）で presign する。presign は HMAC 計算のみで接続しない
  ため、公開ホスト用クライアントは接続せず署名だけ生成でき、ブラウザからの GET で検証が通る。
"""
from __future__ import annotations

import hashlib
import io
import uuid
from datetime import timedelta
from typing import Protocol

from app.core.config import get_settings

# 画像 MIME allowlist（K.4・データモデル §8-⑦・初期値）。拡張子は物理名生成用。
ALLOWED_IMAGE_MIME: dict[str, str] = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
}
MAX_IMAGE_BYTES = 5 * 1024 * 1024  # 画像 1ファイル 5MB（初期値・K.6 TBD）


def hashed_key(data: bytes, content_type: str, *, prefix: str) -> str:
    """物理オブジェクトキー＝`<prefix>/<sha256前半>-<乱数>.<ext>`（元名非露出・衝突/列挙耐性）。"""
    digest = hashlib.sha256(data).hexdigest()[:32]
    ext = ALLOWED_IMAGE_MIME.get(content_type, "bin")
    return f"{prefix}/{digest}-{uuid.uuid4().hex[:8]}.{ext}"


class ObjectStorage(Protocol):
    def put(self, data: bytes, content_type: str, *, prefix: str) -> str: ...
    def presigned_get(self, key: str) -> str: ...
    def remove(self, key: str) -> None: ...


class MinioStorage:
    """MinIO 実装（dev/prod）。ops クライアント＝内部（put/remove/bucket）、url クライアント＝公開ホストで
    presign（接続せず署名のみ）。"""

    def __init__(self) -> None:
        from minio import Minio  # 遅延 import（テストは Fake に差し替え＝未接続）

        s = get_settings()
        self._bucket = s.minio_bucket
        self._ttl = s.minio_url_ttl_seconds
        # region を明示＝presign が GetBucketLocation の HTTP を打たない（公開ホストは backend から
        # 到達不要でオフライン署名でき、ブラウザからの GET で検証が通る）。
        self._ops = Minio(s.minio_endpoint, access_key=s.minio_access_key,
                          secret_key=s.minio_secret_key, secure=s.minio_secure, region=s.minio_region)
        self._url = Minio(s.minio_public_endpoint, access_key=s.minio_access_key,
                          secret_key=s.minio_secret_key, secure=s.minio_secure, region=s.minio_region)
        self._ensure_bucket()

    def _ensure_bucket(self) -> None:
        if not self._ops.bucket_exists(self._bucket):
            self._ops.make_bucket(self._bucket)  # 非公開（既定）＝ポリシー付与しない

    def put(self, data: bytes, content_type: str, *, prefix: str) -> str:
        key = hashed_key(data, content_type, prefix=prefix)
        self._ops.put_object(self._bucket, key, io.BytesIO(data), length=len(data), content_type=content_type)
        return key

    def presigned_get(self, key: str) -> str:
        return self._url.presigned_get_object(self._bucket, key, expires=timedelta(seconds=self._ttl))

    def remove(self, key: str) -> None:
        self._ops.remove_object(self._bucket, key)


class FakeStorage:
    """テスト用＝メモリ保持。presign はダミー URL（key を含む）を返す（実際には送らない）。"""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def put(self, data: bytes, content_type: str, *, prefix: str) -> str:
        key = hashed_key(data, content_type, prefix=prefix)
        self.objects[key] = data
        return key

    def presigned_get(self, key: str) -> str:
        return f"https://minio.test/{key}?sig=fake"

    def remove(self, key: str) -> None:
        self.objects.pop(key, None)


_storage: ObjectStorage | None = None


def set_storage(storage: ObjectStorage | None) -> None:
    """ストレージ実装を差し替える（None で既定＝MinIO に戻す）。テストは Fake を注入。"""
    global _storage
    _storage = storage


def get_storage() -> ObjectStorage:
    """現在のストレージ実装（未設定なら MinIO を遅延生成）。"""
    global _storage
    if _storage is None:
        _storage = MinioStorage()
    return _storage
