"""WS 購読の門番（L.2）。chat:{chat_group_id} 購読要求時に REST と同一の権限で可否判定する。

`notifications:{user_id}` は本人固定＝追加検証不要（接続時に自動購読）。chat は REST の門番
（`chat.application._resolve_chat_idea`＝公開アイデア＋パーティー参加中・E.0/C.0）を**そのまま再利用**し、
WS と REST の認可を一致させる（DRY・存在秘匿のため可否は bool のみ返す）。同期 DB アクセス＝呼び出し側が
threadpool で実行する。
"""
from __future__ import annotations

import uuid

from app.control_plane.auth.orm import Company
from app.core.errors import AppError
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.chat.orm import ChatGroup
from app.tenant.profile.repository import get_user_by_account


def _db_identifier(company_id: str) -> str | None:
    with control_session() as s:
        c = s.get(Company, uuid.UUID(str(company_id)))
        return c.db_identifier if c else None


def can_subscribe_chat(account_id: str, company_id: str, chat_group_id: str) -> bool:
    from app.tenant.chat.application import _resolve_chat_idea  # 遅延 import（循環回避）

    db = _db_identifier(company_id)
    if db is None:
        return False
    try:
        cg_id = uuid.UUID(str(chat_group_id))
        acc_id = uuid.UUID(str(account_id))
    except (ValueError, AttributeError, TypeError):
        return False
    with get_tenant_session(db) as ts:
        user = get_user_by_account(ts, acc_id)
        if user is None:
            return False
        cg = ts.get(ChatGroup, cg_id)
        if cg is None:
            return False
        try:
            _resolve_chat_idea(ts, cg.idea_id, user)  # 非公開/非パーティーは AppError(404)
        except AppError:
            return False
        return True
