"""ドメイン C（クエスト）の application（imperative shell・API設計 C.1/C.4）。

会社DB を動的解決（§1.5・company_id はセッション由来）→ テナントユーザーを解決 →
可視性（グループ×パーティー門番は repository が per-quest 強制・C.0）を満たす一覧を DTO 化して返す。
本スライスは**読み取り経路（SC-10）**のみ＝`get_quests`／`get_quest_groups`。作成/編集は C.2 以降。
"""
from __future__ import annotations

import base64
import binascii
import json
import logging
import re
import unicodedata
import uuid
from datetime import datetime, timedelta, timezone

from app.control_plane.auth.orm import Company
from app.core import list_query as lq
from app.core.errors import AppError
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.infra.storage import get_storage, validate_image_upload
from app.tenant.chat import repository as chat_repo
from app.tenant.evaluations import application as eval_app
from app.tenant.ideas import repository as ideas_repo
from app.tenant.notifications import service as notify_svc
from app.tenant.realtime import events as realtime_events
from app.tenant.profile import repository as profile_repo
from app.tenant.profile.orm import User
from app.tenant.quest_group import repository as qg_repo
from app.tenant.quests import repository as repo
from app.tenant.quests.schemas import PERMISSION_VALUES

logger = logging.getLogger(__name__)

# 有効な quest_status（§3）。フィルタの想定外値は 422（§C.6 入力検証）。
_VALID_STATUS = {"draft", "recruiting", "in_progress", "evaluating", "completed"}

# FR-39 ⑥ 総括の初回記入 XP（成果重視カーブ・初期値・調整可）。クエスト単位で本人1回・冪等。
_XP_QUEST_RESULT = 20

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


# ソート可能キー（§1.8.1 ホワイトリスト・C.1）＝repository の集計列/列に対応。
_SORTABLE_KEYS = {"created_at", "deadline", "idea_count", "member_count"}
# カーソルで datetime として符号化するキー（他は int）。
_DATETIME_SORT_KEYS = {"created_at", "deadline"}


def _parse_sort(sort: str | None) -> list[tuple[str, bool]]:
    """`?sort=` を `[(key, descending)]` に解析（左が最優先・`-`接頭辞で降順・§1.8.1）。

    未知キーは 422 `validation_error`（`errors[].field="sort"`＝任意列ソートの情報漏れ防止）。
    省略/空は新着（`-created_at`）を既定にする（現行挙動を維持）。
    """
    if not sort:
        return [("created_at", True)]
    specs: list[tuple[str, bool]] = []
    for token in sort.split(","):
        token = token.strip()
        if not token:
            continue
        descending = token.startswith("-")
        key = token[1:] if descending else token
        if key not in _SORTABLE_KEYS:
            raise AppError(422, "validation_error", detail="sort が不正です", errors=[{"field": "sort"}])
        specs.append((key, descending))
    return specs or [("created_at", True)]


def _encode_cursor(keyset: tuple, sort: list[tuple[str, bool]]) -> str:
    """ソートキー値タプル（末尾 id）を不透明カーソルにエンコード（§1.8.1・タプル内包）。"""
    vals = []
    for (key, _), v in zip(sort, keyset[:-1]):
        if key in _DATETIME_SORT_KEYS:
            vals.append(v.isoformat() if v is not None else None)
        else:
            vals.append(v)
    payload = {"s": [[k, d] for k, d in sort], "v": vals, "id": str(keyset[-1])}
    raw = json.dumps(payload, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).decode()


def _decode_cursor(cursor: str, sort: list[tuple[str, bool]]) -> tuple:
    """カーソルを keyset タプルに復号（現在のソートと不一致なら 422・§1.8.1）。"""
    try:
        payload = json.loads(base64.urlsafe_b64decode(cursor.encode()).decode())
        if payload["s"] != [[k, d] for k, d in sort]:
            raise ValueError("sort mismatch")  # 途中でソートを変えたカーソルは無効
        vals = []
        for (key, _), v in zip(sort, payload["v"]):
            if key in _DATETIME_SORT_KEYS:
                vals.append(datetime.fromisoformat(v) if v is not None else None)
            else:
                vals.append(int(v))
        return tuple(vals) + (uuid.UUID(payload["id"]),)
    except (binascii.Error, ValueError, KeyError, TypeError, UnicodeDecodeError):
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
    sort: str | None = None,
    limit: int,
    cursor: str | None = None,
) -> dict:
    """参加中クエスト＋自分の下書き一覧（SC-10・C.1・FR-15）。ソート/カーソル §1.8.1。

    参照制限（(A) 非draft×所属グループ×パーティー参加中 ／ (B) 自分の下書き）は repository が強制。
    ソート＝`?sort=`（既定 `-created_at`・未知キーは 422）。会社/ユーザー未解決（通常起きない）は空ページ。
    """
    if status is not None:
        invalid = [s for s in status if s not in _VALID_STATUS]
        if invalid:
            raise AppError(422, "validation_error", detail="status が不正です", errors=[{"field": "status"}])
    sort_specs = _parse_sort(sort)  # 未知キーは query 前に 422（field=sort）
    group_uuid = _parse_uuid(group_id, field="group_id") if group_id else None
    cur = _decode_cursor(cursor, sort_specs) if cursor else None  # 不正カーソルは query 前に 422

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
            q=q, status=status, group_id=group_uuid, sort=sort_specs, cursor=cur, limit=limit + 1,
        )
        has_next = len(rows) > limit
        rows = rows[:limit]
        # ページ分の付随情報を一括取得（N+1 回避）。member_count/idea_count は list 側が各行に付与済み。
        owner_ids = list({r.owner_id for r in rows})
        qids = [r.id for r in rows]
        links_by_quest = repo.linked_groups_for_quests(ts, qids)  # quest_id→[参加部署 id]（0..N）
        gids = list({g for gl in links_by_quest.values() for g in gl})
        owners, groups = repo.get_owners_and_groups(ts, owner_ids, gids)
        cats = repo.list_categories_for_quests(ts, qids)
        data = [
            _quest_card_dto(r, user.id, owners, groups, links_by_quest.get(r.id, []), cats)
            for r in rows
        ]
    next_cursor = _encode_cursor(repo.keyset_of(rows[-1], sort_specs), sort_specs) if has_next and rows else None
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


def get_company_group_directory(account_id: uuid.UUID, company_id: uuid.UUID, *, q: str | None = None) -> dict:
    """会社内の全クエストグループ（部署ディレクトリ・FR-38 SC-11 追加グループ選択）。所属に依らず全件。

    複数部署横断のクエストに他部署を関連付ける選択肢。会社内は部署をこえて可視の確定方針に基づき、認証済み
    一般ユーザーに会社内の全有効グループ（最小フィールド）を返す。実際の追加可否は作成/編集で再検証（C.2）。
    """
    company = _resolve_company(company_id)
    if company is None:
        return {"data": []}
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            return {"data": []}
        groups = repo.list_all_active_groups(ts, q=q)
        data = [
            {"id": str(g.id), "quest_group_code": g.quest_group_code, "name": g.name} for g in groups
        ]
    return {"data": data}


def _group_refs(group_ids, groups) -> list[dict]:
    """参加部署 id 配列→グループ参照 DTO 配列（id/code/name・N+1 回避で groups マップを受け取る）。"""
    out = []
    for gid in group_ids:
        g = groups.get(gid)
        out.append({
            "id": str(gid),
            "quest_group_code": g.quest_group_code if g else "",
            "name": g.name if g else "",
        })
    return out


