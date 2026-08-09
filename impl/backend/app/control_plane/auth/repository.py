"""管理DB（コントロールプレーン）のアカウント参照／OTP チャレンジの永続化。"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.control_plane.auth.orm import Account, Company, OtpChallenge, TrustedDevice


def find_account_and_company(
    session: Session, company_code: str, login_id: str
) -> tuple[Account | None, Company | None]:
    """会社コード＋ログインID からアカウントと会社を引く。

    会社コードが無ければ (None, None)。会社はあるがアカウントが無ければ (None, company)。
    列挙耐性のため、呼び出し側は結果に関わらず必ず PW 照合（ダミー含む）を行う。
    """
    company = session.execute(
        select(Company).where(Company.company_code == company_code)
    ).scalar_one_or_none()
    if company is None:
        return None, None
    account = session.execute(
        select(Account).where(Account.company_id == company.id, Account.login_id == login_id)
    ).scalar_one_or_none()
    return account, company


# --- OTP チャレンジ（password_setup・データモデル §4.4／ADR-0002） -------------------------
_PASSWORD_SETUP = "password_setup"


def invalidate_password_setup_challenges(session: Session, account_id: uuid.UUID) -> None:
    """当該アカウントの未使用 password_setup チャレンジを失効（削除）。最新リンクのみ有効に保つ（ADR-0002 §2.1）。"""
    session.execute(
        delete(OtpChallenge).where(
            OtpChallenge.account_id == account_id,
            OtpChallenge.purpose == _PASSWORD_SETUP,
            OtpChallenge.used_at.is_(None),
        )
    )


def create_password_setup_challenge(
    session: Session, account_id: uuid.UUID, code_hash: str, expires_at: datetime
) -> OtpChallenge:
    challenge = OtpChallenge(
        id=uuid.uuid4(),
        account_id=account_id,
        code_hash=code_hash,
        purpose=_PASSWORD_SETUP,
        expires_at=expires_at,
    )
    session.add(challenge)
    return challenge


def find_password_setup_challenge_by_hash(session: Session, code_hash: str) -> OtpChallenge | None:
    return session.execute(
        select(OtpChallenge).where(
            OtpChallenge.code_hash == code_hash, OtpChallenge.purpose == _PASSWORD_SETUP
        )
    ).scalar_one_or_none()


def get_account(session: Session, account_id: uuid.UUID) -> Account | None:
    return session.get(Account, account_id)


def get_company(session: Session, company_id: uuid.UUID) -> Company | None:
    return session.get(Company, company_id)


# --- 信頼端末（trusted_devices・iq_trust・ADR-0004 §2.3） -----------------------------------
def create_trusted_device(
    session: Session, account_id: uuid.UUID, token_hash: str, expires_at: datetime
) -> TrustedDevice:
    td = TrustedDevice(
        id=uuid.uuid4(), account_id=account_id, token_hash=token_hash, expires_at=expires_at
    )
    session.add(td)
    return td


def find_active_trusted_device(
    session: Session, account_id: uuid.UUID, token_hash: str
) -> TrustedDevice | None:
    """未失効かつ未期限切れの信頼端末のみ有効（login の MFA スキップ判定・A.0-①）。"""
    now = datetime.now(timezone.utc)
    return session.execute(
        select(TrustedDevice).where(
            TrustedDevice.account_id == account_id,
            TrustedDevice.token_hash == token_hash,
            TrustedDevice.revoked.is_(False),
            TrustedDevice.expires_at > now,
        )
    ).scalar_one_or_none()


def revoke_all_trusted_devices(session: Session, account_id: uuid.UUID) -> None:
    """当該アカウントの全信頼端末を失効（logout-all・A.0-⑤＝全端末で次回 MFA 必須）。"""
    session.execute(
        update(TrustedDevice)
        .where(TrustedDevice.account_id == account_id, TrustedDevice.revoked.is_(False))
        .values(revoked=True)
    )
