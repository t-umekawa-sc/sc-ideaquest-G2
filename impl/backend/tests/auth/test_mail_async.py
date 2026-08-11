"""認証系メール非同期化の統合テスト（doc/テスト/A_認証.md §7・ADR-0007）。

login / password-setup/request の処理中に SMTP は走らない（mail_outbox へ enqueue するだけ）。
実送信は process_mail_outbox_once() を明示的に呼んで確認する。配信タイミングを検証するため、
本ファイルは _DrainingMail（mail フィクスチャ）を使わず素の FakeMailSender を差し替える。
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.control_plane.mail_outbox.application import process_mail_outbox_once
from app.control_plane.mail_outbox.orm import MailOutboxEntry
from app.core.config import get_settings
from app.db.control import control_session
from app.infra import mail as mail_infra
from app.main import app

LOGIN = "/api/v1/auth/login"
PWREQ = "/api/v1/auth/password-setup/request"
MAX = get_settings().login_lock_max_attempts


def _outbox_rows() -> list[MailOutboxEntry]:
    with control_session() as s:
        return list(s.execute(select(MailOutboxEntry).order_by(MailOutboxEntry.seq)).scalars())


class _FailingSender:
    """全送信を失敗させる（SMTP 障害の再現）。"""
    def send(self, to: str, subject: str, body: str) -> None:
        raise RuntimeError("smtp boom")


@pytest.fixture
def set_sender():
    """任意の MailSender に差し替え、そのオブジェクトを返す。teardown で解除。"""
    def _set(sender):
        mail_infra.set_mail_sender(sender)
        return sender
    yield _set
    mail_infra.set_mail_sender(None)


def _fail_login(cl: TestClient, acc: dict) -> None:
    cl.post(LOGIN, json={"company_code": acc["company_code"], "login_id": acc["login_id"], "password": "WRONG"})


def test_a_tc_090_request_enqueues_without_sync_send(client, factory, set_sender):
    """A-TC-090 request は enqueue のみ＝同期送信しない。行は pending＋secret（token 隔離）。根拠 ADR-0007 §2.6/§4.7。"""
    fake = set_sender(mail_infra.FakeMailSender())
    acc = factory.make_seed_company_account()

    r = client.post(PWREQ, json={"company_code": acc["company_code"], "login_id": acc["login_id"]})

    assert r.status_code == 202
    assert fake.sent == []                              # request 時点で同期送信していない
    rows = _outbox_rows()
    assert len(rows) == 1
    assert rows[0].category == "password_setup"
    assert rows[0].status == "pending"
    assert rows[0].secret                               # 設定リンクのトークンを secret に隔離


def test_a_tc_092_mfa_login_enqueues_otp(client, factory, set_sender):
    """A-TC-092 MFA login は OTP を enqueue（送信を待たない）。配信で届く。根拠 ADR-0007 §2.6。"""
    fake = set_sender(mail_infra.FakeMailSender())
    acc = factory.make_seed_mfa_account()

    r = client.post(LOGIN, json={"company_code": acc["company_code"], "login_id": acc["login_id"], "password": acc["password"]})

    assert r.status_code == 200 and r.json()["status"] == "mfa_required"
    assert fake.sent == []                              # 送信を待たずに応答
    rows = _outbox_rows()
    assert len(rows) == 1 and rows[0].category == "otp" and rows[0].secret

    process_mail_outbox_once()                          # 配信
    assert len(fake.sent) == 1


def test_a_tc_093_lock_fire_enqueues_notification(client, factory, set_sender):
    """A-TC-093 ロック発火は通知を enqueue（発火リクエストで同期送信しない）。根拠 ADR-0007 §1(a)/§2.6。"""
    fake = set_sender(mail_infra.FakeMailSender())
    acc = factory.make_seed_company_account()
    a = TestClient(app, client=("10.0.0.93", 1))

    for _ in range(MAX):
        _fail_login(a, acc)                             # 発火

    assert fake.sent == []                              # 発火時点で同期送信していない（遅延が乗らない）
    rows = _outbox_rows()
    assert len(rows) == 1
    assert rows[0].category == "lock_notification"
    assert rows[0].secret is None                       # ロック通知は秘匿値なし

    process_mail_outbox_once()
    assert len(fake.sent) == 1 and fake.sent[0].to == acc["email"]


def test_a_tc_098_request_202_even_if_smtp_down(client, factory, set_sender):
    """A-TC-098 SMTP 不達でも request は 202（送信は経路外＝enqueue のみ）。根拠 ADR-0007 §1(b)/§2.6。"""
    set_sender(_FailingSender())                        # ワーカは動かさない
    acc = factory.make_seed_company_account()

    r = client.post(PWREQ, json={"company_code": acc["company_code"], "login_id": acc["login_id"]})

    assert r.status_code == 202                         # 500 にならない
    assert _outbox_rows()[0].status == "pending"        # enqueue はされている


def test_a_tc_099_login_401_even_if_smtp_down(client, factory, set_sender):
    """A-TC-099 SMTP 不達でもロック発火 login は 401（通知は enqueue のみ）。根拠 ADR-0007 §1(b)。"""
    set_sender(_FailingSender())
    acc = factory.make_seed_company_account()
    a = TestClient(app, client=("10.0.0.99", 1))

    last = None
    for _ in range(MAX):
        last = a.post(LOGIN, json={"company_code": acc["company_code"], "login_id": acc["login_id"], "password": "WRONG"})

    assert last.status_code == 401                      # SMTP 失敗が応答に出ない
