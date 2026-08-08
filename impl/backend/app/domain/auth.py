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
