"""リクエスト locale の解決（コーディング規約 §2.1）。

解決順＝**ユーザー設定（ログイン済みセッションの `locale`）→ Accept-Language → 既定 `ja`**。
バックエンドの自己ローカライズ出力のうち、メール/通知/マスタ名は entity-bound（account/user.locale が源泉）で
Accept-Language は効かない。本モジュールが効くのは **entity に紐づかない per-request 応答**＝エラー応答
（`title`/汎用 `detail`）。対応言語は `ja`/`en` のみ（未対応タグは既定 ja へフォールバック）。
"""
from __future__ import annotations

from fastapi import Request

SUPPORTED = ("ja", "en")
DEFAULT = "ja"


def normalize(tag: str | None) -> str | None:
    """言語タグ（`en-US` 等）を対応言語（`ja`/`en`）へ。未対応/空は None。"""
    if not tag:
        return None
    primary = tag.split("-", 1)[0].strip().lower()
    return primary if primary in SUPPORTED else None


def parse_accept_language(header: str | None) -> str | None:
    """Accept-Language を q 値順に評価し、最上位の対応言語を返す（無ければ None）。"""
    if not header:
        return None
    best: tuple[float, int, str] | None = None  # (q, -order, lang) の最大
    for order, part in enumerate(header.split(",")):
        segs = part.split(";")
        lang = normalize(segs[0])
        if lang is None:
            continue
        q = 1.0
        for extra in segs[1:]:
            extra = extra.strip()
            if extra.startswith("q="):
                try:
                    q = float(extra[2:])
                except ValueError:
                    q = 0.0
        # 同 q は記載順が先（order 小）を優先＝ (q, -order) の辞書式最大
        cand = (q, -order, lang)
        if q > 0 and (best is None or cand > best):
            best = cand
    return best[2] if best else None


def resolve_request_locale(request: Request) -> str:
    """§2.1 の解決順で locale を確定（ユーザー設定→Accept-Language→ja）。

    `request.state.locale`（session ガードが載せたユーザー設定）を最優先。無ければ Accept-Language、
    それも無ければ既定 `ja`。ミドルウェアが未設定でも安全に動くよう getattr で防御する。
    """
    user_setting = normalize(getattr(request.state, "user_locale", None))
    if user_setting:
        return user_setting
    return parse_accept_language(request.headers.get("accept-language")) or DEFAULT
