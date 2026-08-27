"""全文検索の合成（ドメイン J・SC-12）＝検索の殻。新業務ロジックなし＝可視範囲は各ドメイン門番/述語を適用し、
3 種（idea/chat/attachment）を UNION して `pgroonga_score` 降順・オフセットページング（total）で返す（J.1〜J.4）。
"""
from __future__ import annotations

import uuid

from sqlalchemy.exc import DBAPIError

from app.control_plane.auth.orm import Company
from app.core.errors import AppError
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.profile import repository as profile_repo
from app.tenant.quest_group import repository as qg_repo
from app.tenant.quests import repository as quests_repo
from app.tenant.search import repository as search_repo

_VALID_TYPES = ("idea", "chat", "attachment")
_FIELD = {"idea": "body", "chat": "body", "attachment": "original_name"}
_CAP = 200          # 種別ごとの取得上限（結果は通常小・合成/ページングは app）
_PER_PAGE_MAX = 100


def _resolve_company(company_id: uuid.UUID) -> Company | None:
    with control_session() as s:
        return s.get(Company, company_id)


def _parse_types(types_param: str | None) -> list[str]:
    if not types_param:
        return list(_VALID_TYPES)
    req = [t.strip() for t in types_param.split(",") if t.strip()]
    invalid = [t for t in req if t not in _VALID_TYPES]
    if invalid:
        raise AppError(422, "validation_error", detail="types が不正です", errors=[{"field": "types"}])
    return req or list(_VALID_TYPES)


def _row_dto(kind: str, r: dict, quest) -> dict:
    return {
        "type": kind, "field": _FIELD[kind],
        "quest": {"id": str(quest.id), "title": quest.title},
        "idea_id": str(r["idea_id"]) if r["idea_id"] else None,
        "idea_title": r["idea_title"],
        "chat_message_id": str(r["chat_message_id"]) if r["chat_message_id"] else None,
        "attachment_id": str(r["attachment_id"]) if r["attachment_id"] else None,
        "snippet_html": r["snippet"],
        "score": float(r["score"]) if r["score"] is not None else 0.0,
        "target": "idea" if kind == "idea" else "chat",  # chat/添付は SC-24 導線
        "_sort_ts": r["sort_ts"],
    }


def search_quest(account_id: uuid.UUID, company_id: uuid.UUID, quest_id: str, *,
                 q: str, types: str | None = None, page: int = 1, per_page: int = 20) -> dict:
    """クエスト内 全文検索（`GET /quests/{id}/search`・J.1）。門番＝パーティー∩グループ AND（404）。"""
    q = (q or "").strip()
    if not q:
        raise AppError(422, "validation_error", detail="検索語を入力してください", errors=[{"field": "q"}])
    kinds = _parse_types(types)
    page = max(page, 1)
    per_page = min(max(per_page, 1), _PER_PAGE_MAX)

    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    try:
        qid = uuid.UUID(quest_id)
    except (ValueError, AttributeError, TypeError):
        raise AppError(404, "not_found")

    rows: list[dict] = []
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        quest = quests_repo.get_quest(ts, qid)
        if quest is None:
            raise AppError(404, "not_found")
        # 門番＝パーティー所属 かつ クエストグループ所属（AND・どちらか欠けても 404・存在秘匿・J.0/C.0）
        if quests_repo.get_active_member(ts, qid, user.id) is None:
            raise AppError(404, "not_found")
        if qg_repo.get_active_membership(ts, quest.quest_group_id, user.id) is None:
            raise AppError(404, "not_found")
        for kind in kinds:
            try:
                for r in search_repo.search(ts, kind, q, [qid], cap=_CAP):
                    rows.append(_row_dto(kind, r, quest))
            except DBAPIError as e:
                # PGroonga のクエリ構文パース失敗（`*`・`((` 等の演算子のみ/不正入力）は「該当なし」として
                # 安全に握る＝ユーザー入力で 5xx を出さない（J.0 injection-safe の本旨・§2.2③）。エラーで
                # トランザクションが中断するため rollback して次の種別へ。pgroonga 以外の想定外は再送出。
                ts.rollback()
                if "pgroonga" in str(getattr(e, "orig", e)).lower():
                    continue
                raise

    # score 降順・タイブレーク＝created_at/uploaded_at 降順（J.3）。
    rows.sort(key=lambda x: (x["score"], x["_sort_ts"]), reverse=True)
    total = len(rows)
    start = (page - 1) * per_page
    page_rows = rows[start:start + per_page]
    for r in page_rows:
        r.pop("_sort_ts", None)
    return {"data": page_rows, "page_info": {"total": total, "page": page, "per_page": per_page}}
