"""メール送信アウトボックスの機構テスト（doc/テスト/A_認証.md §7・ADR-0007）。

`mail_outbox` は管理DBのトランスポート状態（conftest の autouse で各テスト前後に truncate）。
実送信は `process_mail_outbox_once()` を直接呼ぶ（§4.6 account_sync と同じくテストは常駐不要）。
秘匿値は `secret` 列に隔離し、送信成功／端末失敗で NULL 化される（§2.7）。
"""
from __future__ import annotations

import subprocess
import sys
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.control_plane.mail_outbox.application import (
    cleanup_done_mail_outbox,
    process_mail_outbox_once,
)
from app.control_plane.mail_outbox.orm import MailOutboxEntry
from app.control_plane.mail_outbox.templates import (
    CATEGORY_LOCK_NOTIFICATION,
    CATEGORY_OTP,
    CATEGORY_PASSWORD_SETUP,
)
from app.core.config import get_settings
from app.db.control import control_session
from app.infra import mail as mail_infra


def _enqueue(to_email: str, category: str, *, secret: str | None = None, status: str = "pending",
             attempts: int = 0, claimed_at=None, processed_at=None) -> uuid.UUID:
    rid = uuid.uuid4()
    with control_session() as s:
        s.add(MailOutboxEntry(
            id=rid, to_email=to_email, category=category, secret=secret,
            status=status, attempts=attempts, claimed_at=claimed_at, processed_at=processed_at,
        ))
        s.commit()
    return rid


def _get(rid: uuid.UUID) -> MailOutboxEntry | None:
    with control_session() as s:
        return s.get(MailOutboxEntry, rid)  # expire_on_commit=False＝クローズ後も属性参照可


class _FailingSender:
    """全送信を失敗させる（SMTP 障害の再現）。"""
    def send(self, to: str, subject: str, body: str) -> None:
        raise RuntimeError("smtp boom")


class _SelectiveFailSender:
    """指定宛先だけ失敗させる（独立処理の検証）。"""
    def __init__(self, fail_to: str) -> None:
        self.fail_to = fail_to
        self.sent: list[str] = []

    def send(self, to: str, subject: str, body: str) -> None:
        if to == self.fail_to:
            raise RuntimeError("smtp boom")
        self.sent.append(to)


@pytest.fixture
def set_sender():
    """任意の MailSender に差し替え、teardown で解除する。"""
    yield mail_infra.set_mail_sender
    mail_infra.set_mail_sender(None)


def test_a_tc_091_worker_sends_and_clears_secret(mail):
    """A-TC-091 ワーカ適用で送信→done→secret NULL 化。根拠 ADR-0007 §2.5/§2.7。"""
    token = "tok-091-abc"
    rid = _enqueue("u091@x.example", CATEGORY_PASSWORD_SETUP, secret=token)

    stats = process_mail_outbox_once()

    assert stats["sent"] == 1
    assert len(mail.sent) == 1
    assert token in mail.sent[0].body        # 送信時レンダリングで設定リンクに token が載る
    row = _get(rid)
    assert row.status == "done"
    assert row.secret is None                # 送信後 NULL 化（at-rest 最小化）
    assert row.processed_at is not None


def test_a_tc_094_retry_then_failed_clears_secret(set_sender, monkeypatch):
    """A-TC-094 送信失敗は attempts++ で pending 維持、上限超で failed＋secret NULL。根拠 ADR-0007 §2.5/§2.7。"""
    set_sender(_FailingSender())
    monkeypatch.setenv("MAIL_OUTBOX_MAX_ATTEMPTS", "2")
    get_settings.cache_clear()
    try:
        rid = _enqueue("u094@x.example", CATEGORY_OTP, secret="123456")

        s1 = process_mail_outbox_once()
        assert s1["failed"] == 1
        row = _get(rid)
        assert row.status == "pending" and row.attempts == 1
        assert row.secret == "123456"        # 上限未満＝再送のため secret は保持

        process_mail_outbox_once()           # 2 回目で上限到達
        row = _get(rid)
        assert row.status == "failed" and row.attempts == 2
        assert row.secret is None            # 端末失敗で secret NULL
    finally:
        get_settings.cache_clear()


