"""管理DB（コントロールプレーン）のアカウント参照。"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.control import Account, Company


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
