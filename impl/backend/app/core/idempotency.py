"""冪等キー（Idempotency-Key）横断ミドルウェア（API設計 §1.9）。

非冪等 POST の二重送信に対し、**会社×アカウント×キー**でスコープした Redis レコードで最初の結果を
再生する（replay＝`Idempotency-Replayed: true`）。処理中の同時再送は `409 idempotency_in_progress`、
同一キー・別内容は `422 idempotency_key_reuse`。**確定応答（2xx・決定的 4xx）のみ done として保存**し、
5xx はマーカーを解放（失敗を固定化しない）。**done 書き込みは業務コミット後**＝本ミドルウェアはエンドポイント
（内部で commit）の応答を捕捉してから done を書く。キーは不透明文字列（最大 128 文字・空/超過は 422）。
"""
from __future__ import annotations

import base64
import hashlib
import json

from starlette.requests import Request
from starlette.responses import Response

from app.core.deps import resolve_session
from app.core.errors import _problem
from app.infra.cache import get_redis

_MAX_KEY_LEN = 128
_TTL_SECONDS = 24 * 60 * 60  # 24h（§1.9・実装で調整可）


def _fingerprint(method: str, path: str, body: bytes) -> str:
    """リクエスト指紋＝method＋path＋正規化ボディ（§1.9）。同一キー・別内容の検知に使う。"""
    h = hashlib.sha256()
    h.update(f"{method} {path}\n".encode())
    h.update(body)
    return h.hexdigest()


def _in_progress(request: Request) -> Response:
    return _problem(request, 409, "idempotency_in_progress",
                    "同じリクエストが処理中です。少し待って再試行してください。",
                    None, headers={"Retry-After": "1"})


async def idempotency_middleware(request: Request, call_next):  # noqa: ANN001, ANN201
    key = request.headers.get("Idempotency-Key")
    if request.method != "POST" or not key:
        return await call_next(request)  # 対象外＝素通し（キーは非冪等 POST のみに付与・§1.9）
    if len(key) > _MAX_KEY_LEN:
        return _problem(request, 422, "validation_error", "Idempotency-Key が不正です（最大128文字）",
                        [{"field": "Idempotency-Key"}])
    session = resolve_session(request)
    if session is None:
        return await call_next(request)  # 未認証はスコープ不能＝エンドポイントの 401 に委譲
    scope = f"idem:{session['company_id']}:{session['account_id']}:{key}"
    body = await request.body()  # 下流のため Starlette がキャッシュ（再読可能）
    fp = _fingerprint(request.method, request.url.path, body)
    r = get_redis()

    existing = r.get(scope)
    if existing is not None:
        rec = json.loads(existing)
        if rec.get("fingerprint") != fp:  # 同一キー・別内容＝誤用
            return _problem(request, 422, "idempotency_key_reuse",
                            "同じ Idempotency-Key で異なる内容のリクエストです（別操作には別キーを使ってください）。",
                            [{"field": "Idempotency-Key"}])
        if rec.get("state") == "done":  # 確定応答を再生
            resp = Response(content=base64.b64decode(rec["body"]), status_code=rec["status"],
                            media_type=rec.get("media_type"))
            resp.headers["Idempotency-Replayed"] = "true"
            return resp
        return _in_progress(request)  # 先行が処理中

    # 初回＝in_flight マーカーを原子的に確保（SET NX）してから業務処理へ
    marker = json.dumps({"state": "in_flight", "fingerprint": fp})
    if not r.set(scope, marker, nx=True, ex=_TTL_SECONDS):
        return _in_progress(request)  # GET と SET の間に別リクエストが確保＝処理中扱い

    try:
        response = await call_next(request)
    except Exception:
        r.delete(scope)  # 想定外エラー＝マーカー解放（失敗を固定化しない）
        raise

    resp_body = b""
    async for chunk in response.body_iterator:
        resp_body += chunk

    if response.status_code < 500:  # 2xx・決定的 4xx は done 保存（commit 後＝応答確定後）
        rec = {"state": "done", "fingerprint": fp, "status": response.status_code,
               "body": base64.b64encode(resp_body).decode(), "media_type": response.media_type}
        r.set(scope, json.dumps(rec), ex=_TTL_SECONDS)
    else:  # 5xx は解放＝再送で再実行可
        r.delete(scope)

    headers = dict(response.headers)
    headers.pop("content-length", None)  # body 再構築で再計算させる
    return Response(content=resp_body, status_code=response.status_code, headers=headers,
                    media_type=response.media_type)
