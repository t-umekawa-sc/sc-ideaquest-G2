"""テスト共通フィクスチャ（テスト規約 §3）。

- Redis はテストごとに flush して隔離（セッション・レート制限カウンタをリセット）。
- 管理DB/会社DB は起動時 bootstrap 済み。テストが作る行は teardown で削除。
- 成功パスはシード会社/アカウント（定数）を使う。エッジは factory で専用データを作る。
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.control_plane.auth.orm import Account, Company, OtpChallenge, TrustedDevice
from app.core.security import generate_token, hash_password, hash_token
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.infra import mail as mail_infra
from app.infra.cache import get_redis
from app.main import app
from app.tenant.profile.orm import User

# bootstrap のシード（開発用ログイン情報）
SEED_COMPANY_CODE = "ACME-01"
SEED_LOGIN = "user@acme.example"
SEED_PASSWORD = "Passw0rd!"
# MFA 必須のシード会社（ADR-0004・状態C）
SEED_MFA_COMPANY_CODE = "ACME-02"
SEED_MFA_LOGIN = "mfa@acme2.example"


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture(autouse=True)
def _flush_redis():
    """各テストの前後で Redis を初期化（セッション・レート制限を隔離）。"""
    get_redis().flushdb()
    yield
    get_redis().flushdb()


@pytest.fixture
def mail():
    """メール送信をフェイクに差し替え、送信内容を捕捉する（ADR-0002 §2.5）。teardown で解除。"""
    fake = mail_infra.FakeMailSender()
    mail_infra.set_mail_sender(fake)
    yield fake
    mail_infra.set_mail_sender(None)


@pytest.fixture
def factory():
    """エッジ検証用の会社/アカウントを作る。teardown で削除。

    db_identifier は毎回ユニーク（実DBは作らない）。成功認証しないケース専用
    （suspended / 無効資格 / PW未設定）なので会社DB接続は発生しない。
    """
    created_accounts: list[uuid.UUID] = []
    created_companies: list[uuid.UUID] = []
    created_challenges: list[uuid.UUID] = []
    # (db_identifier, account_id) 会社DB ミラーの掃除対象
    created_users: list[tuple[str, uuid.UUID]] = []

    def _company_by_code(code: str) -> Company:
        with control_session() as s:
            return s.query(Company).filter_by(company_code=code).one()

    def _seed_company() -> Company:
        return _company_by_code(SEED_COMPANY_CODE)

    def make_company(status: str = "active", mfa_required: bool = False) -> dict:
        code = f"TST-{uuid.uuid4().hex[:8]}"
        with control_session() as s:
            c = Company(
                id=uuid.uuid4(),
                company_code=code,
                name="Test Co",
                db_identifier=f"ideaquest_test_{uuid.uuid4().hex[:8]}",
                status=status,
                mfa_required=mfa_required,
            )
            s.add(c)
            s.commit()
            created_companies.append(c.id)
            return {"id": c.id, "company_code": code}

    def make_account(company: dict, password: str = "Passw0rd!", password_set: bool = True,
                     status: str = "active") -> dict:
        lid = f"user-{uuid.uuid4().hex[:8]}@t.example"
        with control_session() as s:
            a = Account(
                id=uuid.uuid4(),
                company_id=company["id"],
                login_id=lid,
                email=lid,
                display_name="Test User",
                password_hash=hash_password(password) if password_set else None,
                locale="ja",
                system_role="general",
                status=status,
            )
            s.add(a)
            s.commit()
            created_accounts.append(a.id)
            return {"id": a.id, "login_id": lid, "password": password}

    def _make_real_account(company: Company, prefix: str, password_set: bool, status: str) -> dict:
        """実在の会社DBを持つシード会社配下にアカウント＋users ミラーを作る（成功認証パス用）。

        complete→login の往復や MFA verify 成功（会社DBミラー解決）に使う。
        teardown で control の accounts と 会社DB の users を削除する。
        """
        lid = f"{prefix}-{uuid.uuid4().hex[:8]}@{company.company_code.lower()}.example"
        password = "Passw0rd!"
        aid = uuid.uuid4()
        with control_session() as s:
            s.add(Account(
                id=aid,
                company_id=company.id,
                login_id=lid,
                email=lid,
                display_name="Seed Test",
                password_hash=hash_password(password) if password_set else None,
                locale="ja",
                system_role="general",
                status=status,
            ))
            s.commit()
        created_accounts.append(aid)
        with get_tenant_session(company.db_identifier) as ts:
            ts.add(User(id=uuid.uuid4(), account_id=aid, display_name="Seed Test", locale="ja", status="active"))
            ts.commit()
        created_users.append((company.db_identifier, aid))
        return {"id": aid, "login_id": lid, "password": password,
                "company_code": company.company_code, "email": lid}

    def make_seed_company_account(password_set: bool = True, status: str = "active") -> dict:
        """ACME-01（MFA OFF）配下の実アカウント。password-setup complete→login 等に使う。"""
        return _make_real_account(_seed_company(), "pw", password_set, status)

    def make_seed_mfa_account(status: str = "active") -> dict:
        """ACME-02（MFA ON）配下の実アカウント。login→OTP→mfa/verify 成功パスに使う（ADR-0004）。"""
        return _make_real_account(_company_by_code(SEED_MFA_COMPANY_CODE), "mfa", True, status)

    def make_password_setup_challenge(
        account_id: uuid.UUID, token: str | None = None,
        expires_in_seconds: int = 3600, used: bool = False,
    ) -> str:
        """password_setup チャレンジを直接作成し、平文トークンを返す（expired/used ケース用）。"""
        tok = token or generate_token()
        cid = uuid.uuid4()
        now = datetime.now(timezone.utc)
        with control_session() as s:
            s.add(OtpChallenge(
                id=cid,
                account_id=account_id,
                code_hash=hash_token(tok),
                purpose="password_setup",
                expires_at=now + timedelta(seconds=expires_in_seconds),
                used_at=now if used else None,
            ))
            s.commit()
        created_challenges.append(cid)
        return tok

    yield SimpleNamespace(
        make_company=make_company,
        make_account=make_account,
        make_seed_company_account=make_seed_company_account,
        make_seed_mfa_account=make_seed_mfa_account,
        make_password_setup_challenge=make_password_setup_challenge,
    )

    with control_session() as s:
        for cid in created_challenges:
            s.query(OtpChallenge).filter_by(id=cid).delete()
        # テスト中に request/complete が作った未追跡のチャレンジも掃除（対象アカウント分）
        for aid in created_accounts:
            s.query(OtpChallenge).filter_by(account_id=aid).delete()
        # MFA verify(trust_device) が作った信頼端末も掃除
        for aid in created_accounts:
            s.query(TrustedDevice).filter_by(account_id=aid).delete()
        for aid in created_accounts:
            s.query(Account).filter_by(id=aid).delete()
        for cid in created_companies:
            s.query(Company).filter_by(id=cid).delete()
        s.commit()
    for db_identifier, aid in created_users:
        with get_tenant_session(db_identifier) as ts:
            ts.query(User).filter_by(account_id=aid).delete()
            ts.commit()
