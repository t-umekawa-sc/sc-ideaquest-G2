"""管理DB（コントロールプレーン）のアカウント参照／OTP チャレンジの永続化。"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.control_plane.auth.orm import Account, Company, OtpChallenge


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
