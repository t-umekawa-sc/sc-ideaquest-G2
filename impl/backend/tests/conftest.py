"""テスト共通フィクスチャ（テスト規約 §3）。

- Redis はテストごとに flush して隔離（セッション・レート制限カウンタをリセット）。
- 管理DB/会社DB は起動時 bootstrap 済み。テストが作る行は teardown で削除。
- 成功パスはシード会社/アカウント（定数）を使う。エッジは factory で専用データを作る。
"""
from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.control_plane.auth.orm import Account, Company
from app.core.security import hash_password
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.infra.cache import get_redis
from app.main import app
from app.tenant.profile.orm import User

# bootstrap のシード（開発用ログイン情報）
SEED_COMPANY_CODE = "ACME-01"
SEED_LOGIN = "user@acme.example"
SEED_PASSWORD = "Passw0rd!"


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
def factory():
    """エッジ検証用の会社/アカウントを作る。teardown で削除。

    db_identifier は毎回ユニーク（実DBは作らない）。成功認証しないケース専用
    （suspended / 無効資格 / PW未設定）なので会社DB接続は発生しない。
    """
    created_accounts: list[uuid.UUID] = []
    created_companies: list[uuid.UUID] = []

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

    yield SimpleNamespace(make_company=make_company, make_account=make_account)

    with control_session() as s:
        for aid in created_accounts:
            s.query(Account).filter_by(id=aid).delete()
        for cid in created_companies:
            s.query(Company).filter_by(id=cid).delete()
        s.commit()
