"""公開プレーンの管理DBアクセス（会社コード解決／signup_challenges CRUD）。

呼び出し側 Tx に相乗る（application 層が control_session を開く）。
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.control_plane.auth.orm import Account, Company, SignupChallenge


def get_company_by_code(session: Session, company_code: str) -> Company | None:
    """会社コード→会社（大文字正規化は呼び出し側で実施）。存在秘匿のため呼び出し側で成否を隠す。"""
    return session.execute(
        select(Company).where(Company.company_code == company_code)
    ).scalars().one_or_none()


def account_exists(session: Session, company_id: uuid.UUID, *, login_id: str, email: str) -> bool:
    """同一会社に login_id または email の account が既に有るか（列挙耐性のため in-band では使わない）。"""
    return session.execute(
        select(Account.id).where(
            Account.company_id == company_id,
            (Account.login_id == login_id) | (Account.email == email),
        ).limit(1)
    ).first() is not None


def replace_pending(
    session: Session, *, company_id: uuid.UUID, login_id: str, email: str,
    display_name: str, password_hash: str, code_hash: str, expires_at: datetime,
) -> SignupChallenge:
    """同一 (company, email) の未使用 pending を破棄し最新1件に置換（再送＝最新のみ有効・SEC C）。"""
    session.execute(
        SignupChallenge.__table__.delete().where(
            SignupChallenge.company_id == company_id,
            SignupChallenge.email == email,
            SignupChallenge.used_at.is_(None),
        )
    )
    row = SignupChallenge(
        id=uuid.uuid4(), company_id=company_id, login_id=login_id, email=email,
        display_name=display_name, password_hash=password_hash, code_hash=code_hash,
        attempts=0, expires_at=expires_at,
    )
    session.add(row)
    session.flush()
    return row


def find_latest_pending(session: Session, *, company_id: uuid.UUID, email: str) -> SignupChallenge | None:
    """検証用＝(company, email) の最新 pending（used 済みも含む）。used/期限/試行/一致は呼び出し側で判定。

    used 済みを含めて引くのは、確定後の再利用を 410（使用済み）として明示するため（単回・SEC A/C）。
    """
    return session.execute(
        select(SignupChallenge).where(
            SignupChallenge.company_id == company_id,
            SignupChallenge.email == email,
        ).order_by(SignupChallenge.created_at.desc()).limit(1)
    ).scalars().one_or_none()
