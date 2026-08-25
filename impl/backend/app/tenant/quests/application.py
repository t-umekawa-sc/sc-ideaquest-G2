"""ドメイン C（クエスト）の application（imperative shell・API設計 C.1/C.4）。

会社DB を動的解決（§1.5・company_id はセッション由来）→ テナントユーザーを解決 →
可視性（グループ×パーティー門番は repository が per-quest 強制・C.0）を満たす一覧を DTO 化して返す。
本スライスは**読み取り経路（SC-10）**のみ＝`get_quests`／`get_quest_groups`。作成/編集は C.2 以降。
"""
from __future__ import annotations

import base64
import binascii
import re
import unicodedata
import uuid
from datetime import datetime, timezone

from app.control_plane.auth.orm import Company
from app.core.errors import AppError
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.infra.storage import get_storage, validate_image_upload
from app.tenant.ideas import repository as ideas_repo
from app.tenant.profile import repository as profile_repo
from app.tenant.quest_group import repository as qg_repo
from app.tenant.quests import repository as repo
from app.tenant.quests.schemas import PERMISSION_VALUES

# 有効な quest_status（§3）。フィルタの想定外値は 422（§C.6 入力検証）。
_VALID_STATUS = {"draft", "recruiting", "in_progress", "evaluating", "completed"}

_EMPTY_PAGE = {"data": [], "page_info": {"next_cursor": None, "has_next": False}}

# 作成者に付与する全権限（作成者は常に全権限＝§5.6/C.0・剥奪不可）。
_ALL_PERMISSIONS = ["owner", "quest_admin", "evaluator", "vote", "idea_create", "comment"]
# 公開中とみなす status（PATCH の strict 検証分岐・C.2）。
_PUBLIC_STATUS = {"recruiting", "in_progress", "evaluating"}
# クエストカラーの形式検証（#RRGGBB）。プリセット10色の正本 hex 群は未確定＝形式のみ（SC-11 §114/C.6）。
_HEX_COLOR = re.compile(r"^#[0-9A-Fa-f]{6}$")
_MAX_TITLE = 255
_MAX_CATEGORIES = 20
_MAX_CATEGORY_LABEL = 255
# 事前定義カテゴリの正本（会社内マスタ）は未整備＝C.7 TBD。現状は空＝全ラベルを is_custom として扱う。
_PRESET_CATEGORIES: frozenset[str] = frozenset()


def _image_url(path: str | None) -> str | None:
    """MinIO キー→短TTL 署名URL（§1.10）。未設定は None（storage 未呼び出し）。"""
    return get_storage().presigned_get(path) if path else None


def _encode_cursor(quest) -> str:
    """(created_at, id) を不透明カーソルにエンコード（§1.8・me._encode_cursor と同方式）。"""
    raw = f"{quest.created_at.isoformat()}|{quest.id}".encode()
    return base64.urlsafe_b64encode(raw).decode()


def _decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        created_str, id_str = base64.urlsafe_b64decode(cursor.encode()).decode().split("|", 1)
        return datetime.fromisoformat(created_str), uuid.UUID(id_str)
    except (binascii.Error, ValueError, UnicodeDecodeError):
        raise AppError(422, "validation_error", detail="cursor が不正です", errors=[{"field": "cursor"}])


def _resolve_company(company_id: uuid.UUID) -> Company | None:
    with control_session() as s:
        return s.get(Company, company_id)


