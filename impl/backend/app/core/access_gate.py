"""公開モード外周アクセスゲート（FR-48 §8.0・決定O・2026-10-04／存在秘匿 404 化 2026-10-07・決定P'）。

会社 `companies.access_mode='public'`（デモ・コンテスト専用テナント）のセッションは、
**役割別の許可リスト外のEPをサーバーで 404**（UI非表示に依存しない・API設計 §1.6＝サーバー権威）。
403 ではなく **404（存在秘匿）** を返す＝公開（コンテスト専用）会社ではそれらの業務EPは
「存在しない」ものとして扱う（`can_access_quest` 等と同じ存在秘匿の慣習に整合）。

- コンテスト許可リスト（全ロール）＝コンテスト/アイデア(コンテスト配下)/投票/評価/チャット/全文検索
  ＋認証・セッション・プロフィール・通知。
- 管理許可リスト（管理者 system_admin / company_account_admin のみ追加）＝会社・アカウント・所属/能力管理。
- 決定O＝**どちらの許可リストにも無い業務EP（クエスト等）は管理者でも 404**（公開会社はコンテスト専用）。
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

# コンテスト許可リスト（全ロール）。パスは /api/v1 以降の実パス接頭辞（auth は /auth/* に集約）。
# アイデア/投票/評価は /ideas 配下に集約（コンテスト配下のみ可視ゲート §2.3 で担保）。添付DLは /attachments。
# 全文検索は /quests/{id}/search 配下（業務扱い）＝public のコンテスト内検索は当面不可（許容・将来コンテスト専用EP化）。
# /announcements＝お知らせの read（閲覧/詳細/既読）は全ロール許可（会社DBスコープ＝他社漏れなし・SC-95 §4.6）。
# 管理（作成/編集）は /admin/announcements（＝/admin 許可リスト＝管理者のみ）で別管理。
_CONTEST_ALLOW = (
    "/contests", "/ideas", "/chat-messages", "/attachments",
    "/me", "/notifications", "/announcements", "/realtime", "/auth",
    "/media",  # お知らせ本文のインライン画像（安定配信プロキシ・F8）＝公開会社の general も閲覧可
)
# 管理許可リスト（system_admin / company_account_admin のみ追加）。会社/アカウント/所属/能力の管理は全て /admin/* に集約（32本）。
_ADMIN_ALLOW = ("/admin",)

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
            # 公開（コンテスト専用）会社では許可リスト外を一律 404＝存在秘匿（§8.0・決定P'・サーバー権威）。
            # 403 は「存在するが不可」を露呈するため、業務EPは「存在しない」ものとして 404 を返す。
            return _problem(request, 404, "not_found",
                            "お探しのリソースは見つかりません。", None)
    return await call_next(request)
