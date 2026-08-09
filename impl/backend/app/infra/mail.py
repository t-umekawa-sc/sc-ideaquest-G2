"""メール送信（ADR-0002 §2.5・データモデル §4.4「アダプタで抽象化」）。

- 送信は Protocol `MailSender` で抽象化＝本番は SMTP、dev は MailHog（同じ SMTP）、テストは
  フェイク（送信内容を捕捉）に差し替える。
- 業務ロジック（誰に何を送るか）は application 層が決め、本モジュールは配送手段のみを担う（§3.1）。
- 秘匿値の扱い＝トークンは本文（リンク）に載るが、ログには出さない（セキュリティ一覧 3・15）。
"""
from __future__ import annotations

import smtplib
from dataclasses import dataclass
from email.message import EmailMessage
from typing import Protocol

from app.core.config import get_settings


@dataclass
class SentMail:
    to: str
    subject: str
    body: str


class MailSender(Protocol):
    def send(self, to: str, subject: str, body: str) -> None: ...


class SmtpMailSender:
    """SMTP 送信（dev=MailHog `mailhog:1025`／prod=SMTP）。

    設定は env（ADR-0003）＝接続先/STARTTLS/認証。dev の MailHog は認証なし・平文なので
    `smtp_start_tls=False`・`smtp_user=""` の既定でそのまま動く（STARTTLS もログインも行わない）。
    """

    def send(self, to: str, subject: str, body: str) -> None:
        s = get_settings()
        msg = EmailMessage()
        msg["From"] = s.mail_from
        msg["To"] = to
        msg["Subject"] = subject
        msg.set_content(body)
        with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=10) as smtp:
            if s.smtp_start_tls:
                smtp.starttls()
            if s.smtp_user:
                smtp.login(s.smtp_user, s.smtp_password)
            smtp.send_message(msg)


class FakeMailSender:
    """テスト用＝送信内容をメモリに捕捉（実際には送らない）。"""

    def __init__(self) -> None:
        self.sent: list[SentMail] = []

    def send(self, to: str, subject: str, body: str) -> None:
        self.sent.append(SentMail(to=to, subject=subject, body=body))


# 差し替え可能なプロセス内シングルトン。テストは set_mail_sender() でフェイクに置換する。
_override: MailSender | None = None
_default: MailSender | None = None


def set_mail_sender(sender: MailSender | None) -> None:
    global _override
    _override = sender


def get_mail_sender() -> MailSender:
    global _default
    if _override is not None:
        return _override
    if _default is None:
        _default = SmtpMailSender()
    return _default
