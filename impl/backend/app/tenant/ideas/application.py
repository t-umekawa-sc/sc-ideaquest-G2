"""ドメイン D（アイデア）の application（imperative shell・D.1/D.2）。

会社DB 動的解決（§1.5・company_id はセッション由来）→ テナントユーザー解決 → クエストのパーティー門番（C.0）を
満たす範囲で一覧/詳細/作成/編集/公開/削除を行う。作成は `idea_create` 権限、編集/公開/削除は投稿者本人 or
`owner`/`quest_admin`。公開処理（chat_groups 作成＝E／投稿 XP+50＝G／idea_updated 通知＝H）は各ドメイン実装まで
no-op フック＋TODO（C の H 通知と同方針）。本スライス＝添付(D.3)/投票(D.5)/フォロー(D.6)/版 GET(D.4) は後続。
"""
from __future__ import annotations

import base64
import binascii
import uuid
from datetime import datetime, timezone

from app.control_plane.auth.orm import Company
from app.core.errors import AppError
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.ideas import repository as repo
from app.tenant.ideas.schemas import STATUS_VALUES
from app.tenant.profile import repository as profile_repo
from app.tenant.quests import repository as quests_repo

_EMPTY_PAGE = {"data": [], "page_info": {"next_cursor": None, "has_next": False}}


def _resolve_company(company_id: uuid.UUID) -> Company | None:
    with control_session() as s:
        return s.get(Company, company_id)


def _image_url(path: str | None) -> str | None:
    from app.infra.storage import get_storage

    return get_storage().presigned_get(path) if path else None


