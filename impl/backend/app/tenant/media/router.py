"""インライン画像の安定配信プロキシ（`GET /api/v1/media/{key}`・F8・§1.10）。

リッチ本文（お知らせ U-8／情報 N.2）に直接埋め込むインライン画像を、短TTL署名URLの直埋め
（保存から TTL 経過で失効＝画像が壊れる）ではなく、**本文には安定パス `/api/v1/media/<key>` を保存**し、
閲覧時に本EPが**都度再署名して 302** する。これで時間が経っても失効しない（認可・監査・キャッシュ制御を一点集約）。

認可＝`require_me`（認証済みの会社ユーザー）。serve 対象はインライン画像 prefix のみ（添付/アバター等は
専用DL経路・prefix allowlist で限定＝任意オブジェクトの踏み台にしない）。キーは sha256+乱数で列挙耐性。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse

from app.control_plane.me.deps import require_me
from app.core.errors import AppError
from app.infra.storage import get_storage, is_inline_image_key

router = APIRouter(prefix="/api/v1", tags=["media"])


@router.get("/media/{key:path}")
def get_media(key: str, request: Request, session: dict = Depends(require_me)) -> RedirectResponse:
    """インライン画像キーを都度再署名して 302（短TTL署名URLへ）。対象 prefix 外は 404（存在秘匿）。"""
    if not is_inline_image_key(key):
        # 添付/アバター等の任意キーは serve しない（専用DL経路で認可）＝存在を明かさず 404。
        raise AppError(404, "not_found")
    url = get_storage().presigned_get(key)
    # 302＝GET の一時リダイレクト。短TTL署名URLはブラウザのキャッシュに残さない（都度本EP経由で再署名）。
    return RedirectResponse(url, status_code=302, headers={"Cache-Control": "no-store"})