def get_quests(
    account_id: uuid.UUID,
    company_id: uuid.UUID,
    *,
    q: str | None = None,
    status: list[str] | None = None,
    group_id: str | None = None,
    limit: int,
    cursor: str | None = None,
) -> dict:
    """参加中クエスト＋自分の下書き一覧（SC-10・C.1・FR-15）。新着順・カーソル §1.8。

    参照制限（(A) 非draft×所属グループ×パーティー参加中 ／ (B) 自分の下書き）は repository が強制。
    会社/ユーザー未解決（通常起きない）は空ページ。
    """
    if status is not None:
        invalid = [s for s in status if s not in _VALID_STATUS]
        if invalid:
            raise AppError(422, "validation_error", detail="status が不正です", errors=[{"field": "status"}])
    group_uuid = _parse_uuid(group_id, field="group_id") if group_id else None
    cur = _decode_cursor(cursor) if cursor else None  # 不正カーソルは query 前に 422

    company = _resolve_company(company_id)
    if company is None:
        return _EMPTY_PAGE
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            return _EMPTY_PAGE
        visible_group_ids = qg_repo.list_active_group_ids_for_user(ts, user.id)
        rows = repo.list_quests_for_user(
            ts, user_id=user.id, visible_group_ids=visible_group_ids,
            q=q, status=status, group_id=group_uuid, cursor=cur, limit=limit + 1,
        )
        has_next = len(rows) > limit
        rows = rows[:limit]
        # ページ分の付随情報を一括取得（N+1 回避）。
        owner_ids = list({r.owner_id for r in rows})
        gids = list({r.quest_group_id for r in rows})
        qids = [r.id for r in rows]
        owners, groups = repo.get_owners_and_groups(ts, owner_ids, gids)
        cats = repo.list_categories_for_quests(ts, qids)
        member_counts = repo.count_active_members_for_quests(ts, qids)
        idea_counts = ideas_repo.count_published_ideas_for_quests(ts, qids)
        data = [
            _quest_card_dto(r, user.id, owners, groups, cats, member_counts, idea_counts) for r in rows
        ]
    next_cursor = _encode_cursor(rows[-1]) if has_next and rows else None
    return {"data": data, "page_info": {"next_cursor": next_cursor, "has_next": has_next}}


def get_quest_groups(account_id: uuid.UUID, company_id: uuid.UUID, *, q: str | None = None) -> dict:
    """自分が有効所属するグループ一覧（SC-10 フィルタ・SC-11 グループ選択・C.4）。"""
    company = _resolve_company(company_id)
    if company is None:
        return {"data": []}
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            return {"data": []}
        groups = repo.list_visible_groups(ts, user.id, q=q)
        data = [
            {"id": str(g.id), "quest_group_code": g.quest_group_code, "name": g.name} for g in groups
        ]
    return {"data": data}


def _quest_card_dto(quest, viewer_id, owners, groups, cats, member_counts, idea_counts) -> dict:
    owner = owners.get(quest.owner_id)
    group = groups.get(quest.quest_group_id)
    return {
        "id": str(quest.id),
        "title": quest.title,
        "color": quest.color,
        "icon_image_url": _image_url(quest.icon_image_path),
        "categories": [c.label for c in cats.get(quest.id, [])],
        "status": quest.status,
        "deadline": quest.deadline,
        "member_count": member_counts.get(quest.id, 0),
        # 公開アイデア数（C.1・下書き/削除は除外・N+1 回避＝一括集計を受け取る）。
        "idea_count": idea_counts.get(quest.id, 0),
        "owner": {
            "user_id": str(quest.owner_id),
            "display_name": owner.display_name if owner else "",
            "avatar_image_url": _image_url(owner.avatar_image_path) if owner else None,
        },
        "quest_group": {
            "id": str(quest.quest_group_id),
            "quest_group_code": group.quest_group_code if group else "",
            "name": group.name if group else "",
        },
        # 本人の下書きは draft、それ以外は member。未投稿/投稿済みはドメイン D 実装後に精緻化（C.1）。
        "my_state": "draft" if quest.status == "draft" and quest.owner_id == viewer_id else "member",
    }


