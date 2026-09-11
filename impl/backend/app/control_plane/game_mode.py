"""ゲームモード実効値の解決（レビュー#2・デザイン標準 §4.11）。

実効値 = 個人上書き（accounts.game_mode_override・三値 NULL/true/false）が非 NULL ならそれ、
NULL なら会社既定（companies.game_mode_default）。未上書きの個人は会社既定に追従する（会社統制点）。
通知の出し分け等（ゲームOFF でゲーム層の表示を隠す）で参照する共有ロジック（DRY・§2.3）。
"""
from __future__ import annotations

import uuid

from app.control_plane.auth.orm import Account, Company
from app.db.control import control_session


def effective_game_mode(override: bool | None, company_default: bool) -> bool:
    """実効ゲームモード＝override ?? company_default（純ロジック・§4.11）。"""
    return override if override is not None else company_default


def resolve_effective_game_mode(account_id: uuid.UUID, company_id: uuid.UUID) -> bool:
    """(account_id, company_id) から実効ゲームモードを解決（管理DB を読む）。

    不明時（アカウント/会社が解決できない稀ケース）は True（＝ゲーム表示・除外しない）で安全側に倒す。
    """
    with control_session() as s:
        account = s.get(Account, account_id)
        company = s.get(Company, company_id)
    if account is None or company is None:
        return True
    return effective_game_mode(account.game_mode_override, company.game_mode_default)
