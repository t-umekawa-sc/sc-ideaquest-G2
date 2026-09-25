"""WS 購読の門番（L.2）。chat:{thread_id} 購読要求時に REST と同一の権限で可否判定する。

`notifications:{user_id}` は本人固定＝追加検証不要（接続時に自動購読）。chat は REST の門番
（`chat.application._resolve_host`＝owner_type で idea＝公開+パーティー / concept_scope＝draft可視性+パーティーを
分岐・E.0/C.0）を**そのまま再利用**し、WS と REST の認可を一致させる（DRY・存在秘匿のため可否は bool のみ）。
チャット中核は thread_id ただ一つ＝ホスト非依存（§5.45）。同期 DB アクセス＝呼び出し側が threadpool で実行。
"""
from __future__ import annotations

import uuid

from app.control_plane.auth.orm import Company
from app.core.errors import AppError
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.profile.repository import get_user_by_account


def _db_identifier(company_id: str) -> str | None:
    with control_session() as s:
        c = s.get(Company, uuid.UUID(str(company_id)))
        return c.db_identifier if c else None


def can_subscribe_chat(account_id: str, company_id: str, thread_id: str) -> bool:
    from app.tenant.chat.application import _resolve_host  # 遅延 import（循環回避）
    from app.tenant.chat import repository as chat_repo

    db = _db_identifier(company_id)
    if db is None:
        return False
    try:
        th_id = uuid.UUID(str(thread_id))
        acc_id = uuid.UUID(str(account_id))
    except (ValueError, AttributeError, TypeError):
        return False
    with get_tenant_session(db) as ts:
        user = get_user_by_account(ts, acc_id)
        if user is None:
            return False
        thread = chat_repo.get_thread(ts, th_id)
        if thread is None:
            return False
        try:
            _resolve_host(ts, thread, user)  # 非公開/非パーティー等は AppError(404)
        except AppError:
            return False
        return True
