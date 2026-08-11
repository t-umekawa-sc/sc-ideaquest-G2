"""自己プロフィール編集のユースケース（ドメイン K・コントロールプレーン中心）。

identity（`display_name`/`locale`）の源泉は管理DB `accounts`（§4.2）。編集は **accounts 更新＋同一Tx で
`account_sync_outbox` INSERT**（§1.13/§4.6）＝会社DB `users` ミラーは常駐ワーカが結果整合で反映。
`PATCH /me` は両フィールドとも accounts のため**単一のコントロールプレーン Tx**（跨ぎ書き込み無し・K.2）。
"""
from __future__ import annotations

import uuid

from app.control_plane.account_sync import repository as account_sync_repo
from app.control_plane.auth.orm import Account
from app.core.errors import AppError
from app.db.control import control_session

_EDITABLE_FIELDS = ("display_name", "locale")  # allowlist（§2.2）


def _me(account: Account) -> dict:
    return {
        "login_id": account.login_id,
        "email": account.email,
        "display_name": account.display_name,
        "locale": account.locale,
        "system_role": account.system_role,
    }


def get_me(account_id: uuid.UUID) -> dict:
    """自分のプロフィール（identity サブセット）を返す（K.1）。残高・画像（K.1 全体）は別スライス。"""
    with control_session() as session:
        account = session.get(Account, account_id)
        if account is None:
            raise AppError(401, "unauthenticated")  # セッション有効中の消失＝通常起きない
        return _me(account)


def update_me(account_id: uuid.UUID, company_id: uuid.UUID, *, changes: dict) -> dict:
    """表示名・ロケールを編集（K.2）。accounts を更新し、同一Tx で会社DB `users` へのミラーを enqueue。

    `changes` は allowlist（`display_name`/`locale`）のみ反映（DTO で extra=forbid 済み・二重防御）。
    """
    with control_session() as session:
        account = session.get(Account, account_id)
        if account is None:
            raise AppError(401, "unauthenticated")  # セッション有効中にアカウント消失＝通常起きない
        payload = {f: changes[f] for f in _EDITABLE_FIELDS if f in changes}
        for field, value in payload.items():
            setattr(account, field, value)
        if payload:  # 変更があるときだけミラー enqueue（会社DB `users` はワーカが反映・§4.6）
            account_sync_repo.enqueue(session, account_id, company_id, "upsert", payload)
        session.commit()
        return _me(account)
