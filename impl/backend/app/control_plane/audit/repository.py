"""システム監査ログの記録（管理DB・データモデル §4.5・API設計 B.6）。

`record(action, detail, session=...)`＝1 行 INSERT。実行者/IP/UA はリクエストコンテキスト
（`core.audit_context`・ミドルウェアが設定）から自動取得＝呼び出し側は action と detail だけ渡す。
`session` を渡すと**その Tx に相乗**（操作と原子的）。省略時は独立 Tx で記録（テナントのみの操作＝
会社DB 変更の後の best-effort append）。**PW/トークン等の機密を detail に入れないこと**（§15）。
"""
from __future__ import annotations

import json
import uuid

from sqlalchemy.orm import Session

from app.control_plane.audit.orm import SystemAuditLog
from app.core.audit_context import current_audit_context
from app.db.control import control_session


def _json_safe(detail: dict | None) -> dict | None:
    """JSONB へ安全に載るよう正規化（UUID/datetime 等を str 化）＝call site の型を気にしなくてよい安全網。"""
    if detail is None:
        return None
    return json.loads(json.dumps(detail, default=str, ensure_ascii=False))


def record(action: str, detail: dict | None = None, *, session: Session | None = None) -> None:
    actor, ip, user_agent = current_audit_context()
    row = SystemAuditLog(
        id=uuid.uuid4(),
        actor_account_id=uuid.UUID(actor) if actor else None,
        action=action,
        detail=_json_safe(detail),
        ip=ip,
        user_agent=user_agent,
    )
    if session is not None:
        session.add(row)  # 呼び出し側 Tx に相乗（操作と原子的にコミット/ロールバック）
    else:
        with control_session() as s:  # 独立記録（テナントのみの操作の後・best-effort append）
            s.add(row)
            s.commit()