def test_a_tc_095_independent_processing(set_sender):
    """A-TC-095 先頭行の送信失敗は後続の別行をブロックしない（HOL 無し）。根拠 ADR-0007 §2.4。"""
    set_sender(_SelectiveFailSender(fail_to="bad@x.example"))
    _enqueue("bad@x.example", CATEGORY_LOCK_NOTIFICATION)     # 先に積む（seq 小）＝送信失敗
    good = _enqueue("good@x.example", CATEGORY_LOCK_NOTIFICATION)

    stats = process_mail_outbox_once()

    assert stats["sent"] == 1 and stats["failed"] == 1
    assert _get(good).status == "done"       # 後続の別行は送信される


def test_a_tc_096_reclaim_stuck_sending(mail):
    """A-TC-096 reclaim 超の sending は pending へ戻して再送・reclaim 未満は横取りしない。根拠 ADR-0007 §2.5。"""
    stale = _enqueue("u096@x.example", CATEGORY_LOCK_NOTIFICATION, status="sending",
                     claimed_at=datetime.now(timezone.utc) - timedelta(seconds=9999))
    fresh = _enqueue("fresh@x.example", CATEGORY_LOCK_NOTIFICATION, status="sending",
                     claimed_at=datetime.now(timezone.utc))

    stats = process_mail_outbox_once()

    assert stats["reclaimed"] >= 1
    assert _get(stale).status == "done"      # 滞留 → pending → 送信
    assert _get(fresh).status == "sending"   # 送信中（新しい）は横取りしない
    assert len(mail.sent) == 1


def test_a_tc_100_worker_process_registers_fk_targets():
    """A-TC-100 mail_worker は別プロセス＝application 単独 import で FK ターゲット(accounts/companies)が
    metadata に登録される（登録漏れだと done 書込のフラッシュで NoReferencedTableError）。根拠 ADR-0007 §2.3。

    本テストプロセスは conftest が auth.orm を import 済みで再現しないため、**まっさらな子プロセス**で
    mail_outbox.application だけを import して検証する（worker の import 隔離バグの回帰防止）。
    """
    code = (
        "import app.control_plane.mail_outbox.application\n"
        "from app.db.base import ControlBase\n"
        "t = ControlBase.metadata.tables\n"
        "assert 'accounts' in t and 'companies' in t, sorted(t)\n"
        "print('OK')\n"
    )
    r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    assert "OK" in r.stdout


def test_a_tc_097_cleanup_done_retention(monkeypatch):
    """A-TC-097 retention 超の done のみ削除・retention 内の done と failed は残す。根拠 ADR-0007 §2.7。"""
    monkeypatch.setenv("MAIL_OUTBOX_DONE_RETENTION_SECONDS", "100")
    get_settings.cache_clear()
    try:
        now = datetime.now(timezone.utc)
        old_done = _enqueue("old@x.example", CATEGORY_LOCK_NOTIFICATION, status="done",
                            processed_at=now - timedelta(seconds=9999))
        recent_done = _enqueue("recent@x.example", CATEGORY_LOCK_NOTIFICATION, status="done",
                               processed_at=now - timedelta(seconds=10))
        failed = _enqueue("failed@x.example", CATEGORY_LOCK_NOTIFICATION, status="failed",
                          processed_at=now - timedelta(seconds=9999))

        deleted = cleanup_done_mail_outbox()

        assert deleted == 1
        assert _get(old_done) is None            # retention 超の done は削除
        assert _get(recent_done) is not None     # retention 内の done は残す
        assert _get(failed) is not None          # failed は残す（要手動対応）
    finally:
        get_settings.cache_clear()
