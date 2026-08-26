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
from app.core.errors import AppError

# 画像 MIME allowlist（K.4・データモデル §8-⑦・初期値）。拡張子は物理名生成用。
ALLOWED_IMAGE_MIME: dict[str, str] = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
}
MAX_IMAGE_BYTES = 5 * 1024 * 1024  # 画像 1ファイル 5MB（初期値・K.6 TBD）

# 添付 MIME allowlist（D.3・§5.12・§1.10・初期値）＝画像＋pdf/Office/テキスト/zip。値は物理名生成用の拡張子。
ALLOWED_ATTACHMENT_MIME: dict[str, str] = {
    "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
    "text/plain": "txt", "text/csv": "csv", "text/markdown": "md",
    "application/zip": "zip",
}
# 拡張子→正規 MIME（申告 Content-Type を信用せず拡張子から MIME を導出＝D.3・§1.10）。
ATTACHMENT_EXT_TO_MIME: dict[str, str] = {
    "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp", "gif": "image/gif",
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "txt": "text/plain", "csv": "text/csv", "md": "text/markdown",
    "zip": "application/zip",
}
MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024  # 添付 1ファイル 20MB（D.3・§5.12 初期値）
MAX_ATTACHMENTS_PER_IDEA = 10  # 1アイデアあたり添付上限（D.3）

# ファイルシグネチャ（マジックバイト）＝MIME/拡張子の申告を信用せず先頭バイトで実体を検証（セキュリティ一覧 §8）。
# 署名を持たない型（text/*）は検証不能＝allowlist に委ねる（許可）。webp は RIFF....WEBP で別途判定。
_MAGIC: dict[str, list[bytes]] = {
    "image/png": [b"\x89PNG\r\n\x1a\n"],
    "image/jpeg": [b"\xff\xd8\xff"],
    "image/gif": [b"GIF87a", b"GIF89a"],
    "application/pdf": [b"%PDF-"],
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08"],
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08"],
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": [b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08"],
    "application/zip": [b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08"],
}


def _signature_ok(mime: str, data: bytes) -> bool:
    """先頭バイトが申告 MIME のシグネチャと一致するか（§8「MIME だけを信用しない／シグネチャ確認」）。"""
    if mime == "image/webp":
        return len(data) >= 12 and data[0:4] == b"RIFF" and data[8:12] == b"WEBP"
    prefixes = _MAGIC.get(mime)
    if prefixes is None:
        return True  # 署名不明の型（text/* 等）＝検証不能なので allowlist に委ねる
    return any(data.startswith(p) for p in prefixes)


def validate_image_upload(content_type: str, data: bytes) -> None:
    """画像アップロードのサーバー検証（§2.2⑧・§1.10・§8）＝MIME allowlist・サイズ上限・非空・シグネチャ一致。

    アバター/背景（K.4）・会社アイコン（B.1）など全画像 EP で共用（DRY・§2.3）。`data`＝実バイト。
    """
    size = len(data)
    if content_type not in ALLOWED_IMAGE_MIME:
        raise AppError(422, "validation_error", detail="対応していない画像形式です（PNG/JPEG/WebP/GIF）",
                       errors=[{"field": "file"}])
    if size == 0:
        raise AppError(422, "validation_error", detail="ファイルが空です", errors=[{"field": "file"}])
    if size > MAX_IMAGE_BYTES:
        raise AppError(422, "validation_error", detail="画像サイズが上限を超えています", errors=[{"field": "file"}])
    if not _signature_ok(content_type, data):  # MIME 申告を信用せずシグネチャで実体検証（§8）
        raise AppError(422, "validation_error", detail="ファイル内容が申告した画像形式と一致しません",
                       errors=[{"field": "file", "code": "signature_mismatch"}])


def validate_attachment_upload(filename: str, data: bytes) -> str:
    """添付アップロードのサーバー検証（D.3・§1.10・§5.12・§8）＝拡張子 allowlist・サイズ上限・非空・シグネチャ一致。

    申告 Content-Type は信用せず**拡張子から正規 MIME を導出**し、さらに**先頭バイト（マジックバイト）で実体を検証**
    （MIME/拡張子偽装拒否・§8）。署名を持たない型（text/*）は allowlist に委ねる。返り値＝正規 MIME。
    """
    size = len(data)
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    mime = ATTACHMENT_EXT_TO_MIME.get(ext)
    if mime is None:
        raise AppError(422, "validation_error", detail="対応していないファイル形式です",
                       errors=[{"field": "files", "code": "mime_not_allowed"}])
    if size == 0:
        raise AppError(422, "validation_error", detail="ファイルが空です",
                       errors=[{"field": "files", "code": "empty"}])
    if size > MAX_ATTACHMENT_BYTES:
        raise AppError(422, "validation_error", detail="ファイルサイズが上限（20MB）を超えています",
                       errors=[{"field": "files", "code": "too_large"}])
    if not _signature_ok(mime, data):  # 拡張子と実体（マジックバイト）の一致を検証（§8）
        raise AppError(422, "validation_error", detail="ファイル内容が拡張子と一致しません",
                       errors=[{"field": "files", "code": "signature_mismatch"}])
    return mime


def hashed_key(data: bytes, content_type: str, *, prefix: str) -> str:
    """物理オブジェクトキー＝`<prefix>/<sha256前半>-<乱数>.<ext>`（元名非露出・衝突/列挙耐性）。

    拡張子は画像/添付双方の allowlist から解決（未知は bin）。
    """
    digest = hashlib.sha256(data).hexdigest()[:32]
    ext = ALLOWED_IMAGE_MIME.get(content_type) or ALLOWED_ATTACHMENT_MIME.get(content_type, "bin")
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