def _parse_uuid(value: str, *, field: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except (ValueError, AttributeError):
        raise AppError(422, "validation_error", detail=f"{field} が不正です", errors=[{"field": field}])


def _encode_cursor(idea) -> str:
    raw = f"{idea.created_at.isoformat()}|{idea.id}".encode()
    return base64.urlsafe_b64encode(raw).decode()


def _decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        created_str, id_str = base64.urlsafe_b64decode(cursor.encode()).decode().split("|", 1)
        return datetime.fromisoformat(created_str), uuid.UUID(id_str)
    except (binascii.Error, ValueError, UnicodeDecodeError):
        raise AppError(422, "validation_error", detail="cursor が不正です", errors=[{"field": "cursor"}])


# ---- 取得（一覧・詳細・D.1） ----


def get_ideas(account_id, company_id, quest_id, *, status=None, limit, cursor=None) -> dict:
    """クエスト内アイデア一覧（SC-12・D.1）。門番＝当該クエストのパーティー所属（C.0）。範囲外は 404。"""
    if status is not None:
        invalid = [s for s in status if s not in STATUS_VALUES]
        if invalid:
            raise AppError(422, "validation_error", detail="status が不正です", errors=[{"field": "status"}])
    qid = _parse_uuid(quest_id, field="quest_id")
    cur = _decode_cursor(cursor) if cursor else None
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        quest = quests_repo.get_quest(ts, qid)
        if quest is None or quests_repo.get_active_member(ts, qid, user.id) is None:
            raise AppError(404, "not_found")  # クエスト不在 or 非パーティー＝存在秘匿（C.0）
        rows = repo.list_ideas_for_quest(
            ts, quest_id=qid, viewer_id=user.id, status=status, cursor=cur, limit=limit + 1,
        )
        has_next = len(rows) > limit
        rows = rows[:limit]
        users = quests_repo.get_users_by_ids(ts, {r.author_id for r in rows})
        vote_counts = repo.count_votes_for_ideas(ts, [r.id for r in rows])
        followed = repo.list_followed_idea_ids(ts, user.id)
        data = [_idea_card(ts, r, user.id, users, vote_counts, followed) for r in rows]
        next_cursor = _encode_cursor(rows[-1]) if has_next and rows else None
    return {"data": data, "page_info": {"next_cursor": next_cursor, "has_next": has_next}}


def get_idea_detail(account_id, company_id, idea_id) -> dict:
    """アイデア詳細（SC-22・D.1）。下書きは本人のみ／公開系は当該クエストのパーティー員のみ（範囲外 404）。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    iid = _parse_uuid(idea_id, field="idea_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        idea = repo.get_idea(ts, iid)
        if idea is None:
            raise AppError(404, "not_found")
        if idea.status == "draft" and idea.author_id != user.id:
            raise AppError(404, "not_found")  # 下書きは本人のみ
        if quests_repo.get_active_member(ts, idea.quest_id, user.id) is None:
            raise AppError(404, "not_found")  # 非パーティーは秘匿
        return _build_detail(ts, idea, user.id)


# ---- 作成・編集・公開・削除（D.2） ----


def create_idea(account_id, company_id, quest_id, *, body) -> dict:
    """アイデアを作成（SC-21・idea_create 権限）。status=published は作成＋即公開（公開処理を同一 UoW）。"""
    qid = _parse_uuid(quest_id, field="quest_id")
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        quest = quests_repo.get_quest(ts, qid)
        member = quests_repo.get_active_member(ts, qid, user.id)
        if quest is None or member is None:
            raise AppError(404, "not_found")
        _guard_not_completed(quest)
        # 作成権限＝idea_create（owner は全権限）。
        perms = quests_repo.get_permissions(ts, member.id)
        if user.id != quest.owner_id and "idea_create" not in perms:
            raise AppError(403, "forbidden", detail="アイデア作成の権限がありません")
        if body.status == "published":
            _validate_publishable(title=body.title, value=body.value, body_text=body.body)
        idea = repo.create_idea(
            ts, quest_id=qid, author_id=user.id, title=body.title, body=body.body, value=body.value,
            status=body.status, time_limit=body.time_limit, note=body.note,
        )
        ts.flush()
        repo.replace_stakeholders(ts, idea.id, _normalize_stakeholders(body.stakeholders))
        if body.status == "published":
            _publish_processing(ts, idea, user.id)
        detail = _build_detail(ts, idea, user.id)
        ts.commit()
    return detail


def update_idea(account_id, company_id, idea_id, *, body) -> dict:
    """アイデア編集（D.2）。現在 status で検証分岐（draft=緩い／published=strict＋版記録／completed=409）。"""
    iid = _parse_uuid(idea_id, field="idea_id")
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        idea = repo.get_idea(ts, iid)
        if idea is None:
            raise AppError(404, "not_found")
        quest = quests_repo.get_quest(ts, idea.quest_id)
        _authorize_edit_idea(ts, idea, quest, user)
        _guard_not_completed(quest)
        _apply_content(ts, idea, body)
        if idea.status == "published":
            _validate_publishable(title=idea.title, value=idea.value, body_text=idea.body)
            _record_revision(ts, idea, user.id)  # 公開中は保存ごとに1版＋通知（H は no-op）
        detail = _build_detail(ts, idea, user.id)
        ts.commit()
    return detail


def publish_idea(account_id, company_id, idea_id, *, body) -> dict:
    """下書きを公開（draft→published・アトミック・D.2）。draft 以外は 409。投稿者本人 or owner/quest_admin。"""
    iid = _parse_uuid(idea_id, field="idea_id")
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        idea = repo.get_idea(ts, iid)
        if idea is None:
            raise AppError(404, "not_found")
        quest = quests_repo.get_quest(ts, idea.quest_id)
        _authorize_edit_idea(ts, idea, quest, user)
        if idea.status != "draft":
            raise AppError(409, "conflict", detail="下書き以外は公開できません", extra={"errors": [{"reason": "invalid_state"}]})
        _apply_content(ts, idea, body)
        _validate_publishable(title=idea.title, value=idea.value, body_text=idea.body)
        idea.status = "published"
        _publish_processing(ts, idea, user.id)
        detail = _build_detail(ts, idea, user.id)
        ts.commit()
    return detail


def delete_idea(account_id, company_id, idea_id) -> None:
    """アイデアを論理削除（D.2・§5.10）。投稿者本人 or owner/quest_admin。子は監査保持。"""
    iid = _parse_uuid(idea_id, field="idea_id")
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        idea = repo.get_idea(ts, iid)
        if idea is None:
            raise AppError(404, "not_found")
        quest = quests_repo.get_quest(ts, idea.quest_id)
        _authorize_edit_idea(ts, idea, quest, user)
        idea.deleted_at = datetime.now(timezone.utc)
        idea.deleted_by_id = user.id
        ts.commit()


# ---- ドメイン関数（共有） ----


def _validate_publishable(*, title, value, body_text) -> None:
    """公開の必須充足（title/value/body・D.2）。未充足は 422。"""
    errors = []
    if not title or not str(title).strip():
        errors.append({"field": "title"})
    if not value or not str(value).strip():
        errors.append({"field": "value"})
    if not body_text or not str(body_text).strip():
        errors.append({"field": "body"})
    if errors:
        raise AppError(422, "validation_error", detail="公開に必要な項目が不足しています", errors=errors)


def _authorize_edit_idea(ts, idea, quest, user) -> None:
    """編集/公開/削除の認可＝投稿者本人 or owner/quest_admin（D.2）。下書きは本人のみ可視＝他人は 404。"""
    if idea.status == "draft" and idea.author_id != user.id:
        raise AppError(404, "not_found")
    if idea.author_id == user.id:
        return
    if quest is not None and quest.owner_id == user.id:
        return
    member = quests_repo.get_active_member(ts, idea.quest_id, user.id)
    if member is None or "quest_admin" not in quests_repo.get_permissions(ts, member.id):
        raise AppError(403, "forbidden")


def _guard_not_completed(quest) -> None:
    if quest is not None and quest.status == "completed":
        raise AppError(409, "conflict", detail="完了後は変更できません", extra={"errors": [{"reason": "invalid_state"}]})


def _normalize_stakeholders(items) -> list[tuple[str, bool]]:
    """利害関係者を正規化（トリム＋重複排除）。is_custom は入力尊重（既定 False）。"""
    result: list[tuple[str, bool]] = []
    seen: set[str] = set()
    for it in items or []:
        label = (it.label or "").strip()
        if not label:
            continue
        key = label.casefold()
        if key in seen:
            continue
        seen.add(key)
        result.append((label, bool(it.is_custom)))
    return result


def _apply_content(ts, idea, body) -> None:
    provided = body.model_fields_set
    if "title" in provided:
        idea.title = body.title
    if "value" in provided:
        idea.value = body.value
    if "body" in provided:
        idea.body = body.body
    if "time_limit" in provided:
        idea.time_limit = body.time_limit
    if "note" in provided:
        idea.note = body.note
    if "stakeholders" in provided and body.stakeholders is not None:
        repo.replace_stakeholders(ts, idea.id, _normalize_stakeholders(body.stakeholders))


def _record_revision(ts, idea, editor_id) -> None:
    """公開中アイデアの保存ごとに1版（スナップショット）を追加し current_revision++（D.4）。通知は H まで no-op。"""
    next_rev = idea.current_revision + 1
    snapshot = {
        "title": idea.title, "value": idea.value, "body": idea.body,
        "time_limit": idea.time_limit.isoformat() if idea.time_limit else None,
        "note": idea.note,
        "stakeholders": [{"label": s.label, "is_custom": s.is_custom} for s in repo.list_stakeholders(ts, idea.id)],
    }
    repo.add_revision(ts, idea.id, revision=next_rev, editor_id=editor_id, changes=snapshot)
    idea.current_revision = next_rev
    _notify_idea_updated(idea.id, next_rev)


def _publish_processing(ts, idea, author_id) -> None:
    """公開の瞬間の処理（D.2）。chat_groups 作成(E)・投稿 XP+50(G)・参加通知は各ドメイン実装まで no-op フック。

    TODO(E): ensure chat_group (UNIQUE(idea_id))。TODO(G): activities に idea_post/XP+50 を同一 UoW 記帳。
    現フェーズは no-op（公開＝draft→published＋strict＋版なし）。冪等は status 遷移（再 publish は 409）で担保。
    """
    return None


def _notify_idea_updated(idea_id, revision) -> None:
    """版追加時の idea_updated 通知（投票者＋フォロワー・D.4/H）。H 実装まで post-commit no-op フック＋TODO。"""
    return None


def _idea_card(ts, idea, viewer_id, users, vote_counts, followed) -> dict:
    author = users.get(idea.author_id)
    my_vote = repo.get_vote(ts, idea.id, viewer_id)
    vc = vote_counts.get(idea.id, {"approve": 0, "oppose": 0})
    return {
        "id": str(idea.id),
        "title": idea.title,
        "status": idea.status,
        "author": _author_dto(author, idea.author_id),
        "vote_summary": {"approve": vc.get("approve", 0), "oppose": vc.get("oppose", 0)},
        "comment_count": 0,  # ドメイン E 実装後に接続
        "is_selected": idea.is_selected,
        "current_revision": idea.current_revision,
        "updated_at": idea.updated_at,
        "my_vote": my_vote.type if my_vote else None,
        "following": idea.id in followed,
        "my_state": "draft" if idea.status == "draft" and idea.author_id == viewer_id else "member",
    }


def _build_detail(ts, idea, viewer_id) -> dict:
    users = quests_repo.get_users_by_ids(ts, {idea.author_id})
    author = users.get(idea.author_id)
    stakeholders = [{"label": s.label, "is_custom": s.is_custom} for s in repo.list_stakeholders(ts, idea.id)]
    vc = repo.count_votes(ts, idea.id)
    my_vote = repo.get_vote(ts, idea.id, viewer_id)
    # UX 出し分け用の権限＝当該クエストの自分の権限（owner は全権限）。
    my_permissions: list[str] = []
    member = quests_repo.get_active_member(ts, idea.quest_id, viewer_id)
    if member is not None:
        my_permissions = quests_repo.get_permissions(ts, member.id)
    return {
        "id": str(idea.id),
        "title": idea.title,
        "value": idea.value,
        "body": idea.body,
        "stakeholders": stakeholders,
        "time_limit": idea.time_limit,
        "note": idea.note,
        "status": idea.status,
        "is_selected": idea.is_selected,
        "current_revision": idea.current_revision,
        "author": _author_dto(author, idea.author_id),
        "created_at": idea.created_at,
        "updated_at": idea.updated_at,
        "vote": {"summary": {"approve": vc.get("approve", 0), "oppose": vc.get("oppose", 0)}, "my_vote": my_vote.type if my_vote else None},
        "following": repo.is_following(ts, viewer_id, idea.id),
        "my_permissions": my_permissions,
        "my_state": "draft" if idea.status == "draft" and idea.author_id == viewer_id else "member",
    }


def _author_dto(user, author_id) -> dict:
    return {
        "user_id": str(author_id),
        "display_name": user.display_name if user else "",
        "avatar_image_url": _image_url(user.avatar_image_path) if user else None,
        "level": user.level if user else None,
    }
