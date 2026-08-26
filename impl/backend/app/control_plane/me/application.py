"""自己プロフィール編集のユースケース（ドメイン K・コントロールプレーン中心）。

identity（`display_name`/`locale`）の源泉は管理DB `accounts`（§4.2）。編集は **accounts 更新＋同一Tx で
`account_sync_outbox` INSERT**（§1.13/§4.6）＝会社DB `users` ミラーは常駐ワーカが結果整合で反映。
`PATCH /me` は両フィールドとも accounts のため**単一のコントロールプレーン Tx**（跨ぎ書き込み無し・K.2）。
"""
from __future__ import annotations

import base64
import binascii
import uuid
from datetime import datetime, timedelta, timezone

import redis
from sqlalchemy import select

from app.control_plane.account_sync import repository as account_sync_repo
from app.control_plane.audit import repository as audit
from app.control_plane.auth import repository as account_repo
from app.control_plane.auth import security_events
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
from app.tenant.gamification import repository as gami_repo
from app.tenant.gamification.daily import period_bounds_utc
from app.infra.storage import get_storage, validate_image_upload
from app.tenant.gamification.level import level_progress
from app.tenant.profile import repository as profile_repo
from app.tenant.profile.orm import User

_EDITABLE_FIELDS = ("display_name", "locale")  # allowlist（§2.2）


def _image_url(path: str | None) -> str | None:
    """MinIO オブジェクトキー→短TTL 署名URL（K.4・§1.10）。未設定は None（storage 未呼び出し）。"""
    return get_storage().presigned_get(path) if path else None


