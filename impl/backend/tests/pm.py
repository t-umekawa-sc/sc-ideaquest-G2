"""テスト用 PM-JSON ヘルパ（TT5・チャット本文は PM-JSON 正本）。

チャット/リッチテキストの multipart 投稿は本文を PM-JSON の JSON 文字列で送る。検証は平文化（`pm_text`）で行う。
"""
from __future__ import annotations

import json

from app.core.richtext import pm_to_text


def pm_doc(text: str) -> dict:
    """plain テキスト → PM-JSON の doc（空文字は空段落）。"""
    content = [{"type": "text", "text": text}] if text else []
    return {"type": "doc", "content": [{"type": "paragraph", "content": content}]}


def pm_body(text: str) -> str:
    """multipart/form 用＝PM-JSON を JSON 文字列化。"""
    return json.dumps(pm_doc(text))


def pm_text(body) -> str:
    """メッセージ DTO の body（PM-JSON）を平文化（検証用）。"""
    return pm_to_text(body)
