"""自己プロフィール編集のユースケース（ドメイン K・コントロールプレーン中心）。

identity（`display_name`/`locale`）の源泉は管理DB `accounts`（§4.2）。編集は **accounts 更新＋同一Tx で
`account_sync_outbox` INSERT**（§1.13/§4.6）＝会社DB `users` ミラーは常駐ワーカが結果整合で反映。
`PATCH /me` は両フィールドとも accounts のため**単一のコントロールプレーン Tx**（跨ぎ書き込み無し・K.2）。
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import redis
from sqlalchemy import select

from app.control_plane.account_sync import repository as account_sync_repo
from app.control_plane.audit import repository as audit
from app.control_plane.auth import repository as account_repo
from app.control_plane.auth.domain.service import password_policy_errors
from app.control_plane.auth.orm import Account, Company
from app.control_plane.mail_outbox import repository as mail_repo
from app.control_plane.mail_outbox.templates import (
    CATEGORY_EMAIL_CHANGE_CONFIRM,
    CATEGORY_EMAIL_CHANGE_NOTICE,
)
from app.core.config import get_settings
from app.core.errors import AppError
from app.core.security import (
    delete_account_sessions,
    generate_token,
    hash_password,
    hash_token,
    verify_password,
)
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.gamification.level import level_progress
from app.tenant.profile import repository as profile_repo
from app.tenant.profile.orm import User

_EDITABLE_FIELDS = ("display_name", "locale")  # allowlist（§2.2）


def _me(account: Account, user: "User | None") -> dict:
    """K.1 正準形（account／profile／balance／system_role）。

    identity・display_name の源泉は accounts（§4.2・K.6）。残高は会社DB `users`（読み取り専用・K.0）で
    `level`/`xp_to_next`/`level_span` は G の純粋レベル関数（§7）で `xp` から算出。画像署名URL（K.4）は別スライス＝現状 None。
    """
    xp = user.xp if user else 0
    prog = level_progress(xp)
    return {
        "account": {"login_id": account.login_id, "email": account.email, "locale": account.locale},
        "profile": {
            "display_name": account.display_name,
            "avatar_image_url": None,       # K.4（MinIO 署名URL）は別スライス
            "background_image_url": None,   # 同上
        },
        "balance": {
            "level": prog["level"],
            "xp": xp,
            "xp_to_next": prog["xp_to_next"],
            "level_span": prog["level_span"],
            "coin_balance": user.coin_balance if user else 0,
            "skill_point_balance": user.skill_point_balance if user else 0,
        },
        "system_role": account.system_role,
    }


def _tenant_user(company_id: uuid.UUID, account_id: uuid.UUID) -> "User | None":
    """会社DB `users` ミラー（残高・K.1）を account_id で読む（§1.5 動的ルーティング）。"""
    with control_session() as session:
        company = session.get(Company, company_id)
    if company is None:
        return None
    with get_tenant_session(company.db_identifier) as ts:
        return profile_repo.get_user_by_account(ts, account_id)


def get_me(account_id: uuid.UUID, company_id: uuid.UUID) -> dict:
    """自分のプロフィール＋残高（正準・K.1）。accounts（identity）＋会社DB users（残高）を読む。"""
    with control_session() as session:
        account = session.get(Account, account_id)
        if account is None:
            raise AppError(401, "unauthenticated")  # セッション有効中の消失＝通常起きない
    return _me(account, _tenant_user(company_id, account_id))


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
    # 返却は K.1 正準形（残高は会社DB users＝ミラーは非同期・display_name は accounts 源泉で即反映）
    return _me(account, _tenant_user(company_id, account_id))


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


def _assert_email_unique_in_company(session, company_id: uuid.UUID, account_id: uuid.UUID, email: str) -> None:
    """会社内で他アカウントの確定 email と衝突しないことを検証（§4.2・重複は 409 field=email）。"""
    clash = session.execute(
        select(Account).where(
            Account.company_id == company_id, Account.id != account_id, Account.email == email
        )
    ).scalars().first()
    if clash is not None:
        raise AppError(409, "conflict", extra={"errors": [{"field": "email"}]})


def request_email_change(
    account_id: uuid.UUID, company_id: uuid.UUID, *, new_email: str, current_password: str
) -> None:
    """自己メール変更の**要求**（K.3・ダブルオプトイン・ADR-0008）。

    現在PW再認証→会社内一意（確定 email で検証）→`accounts.pending_email` 格納＋`email_change` トークン発行→
    **新メールへ確認リンク**・**旧メールへ変更通知**（乗っ取り検知）を同一Tx で enqueue。**`accounts.email` は変えず
    `account_sync_outbox` も積まない**（会社DB ミラーは確定時）。メール変更はセッション破棄を必須にしない（§A.9-③ 対象外）。
    """
    s = get_settings()
    with control_session() as session:
        account = _require_current_password(session.get(Account, account_id), current_password)
        old_email = account.email
        if new_email == old_email:  # no-op 抑止（誤操作）
            raise AppError(422, "validation_error", detail="現在のメールアドレスと同じです",
                           errors=[{"field": "new_email"}])
        _assert_email_unique_in_company(session, company_id, account_id, new_email)
        account.pending_email = new_email
        token = generate_token()
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=s.email_change_ttl_seconds)
        account_repo.invalidate_email_change_challenges(session, account_id)  # 最新リンクのみ有効（§2.1）
        account_repo.create_email_change_challenge(session, account_id, hash_token(token), expires_at)
        # 新メールへ確認リンク（secret＝トークン）／旧メールへ変更通知（secret なし）＝同一Tx で enqueue
        mail_repo.enqueue(session, new_email, CATEGORY_EMAIL_CHANGE_CONFIRM, secret=token,
                          locale=account.locale, account_id=account_id, company_id=company_id)
        mail_repo.enqueue(session, old_email, CATEGORY_EMAIL_CHANGE_NOTICE,
                          locale=account.locale, account_id=account_id, company_id=company_id)
        session.commit()


def confirm_email_change(token: str) -> None:
    """メール変更の**確定**（K.3・未認証＝トークンが認可・ADR-0008 §2.3）。

    トークン照合（無効/期限切れ/使用済み一律 410）→ 会社内一意を**再検証**（TOCTOU・衝突 409＋pending クリア）→
    `email=pending_email`・`pending_email=NULL`・チャレンジ単回消費 → **同一Tx で `account_sync_outbox` へ enqueue**
    （会社DB `users` ミラーは確定時）→ 監査記録。セッション破棄はしない（§A.9-③ 対象外）。
    """
    with control_session() as session:
        challenge = account_repo.find_email_change_challenge_by_hash(session, hash_token(token))
        if not _challenge_is_valid(challenge):
            raise AppError(410, "token_expired")
        account = session.get(Account, challenge.account_id)
        if account is None or not account.pending_email:
            raise AppError(410, "token_expired")  # 確定対象なし（pending 消失）
        new_email = account.pending_email
        try:  # 要求〜確定の間に他アカウントが同 email を確定し得る（TOCTOU）
            _assert_email_unique_in_company(session, account.company_id, account.id, new_email)
        except AppError:
            account.pending_email = None  # やり直しを促す（pending は残さない）
            session.commit()
            raise
        account.email = new_email
        account.pending_email = None
        challenge.used_at = datetime.now(timezone.utc)  # 単回消費
        account_sync_repo.enqueue(session, account.id, account.company_id, "upsert", {"email": new_email})
        audit.record("email.change.confirm",  # 監査（B.6）。機密（token）は入れない（§15）
                     {"company_id": str(account.company_id), "account_id": str(account.id)}, session=session)
        session.commit()


def _challenge_is_valid(challenge) -> bool:
    return (
        challenge is not None
        and challenge.used_at is None
        and challenge.expires_at > datetime.now(timezone.utc)
    )
