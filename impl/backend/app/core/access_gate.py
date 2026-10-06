"""公開モード外周アクセスゲート（FR-48 §8.0・決定O・2026-10-04）。

会社 `companies.access_mode='public'`（デモ・コンテスト専用テナント）のセッションは、
**役割別の許可リスト外のEPをサーバーで 403**（UI非表示に依存しない・API設計 §1.6＝サーバー権威）。

- コンテスト許可リスト（全ロール）＝コンテスト/アイデア(コンテスト配下)/投票/評価/チャット/全文検索
  ＋認証・セッション・プロフィール・通知。
- 管理許可リスト（管理者 system_admin / company_account_admin のみ追加）＝会社・アカウント・所属/能力管理。
- 決定O＝**どちらの許可リストにも無い業務EP（クエスト等）は管理者でも 403**（公開会社はコンテスト専用）。
- `private` は素通し（従来どおり）。

全ルータに漏れなく効かせるため middleware で実装（どのルータ・どの認可 deps を使っていても封鎖される）。
可視ゲート（コンテスト内の中身 `can_view_contest`）とは直交する2段目の関所（§2.3 とは別レイヤ）。
"""
from __future__ import annotations

import uuid

from fastapi import Request
from starlette.concurrency import run_in_threadpool

from app.control_plane.auth.orm import Company
from app.core.deps import resolve_session
from app.core.errors import _problem
from app.db.control import control_session

_API = "/api/v1"

# コンテスト許可リスト（全ロール）。アイデア/投票/評価は /ideas 配下に集約（コンテスト配下のみ可視ゲートで担保）。
_CONTEST_ALLOW = (
    "/contests", "/ideas", "/chat-messages", "/search",
    "/me", "/notifications", "/realtime",
    "/login", "/logout", "/logout-all", "/mfa", "/session",
    "/password-setup", "/email-verify",
)
# 管理許可リスト（system_admin / company_account_admin のみ追加）。デモ運営に必要な会社/アカウント/所属/能力管理。
_ADMIN_ALLOW = (
    "/admin", "/companies", "/accounts", "/capabilities",
    "/quest-groups", "/company-quest-groups", "/quest-group-directory", "/company-directory",
    "/info-curators", "/info-capabilities",
)

_ADMIN_ROLES = ("system_admin", "company_account_admin")


def _matches(sub: str, prefixes: tuple[str, ...]) -> bool:
    return any(sub == p or sub.startswith(p + "/") for p in prefixes)


def is_path_allowed(sub: str, is_admin: bool) -> bool:
    """public 会社で `sub`（/api/v1 以降のパス）が許可されるか（純関数・決定O）。
    コンテスト許可リストは全ロール可／管理許可リストは管理者のみ追加／それ以外（業務EP）は管理者でも不可。
    """
    return _matches(sub, _CONTEST_ALLOW) or (is_admin and _matches(sub, _ADMIN_ALLOW))


def _resolve(request: Request) -> tuple[dict | None, str | None]:
    """セッション解決＋会社 access_mode を同期で引く（threadpool 経由で呼ぶ）。"""
    session = resolve_session(request)
    if session is None or not session.get("company_id"):
        return None, None
    with control_session() as s:
        company = s.get(Company, uuid.UUID(session["company_id"]))
        return session, (company.access_mode if company else None)


async def access_mode_gate(request: Request, call_next):  # noqa: ANN001, ANN201
    path = request.url.path
    if not path.startswith(_API):
        return await call_next(request)
    session, mode = await run_in_threadpool(_resolve, request)
    if session is not None and mode == "public":
        sub = path[len(_API):] or "/"
        is_admin = session.get("system_role") in _ADMIN_ROLES
        if not is_path_allowed(sub, is_admin):
            # 公開（コンテスト専用）会社では許可リスト外を一律 403（§8.0・サーバー権威）。
            return _problem(request, 403, "forbidden",
                            "この会社は公開（コンテスト専用）モードのため、この操作はできません。", None)
    return await call_next(request)