def _parse_uuid(value: str, *, field: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except (ValueError, AttributeError):
        raise AppError(422, "validation_error", detail=f"{field} が不正です", errors=[{"field": field}])


# ============================================================================
# SC-11 作成・編集・公開（C.2）／パーティー（C.3）／候補（C.4）／アイコン（論点2）
# ============================================================================


def get_quest_detail(account_id: uuid.UUID, company_id: uuid.UUID, quest_id: str) -> dict:
    """クエスト詳細（C.1・SC-12 概要／SC-11 編集プリフィル）。可視性をサーバー強制。

    下書きは本人のみ（他人は 404 存在秘匿）。公開系は owner か有効パーティー員のみ（範囲外は 404）。
    """
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    qid = _parse_uuid(quest_id, field="quest_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        quest = repo.get_quest(ts, qid)
        if quest is None:
            raise AppError(404, "not_found")
        if quest.status == "draft":
            if quest.owner_id != user.id:
                raise AppError(404, "not_found")  # 下書きは本人だけに見える
        elif quest.owner_id != user.id and repo.get_active_member(ts, quest.id, user.id) is None:
            raise AppError(404, "not_found")  # 公開系もパーティー外には秘匿
        return _build_detail(ts, quest, user.id)


def create_quest(account_id: uuid.UUID, company_id: uuid.UUID, *, body) -> dict:
    """クエストを作成（C.2・SC-11）。作成者＝所有者（全権限）。status=recruiting は即公開扱い。

    内容検証（title/color/categories 正規化）→ グループ有効所属検証 → 本体作成 → カテゴリ置換 →
    作成者を owner でパーティー投入 → 追加メンバーを差分適用 を単一 UoW で実行。recruiting は strict 検証。
    """
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    group_uuid = _parse_uuid(body.quest_group_id, field="quest_group_id")
    title = _validate_title(body.title)
    color = _validate_color(body.color)
    cats = _normalize_categories(body.categories)

    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        # 作成者が当該グループに有効所属していること（§C.6 IDOR・非所属は 422）。
        if qg_repo.get_active_membership(ts, group_uuid, user.id) is None:
            raise AppError(
                422, "validation_error", detail="quest_group_id が不正です",
                errors=[{"field": "quest_group_id"}],
            )
        if body.status == "recruiting":
            _validate_publishable(title=title, color=color, categories=cats, quest_group_id=group_uuid)
        quest = repo.create_quest(
            ts, quest_group_id=group_uuid, owner_id=user.id, title=title, color=color,
            status=body.status, purpose=body.purpose, deadline=body.deadline,
            icon_image_path=body.icon_image_path,
        )
        ts.flush()  # quest.id 確定（カテゴリ/パーティーの FK に使う）
        repo.replace_categories(ts, quest.id, cats)
        # 作成者は常にパーティー員＝owner（C.0）。差分より先に投入して保護対象にする。
        repo.add_member(ts, quest.id, user.id, permissions=_ALL_PERMISSIONS, granted_by_id=user.id)
        _apply_party_diff(ts, quest, body.members, requester=user, group_id=group_uuid)
        detail = _build_detail(ts, quest, user.id)
        recipients = [m.user_id for m in repo.list_active_members(ts, quest.id) if m.user_id != user.id]
        quest_id = quest.id
        ts.commit()
    if body.status == "recruiting":
        _notify_party_invited(company_id, quest_id, recipients)  # 即公開＝参加通知（H 実装まで no-op）
    return detail


def update_quest(account_id: uuid.UUID, company_id: uuid.UUID, quest_id: str, *, body) -> dict:
    """クエストを編集（C.2・SC-11「下書き保存」/全体編集）。差分＝送られたフィールドのみ適用。

    検証は**現在の status で分岐**（draft=緩い／公開中=strict／completed=書き込み凍結 409）。
    `quest_group_id`/`status` は不変（DTO が持たない）。認可＝owner または quest_admin。
    """
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    qid = _parse_uuid(quest_id, field="quest_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        quest = repo.get_quest(ts, qid)
        if quest is None:
            raise AppError(404, "not_found")
        _authorize_edit(ts, quest, user)
        if quest.status == "completed":
            raise AppError(
                409, "conflict", detail="完了後は編集できません",
                extra={"errors": [{"reason": "invalid_state"}]},
            )
        _apply_content(ts, quest, body)
        if "members" in body.model_fields_set and body.members is not None:
            _apply_party_diff(ts, quest, body.members, requester=user, group_id=quest.quest_group_id)
        # 公開中クエストは不正な状態へ落とせない＝strict 再検証（未充足は 422）。
        if quest.status in _PUBLIC_STATUS:
            _validate_publishable(
                title=quest.title, color=quest.color,
                categories=repo.list_categories(ts, quest.id), quest_group_id=quest.quest_group_id,
            )
        detail = _build_detail(ts, quest, user.id)
        ts.commit()
    return detail


def publish_quest(account_id: uuid.UUID, company_id: uuid.UUID, quest_id: str, *, body) -> dict:
    """下書きを公開（draft→recruiting・C.2・アトミック）。内容適用＋パーティー適用＋strict＋遷移を単一 UoW。

    `draft` 以外は 409（invalid_state）。owner（作成者）のみ。参加通知は post-commit で no-op フック（H 実装まで）。
    """
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    qid = _parse_uuid(quest_id, field="quest_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        quest = repo.get_quest(ts, qid)
        if quest is None:
            raise AppError(404, "not_found")
        if quest.owner_id != user.id:
            # 下書きは本人のみ可視＝存在秘匿の 404。公開中を他人が publish しようとしたら 403。
            raise AppError(404, "not_found") if quest.status == "draft" else AppError(403, "forbidden")
        if quest.status != "draft":
            raise AppError(
                409, "conflict", detail="下書き以外は公開できません",
                extra={"errors": [{"reason": "invalid_state"}]},
            )
        _apply_content(ts, quest, body)
        if "members" in body.model_fields_set and body.members is not None:
            _apply_party_diff(ts, quest, body.members, requester=user, group_id=quest.quest_group_id)
        _validate_publishable(
            title=quest.title, color=quest.color,
            categories=repo.list_categories(ts, quest.id), quest_group_id=quest.quest_group_id,
        )
        quest.status = "recruiting"
        detail = _build_detail(ts, quest, user.id)
        recipients = [m.user_id for m in repo.list_active_members(ts, quest.id) if m.user_id != user.id]
        published_id = quest.id
        ts.commit()
    _notify_party_invited(company_id, published_id, recipients)  # H 実装まで no-op
    return detail


def set_quest_icon(account_id: uuid.UUID, company_id: uuid.UUID, quest_id: str, *,
                   data: bytes, content_type: str) -> dict:
    """クエストアイコンを設定（論点2・K.4 流儀の専用 multipart EP）。owner/quest_admin。旧画像は best-effort 削除。"""
    validate_image_upload(content_type, len(data))
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    qid = _parse_uuid(quest_id, field="quest_id")
    storage = get_storage()
    old: str | None = None
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        quest = repo.get_quest(ts, qid)
        if quest is None:
            raise AppError(404, "not_found")
        _authorize_edit(ts, quest, user)
        if quest.status == "completed":
            raise AppError(
                409, "conflict", detail="完了後は編集できません",
                extra={"errors": [{"reason": "invalid_state"}]},
            )
        key = storage.put(data, content_type, prefix="quest-icons")
        old = quest.icon_image_path
        quest.icon_image_path = key
        ts.commit()
    if old:
        try:
            storage.remove(old)
        except Exception:
            pass
    return {"icon_image_url": storage.presigned_get(key)}


def delete_quest_icon(account_id: uuid.UUID, company_id: uuid.UUID, quest_id: str) -> None:
    """クエストアイコンを削除（既定表示に戻す・論点2）。owner/quest_admin。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    qid = _parse_uuid(quest_id, field="quest_id")
    storage = get_storage()
    old: str | None = None
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        quest = repo.get_quest(ts, qid)
        if quest is None:
            raise AppError(404, "not_found")
        _authorize_edit(ts, quest, user)
        old = quest.icon_image_path
        quest.icon_image_path = None
        ts.commit()
    if old:
        try:
            storage.remove(old)
        except Exception:
            pass


def get_group_member_candidates(
    account_id: uuid.UUID, company_id: uuid.UUID, group_id: str, *,
    q: str | None = None, exclude_user_ids: list[str] | None = None,
    limit: int, cursor: str | None = None,
) -> dict:
    """パーティー候補（C.4・SC-11）。同一グループの有効メンバー×active、`exclude_user_ids` をサーバー除外。

    門番＝リクエスト者自身が当該グループに有効所属（非所属は 404 存在秘匿・C.4）。並びは display_name→id 昇順。
    """
    group_uuid = _parse_uuid(group_id, field="group_id")
    excl = _parse_exclude(exclude_user_ids)
    cur = _decode_candidate_cursor(cursor) if cursor else None
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        if qg_repo.get_active_membership(ts, group_uuid, user.id) is None:
            raise AppError(404, "not_found")  # 非所属グループは存在秘匿（C.4）
        rows = repo.list_group_member_candidates(
            ts, group_uuid, q=q, exclude_user_ids=excl, cursor=cur, limit=limit + 1,
        )
        has_next = len(rows) > limit
        rows = rows[:limit]
        data = [
            {
                "user_id": str(u.id),
                "display_name": u.display_name,
                "avatar_image_url": _image_url(u.avatar_image_path),
            }
            for u in rows
        ]
        next_cursor = _encode_candidate_cursor(rows[-1]) if has_next and rows else None
    return {"data": data, "page_info": {"next_cursor": next_cursor, "has_next": has_next}}


# ---- パーティー粒度（C.3・SC-12 パーティータブ）／状態遷移（C.5）／削除 ----

# 状態機械の前進順（§3・C.5）。逆行・飛び越えは 409。
_STATUS_ORDER = ["draft", "recruiting", "in_progress", "evaluating", "completed"]


def list_party_members(account_id: uuid.UUID, company_id: uuid.UUID, quest_id: str) -> dict:
    """パーティー＋権限（SC-12 パーティータブ・C.1 GET .../members）。可視性＝owner か有効メンバー（範囲外 404）。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    qid = _parse_uuid(quest_id, field="quest_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        quest = repo.get_quest(ts, qid)
        if quest is None:
            raise AppError(404, "not_found")
        if quest.owner_id != user.id and repo.get_active_member(ts, quest.id, user.id) is None:
            raise AppError(404, "not_found")
        return {"data": _members_payload(ts, quest)}


def set_party(account_id: uuid.UUID, company_id: uuid.UUID, quest_id: str, *, members) -> dict:
    """パーティーを一括更新（C.3 PUT /party・あるべき全体像で差分適用）。owner/quest_admin。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    qid = _parse_uuid(quest_id, field="quest_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        quest = repo.get_quest(ts, qid)
        if quest is None:
            raise AppError(404, "not_found")
        _authorize_edit(ts, quest, user)
        _guard_not_completed(quest)
        _apply_party_diff(ts, quest, members, requester=user, group_id=quest.quest_group_id)
        data = _members_payload(ts, quest)
        ts.commit()
    return {"data": data}


def add_party_member(account_id: uuid.UUID, company_id: uuid.UUID, quest_id: str, *,
                     user_id: str, permissions) -> dict:
    """メンバーを1名追加（C.3 POST /members・増分）。候補制限・owner 付与は作成者のみ・既定権限。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    qid = _parse_uuid(quest_id, field="quest_id")
    uid = _parse_uuid(user_id, field="user_id")
    perms = _validate_permissions(permissions)
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        quest = repo.get_quest(ts, qid)
        if quest is None:
            raise AppError(404, "not_found")
        _authorize_edit(ts, quest, user)
        _guard_not_completed(quest)
        if uid not in repo.list_active_group_member_user_ids(ts, quest.quest_group_id):
            raise AppError(422, "validation_error", detail="候補外のユーザーは追加できません", errors=[{"field": "user_id"}])
        if perms and "owner" in perms and user.id != quest.owner_id:
            raise AppError(403, "forbidden", detail="owner 権限の付与は作成者のみ可能です")
        member = repo.add_member(ts, quest.id, uid, permissions=perms, granted_by_id=user.id)
        users = repo.get_users_by_ids(ts, {uid})
        dto = _member_dto(ts, member, quest.owner_id, users.get(uid))
        ts.commit()
    return dto


def remove_party_member(account_id: uuid.UUID, company_id: uuid.UUID, quest_id: str, *, user_id: str) -> None:
    """メンバーをパーティーから外す（C.3 DELETE /members・論理削除）。作成者は除外不可（422）。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    qid = _parse_uuid(quest_id, field="quest_id")
    uid = _parse_uuid(user_id, field="user_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        quest = repo.get_quest(ts, qid)
        if quest is None:
            raise AppError(404, "not_found")
        _authorize_edit(ts, quest, user)
        _guard_not_completed(quest)
        if uid == quest.owner_id:
            raise AppError(422, "validation_error", detail="作成者はパーティーから外せません", errors=[{"field": "user_id", "reason": "last_owner"}])
        repo.remove_member(ts, quest.id, uid)  # 有効参加が無ければ no-op（冪等）
        ts.commit()


def set_member_permissions(account_id: uuid.UUID, company_id: uuid.UUID, quest_id: str, *,
                           user_id: str, permissions) -> dict:
    """あるメンバーの権限セットを置換（C.3 PUT .../permissions）。owner 付与は作成者のみ・作成者は保護。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    qid = _parse_uuid(quest_id, field="quest_id")
    uid = _parse_uuid(user_id, field="user_id")
    perms = _validate_permissions(permissions) or []
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        quest = repo.get_quest(ts, qid)
        if quest is None:
            raise AppError(404, "not_found")
        _authorize_edit(ts, quest, user)
        _guard_not_completed(quest)
        if uid == quest.owner_id:
            # 作成者は常に全権限＝owner 剥奪不可（保護）。権限置換の対象にしない。
            raise AppError(422, "validation_error", detail="作成者の権限は変更できません", errors=[{"field": "user_id", "reason": "last_owner"}])
        if "owner" in perms and user.id != quest.owner_id:
            raise AppError(403, "forbidden", detail="owner 権限の付与は作成者のみ可能です")
        member = repo.set_member_permissions(ts, quest.id, uid, perms, granted_by_id=user.id)
        if member is None:
            raise AppError(404, "not_found")  # 有効参加でない
        result = repo.get_permissions(ts, member.id)
        ts.commit()
    return {"permissions": result}


def transition_quest(account_id: uuid.UUID, company_id: uuid.UUID, quest_id: str, *, to: str) -> dict:
    """ステータスを前進（C.5・owner/quest_admin）。逆行・飛び越えは 409。draft→recruiting は strict 検証。"""
    if to not in _VALID_STATUS:
        raise AppError(422, "validation_error", detail="to が不正です", errors=[{"field": "to"}])
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    qid = _parse_uuid(quest_id, field="quest_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        quest = repo.get_quest(ts, qid)
        if quest is None:
            raise AppError(404, "not_found")
        _authorize_edit(ts, quest, user)
        cur_idx = _STATUS_ORDER.index(quest.status)
        # 前進は「現在の次」のみ許可（逆行・飛び越えは 409・C.5）。
        if not (cur_idx + 1 < len(_STATUS_ORDER) and to == _STATUS_ORDER[cur_idx + 1]):
            raise AppError(409, "conflict", detail="許可されない状態遷移です", extra={"errors": [{"reason": "invalid_state"}]})
        if to == "recruiting":  # draft→recruiting は公開＝strict 再検証（publish と同一関門）
            _validate_publishable(
                title=quest.title, color=quest.color,
                categories=repo.list_categories(ts, quest.id), quest_group_id=quest.quest_group_id,
            )
        quest.status = to
        if to == "completed":
            _finalize_completion(ts, quest)  # F.4 投稿者コイン一括確定（同一 UoW・冪等）
        detail = _build_detail(ts, quest, user.id)
        ts.commit()
    return detail


def delete_quest(account_id: uuid.UUID, company_id: uuid.UUID, quest_id: str) -> None:
    """クエストを論理削除（C.2 DELETE・owner/quest_admin）。子データは物理削除せず監査保持（§5.6）。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    qid = _parse_uuid(quest_id, field="quest_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        quest = repo.get_quest(ts, qid)
        if quest is None:
            raise AppError(404, "not_found")
        _authorize_edit(ts, quest, user)
        quest.deleted_at = datetime.now(timezone.utc)
        quest.deleted_by_id = user.id
        ts.commit()


def _guard_not_completed(quest) -> None:
    """完了後の書き込み凍結（C.5）。完了クエストへの変更は 409。"""
    if quest.status == "completed":
        raise AppError(409, "conflict", detail="完了後は変更できません", extra={"errors": [{"reason": "invalid_state"}]})


def _finalize_completion(ts, quest) -> None:
    """evaluating→completed の副作用＝投稿者コイン一括確定（正＝データモデル §7／API設計 F.4(b)）。

    F ドメインへ委譲（同一 UoW）＝未確定の全 published アイデアの評価連動コインを冪等に確定・付与
    （reason=evaluation_coin・アイデア単位1回・(a) 早期確定済みは二重付与しない）。局所 import で循環回避。
    """
    from app.tenant.evaluations import application as eval_service

    eval_service.finalize_quest_author_coins(ts, quest)


# ---- ドメイン関数（全経路で共有・C.2/C.3 サーバー強制ルール） ----


def _validate_publishable(*, title, color, categories, quest_group_id) -> None:
    """公開に必要な必須充足（title/color/categories≥1/quest_group_id）。未充足は 422（C.2）。"""
    errors = []
    if not title or not str(title).strip():
        errors.append({"field": "title"})
    if not color:
        errors.append({"field": "color"})
    if not categories:
        errors.append({"field": "categories"})
    if quest_group_id is None:
        errors.append({"field": "quest_group_id"})
    if errors:
        raise AppError(422, "validation_error", detail="公開に必要な項目が不足しています", errors=errors)


def _apply_party_diff(ts, quest, desired_members, *, requester, group_id) -> None:
    """パーティーの差分適用（あるべき全体像→追加/更新/除外）。全経路共有のサーバー強制ルール（C.3）。

    - 候補制限＝追加/更新対象は当該グループの有効メンバーのみ（範囲外は 422 user_id）。
    - owner 付与は作成者本人のみ（他者付与は 403）。
    - 作成者は保護＝差分対象から除外（除外/owner 剥奪不可・常に全権限）。
    - 既定権限（省略時 vote+idea_create+comment）は repository が付与。再追加はトゥームストーン再利用。
    """
    creator_id = quest.owner_id
    valid_group_ids = repo.list_active_group_member_user_ids(ts, group_id)

    desired: dict[uuid.UUID, list[str] | None] = {}
    for m in desired_members:
        uid = _parse_uuid(m.user_id, field="user_id")
        if uid == creator_id:
            continue  # 作成者は保護（常に owner・差分では触らない）
        desired[uid] = _validate_permissions(m.permissions)

    for uid, perms in desired.items():
        if uid not in valid_group_ids:
            raise AppError(
                422, "validation_error", detail="候補外のユーザーは追加できません",
                errors=[{"field": "user_id"}],
            )
        if perms and "owner" in perms and requester.id != creator_id:
            raise AppError(403, "forbidden", detail="owner 権限の付与は作成者のみ可能です")

    current = {
        m.user_id for m in repo.list_active_members(ts, quest.id) if m.user_id != creator_id
    }
    for uid, perms in desired.items():
        repo.add_member(ts, quest.id, uid, permissions=perms, granted_by_id=requester.id)
    for uid in current - set(desired):
        repo.remove_member(ts, quest.id, uid)


def _validate_permissions(perms) -> list[str] | None:
    """権限値が 6 権限のいずれかであることを検証（想定外は 422）。None は既定付与（repository 側）。"""
    if perms is None:
        return None
    invalid = [p for p in perms if p not in PERMISSION_VALUES]
    if invalid:
        raise AppError(
            422, "validation_error", detail="permissions が不正です", errors=[{"field": "permissions"}]
        )
    return list(dict.fromkeys(perms))  # 重複排除・順序保持


def _validate_title(title: str) -> str:
    t = (title or "").strip()
    if not t:
        raise AppError(422, "validation_error", detail="title は必須です", errors=[{"field": "title"}])
    if len(t) > _MAX_TITLE:
        raise AppError(422, "validation_error", detail="title が長すぎます", errors=[{"field": "title"}])
    return t


def _validate_color(color: str) -> str:
    if not color or not _HEX_COLOR.match(color):
        raise AppError(422, "validation_error", detail="color の形式が不正です", errors=[{"field": "color"}])
    return color


def _normalize_categories(labels) -> list[tuple[str, bool]]:
    """カテゴリを正規化（NFKC＝全半角統一＋トリム＋空白畳み）し、大文字小文字を無視して重複排除（§5.7）。

    表示形は最初の出現を保持（大小文字は潰さない）。`is_custom` は事前定義候補（現状 空＝全て True・C.7）に無いか。
    件数/長さ上限は 422。
    """
    result: list[tuple[str, bool]] = []
    seen: set[str] = set()
    for raw in labels or []:
        norm = unicodedata.normalize("NFKC", str(raw)).strip()
        norm = re.sub(r"\s+", " ", norm)
        if not norm:
            continue
        if len(norm) > _MAX_CATEGORY_LABEL:
            raise AppError(
                422, "validation_error", detail="categories のラベルが長すぎます",
                errors=[{"field": "categories"}],
            )
        key = norm.casefold()
        if key in seen:
            continue
        seen.add(key)
        result.append((norm, norm not in _PRESET_CATEGORIES))
    if len(result) > _MAX_CATEGORIES:
        raise AppError(
            422, "validation_error", detail="categories の件数が上限を超えています",
            errors=[{"field": "categories"}],
        )
    return result


def _apply_content(ts, quest, body) -> None:
    """PATCH/publish の内容フィールドを差分適用（送られたフィールドのみ）。categories は置換セット。"""
    provided = body.model_fields_set
    if "title" in provided:
        quest.title = _validate_title(body.title)
    if "color" in provided:
        quest.color = _validate_color(body.color)
    if "purpose" in provided:
        quest.purpose = body.purpose
    if "deadline" in provided:
        quest.deadline = body.deadline
    if "icon_image_path" in provided:
        quest.icon_image_path = body.icon_image_path
    if "categories" in provided:
        repo.replace_categories(ts, quest.id, _normalize_categories(body.categories or []))


def _authorize_edit(ts, quest, user) -> None:
    """編集認可＝owner または quest_admin（C.2/C.3）。下書きは本人のみ可視＝他人は 404（存在秘匿）。"""
    if quest.status == "draft" and quest.owner_id != user.id:
        raise AppError(404, "not_found")
    if quest.owner_id == user.id:
        return
    member = repo.get_active_member(ts, quest.id, user.id)
    if member is None or "quest_admin" not in repo.get_permissions(ts, member.id):
        raise AppError(403, "forbidden")


def _member_dto(ts, member, creator_id, user) -> dict:
    """パーティーメンバー1件の DTO（C.1 GET .../members・SC-11/SC-12 共通形）。"""
    return {
        "user": {
            "user_id": str(member.user_id),
            "display_name": user.display_name if user else "",
            "avatar_image_url": _image_url(user.avatar_image_path) if user else None,
        },
        "permissions": repo.get_permissions(ts, member.id),
        "joined_at": member.joined_at,
        "is_creator": member.user_id == creator_id,
    }


def _members_payload(ts, quest) -> list[dict]:
    """有効パーティーの DTO 配列（GET members・PUT party・詳細で共有）。N+1 回避で users を一括取得。"""
    members = repo.list_active_members(ts, quest.id)
    users = repo.get_users_by_ids(ts, {m.user_id for m in members})
    return [_member_dto(ts, m, quest.owner_id, users.get(m.user_id)) for m in members]


def _build_detail(ts, quest, viewer_id) -> dict:
    """作成/編集/公開の応答＝クエスト詳細（カード項目＋purpose/created_at＋my_permissions＋パーティー）。"""
    owners, groups = repo.get_owners_and_groups(ts, [quest.owner_id], [quest.quest_group_id])
    cats = repo.list_categories(ts, quest.id)
    owner = owners.get(quest.owner_id)
    group = groups.get(quest.quest_group_id)

    member_dtos = _members_payload(ts, quest)
    my_permissions = next(
        (m["permissions"] for m in member_dtos if m["user"]["user_id"] == str(viewer_id)), []
    )
    members = member_dtos  # member_count は有効パーティー数
    idea_count = ideas_repo.count_published_ideas_for_quests(ts, [quest.id]).get(quest.id, 0)
    return {
        "id": str(quest.id),
        "title": quest.title,
        "color": quest.color,
        "icon_image_url": _image_url(quest.icon_image_path),
        "categories": [c.label for c in cats],
        "status": quest.status,
        "deadline": quest.deadline,
        "purpose": quest.purpose,
        "member_count": len(members),
        # 公開アイデア数（C.1・下書き/削除は除外）。
        "idea_count": idea_count,
        "owner": {
            "user_id": str(quest.owner_id),
            "display_name": owner.display_name if owner else "",
            "avatar_image_url": _image_url(owner.avatar_image_path) if owner else None,
        },
        "quest_group": {
            "id": str(quest.quest_group_id),
            "quest_group_code": group.quest_group_code if group else "",
            "name": group.name if group else "",
        },
        "my_state": "draft" if quest.status == "draft" and quest.owner_id == viewer_id else "member",
        "my_permissions": my_permissions,
        "members": member_dtos,
        "created_at": quest.created_at,
    }


def _notify_party_invited(company_id: uuid.UUID, quest_id: uuid.UUID, recipient_ids: list[uuid.UUID]) -> None:
    """publish/即公開時の参加通知（`quest_party_invited`・H.0 発火元表に登録済み）。

    TODO(H): ドメイン H 実装時に post-commit で notify() を呼ぶ（宛先＝recipient_ids・ref_quest_id=quest_id）。
    通知種別・参照列（notifications.ref_quest_id）・発火元台帳は spec 登録済み（データモデル §3/§5.24・H.0）＝
    H 実装で必ず結線される。現フェーズは no-op（C.7-補・論点3 の確定方針）。
    """
    return None


def _parse_exclude(values) -> list[uuid.UUID]:
    """`exclude_user_ids` を UUID 列に整形（反復パラメータ＋各値の CSV 分割の両対応・C.4）。不正値は無視。"""
    out: list[uuid.UUID] = []
    for v in values or []:
        for part in str(v).split(","):
            part = part.strip()
            if not part:
                continue
            try:
                out.append(uuid.UUID(part))
            except ValueError:
                continue  # 不正な除外指定は黙殺（候補が過剰に出ても最終権威は候補制限 §C.3）
    return out


def _encode_candidate_cursor(user) -> str:
    """(display_name, id) を不透明カーソルにエンコード（候補の昇順キーセット・C.4）。"""
    raw = f"{user.display_name}|{user.id}".encode()
    return base64.urlsafe_b64encode(raw).decode()


def _decode_candidate_cursor(cursor: str) -> tuple[str, uuid.UUID]:
    try:
        name, id_str = base64.urlsafe_b64decode(cursor.encode()).decode().rsplit("|", 1)
        return name, uuid.UUID(id_str)
    except (binascii.Error, ValueError, UnicodeDecodeError):
        raise AppError(422, "validation_error", detail="cursor が不正です", errors=[{"field": "cursor"}])
