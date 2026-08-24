"""mail_outbox の送信時レンダリング（ADR-0007 §2.7・§4.7）。

秘匿値（OTP コード／設定リンクのトークン）は DB に完成本文で持たず `secret` 列に隔離し、
**送信時に本モジュールが件名/本文へ差し込む**。テンプレはここ 1 箇所に集約する（auth からは移設）。
locale は i18n 拡張の受け皿（現状は JA のみ・システム生成メールは `accounts.locale` 由来）。
"""
from __future__ import annotations

from app.core.config import get_settings

# category 値（データモデル §3 mail_category・§4.7）
CATEGORY_OTP = "otp"
CATEGORY_PASSWORD_SETUP = "password_setup"
CATEGORY_LOCK_NOTIFICATION = "lock_notification"
CATEGORY_EMAIL_CHANGE_CONFIRM = "email_change_confirm"    # メール変更確認リンク（新メール宛・ADR-0008）
CATEGORY_EMAIL_CHANGE_NOTICE = "email_change_notice"      # メール変更通知（旧メール宛・乗っ取り検知・ADR-0008）
CATEGORY_EMAIL_VERIFY_LINK = "email_verify_link"          # メールアドレス確認リンク（現メール宛・ADR-0009）


def render(category: str, secret: str | None, locale: str | None = None) -> tuple[str, str]:
    """`(subject, body)` を返す。`secret`＝OTP コード／設定リンクトークン（lock は None）。

    本文・秘匿値はログに出さない（呼び出し側の責務・セキュリティ一覧 3・15）。
    """
    s = get_settings()
    if category == CATEGORY_OTP:
        minutes = s.otp_ttl_seconds // 60
        subject = "【ideaquest】ログイン認証コード"
        body = (
            "ideaquest のログイン認証コードです。\n\n"
            f"認証コード: {secret}\n"
            f"（有効期限 {minutes} 分・1回限り）\n\n"
            "このメールに心当たりがない場合は破棄してください。"
        )
        return subject, body
    if category == CATEGORY_PASSWORD_SETUP:
        link = f"{s.app_base_url}/password-setup?token={secret}"
        subject = "【ideaquest】パスワード設定のご案内"
        body = (
            "ideaquest のパスワード設定/再設定のご案内です。\n\n"
            "以下のリンクから新しいパスワードを設定してください（有効期限 72 時間・1回限り）。\n"
            f"{link}\n\n"
            "このメールに心当たりがない場合は破棄してください。"
        )
        return subject, body
    if category == CATEGORY_LOCK_NOTIFICATION:
        subject = "【ideaquest】ログインの一時制限のお知らせ"
        body = (
            "あなたのアカウントでログインの失敗が続いたため、一時的にログインを制限しました。\n\n"
            "しばらく時間をおくと自動的に解除されます。\n"
            "心当たりがない場合は、パスワードの再設定をおすすめします。\n\n"
            "このメールに心当たりがない場合は破棄してください。"
        )
        return subject, body
    if category == CATEGORY_EMAIL_CHANGE_CONFIRM:
        hours = s.email_change_ttl_seconds // 3600
        link = f"{s.app_base_url}/email-change/confirm?token={secret}"
        subject = "【ideaquest】メールアドレス変更の確認"
        body = (
            "ideaquest のメールアドレス変更のご確認です。\n\n"
            f"以下のリンクを開くと、このメールアドレスへの変更が確定します（有効期限 {hours} 時間・1回限り）。\n"
            f"{link}\n\n"
            "このメールに心当たりがない場合は破棄してください（リンクを開かなければ変更は行われません）。"
        )
        return subject, body
    if category == CATEGORY_EMAIL_VERIFY_LINK:
        hours = s.email_verify_ttl_seconds // 3600
        link = f"{s.app_base_url}/email-verify/confirm?token={secret}"
        subject = "【ideaquest】メールアドレスの確認"
        body = (
            "ideaquest のメールアドレス確認のお願いです。\n\n"
            f"以下のリンクを開くと、このメールアドレスが確認済みになります（有効期限 {hours} 時間・1回限り）。\n"
            f"{link}\n\n"
            "このメールに心当たりがない場合は破棄してください（メールアドレスは変更されません）。"
        )
        return subject, body
    if category == CATEGORY_EMAIL_CHANGE_NOTICE:
        # 旧メール宛の通知（乗っ取り検知）。新メールアドレスは載せない（最小開示・ADR-0008 §2.4）
        subject = "【ideaquest】メールアドレス変更の依頼を受け付けました"
        body = (
            "あなたのアカウントでメールアドレスの変更が依頼されました。\n\n"
            "新しいメールアドレス宛に確認リンクを送信しています。変更は確認リンクを開くまで確定しません。\n"
            "心当たりがない場合は、パスワードを変更し管理者にご連絡ください。\n\n"
            "このメールに心当たりがない場合は破棄してください。"
        )
        return subject, body
    raise ValueError(f"unknown mail category: {category}")