def _quest_card_dto(quest, viewer_id, owners, groups, group_ids, cats) -> dict:
    owner = owners.get(quest.owner_id)
    return {
        "id": str(quest.id),
        "title": quest.title,
        "color": quest.color,
        "icon_image_url": _image_url(quest.icon_image_path),
        "categories": [c.label for c in cats.get(quest.id, [])],
        "status": quest.status,
        "deadline": quest.deadline,
        # 有効パーティー人数／公開アイデア数（C.1・下書き/削除は除外）＝list 側が集計列として各行に付与。
        "member_count": quest.member_count,
        "idea_count": quest.idea_count,
        "owner": {
            "user_id": str(quest.owner_id),
            "display_name": owner.display_name if owner else "",
            "avatar_image_url": _image_url(owner.avatar_image_path) if owner else None,
        },
        # 参加部署（0..N・すべて同格・FR-38 再設計）。0 件なら空配列。
        "quest_groups": _group_refs(group_ids, groups),
        # 本人の下書きは draft、それ以外は member。未投稿/投稿済みはドメイン D 実装後に精緻化（C.1）。
        "my_state": "draft" if quest.status == "draft" and quest.owner_id == viewer_id else "member",
        # 閲覧者が作成者か（SC-01 ダッシュボードで「自分のクエスト」を参加中と分離・SC-10 でも利用可）。
        "is_owner": quest.owner_id == viewer_id,
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
        elif not repo.can_access_quest(ts, quest, user.id):
            raise AppError(404, "not_found")  # 公開系は C.0 門番（作成者別格・参加部署の都度再判定・§5.6b）
        return _build_detail(ts, quest, user.id)


def create_quest(account_id: uuid.UUID, company_id: uuid.UUID, *, body) -> dict:
    """クエストを作成（C.2・SC-11）。作成者＝所有者（全権限）。status=recruiting は即公開扱い。

    内容検証（title/color/categories 正規化）→ グループ有効所属検証 → 本体作成 → カテゴリ置換 →
    作成者を owner でパーティー投入 → 追加メンバーを差分適用 を単一 UoW で実行。recruiting は strict 検証。
    """
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    group_uuids = _parse_group_ids(body.quest_group_ids)
    title = _validate_title(body.title)
    color = _validate_color(body.color)
    cats = _normalize_categories(body.categories)

    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        # 参加部署は会社内の有効グループのみ許容（0..N・作成者の所属は不問＝別格・FR-38 再設計）。
        group_uuids = _validate_groups(ts, group_uuids)
        if body.status == "recruiting":
            _validate_publishable(title=title, color=color, categories=cats)
        quest = repo.create_quest(
            ts, owner_id=user.id, title=title, color=color,
            status=body.status, purpose=body.purpose, deadline=body.deadline,
            icon_image_path=body.icon_image_path, discoverable=body.discoverable,
        )
        ts.flush()  # quest.id 確定（カテゴリ/パーティー/リンクの FK に使う）
        repo.replace_categories(ts, quest.id, cats)
        # 参加部署（フラット 0..N）を確定＝候補範囲の材料（party 差分より先に書く）。
        repo.create_group_links(ts, quest.id, group_ids=group_uuids)
        # 作成者は常にパーティー員＝owner（C.0）。差分より先に投入して保護対象にする。
        repo.add_member(ts, quest.id, user.id, permissions=_ALL_PERMISSIONS, granted_by_id=user.id)
        _apply_party_diff(ts, quest, body.members, requester=user)
        detail = _build_detail(ts, quest, user.id)
        recipients = [m.user_id for m in repo.list_active_members(ts, quest.id) if m.user_id != user.id]
        quest_id = quest.id
        ts.commit()
    if body.status == "recruiting":
        _notify_party_invited(company_id, quest_id, recipients, user.id)  # 即公開＝参加通知（H・C.2）
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
        prev_deadline = quest.deadline  # watch 通知（deadline 変更）の判定用に適用前を保持
        _apply_content(ts, quest, body)
        deadline_changed = "deadline" in body.model_fields_set and quest.deadline != prev_deadline
        # 参加部署の差分（フラット 0..N・すべて同格・FR-38 再設計）＝あるべき全体像へ差分適用。party 差分より先に確定。
        # 参加部署を外すのはブロックしない（409 group_in_use 廃止）＝門番の都度再判定で失効を表現する（C.0）。
        if "quest_group_ids" in body.model_fields_set and body.quest_group_ids is not None:
            target = _validate_groups(ts, _parse_group_ids(body.quest_group_ids))
            repo.reconcile_group_links(ts, quest.id, target)
        removed: list = []
        if "members" in body.model_fields_set and body.members is not None:
            removed = _apply_party_diff(ts, quest, body.members, requester=user)
        cg_ids = chat_repo.list_chat_group_ids_for_quest(ts, quest.id) if removed else []
        # 公開中クエストは不正な状態へ落とせない＝strict 再検証（未充足は 422）。
        if quest.status in _PUBLIC_STATUS:
            _validate_publishable(
                title=quest.title, color=quest.color,
                categories=repo.list_categories(ts, quest.id),
            )
        new_deadline = quest.deadline.isoformat() if quest.deadline else None
        detail = _build_detail(ts, quest, user.id)
        ts.commit()
    _revoke_chat_subscriptions(company_id, cg_ids, removed)  # L.4（post-commit・全体編集での除外も失効）
    if deadline_changed:  # フォロワーへ watch 更新（締切変更・メタ級・発見可能な間のみ・行為者除外）
        _notify_quest_watch_update(company_id, qid, {"event": "deadline", "deadline": new_deadline}, exclude=(user.id,))
    return detail


def publish_quest(account_id: uuid.UUID, company_id: uuid.UUID, quest_id: str, *, body) -> dict:
    """下書きを公開（draft→recruiting・C.2・アトミック）。内容適用＋パーティー適用＋strict＋遷移を単一 UoW。

    `draft` 以外は 409（invalid_state）。owner（作成者）のみ。参加通知（`quest_party_invited`）は post-commit で H に結線済み（`_notify_party_invited`）。
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
        removed: list = []
        if "members" in body.model_fields_set and body.members is not None:
            removed = _apply_party_diff(ts, quest, body.members, requester=user)
        cg_ids = chat_repo.list_chat_group_ids_for_quest(ts, quest.id) if removed else []
        _validate_publishable(
            title=quest.title, color=quest.color,
            categories=repo.list_categories(ts, quest.id),
        )
        quest.status = "recruiting"
        detail = _build_detail(ts, quest, user.id)
        recipients = [m.user_id for m in repo.list_active_members(ts, quest.id) if m.user_id != user.id]
        published_id = quest.id
        ts.commit()
    _notify_party_invited(company_id, published_id, recipients, user.id)  # 公開＝参加通知（H・C.2）
    _revoke_chat_subscriptions(company_id, cg_ids, removed)  # L.4（post-commit・publish 時の除外も失効）
    return detail


def set_quest_icon(account_id: uuid.UUID, company_id: uuid.UUID, quest_id: str, *,
                   data: bytes, content_type: str) -> dict:
    """クエストアイコンを設定（論点2・K.4 流儀の専用 multipart EP）。owner/quest_admin。旧画像は best-effort 削除。"""
    validate_image_upload(content_type, data)
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


def get_quest_group_candidates(
    account_id: uuid.UUID, company_id: uuid.UUID, *, group_ids: list[str],
    q: str | None = None, exclude_user_ids: list[str] | None = None,
    limit: int, cursor: str | None = None,
) -> dict:
    """参加部署のパーティー候補（FR-38 再設計・C.4 GET /quest-group-candidates）。

    指定した参加部署群のいずれかの有効メンバー×active を返す。**`group_ids` 省略/空なら会社の有効ユーザー全体**
    （参加部署 0 件のクエスト用）。各候補は所属 group_id 配列を併せて返す（部署バッジ）。
    門番＝**認証済みの同一会社ユーザー**（会社内は部署をこえて可視の確定方針・作成者別格で他部署も選べる・C.4）。
    """
    group_uuids = _parse_group_ids(group_ids)
    excl = _parse_exclude(exclude_user_ids)
    cur = _decode_candidate_cursor(cursor) if cursor else None
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        rows = repo.list_cross_group_candidates(
            ts, group_uuids, q=q, exclude_user_ids=excl, cursor=cur, limit=limit + 1,
        )
        has_next = len(rows) > limit
        rows = rows[:limit]
        # 所属バッジは照会に限らず有効所属全件（全社/単一照会でも常時表示・req2/5）。
        membership = repo.all_active_group_ids_by_user(ts, [u.id for u in rows])
        data = [
            {
                "user_id": str(u.id),
                "display_name": u.display_name,
                "avatar_image_url": _image_url(u.avatar_image_path),
                "group_ids": [str(g) for g in membership.get(u.id, [])],
            }
            for u in rows
        ]
        next_cursor = _encode_candidate_cursor(rows[-1]) if has_next and rows else None
    return {"data": data, "page_info": {"next_cursor": next_cursor, "has_next": has_next}}


# ---- クエスト最終結果＝アイデア選別の申し送り（FR-39・ISO 56002・完了時）。 ----

_RESULT_ASPECTS = ("novelty", "impact", "feasibility", "fit", "cost")


def _outcome_dto(ts, row) -> dict:
    """総括（人手記入）を DTO 化（未記入は各 None／metrics 空）。更新者は表示名に解決。"""
    if row is None:
        return {"metrics": []}
    updater = repo.get_users_by_ids(ts, [row.updated_by]).get(row.updated_by) if row.updated_by else None
    return {
        "summary": row.summary,
        "learnings": row.learnings,
        "next_actions": row.next_actions,
        "metrics": row.metrics or [],
        "chat_summary": row.chat_summary,
        "chat_summary_at": row.chat_summary_at,
        "updated_by_name": updater.display_name if updater else None,
        "updated_at": row.updated_at,
    }


def _can_edit_outcome(ts, quest, user) -> bool:
    """総括（④⑤）の編集可否＝owner または quest_admin（_authorize_edit と同定義）。"""
    if quest.owner_id == user.id:
        return True
    member = repo.get_active_member(ts, quest.id, user.id)
    return member is not None and "quest_admin" in repo.get_permissions(ts, member.id)


def get_quest_result(account_id: uuid.UUID, company_id: uuid.UUID, quest_id: str) -> dict:
    """アイデア選別の申し送り（FR-39）＝既存集計（選定/評価/投票/パーティー）の合成＋総括。

    可視性＝門番 C.0（範囲外 404）。評価の数値は閲覧者に可視な submitted のみ（F.1）。
    「完了時のみ表示」はフロントのタブ出し分けで担保（本 EP は参照可能なパーティー員に status 込みで返す）。
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
        if quest is None or not repo.can_access_quest(ts, quest, user.id):
            raise AppError(404, "not_found")  # 存在秘匿（C.0）
        ideas = ideas_repo.list_published_ideas_for_quest(ts, qid)
        idea_ids = [i.id for i in ideas]
        states = eval_app.eval_states_for_ideas(ts, quest, user, ideas)  # per-idea overall_avg/evaluator_count（可視のみ）
        aspect = eval_app.aspect_averages_for_quest(ts, quest, user, ideas)  # クエスト横断の観点別平均（可視のみ）
        votes = ideas_repo.count_votes_for_ideas(ts, idea_ids) if idea_ids else {}
        authors = repo.get_users_by_ids(ts, {i.author_id for i in ideas})
        decisions = []
        for i in ideas:
            st = states.get(i.id, {})
            a = authors.get(i.author_id)
            decisions.append({
                "idea_id": str(i.id),
                "title": i.title,
                "value": i.value,
                "author": {
                    "user_id": str(i.author_id),
                    "display_name": a.display_name if a else "",
                    "avatar_image_url": _image_url(a.avatar_image_path) if a else None,
                },
                "is_selected": bool(i.is_selected),
                "overall_avg": st.get("overall_avg"),
                "evaluation_count": st.get("evaluator_count", 0),
            })
        # 評価平均の降順（未評価=None は末尾）。①選定アイデアは is_selected で抽出。
        decisions.sort(key=lambda d: (d["overall_avg"] is None, -(d["overall_avg"] or 0.0)))
        members = repo.list_active_members(ts, quest.id)
        vote_total = sum(sum(v.values()) for v in votes.values())
        asp = aspect["aspects"]
        cats = [c.label for c in repo.list_categories(ts, qid)]
        # ④議論の要点(b)＝ピン留めメッセージ（アイデア横断・pinned_at 昇順）。抜粋＋投稿者＋所属アイデア名。
        idea_titles = {i.id: i.title for i in ideas}
        pinned_rows = chat_repo.list_pinned_for_idea_ids(ts, idea_ids)
        pin_authors = repo.get_users_by_ids(ts, {m.author_id for _iid, m in pinned_rows})
        pinned_messages = []
        for iid, m in pinned_rows:
            a = pin_authors.get(m.author_id)
            pinned_messages.append({
                "message_id": str(m.id),
                "idea_id": str(iid),
                "idea_title": idea_titles.get(iid, ""),
                "author": {
                    "user_id": str(m.author_id),
                    "display_name": a.display_name if a else "",
                    "avatar_image_url": _image_url(a.avatar_image_path) if a else None,
                },
                "excerpt": (m.body or "")[:160],
                "created_at": m.created_at,
            })
        return {
            "quest_id": str(quest.id),
            "title": quest.title,
            "status": quest.status,
            "purpose": quest.purpose,
            "deadline": quest.deadline,
            "categories": cats,
            "decisions": decisions,
            "aspect_averages": {a: asp.get(a) for a in _RESULT_ASPECTS},
            "participation": {
                "idea_count": len(ideas),
                "selected_count": sum(1 for i in ideas if i.is_selected),
                "vote_total": vote_total,
                "evaluation_count": aspect["evaluation_count"],
                "party_size": len(members),
            },
            "pinned_messages": pinned_messages,
            "outcome": _outcome_dto(ts, repo.get_outcome(ts, qid)),
            "can_edit": _can_edit_outcome(ts, quest, user),
        }


def generate_chat_summary(account_id: uuid.UUID, company_id: uuid.UUID, quest_id: str) -> dict:
    """FR-39 (c) 議論の要点＝チャットの自動要約（抽出型・オフライン・無料）を生成/再生成し保存（owner/quest_admin）。

    当該クエストの公開アイデアのチャット本文（非削除・上限）を要約 seam（summarize）に渡し、結果を
    quest_outcomes.chat_summary に保存。外部API/課金/外部送信なし（会社データを外部へ出さない）。
    """
    from app.tenant.quests import summarize

    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    qid = _parse_uuid(quest_id, field="quest_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        quest = repo.get_quest(ts, qid)
        if quest is None or not repo.can_access_quest(ts, quest, user.id):
            raise AppError(404, "not_found")
        _authorize_edit(ts, quest, user)  # owner/quest_admin
        idea_ids = [i.id for i in ideas_repo.list_published_ideas_for_quest(ts, qid)]
        bodies = chat_repo.list_message_bodies_for_idea_ids(ts, idea_ids, limit=500)
        summary = summarize.summarize_text("\n".join(bodies), max_sentences=5) if bodies else ""
        row = repo.upsert_outcome(
            ts, qid,
            fields={"chat_summary": summary or None, "chat_summary_at": datetime.now(timezone.utc)},
            updated_by=user.id,
        )
        dto = _outcome_dto(ts, row)
        ts.commit()
    return dto


def update_quest_outcome(account_id: uuid.UUID, company_id: uuid.UUID, quest_id: str, *, body) -> dict:
    """総括（④振り返り・⑤次アクション・KPI）の保存（FR-39 PUT result・owner/quest_admin）。送られた項目のみ更新。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    qid = _parse_uuid(quest_id, field="quest_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        quest = repo.get_quest(ts, qid)
        if quest is None or not repo.can_access_quest(ts, quest, user.id):
            raise AppError(404, "not_found")
        _authorize_edit(ts, quest, user)  # owner/quest_admin（それ以外は 403）
        fields: dict = {}
        if body.summary is not None:
            fields["summary"] = body.summary.strip() or None
        if body.learnings is not None:
            fields["learnings"] = body.learnings.strip() or None
        if body.next_actions is not None:
            fields["next_actions"] = body.next_actions.strip() or None
        if body.metrics is not None:
            fields["metrics"] = [{"label": m.label, "value": m.value} for m in body.metrics]
        row = repo.upsert_outcome(ts, qid, fields=fields, updated_by=user.id)
        # ⑥ 総括に実内容がある初回記入で少額XP（クエスト単位・本人1回・冪等・FR-39 §8-⑥）。局所 import で循環回避。
        if row.summary or row.learnings or row.next_actions:
            from app.tenant.gamification import ledger, repository as gami_repo
            if not gami_repo.exists_ref(ts, user.id, ledger.XP_GAIN, "quest_result_summary", "quests", qid):
                ledger.grant(ts, user, kind=ledger.XP_GAIN, amount=_XP_QUEST_RESULT,
                             reason="quest_result_summary", ref_type="quests", ref_id=qid, quest_id=qid)
        dto = _outcome_dto(ts, row)
        ts.commit()
    return dto


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
        if not repo.can_access_quest(ts, quest, user.id):
            raise AppError(404, "not_found")  # C.0 門番（作成者別格・参加部署の都度再判定）
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
        removed = _apply_party_diff(ts, quest, members, requester=user)
        cg_ids = chat_repo.list_chat_group_ids_for_quest(ts, quest.id) if removed else []
        data = _members_payload(ts, quest)
        ts.commit()
    _revoke_chat_subscriptions(company_id, cg_ids, removed)  # L.4（post-commit・バルク除外でも失効）
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
        # 候補＝参加部署の有効所属者（0 件なら会社の有効ユーザー全体＝アクセス条件と同一・FR-38 再設計・C.3）。
        allowed = _candidate_user_ids(ts, quest)
        if allowed is None:
            u = repo.get_users_by_ids(ts, {uid}).get(uid)
            in_range = u is not None and u.status == "active"
        else:
            in_range = uid in allowed
        if not in_range:
            raise AppError(422, "validation_error", detail="候補外のユーザーは追加できません", errors=[{"field": "user_id"}])
        if perms and "owner" in perms and user.id != quest.owner_id:
            raise AppError(403, "forbidden", detail="owner 権限の付与は作成者のみ可能です")
        member = repo.add_member(ts, quest.id, uid, permissions=perms, granted_by_id=user.id)
        users = repo.get_users_by_ids(ts, {uid})
        has_depts, dept_users = _dept_scope(ts, quest)
        memberships = repo.all_active_group_ids_by_user(ts, [uid])
        dto = _member_dto(
            ts, member, quest.owner_id, users.get(uid),
            has_depts=has_depts, dept_users=dept_users, member_group_ids=memberships.get(uid, []),
        )
        ts.commit()
    return dto


def _revoke_chat_subscriptions(company_id: uuid.UUID, cg_ids, removed_uids) -> None:
    """L.4＝除去メンバーの当該クエスト chat 購読を強制ドロップ（**post-commit**・ハブへ失効シグナル）。

    バルクのパーティー差分（set_party/update_quest/publish_quest）でも増分 DELETE と同じく発火させる。
    再接続時は L.2 gate が再検証するが、除去直後の生 WS を即ドロップする（L.4）。
    """
    for uid in removed_uids:
        for cg_id in cg_ids:
            realtime_events.publish_revoke(uid, cg_id, company_id=company_id)


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
        cg_ids = chat_repo.list_chat_group_ids_for_quest(ts, quest.id)  # L.4 失効対象（除去前に取得）
        repo.remove_member(ts, quest.id, uid)  # 有効参加が無ければ no-op（冪等）
        ts.commit()
    _revoke_chat_subscriptions(company_id, cg_ids, [uid])  # L.4（post-commit）


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
    """ステータスを1ステップ遷移（C.5・owner/quest_admin）。**前進・後退とも隣接1段のみ**許可（2026-09-13）。

    後退は運用上の戻し（誤って進めた/再検討）を許容。ただし **draft への戻し（非公開化）は transition では不可**
    （下限＝recruiting・unpublish は別概念）。飛び越えは 409。draft→recruiting は publish 相当の strict 検証。
    完了時の副作用（コイン確定/通知/フィード）は**初回完了時のみ**（再完了で重複させない・冪等）。
    """
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
        to_idx = _STATUS_ORDER.index(to)
        forward = to_idx == cur_idx + 1
        backward = to_idx == cur_idx - 1 and to_idx >= 1  # 隣接1段の後退（draft〔0〕へは戻さない）
        if not (forward or backward):
            raise AppError(409, "conflict", detail="許可されない状態遷移です（前進/後退とも隣接1段のみ）", extra={"errors": [{"reason": "invalid_state"}]})
        if to == "recruiting" and quest.status == "draft":  # draft→recruiting は公開＝strict 再検証（publish と同一関門）
            _validate_publishable(
                title=quest.title, color=quest.color,
                categories=repo.list_categories(ts, quest.id),
            )
        from_status = quest.status  # watch 通知（status_changed）の補足用に遷移前を保持
        quest.status = to
        result_recipients: list[uuid.UUID] = []
        if to == "completed":
            from app.tenant.gamification import ledger, repository as gami_repo
            # 初回完了か（quest_completed 活動の有無で判定）＝再完了で通知/フィードを重複させない。
            first_completion = not gami_repo.exists_ref(ts, user.id, ledger.XP_GAIN, "quest_completed", "quests", quest.id)
            _finalize_completion(ts, quest)  # F.4 投稿者コイン一括確定（同一 UoW・冪等）
            _record_quest_completed_feed(ts, quest, user)  # ④ チーム成果フィード（quest_completed・冪等・FR-39）
            if first_completion:  # ④ 完了通知は初回のみ（宛先＝作成者を除く有効パーティー員・post-commit）
                result_recipients = [m.user_id for m in repo.list_active_members(ts, quest.id) if m.user_id != user.id]
        detail = _build_detail(ts, quest, user.id)
        ts.commit()
    if to == "completed" and result_recipients:
        _notify_quest_result_ready(company_id, qid, result_recipients, user.id)
    # フォロワーへ watch 更新（H quest_watch_update・メタ級・発見可能な間のみ・行為者除外）。
    watch_params = ({"event": "completed"} if to == "completed"
                    else {"event": "status_changed", "from_status": from_status, "to_status": to})
    _notify_quest_watch_update(company_id, qid, watch_params, exclude=(user.id,))
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


def _validate_publishable(*, title, color, categories) -> None:
    """公開に必要な必須充足（title/color/categories≥1）。未充足は 422（C.2）。

    参加部署（quest_group_ids）は 0..N＝0 件も可のため必須ではない（FR-38 再設計・§5.6b）。
    """
    errors = []
    if not title or not str(title).strip():
        errors.append({"field": "title"})
    if not color:
        errors.append({"field": "color"})
    if not categories:
        errors.append({"field": "categories"})
    if errors:
        raise AppError(422, "validation_error", detail="公開に必要な項目が不足しています", errors=errors)


def _parse_group_ids(values) -> list[uuid.UUID]:
    """クエストグループ id 文字列配列を UUID 配列へ（重複排除・不正は 422 quest_group_ids）。"""
    out: list[uuid.UUID] = []
    for v in values or []:
        gid = _parse_uuid(v, field="quest_group_ids")
        if gid not in out:
            out.append(gid)
    return out


def _validate_groups(ts, group_uuids: list[uuid.UUID]) -> list[uuid.UUID]:
    """参加部署（quest_group_ids）が会社内の有効グループであることを検証し、正規化した配列を返す（FR-38・C.2）。

    フラット 0..N・すべて同格＝主グループの概念なし。存在しない/削除済みグループの付与は 422（`quest_group_ids`）。
    作成者の所属は不問（別格）。0 件（空）はそのまま許容（部署条件なし＝会社全体）。
    """
    if not group_uuids:
        return []
    active = repo.get_active_group_ids(ts, group_uuids)
    if len(active) != len(group_uuids):
        raise AppError(
            422, "validation_error", detail="quest_group_ids が不正です",
            errors=[{"field": "quest_group_ids"}],
        )
    return group_uuids


def _candidate_user_ids(ts, quest) -> set[uuid.UUID] | None:
    """パーティー候補の許容 user_id 集合（C.3・FR-38 再設計＝アクセス条件と同一）。

    参加部署が 1 件以上ならそのいずれかの有効所属者に限定、**0 件なら None**（＝会社の有効ユーザー全体＝
    呼び出し側は範囲制限しない）を返す。作成者は別格で候補判定の対象外（呼び出し側で除外済み）。
    """
    linked = repo.list_linked_group_ids(ts, quest.id)
    if not linked:
        return None  # 参加部署 0 件＝会社全体（範囲制限なし）
    return repo.user_ids_in_any_group(ts, linked)


def _apply_party_diff(ts, quest, desired_members, *, requester) -> list:
    """パーティーの差分適用（あるべき全体像→追加/更新/除外）。全経路共有のサーバー強制ルール（C.3）。

    - 候補制限＝追加/更新対象は**参加部署のいずれか**の有効所属者のみ（0 件なら会社の有効ユーザー全体＝範囲制限なし・
      FR-38 再設計・範囲外は 422 user_id）。
    - owner 付与は作成者本人のみ（他者付与は 403）。
    - 作成者は保護＝差分対象から除外（除外/owner 剥奪不可・常に全権限）。
    - 既定権限（省略時 vote+idea_create+comment）は repository が付与。再追加はトゥームストーン再利用。
    """
    creator_id = quest.owner_id
    # 候補＝参加部署の有効所属者（0 件なら None＝会社全体・アクセス条件と同一・C.3）。
    allowed = _candidate_user_ids(ts, quest)

    desired: dict[uuid.UUID, list[str] | None] = {}
    for m in desired_members:
        uid = _parse_uuid(m.user_id, field="user_id")
        if uid == creator_id:
            continue  # 作成者は保護（常に owner・差分では触らない）
        desired[uid] = _validate_permissions(m.permissions)

    if allowed is None:
        # 参加部署 0 件＝会社の有効ユーザー全体。存在＋`status='active'` を検証（不正 uid は 422）。
        allowed = {uid for uid, u in repo.get_users_by_ids(ts, set(desired)).items() if u.status == "active"}

    for uid, perms in desired.items():
        if uid not in allowed:
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
    removed = list(current - set(desired))
    for uid in removed:
        repo.remove_member(ts, quest.id, uid)
    return removed  # L.4＝呼び出し側が post-commit で除去メンバーの chat 購読を失効させる


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
    if "discoverable" in provided and body.discoverable is not None:
        quest.discoverable = body.discoverable  # 発見カタログ掲載トグル（FR-40・C.9.0・owner/quest_admin）
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


def _dept_scope(ts, quest) -> tuple[bool, set]:
    """参加部署によるアクセス範囲＝(参加部署が1件以上あるか, 参加部署いずれかの有効所属者 user_id 集合)。

    0 件なら (False, 空集合)＝部署条件なし（全員 in_scope）。門番 `can_access_quest` と同一定義（§5.6b/C.0）。
    """
    linked = repo.list_linked_group_ids(ts, quest.id)
    if not linked:
        return False, set()
    return True, repo.user_ids_in_any_group(ts, linked)


def _member_dto(ts, member, creator_id, user, *, has_depts=False, dept_users=frozenset(),
                member_group_ids=(), via_request=False) -> dict:
    """パーティーメンバー1件の DTO（C.1 GET .../members・SC-11/SC-12 共通形）。

    `in_scope`＝当該メンバーが今このクエストを参照できるか（作成者別格 or 参加部署0件 or 参加部署に現所属）。
    false＝**参加部署外＝失効中**（異動などで全参加部署を外れた名指しメンバー・UI で明示表示・C.0）。
    `group_ids`＝当該メンバーが有効所属する全クエストグループ（会社内全件）＝チップ常時表示/スコープ再判定の材料（req2/3）。
    `via_request`＝参加リクエスト経由（承認済み jr あり）＝SC-12 の「リクエスト経由」バッジ用（FR-40・C.9）。
    """
    is_creator = member.user_id == creator_id
    in_scope = is_creator or (not has_depts) or (member.user_id in dept_users)
    return {
        "user": {
            "user_id": str(member.user_id),
            "display_name": user.display_name if user else "",
            "avatar_image_url": _image_url(user.avatar_image_path) if user else None,
        },
        "permissions": repo.get_permissions(ts, member.id),
        "joined_at": member.joined_at,
        "is_creator": is_creator,
        "in_scope": in_scope,
        "group_ids": [str(g) for g in member_group_ids],
        "via_request": via_request,
    }


def _members_payload(ts, quest) -> list[dict]:
    """有効パーティーの DTO 配列（GET members・PUT party・詳細で共有）。N+1 回避で users を一括取得。

    各メンバーの `in_scope`（参加部署アクセス可否＝失効表示用）は参加部署スコープを一度だけ引いて付与。
    `group_ids`（有効所属全件）も一括取得して付与（チップ常時表示/スコープ再判定・req2/3）。
    """
    members = repo.list_active_members(ts, quest.id)
    users = repo.get_users_by_ids(ts, {m.user_id for m in members})
    has_depts, dept_users = _dept_scope(ts, quest)
    memberships = repo.all_active_group_ids_by_user(ts, [m.user_id for m in members])
    via_request_ids = repo.approved_join_request_user_ids(ts, quest.id)
    return [
        _member_dto(
            ts, m, quest.owner_id, users.get(m.user_id),
            has_depts=has_depts, dept_users=dept_users, member_group_ids=memberships.get(m.user_id, []),
            via_request=m.user_id in via_request_ids,
        )
        for m in members
    ]


def _build_detail(ts, quest, viewer_id) -> dict:
    """作成/編集/公開の応答＝クエスト詳細（カード項目＋purpose/created_at＋my_permissions＋パーティー）。"""
    owners = repo.get_users_by_ids(ts, [quest.owner_id])
    cats = repo.list_categories(ts, quest.id)
    owner = owners.get(quest.owner_id)
    # 参加部署全件（フラット 0..N・created_at 昇順・複数部署横断 FR-38 再設計）。0 件なら空配列。
    linked_ids = repo.list_linked_group_ids(ts, quest.id)
    linked_groups = repo.get_groups_by_ids(ts, linked_ids)
    quest_groups = _group_refs(linked_ids, linked_groups)

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
        "quest_groups": quest_groups,
        "my_state": "draft" if quest.status == "draft" and quest.owner_id == viewer_id else "member",
        "my_permissions": my_permissions,
        "members": member_dtos,
        "created_at": quest.created_at,
        "discoverable": bool(quest.discoverable),
    }


def _notify_party_invited(
    company_id: uuid.UUID, quest_id: uuid.UUID, recipient_ids: list[uuid.UUID], owner_id: uuid.UUID
) -> None:
    """publish/即公開時の参加通知（`quest_party_invited`・宛先＝追加パーティー員〔owner 除く〕・H.0/C.2）。post-commit。

    参照＝`ref_quest_id`（SC-02→SC-12 遷移）。actor_name＝公開者（owner）の表示名をイベント時点で凍結（H.1）。
    """
    if not recipient_ids:
        return

    def _build(ts):
        owner = ts.get(User, owner_id)
        params = {"actor_name": owner.display_name if owner else None}
        refs = {"ref_quest_id": quest_id}
        return [notify_svc.entry(r, "quest_party_invited", refs=refs, params=params) for r in recipient_ids]

    notify_svc.dispatch(company_id, _build)


def _record_quest_completed_feed(ts, quest, user) -> None:
    """完了＝チーム成果フィード（FR-36 成果系）に quest_completed を記帳（0XP マーカー・クエスト単位で冪等・FR-39 ④）。

    フィードは Activity を reason で絞る方式（§8-㉑）＝完了マイルストーンを 0XP の活動として1件だけ残す。
    実績エンジンは対象外（judge=False）。局所 import で循環回避。
    """
    from app.tenant.gamification import ledger, repository as gami_repo

    if gami_repo.exists_ref(ts, user.id, ledger.XP_GAIN, "quest_completed", "quests", quest.id):
        return
    ledger.grant(ts, user, kind=ledger.XP_GAIN, amount=0, reason="quest_completed",
                 ref_type="quests", ref_id=quest.id, quest_id=quest.id, judge=False)


def _notify_quest_result_ready(
    company_id: uuid.UUID, quest_id: uuid.UUID, recipient_ids: list[uuid.UUID], actor_id: uuid.UUID
) -> None:
    """完了＝結果確定をパーティーへ通知（`quest_result_ready`・宛先＝作成者以外の有効パーティー員・FR-39 ④）。post-commit。"""
    if not recipient_ids:
        return

    def _build(ts):
        actor = ts.get(User, actor_id)
        params = {"actor_name": actor.display_name if actor else None}
        refs = {"ref_quest_id": quest_id}
        return [notify_svc.entry(r, "quest_result_ready", refs=refs, params=params) for r in recipient_ids]

    notify_svc.dispatch(company_id, _build)


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


# ==== 発見カタログ・フォロー・参加リクエスト（FR-40・C.9・SC-13/SC-12） ====

_EMPTY_CATALOG = {"data": [], "page_info": {"total": 0, "page": 1, "per_page": 20}}


def _catalog_state(qid, members, jr_map, follows) -> str:
    """カタログ行の my_state（member > pending/rejected > following > none）。"""
    if qid in members:
        return "member"
    st = jr_map.get(qid)
    if st in ("pending", "rejected"):
        return st
    if qid in follows:
        return "following"
    return "none"


def _catalog_dtos(ts, rows, viewer_id) -> list[dict]:
    qids = [r.id for r in rows]
    links_by_quest = repo.linked_groups_for_quests(ts, qids)
    gids = list({g for gl in links_by_quest.values() for g in gl})
    owners, groups = repo.get_owners_and_groups(ts, list({r.owner_id for r in rows}), gids)
    cats = repo.list_categories_for_quests(ts, qids)
    member_counts = repo.count_active_members_for_quests(ts, qids)
    idea_counts = ideas_repo.count_published_ideas_for_quests(ts, qids)
    members = repo.member_quest_ids(ts, viewer_id, qids)
    follows = repo.followed_quest_ids(ts, viewer_id, qids)
    jr_map = repo.join_request_status_map(ts, viewer_id, qids)
    out = []
    for r in rows:
        r.member_count = member_counts.get(r.id, 0)  # _quest_card_dto は行属性を読む
        r.idea_count = idea_counts.get(r.id, 0)
        dto = _quest_card_dto(r, viewer_id, owners, groups, links_by_quest.get(r.id, []), cats)
        dto["my_state"] = _catalog_state(r.id, members, jr_map, follows)  # カタログ用に上書き
        dto["purpose"] = r.purpose  # メタ（ダイアログ/カードの一言）
        out.append(dto)
    return out


def get_quest_catalog(account_id, company_id, *, q=None, category=None, group_id=None,
                      sort=None, page=None, per_page=None) -> dict:
    """発見カタログ（SC-13・C.9.1）＝`can_discover_quest` を満たすクエストのメタ一覧＋自分の my_state。

    DataTable サーバー契約（§1.8.1・番号ページャ）。`page`/`per_page` 未指定＝全件（後方互換）。中身は返さない。
    """
    company = _resolve_company(company_id)
    if company is None:
        return _EMPTY_CATALOG
    cats_filter = [c.strip() for c in category.split(",") if c.strip()] if category else None
    group_uuid = _parse_uuid(group_id, field="group_id") if group_id else None
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            return _EMPTY_CATALOG
        visible = qg_repo.list_active_group_ids_for_user(ts, user.id)
        rows_stmt, count_stmt = repo.build_catalog_query(
            viewer_id=user.id, visible_group_ids=visible, q=q, categories=cats_filter,
            group_id=group_uuid, sort=sort)  # 未知 sort キーは 422（list_query）
        total = ts.execute(count_stmt).scalar_one()
        if page is None and per_page is None:
            rows = list(ts.execute(rows_stmt).scalars().all())
            eff_page, eff_per = 1, total or 1
        else:
            eff_page = max(1, page or 1)
            eff_per = max(1, min(per_page or lq.DEFAULT_PER_PAGE, lq.MAX_PER_PAGE))
            rows = list(ts.execute(rows_stmt.offset((eff_page - 1) * eff_per).limit(eff_per)).scalars().all())
        data = _catalog_dtos(ts, rows, user.id)
    return {"data": data, "page_info": {"total": total, "page": eff_page, "per_page": eff_per}}


def get_catalog_detail(account_id, company_id, quest_id) -> dict:
    """掲示板ダイアログ用のメタ詳細（SC-13・C.9.1）＝発見門番のみ・中身は返さない。"""
    iid = _parse_uuid(quest_id, field="quest_id")
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        quest = repo.get_quest(ts, iid)
        visible = qg_repo.list_active_group_ids_for_user(ts, user.id)
        if not repo.can_discover_quest(ts, quest, visible):
            raise AppError(404, "not_found")  # 存在秘匿（発見不可）
        dto = _catalog_dtos(ts, [quest], user.id)[0]
        dto["activity"] = _quest_activity(ts, quest.id)  # C.9.1 活発度スパーク（メタ限定・本文なし）
        return dto


_ACTIVITY_DAYS = 14


def _quest_activity(ts, quest_id, *, days=_ACTIVITY_DAYS) -> dict:
    """発見カタログの活発度スパーク（C.9.1）＝クエスト横断の日次メッセージ数（メタのみ）。"""
    since = datetime.now(timezone.utc) - timedelta(days=days)
    daily = [{"date": d.date().isoformat(), "count": n}
             for d, n in chat_repo.daily_message_counts_for_quest(ts, quest_id, since)]
    return {"daily": daily, "total": sum(d["count"] for d in daily), "days": days}


def get_quest_activity(account_id, company_id, quest_id) -> dict:
    """クエスト内の活発度スパーク（SC-12・C.1）＝メンバー可視。日次メッセージ数（公開アイデア横断）。

    可視性＝owner か有効メンバー（`can_access_quest`・範囲外は 404 存在秘匿）。データは `_quest_activity` を共有
    （発見カタログ SC-13 と同じ集計＝クエスト横断の公開アイデアのチャット日次件数）。
    """
    iid = _parse_uuid(quest_id, field="quest_id")
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        quest = repo.get_quest(ts, iid)
        if quest is None:
            raise AppError(404, "not_found")
        if not repo.can_access_quest(ts, quest, user.id):
            raise AppError(404, "not_found")  # C.0 門番（作成者別格・参加部署の都度再判定）
        return _quest_activity(ts, quest.id)


def _discoverable_follower_ids(ts, quest, *, exclude=()) -> list[uuid.UUID]:
    """quest_watch_update の宛先＝**発見可能な間のみ**のフォロワー（C.9・動的失効）。

    discoverable フラグが OFF なら空（watch は休眠）。参加部署0件＝全社→全フォロワー／部署指定→その参加部署に
    現所属のフォロワーのみ（異動で部署外になった人は自然に失効）。exclude は除外（行為者等）。status は問わない
    ＝完了（completed＝非 DISCOVERABLE_STATUS）への遷移でも「完了した」ことはフォロワーへ通知する（FR-40）。
    """
    if quest is None or not quest.discoverable:
        return []
    followers = [f for f in repo.list_follower_ids(ts, quest.id) if f not in set(exclude)]
    if not followers:
        return []
    link_gids = repo.list_group_ids_for_quest(ts, quest.id)
    if not link_gids:
        return followers  # 全社公開＝全フォロワーが発見可能
    gset = set(link_gids)
    ok = {uid for uid, gid, _role in qg_repo.list_active_memberships_for_users(ts, followers) if gid in gset}
    return [f for f in followers if f in ok]


def _notify_quest_watch_update(company_id, quest_id, params, *, exclude=()) -> None:
    """フォロー中クエストのメタ更新通知（H `quest_watch_update`・post-commit・メタ級）。

    宛先は post-commit のセッションで解決（コミット済みの最新状態で発見可否＝動的失効を判定）。
    """
    def _build(ts):
        quest = repo.get_quest(ts, quest_id)
        targets = _discoverable_follower_ids(ts, quest, exclude=exclude)
        refs = {"ref_quest_id": quest_id}
        return [notify_svc.entry(r, "quest_watch_update", refs=refs, params=params) for r in targets]
    notify_svc.dispatch(company_id, _build)


def notify_quest_watch_new_ideas(company_id, quest_id, *, actor_id=None) -> None:
    """アイデア公開でフォロワーへ new_ideas 通知（D ドメインから呼ぶ・C.9/FR-40）。公開者は除外。"""
    _notify_quest_watch_update(company_id, quest_id, {"event": "new_ideas"},
                               exclude=(actor_id,) if actor_id else ())


def _email_business_notify(company_id, recipient_account_ids, category, params) -> None:
    """業務通知メールを mail_outbox に積む（post-commit・control plane・会社トグルでゲート・FR-40/§4）。

    会社の `notify_email_enabled`（既定 true）が OFF なら送らない（セキュリティ系メールは別経路＝常時）。
    宛先メール/locale は管理DB の Account（正）から解決。best-effort（失敗は本処理を壊さない）。
    """
    aids = [a for a in dict.fromkeys(recipient_account_ids) if a]
    if not aids:
        return
    try:
        from app.control_plane.auth.orm import Account, Company as _Company
        from app.control_plane.mail_outbox import repository as mail_repo
        from app.db.control import control_session
        with control_session() as cs:
            co = cs.get(_Company, company_id)
            if co is None or not co.notify_email_enabled:
                return  # 会社が業務通知メールを OFF（既定 ON）
            for aid in aids:
                acc = cs.get(Account, aid)
                if acc is None or not acc.email:
                    continue
                mail_repo.enqueue(cs, acc.email, category, locale=acc.locale, params=params,
                                  account_id=aid, company_id=company_id)
            cs.commit()
    except Exception:  # noqa: BLE001  post-commit の best-effort（通知メールで本処理を壊さない）
        logger.warning("join-request email enqueue failed", exc_info=True)


def _load_discoverable(ts, account_id, quest_id):
    """(user, quest, visible) を返す。発見不可は 404（存在秘匿）。フォロー/申請の共通門番。"""
    user = profile_repo.get_user_by_account(ts, account_id)
    if user is None:
        raise AppError(401, "unauthenticated")
    quest = repo.get_quest(ts, quest_id)
    visible = qg_repo.list_active_group_ids_for_user(ts, user.id)
    if not repo.can_discover_quest(ts, quest, visible):
        raise AppError(404, "not_found")
    return user, quest, visible


def follow_quest(account_id, company_id, quest_id) -> dict:
    """フォロー（watch）を付ける（C.9・発見可能なクエストのみ・冪等）。"""
    iid = _parse_uuid(quest_id, field="quest_id")
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        user, _quest, _visible = _load_discoverable(ts, account_id, iid)
        repo.add_quest_follow(ts, iid, user.id)
        ts.commit()
    return {"following": True}


def unfollow_quest(account_id, company_id, quest_id) -> dict:
    """フォロー解除（冪等・解除は常に許可＝発見不可になった後でも外せる）。"""
    iid = _parse_uuid(quest_id, field="quest_id")
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        repo.remove_quest_follow(ts, iid, user.id)
        ts.commit()
    return {"following": False}


def request_join(account_id, company_id, quest_id, *, message=None) -> dict:
    """参加をリクエスト（C.9・pending 作成）。既 member は 409・重複 pending は 409・却下済みは再申請不可(409)。"""
    iid = _parse_uuid(quest_id, field="quest_id")
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        user, quest, _visible = _load_discoverable(ts, account_id, iid)
        if repo.get_active_member(ts, iid, user.id) is not None:
            raise AppError(409, "conflict", detail="すでに参加中です", extra={"errors": [{"reason": "already_member"}]})
        existing = repo.get_join_request(ts, iid, user.id)
        if existing is not None:
            if existing.status == "pending":
                raise AppError(409, "conflict", detail="すでに申請中です", extra={"errors": [{"reason": "already_requested"}]})
            if existing.status == "rejected":
                # 却下は作成者側の再承諾のみ＝申請者からの再申請は当面不可（§8-6）。
                raise AppError(409, "conflict", detail="この申請は却下されています", extra={"errors": [{"reason": "rejected"}]})
            # ここに来る approved は「承認後にパーティーから外された＝現在は非メンバー」（有効 member は上の
            # get_active_member ガードで 409 済み）。withdrawn（自分で取り下げ）と同様、行を再利用して
            # pending に戻す＝再申請には再承認が必要（remove_member は jr に触れないため・データフロー整合）。
            existing.status = "pending"
            existing.message = message
            existing.decided_at = None
            existing.decided_by_id = None
            jr = existing
        else:
            jr = repo.create_join_request(ts, iid, user.id, message)
        recipients = repo.list_owner_and_admin_ids(ts, quest)
        actor_name = user.display_name
        quest_title = quest.title
        # メール宛先＝作成者/quest_admin の account_id（申請者は除外）。管理DB の Account からメール解決。
        recips = [r for r in dict.fromkeys(recipients) if r != user.id]
        recipient_account_ids = [u.account_id for u in profile_repo.list_users_by_ids(ts, recips)]
        ts.commit()
    _notify_join_request_received(company_id, iid, recipients, [user.id], actor_name)
    _email_business_notify(company_id, recipient_account_ids, "join_request_received",
                           {"quest_title": quest_title, "actor_name": actor_name})
    return {"status": jr.status}


def withdraw_join_request(account_id, company_id, quest_id) -> None:
    """自分の申請を取り下げ（pending→withdrawn・C.9）。承認済みは 409。"""
    iid = _parse_uuid(quest_id, field="quest_id")
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        jr = repo.get_join_request(ts, iid, user.id)
        if jr is None or jr.status != "pending":
            if jr is not None and jr.status == "approved":
                raise AppError(409, "conflict", detail="承認済みのため取り下げできません", extra={"errors": [{"reason": "already_member"}]})
            raise AppError(404, "not_found")
        jr.status = "withdrawn"
        ts.commit()


def _notify_join_request_received(company_id, quest_id, recipients, exclude, actor_name) -> None:
    """参加リクエスト受信通知（H `join_request_received`・作成者+quest_admin・申請者除外・post-commit）。"""
    targets = [r for r in dict.fromkeys(recipients) if r not in set(exclude)]
    if not targets:
        return
    def _build(ts):
        refs = {"ref_quest_id": quest_id}
        return [notify_svc.entry(r, "join_request_received", refs=refs, params={"actor_name": actor_name}) for r in targets]
    notify_svc.dispatch(company_id, _build)


# ---- 受信側＝参加リクエストの承認/却下（C.9.1・SC-12 パーティータブ・owner/quest_admin）----

# 一覧の既定状態＝申請中（pending）＋却下済み（rejected）。承認済み(approved)は通常メンバー表示に統合。
_JOIN_REQUEST_DEFAULT_STATUSES = ("pending", "rejected")
# 表示順の並び＝pending 上位・rejected 下部（同状態内は申請日時 昇順）。
_JOIN_REQUEST_STATUS_RANK = {"pending": 0, "rejected": 1}


def list_join_requests(account_id, company_id, quest_id, *, statuses=None) -> dict:
    """参加リクエスト一覧（C.9.1・SC-12）＝owner/quest_admin のみ。申請者メタ（氏名/アバター/所属）付き。

    既定は pending+rejected。`statuses` 指定時はその状態のみ。並びは pending 上位→rejected 下部（申請日時昇順）。
    """
    iid = _parse_uuid(quest_id, field="quest_id")
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    wanted = list(statuses) if statuses else list(_JOIN_REQUEST_DEFAULT_STATUSES)
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        quest = repo.get_quest(ts, iid)
        if quest is None:
            raise AppError(404, "not_found")
        _authorize_edit(ts, quest, user)  # owner/quest_admin のみ（他は 403・下書き他人は 404）
        rows = repo.list_join_requests(ts, iid, wanted)
        uids = [r.user_id for r in rows]
        users = {u.id: u for u in profile_repo.list_users_by_ids(ts, uids)}
        membership = repo.all_active_group_ids_by_user(ts, uids)
        rows = sorted(rows, key=lambda r: (_JOIN_REQUEST_STATUS_RANK.get(r.status, 99), r.created_at))
        data = []
        for r in rows:
            u = users.get(r.user_id)
            data.append({
                "user": {
                    "user_id": str(r.user_id),
                    "display_name": u.display_name if u else "(unknown)",
                    "avatar_image_url": _image_url(u.avatar_image_path) if u else None,
                    "group_ids": [str(g) for g in membership.get(r.user_id, [])],
                },
                "status": r.status,
                "message": r.message,
                "created_at": r.created_at,
                "decided_at": r.decided_at,
            })
    return {"data": data}


def approve_join_request(account_id, company_id, quest_id, user_id) -> dict:
    """参加リクエストを承認（C.9.1）＝`pending`/`rejected`→`approved`＋同一 UoW で member 追加（既定権限）。

    認可＝owner/quest_admin。申請なし/取り下げ済みは 404（存在秘匿）。既に承認済みは 409 `already_member`。
    """
    iid = _parse_uuid(quest_id, field="quest_id")
    target_uid = _parse_uuid(user_id, field="user_id")
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        actor = profile_repo.get_user_by_account(ts, account_id)
        if actor is None:
            raise AppError(401, "unauthenticated")
        quest = repo.get_quest(ts, iid)
        if quest is None:
            raise AppError(404, "not_found")
        _authorize_edit(ts, quest, actor)
        jr = repo.get_join_request(ts, iid, target_uid)
        if jr is None or jr.status == "withdrawn":
            raise AppError(404, "not_found")
        if jr.status == "approved":
            raise AppError(409, "conflict", detail="すでに参加中です", extra={"errors": [{"reason": "already_member"}]})
        jr.status = "approved"
        jr.decided_at = datetime.now(timezone.utc)
        jr.decided_by_id = actor.id
        repo.add_member(ts, iid, target_uid, granted_by_id=actor.id)  # 既定権限（vote/idea_create/comment）
        actor_name = actor.display_name
        quest_title = quest.title
        applicant = next(iter(profile_repo.list_users_by_ids(ts, [target_uid])), None)
        applicant_account_id = applicant.account_id if applicant else None
        ts.commit()
    _notify_join_request_decided(company_id, iid, target_uid, "approved", actor_name)
    _email_business_notify(company_id, [applicant_account_id], "join_request_decided",
                           {"quest_title": quest_title, "result": "approved"})
    return {"status": "approved"}


def reject_join_request(account_id, company_id, quest_id, user_id) -> dict:
    """参加リクエストを却下（C.9.1・非終端）＝`pending`→`rejected`（行は残し後日 approve 可）。

    認可＝owner/quest_admin。申請なし/取り下げ済みは 404。承認済みは 409 `invalid_state`。既に却下済みは冪等 200。
    """
    iid = _parse_uuid(quest_id, field="quest_id")
    target_uid = _parse_uuid(user_id, field="user_id")
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        actor = profile_repo.get_user_by_account(ts, account_id)
        if actor is None:
            raise AppError(401, "unauthenticated")
        quest = repo.get_quest(ts, iid)
        if quest is None:
            raise AppError(404, "not_found")
        _authorize_edit(ts, quest, actor)
        jr = repo.get_join_request(ts, iid, target_uid)
        if jr is None or jr.status == "withdrawn":
            raise AppError(404, "not_found")
        if jr.status == "approved":
            raise AppError(409, "conflict", detail="承認済みのため却下できません", extra={"errors": [{"reason": "invalid_state"}]})
        if jr.status == "rejected":
            return {"status": "rejected"}  # 冪等（既に却下済み＝通知しない）
        jr.status = "rejected"
        jr.decided_at = datetime.now(timezone.utc)
        jr.decided_by_id = actor.id
        actor_name = actor.display_name
        quest_title = quest.title
        applicant = next(iter(profile_repo.list_users_by_ids(ts, [target_uid])), None)
        applicant_account_id = applicant.account_id if applicant else None
        ts.commit()
    _notify_join_request_decided(company_id, iid, target_uid, "rejected", actor_name)
    _email_business_notify(company_id, [applicant_account_id], "join_request_decided",
                           {"quest_title": quest_title, "result": "rejected"})
    return {"status": "rejected"}


def _notify_join_request_decided(company_id, quest_id, recipient_id, result, actor_name) -> None:
    """参加リクエスト結果通知（H `join_request_decided`・申請者へ・`result`=approved/rejected・post-commit）。"""
    if recipient_id is None:
        return
    def _build(ts):
        refs = {"ref_quest_id": quest_id}
        return [notify_svc.entry(recipient_id, "join_request_decided", refs=refs,
                                 params={"actor_name": actor_name, "result": result})]
    notify_svc.dispatch(company_id, _build)


def get_join_request_profile(account_id, company_id, quest_id, user_id) -> dict:
    """申請者プロフィール＝参加リクエスト承認の判断材料（C.9.1・owner/quest_admin のみ）。

    当該クエストに（pending/rejected の）申請がある user に限る（無ければ 404＝存在秘匿）。中核指標は常時、
    ゲーム層（3Dアバター/レベル/実績/ランキング）は **viewer のゲームモード ON 時のみ** 付与。
    """
    from app.control_plane.game_mode import resolve_effective_game_mode
    from app.tenant.achievements import repository as ach_repo
    from app.tenant.gamification import repository as gami_repo

    iid = _parse_uuid(quest_id, field="quest_id")
    target_uid = _parse_uuid(user_id, field="user_id")
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        actor = profile_repo.get_user_by_account(ts, account_id)
        if actor is None:
            raise AppError(401, "unauthenticated")
        quest = repo.get_quest(ts, iid)
        if quest is None:
            raise AppError(404, "not_found")
        _authorize_edit(ts, quest, actor)  # owner/quest_admin のみ
        jr = repo.get_join_request(ts, iid, target_uid)
        if jr is None or jr.status == "withdrawn":
            raise AppError(404, "not_found")  # 申請のない user のプロフィールは覗けない（存在秘匿）
        out = {
            "active_quest_count": len(repo.list_member_quest_ids(ts, target_uid)),
            "published_idea_count": ideas_repo.count_published_ideas_by_author(ts, target_uid),
            "chat_message_count": chat_repo.count_messages_by_author(ts, target_uid),
            "game": None,
        }
        if resolve_effective_game_mode(account_id, company_id):
            tu = next(iter(profile_repo.list_users_by_ids(ts, [target_uid])), None)
            # 総合ランキング（獲得 XP＋コイン・期間なし）での順位。全行走査は軽量（DTO/署名URL は作らない）。
            rows = gami_repo.aggregate_ranking(ts, start=None, end=None)
            idx = next((i for i, r in enumerate(rows) if r[0] == target_uid), None)
            out["game"] = {
                "avatar_base": (tu.avatar_base if tu else "male"),
                "level": (tu.level if tu else 1),
                "xp": (tu.xp if tu else 0),
                "rank": (idx + 1) if idx is not None else None,
                "rank_total": len(rows),
                "achievement_count": len(ach_repo.list_user_achievements(ts, target_uid)),
            }
    return out
