"""自己プロフィール編集のユースケース（ドメイン K・コントロールプレーン中心）。

identity（`display_name`/`locale`）の源泉は管理DB `accounts`（§4.2）。編集は **accounts 更新＋同一Tx で
`account_sync_outbox` INSERT**（§1.13/§4.6）＝会社DB `users` ミラーは常駐ワーカが結果整合で反映。
`PATCH /me` は両フィールドとも accounts のため**単一のコントロールプレーン Tx**（跨ぎ書き込み無し・K.2）。
"""
from __future__ import annotations

import uuid

import redis
from sqlalchemy import select

from app.control_plane.account_sync import repository as account_sync_repo
from app.control_plane.auth import repository as account_repo
from app.control_plane.auth.domain.service import password_policy_errors
from app.control_plane.auth.orm import Account
from app.core.errors import AppError
from app.core.security import delete_account_sessions, hash_password, verify_password
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


def _require_current_password(account: Account | None, current_password: str) -> Account:
    """再認証＝現在PW照合（K.3・1-㉒/㉓）。不一致は 403 reauth_failed（セッションは有効＝401 と区別）。"""
    if account is None or not verify_password(current_password, account.password_hash):
        raise AppError(403, "reauth_failed")
    return account


def change_password(r: "redis.Redis", account_id: uuid.UUID, *, current_password: str, new_password: str) -> None:
    """自己パスワード変更（K.3）。現在PW再認証→ポリシー検証→更新→**全セッション破棄＋信頼端末失効**（A.9-③）。

    完了後は要再ログイン（新セッションは張らない）。security_password_changed 通知は H ドメイン実装時に接続（K.5）。
    """
    errors = password_policy_errors(new_password)
    if errors:
        raise AppError(422, "validation_error", detail="パスワードがポリシーを満たしません", errors=errors)
    with control_session() as session:
        account = _require_current_password(session.get(Account, account_id), current_password)
        account.password_hash = hash_password(new_password)
        account_repo.revoke_all_trusted_devices(session, account_id)  # 信頼端末失効（A.9-③）
        session.commit()
    delete_account_sessions(r, str(account_id))  # 全アクティブセッション破棄（A.9-③）＝要再ログイン


def change_email(account_id: uuid.UUID, company_id: uuid.UUID, *, new_email: str, current_password: str) -> dict:
    """自己メール変更（K.3）。現在PW再認証→会社内一意検証→`accounts.email` 更新＋outbox（users ミラー）。

    メール変更はセッション破棄を必須にしない（再認証で担保・§A.9-③ 対象外）。新メール到達確認は K.6 TBD（本実装は未挟み）。
    """
    with control_session() as session:
        account = _require_current_password(session.get(Account, account_id), current_password)
        clash = session.execute(
            select(Account).where(
                Account.company_id == company_id, Account.id != account_id, Account.email == new_email
            )
        ).scalars().first()
        if clash is not None:
            raise AppError(409, "conflict", extra={"errors": [{"field": "email"}]})  # 会社内一意（§4.2）
        account.email = new_email
        account_sync_repo.enqueue(session, account_id, company_id, "upsert", {"email": new_email})
        session.commit()
        return _me(account)