def _me(account: Account, user: "User | None") -> dict:
    """K.1 正準形（account／profile／balance／system_role）。

    identity・display_name の源泉は accounts（§4.2・K.6）。残高は会社DB `users`（読み取り専用・K.0）で
    `level`/`xp_to_next`/`level_span` は G の純粋レベル関数（§7）で `xp` から算出。画像は会社DB `users` の
    パスを短TTL 署名URL（K.4・§1.10）に解決して返す（パス直返し禁止）。
    """
    xp = user.xp if user else 0
    prog = level_progress(xp)
    return {
        "account": {"login_id": account.login_id, "email": account.email, "locale": account.locale},
        "profile": {
            "display_name": account.display_name,
            "avatar_image_url": _image_url(user.avatar_image_path if user else None),
            "background_image_url": _image_url(user.background_image_path if user else None),
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


# --- プロフィール画像・背景画像（K.4・MinIO・§1.10）。会社DB users 直接更新（identity ではない＝outbox なし） ---

def _company_db_identifier(company_id: uuid.UUID) -> str:
    with control_session() as session:
        company = session.get(Company, company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    return company.db_identifier


def _set_user_image(company_id: uuid.UUID, account_id: uuid.UUID, *,
                    field: str, data: bytes, content_type: str, prefix: str) -> str:
    """会社DB users の画像パス列を差し替え、旧オブジェクトを best-effort 削除。署名URL を返す。"""
    validate_image_upload(content_type, data)
    storage = get_storage()
    key = storage.put(data, content_type, prefix=prefix)  # 物理名ハッシュ・非公開バケット
    with get_tenant_session(_company_db_identifier(company_id)) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        old = getattr(user, field)
        setattr(user, field, key)
        ts.commit()
    if old:
        try:
            storage.remove(old)  # 旧画像は best-effort（失敗しても新設定は成立・整合は運用掃除）
        except Exception:
            pass
    return storage.presigned_get(key)


def _delete_user_image(company_id: uuid.UUID, account_id: uuid.UUID, *, field: str) -> None:
    with get_tenant_session(_company_db_identifier(company_id)) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        old = getattr(user, field)
        setattr(user, field, None)
        ts.commit()
    if old:
        try:
            get_storage().remove(old)
        except Exception:
            pass


def set_avatar_image(account_id: uuid.UUID, company_id: uuid.UUID, *, data: bytes, content_type: str) -> dict:
    """アバター画像を設定（K.4）＝会社DB users.avatar_image_path 更新＋署名URL 返却。"""
    return {"avatar_image_url": _set_user_image(
        company_id, account_id, field="avatar_image_path", data=data, content_type=content_type, prefix="avatars")}


def delete_avatar_image(account_id: uuid.UUID, company_id: uuid.UUID) -> None:
    """アバター画像を削除（既定に戻す・K.4）。"""
    _delete_user_image(company_id, account_id, field="avatar_image_path")


def set_background_image(account_id: uuid.UUID, company_id: uuid.UUID, *, data: bytes, content_type: str) -> dict:
    """背景画像を設定（K.4・全認証画面に反映）＝会社DB users.background_image_path 更新＋署名URL 返却。"""
    return {"background_image_url": _set_user_image(
        company_id, account_id, field="background_image_path", data=data, content_type=content_type, prefix="backgrounds")}


def delete_background_image(account_id: uuid.UUID, company_id: uuid.UUID) -> None:
    """背景画像をリセット（既定背景へ・K.4）。"""
    _delete_user_image(company_id, account_id, field="background_image_path")


_EMPTY_PAGE = {"data": [], "page_info": {"next_cursor": None, "has_next": False}}


def _encode_cursor(activity) -> str:
    """(created_at, id) を不透明カーソルにエンコード（§1.8・キーセット境界）。"""
    raw = f"{activity.created_at.isoformat()}|{activity.id}".encode()
    return base64.urlsafe_b64encode(raw).decode()


def _decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    """不透明カーソルを (created_at, id) に戻す。壊れていれば 422（field=cursor）。"""
    try:
        created_str, id_str = base64.urlsafe_b64decode(cursor.encode()).decode().split("|", 1)
        return datetime.fromisoformat(created_str), uuid.UUID(id_str)
    except (binascii.Error, ValueError, UnicodeDecodeError):
        raise AppError(422, "validation_error", detail="cursor が不正です", errors=[{"field": "cursor"}])


def _activity_dto(a) -> dict:
    return {
        "id": str(a.id), "kind": a.kind, "amount": a.amount, "reason": a.reason,
        "quest_id": str(a.quest_id) if a.quest_id else None,
        "ref_type": a.ref_type, "ref_id": str(a.ref_id) if a.ref_id else None,
        "created_at": a.created_at,
    }


def get_my_activities(
    account_id: uuid.UUID, company_id: uuid.UUID, *,
    kind: str | None, period: str, limit: int, cursor: str | None,
) -> dict:
    """自分の活動履歴（G.6・新しい順・カーソル §1.8）。会社DB `activities` を読む（残高の元帳）。

    `kind`（activity_kind）・`period`（this_week/last_week/this_month/all）で絞り込み。会社/ユーザー
    未解決（通常起きない）は空ページ。SP 消費/付与もランキング非対象だが履歴には含める（§7）。
    """
    bounds = period_bounds_utc(period, datetime.now(timezone.utc))
    cur = _decode_cursor(cursor) if cursor else None  # 不正カーソルは query 前に 422
    with control_session() as session:
        company = session.get(Company, company_id)
    if company is None:
        return _EMPTY_PAGE
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            return _EMPTY_PAGE
        rows = gami_repo.list_activities(ts, user.id, kind=kind, bounds=bounds, cursor=cur, limit=limit + 1)
    has_next = len(rows) > limit
    rows = rows[:limit]
    next_cursor = _encode_cursor(rows[-1]) if has_next and rows else None
    return {"data": [_activity_dto(a) for a in rows],
            "page_info": {"next_cursor": next_cursor, "has_next": has_next}}


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

    完了後は要再ログイン（新セッションは張らない）。完了後に security_password_changed 通知（in-app＋メール・A.9-⑧(b)）。
    """
    errors = password_policy_errors(new_password)
    if errors:
        raise AppError(422, "validation_error", detail="パスワードがポリシーを満たしません", errors=errors)
    with control_session() as session:
        account = _require_current_password(session.get(Account, account_id), current_password)
        account.password_hash = hash_password(new_password)
        account_repo.revoke_all_trusted_devices(session, account_id)  # 信頼端末失効（A.9-③）
        pw_company_id = account.company_id      # post-commit 発火用に退避（A.9-⑧(b)）
        pw_email = account.email
        pw_locale = account.locale
        session.commit()
    delete_account_sessions(r, str(account_id))  # 全アクティブセッション破棄（A.9-③）＝要再ログイン
    # PW 変更完了通知（in-app＋メール・A.9-⑧(b)／K.3）＝A 経路（complete_password_setup）と等価
    security_events.fire_password_changed(pw_company_id, account_id, email=pw_email, locale=pw_locale)


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
        account.email_verified_at = datetime.now(timezone.utc)  # ダブルオプトインで到達確認済み（ADR-0009 §2.2）
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
