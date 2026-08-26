"""セキュリティ通知の発火（A.9-⑧・cross-plane）。

認証フロー（`auth/application.py`）とプロフィール（`me/application.py`）が本処理コミット後に呼ぶ
post-commit の副作用の殻。3 チャネルを 1 箇所に集約する（DRY・コーディング規約 §2.3）＝
  1. アプリ内通知（会社DB `notifications`）＝H の `notify_account`（account→user 解決・cross-plane）
  2. メール（`mail_outbox`）＝new_device は MFA-OFF 会社のみ前倒し／password_changed は常時（A.9-⑧）
  3. 監査ログ（`system_audit_logs`）＝⑥ とは別に必ず残す

すべて best-effort（本処理は既にコミット済み）＝`notify_account` は例外を握り潰す。メール/監査の失敗は
本処理の成功に影響させない（副作用の殻・§3.5-(3)）。`security_*` はオプトアウト不可（A.9-⑧）。
"""
from __future__ import annotations

import logging
import uuid

from app.control_plane.audit import repository as audit
from app.control_plane.mail_outbox import repository as mail_repo
from app.control_plane.mail_outbox.templates import (
    CATEGORY_NEW_DEVICE,
    CATEGORY_PASSWORD_CHANGED,
)
from app.db.control import control_session
from app.tenant.notifications import service as notify_service

logger = logging.getLogger("app.security_events")


def _enqueue(to_email: str, category: str, *, locale: str | None, params: dict | None,
             account_id: uuid.UUID, company_id: uuid.UUID) -> None:
    with control_session() as s:
        mail_repo.enqueue(s, to_email, category, locale=locale, params=params,
                          account_id=account_id, company_id=company_id)
        s.commit()


def fire_new_device(
    company_id: uuid.UUID, account_id: uuid.UUID, *,
    client_ip: str | None, user_agent: str | None, at: str,
    email: str | None, locale: str | None, send_email: bool,
) -> None:
    """新端末ログイン通知（A.9-⑧(a)）。in-app は全会社／メールは `send_email`（MFA-OFF 前倒し）時のみ。"""
    params = {"ip": client_ip, "device": user_agent, "at": at}
    notify_service.notify_account(company_id, account_id, "security_new_device", params=params)
    try:
        audit.record("auth.login.new_device",
                     {"company_id": str(company_id), "account_id": str(account_id)})
        if send_email and email:
            _enqueue(email, CATEGORY_NEW_DEVICE, locale=locale, params=params,
                     account_id=account_id, company_id=company_id)
    except Exception:  # noqa: BLE001 — 副作用の殻。本処理成功を優先（§3.5-(3)）。
        logger.warning("new_device side-effect failed (account=%s)", account_id, exc_info=True)


def fire_password_changed(
    company_id: uuid.UUID, account_id: uuid.UUID, *, email: str | None, locale: str | None,
) -> None:
    """パスワード変更完了通知（A.9-⑧(b)）。in-app＋メール（常時）。"""
    notify_service.notify_account(company_id, account_id, "security_password_changed")
    try:
        audit.record("auth.password_changed",
                     {"company_id": str(company_id), "account_id": str(account_id)})
        if email:
            _enqueue(email, CATEGORY_PASSWORD_CHANGED, locale=locale, params=None,
                     account_id=account_id, company_id=company_id)
    except Exception:  # noqa: BLE001 — 副作用の殻。本処理成功を優先（§3.5-(3)）。
        logger.warning("password_changed side-effect failed (account=%s)", account_id, exc_info=True)
