"""認証の純粋ロジック（DB/IO 非依存・§3.1 Functional Core）。

ログイン判定の順序が本質（A.1）:
  1. 資格情報が不正なら invalid（列挙耐性で会社停止より先に落とす）
  2. 資格情報が正当かつ会社が停止中なら company_suspended
  3. それ以外は proceed（MFA 要否は application が会社設定で分岐）
"""
from __future__ import annotations

from enum import Enum


class LoginDecision(str, Enum):
    INVALID = "invalid"                 # 401 unauthenticated（一律・列挙耐性）
    COMPANY_SUSPENDED = "company_suspended"  # 503（資格照合が成功した後にのみ）
    PROCEED = "proceed"                 # 認証成立（MFA 要否は後段で判定）


def decide_login(credentials_ok: bool, company_status: str) -> LoginDecision:
    """credentials_ok＝(アカウント存在 かつ active かつ PW一致 かつ PW設定済) を集約した真偽。"""
    if not credentials_ok:
        return LoginDecision.INVALID
    if company_status == "suspended":
        return LoginDecision.COMPANY_SUSPENDED
    return LoginDecision.PROCEED


# --- パスワードポリシー（ADR-0002 §2.2・MVP＝最低8文字＋英字1＋数字1） ---------------------
PASSWORD_MIN_LENGTH = 8


def password_policy_errors(password: str) -> list[dict]:
    """新パスワードのポリシー違反を列挙（純粋関数・DB非依存・§3.3 でユニットテスト）。

    返り値＝problem+json の `errors[]` 形（空なら適合）。漏えい済み/よく使われる PW の
    拒否リストは後続スライスへ委譲（ADR-0002 §2.2）。ここは判定のみで、送出（422）は application。
    """
    errors: list[dict] = []
    if len(password) < PASSWORD_MIN_LENGTH:
        errors.append(
            {"field": "new_password", "code": "too_short",
             "message": f"パスワードは{PASSWORD_MIN_LENGTH}文字以上にしてください"}
        )
    if not any(c.isalpha() for c in password):
        errors.append(
            {"field": "new_password", "code": "missing_letter",
             "message": "パスワードには英字を1文字以上含めてください"}
        )
    if not any(c.isdigit() for c in password):
        errors.append(
            {"field": "new_password", "code": "missing_digit",
             "message": "パスワードには数字を1文字以上含めてください"}
        )
    return errors
