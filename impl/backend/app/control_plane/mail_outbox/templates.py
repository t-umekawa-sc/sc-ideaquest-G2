"""mail_outbox の送信時レンダリング（ADR-0007 §2.7・§4.7）。

秘匿値（OTP コード／設定リンクのトークン）は DB に完成本文で持たず `secret` 列に隔離し、
**送信時に本モジュールが件名/本文へ差し込む**。テンプレはここ 1 箇所に集約する（auth からは移設）。
locale（`ja`/`en`）でシステム生成メールを出し分ける（源泉＝`accounts.locale`・未設定/不明は `ja`・§2.1 i18n）。
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
CATEGORY_NEW_DEVICE = "new_device"                        # 新端末ログイン通知（本人宛・MFA-OFF 前倒し・A.9-⑧(a)）
CATEGORY_PASSWORD_CHANGED = "password_changed"            # パスワード変更完了通知（本人宛・A.9-⑧(b)）


def render(
    category: str, secret: str | None, locale: str | None = None, params: dict | None = None
) -> tuple[str, str]:
    """`(subject, body)` を返す（locale で JA/EN 出し分け・既定 ja）。

    `secret`＝OTP コード／設定リンクトークン（lock は None）。`params`＝非秘匿の描画パラメータ
    （new_device の ip/device/at 等・§4）。本文・秘匿値はログに出さない（呼び出し側の責務・セキュリティ一覧 3・15）。
    """
    s = get_settings()
    en = locale == "en"  # 既定 ja（未設定/不明は ja）
    p = params or {}

    if category == CATEGORY_OTP:
        minutes = s.otp_ttl_seconds // 60
        if en:
            return ("[ideaquest] Login verification code",
                    "Your ideaquest login verification code.\n\n"
                    f"Code: {secret}\n"
                    f"(valid for {minutes} minutes, single use)\n\n"
                    "If you did not request this, please ignore this email.")
        return ("【ideaquest】ログイン認証コード",
                "ideaquest のログイン認証コードです。\n\n"
                f"認証コード: {secret}\n"
                f"（有効期限 {minutes} 分・1回限り）\n\n"
                "このメールに心当たりがない場合は破棄してください。")

    if category == CATEGORY_PASSWORD_SETUP:
        link = f"{s.app_base_url}/password-setup?token={secret}"
        if en:
            return ("[ideaquest] Set your password",
                    "Please set (or reset) your ideaquest password.\n\n"
                    "Open the link below to set a new password (valid for 72 hours, single use).\n"
                    f"{link}\n\n"
                    "If you did not request this, please ignore this email.")
        return ("【ideaquest】パスワード設定のご案内",
                "ideaquest のパスワード設定/再設定のご案内です。\n\n"
                "以下のリンクから新しいパスワードを設定してください（有効期限 72 時間・1回限り）。\n"
                f"{link}\n\n"
                "このメールに心当たりがない場合は破棄してください。")

    if category == CATEGORY_LOCK_NOTIFICATION:
        if en:
            return ("[ideaquest] Sign-in temporarily restricted",
                    "Sign-in for your account was temporarily restricted after repeated failed attempts.\n\n"
                    "It will be lifted automatically after a short while.\n"
                    "If this wasn't you, we recommend resetting your password.\n\n"
                    "If you did not attempt this, please ignore this email.")
        return ("【ideaquest】ログインの一時制限のお知らせ",
                "あなたのアカウントでログインの失敗が続いたため、一時的にログインを制限しました。\n\n"
                "しばらく時間をおくと自動的に解除されます。\n"
                "心当たりがない場合は、パスワードの再設定をおすすめします。\n\n"
                "このメールに心当たりがない場合は破棄してください。")

    if category == CATEGORY_EMAIL_CHANGE_CONFIRM:
        hours = s.email_change_ttl_seconds // 3600
        link = f"{s.app_base_url}/email-change/confirm?token={secret}"
        if en:
            return ("[ideaquest] Confirm your email change",
                    "Please confirm the change of your ideaquest email address.\n\n"
                    f"Opening the link below confirms the change to this address (valid for {hours} hours, single use).\n"
                    f"{link}\n\n"
                    "If you did not request this, please ignore this email (no change is made unless you open the link).")
        return ("【ideaquest】メールアドレス変更の確認",
                "ideaquest のメールアドレス変更のご確認です。\n\n"
                f"以下のリンクを開くと、このメールアドレスへの変更が確定します（有効期限 {hours} 時間・1回限り）。\n"
                f"{link}\n\n"
                "このメールに心当たりがない場合は破棄してください（リンクを開かなければ変更は行われません）。")

    if category == CATEGORY_EMAIL_VERIFY_LINK:
        hours = s.email_verify_ttl_seconds // 3600
        link = f"{s.app_base_url}/email-verify/confirm?token={secret}"
        if en:
            return ("[ideaquest] Verify your email address",
                    "Please verify your ideaquest email address.\n\n"
                    f"Opening the link below marks this address as verified (valid for {hours} hours, single use).\n"
                    f"{link}\n\n"
                    "If you did not request this, please ignore this email (your address is not changed).")
        return ("【ideaquest】メールアドレスの確認",
                "ideaquest のメールアドレス確認のお願いです。\n\n"
                f"以下のリンクを開くと、このメールアドレスが確認済みになります（有効期限 {hours} 時間・1回限り）。\n"
                f"{link}\n\n"
                "このメールに心当たりがない場合は破棄してください（メールアドレスは変更されません）。")

    if category == CATEGORY_EMAIL_CHANGE_NOTICE:
        # 旧メール宛の通知（乗っ取り検知）。新メールアドレスは載せない（最小開示・ADR-0008 §2.4）
        if en:
            return ("[ideaquest] Email change requested",
                    "A change of email address was requested for your account.\n\n"
                    "A confirmation link has been sent to the new address. The change is not final until that link is opened.\n"
                    "If this wasn't you, please change your password and contact your administrator.\n\n"
                    "If you did not request this, please ignore this email.")
        return ("【ideaquest】メールアドレス変更の依頼を受け付けました",
                "あなたのアカウントでメールアドレスの変更が依頼されました。\n\n"
                "新しいメールアドレス宛に確認リンクを送信しています。変更は確認リンクを開くまで確定しません。\n"
                "心当たりがない場合は、パスワードを変更し管理者にご連絡ください。\n\n"
                "このメールに心当たりがない場合は破棄してください。")

    if category == CATEGORY_NEW_DEVICE:
        # 新端末ログイン通知（本人宛・A.9-⑧(a)）。日時／IP／UA を載せて不正の早期検知を促す。
        labels = (("Date", "IP", "Device") if en else ("日時", "IP", "端末"))
        detail_lines = [
            f"{lbl}: {p[key]}" for lbl, key in zip(labels, ("at", "ip", "device")) if p.get(key)
        ]
        detail = ("\n" + "\n".join(detail_lines) + "\n") if detail_lines else ""
        if en:
            return ("[ideaquest] Sign-in from a new device",
                    "Your account was signed in from a new device.\n"
                    f"{detail}\n"
                    "If this was you, no action is needed.\n"
                    "If not, change your password immediately and contact your administrator.")
        return ("【ideaquest】新しい端末からのログイン",
                "あなたのアカウントに、新しい端末からログインがありました。\n"
                f"{detail}\n"
                "心当たりがある場合は操作は不要です。\n"
                "心当たりがない場合は、速やかにパスワードを変更し管理者にご連絡ください。")

    if category == CATEGORY_PASSWORD_CHANGED:
        # パスワード変更完了通知（本人宛・A.9-⑧(b)・固定文＝params 不要）
        if en:
            return ("[ideaquest] Your password was changed",
                    "The password for your account was changed.\n\n"
                    "As a result you have been signed out of all devices (sign in again is required).\n"
                    "If this wasn't you, please contact your administrator immediately.\n\n"
                    "If you did not request this, please ignore this email.")
        return ("【ideaquest】パスワードが変更されました",
                "あなたのアカウントのパスワードが変更されました。\n\n"
                "この操作により、すべての端末からログアウトされています（再ログインが必要です）。\n"
                "心当たりがない場合は、速やかに管理者にご連絡ください。\n\n"
                "このメールに心当たりがない場合は破棄してください。")

    raise ValueError(f"unknown mail category: {category}")
