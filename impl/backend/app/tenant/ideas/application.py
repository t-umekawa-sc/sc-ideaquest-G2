"""ドメイン D（アイデア）の application（imperative shell・D.1/D.2）。

会社DB 動的解決（§1.5・company_id はセッション由来）→ テナントユーザー解決 → クエストのパーティー門番（C.0）を
満たす範囲で一覧/詳細/作成/編集/公開/削除を行う。作成は `idea_create` 権限、編集/公開/削除は投稿者本人 or
`owner`/`quest_admin`。公開処理（chat_groups 作成＝E／投稿 XP+50＝G／idea_updated 通知＝H）は各ドメイン実装まで
no-op フック＋TODO（C の H 通知と同方針）。本スライス＝添付(D.3)/投票(D.5)/フォロー(D.6)/版 GET(D.4) は後続。
"""
from __future__ import annotations

import base64
import binascii
import difflib
import uuid
from datetime import date, datetime, timezone

from app.control_plane.auth.orm import Company
from app.core.errors import AppError
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.ideas import repository as repo
from app.tenant.ideas.schemas import STATUS_VALUES
from app.tenant.notifications import service as notify_svc
from app.tenant.gamification import ledger
from app.tenant.gamification import repository as gami_repo
from app.tenant.gamification.daily import jst_day_bounds_utc
from app.tenant.profile import repository as profile_repo
from app.tenant.quests import repository as quests_repo

_EMPTY_PAGE = {"data": [], "page_info": {"next_cursor": None, "has_next": False}}

# XP 付与（§8-⑥）。投稿＝公開で+50（アイデア初回のみ・ref 冪等）／投票＝各アイデア初回のみ+5・日次上限5/日。
_XP_IDEA_POST = 50
_XP_VOTE = 5
_VOTE_XP_DAILY_CAP = 5


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
        from app.tenant.evaluations import application as evals_app  # 遅延 import（循環回避）
        from app.tenant.chat import repository as chat_repo
        eval_states = evals_app.eval_states_for_ideas(ts, quest, user, rows)  # F 評価集計（SC-12 評価列・D.1）
        comment_counts = chat_repo.count_active_messages_for_ideas(ts, [r.id for r in rows])  # E コメント数（💬）
        data = [_idea_card(ts, r, user.id, users, vote_counts, followed, eval_states, comment_counts) for r in rows]
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


# ---- 版・差分（D.4） ----


def get_revisions(account_id, company_id, idea_id, *, limit, cursor=None) -> dict:
    """版タイムライン（SC-22 更新履歴・D.4）。門番＝アイデア可視性（下書きは本人／パーティー所属）。範囲外 404。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    iid = _parse_uuid(idea_id, field="idea_id")
    cur = _decode_revision_cursor(cursor) if cursor else None
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        idea, _quest = _resolve_visible_idea(ts, iid, user)
        rows = repo.list_revisions(ts, idea.id, cursor=cur, limit=limit + 1)
        has_next = len(rows) > limit
        rows = rows[:limit]
        editors = quests_repo.get_users_by_ids(ts, {r.editor_id for r in rows})
        data = [_revision_dto(ts, idea.id, r, editors) for r in rows]
        next_cursor = _encode_revision_cursor(rows[-1].revision) if has_next and rows else None
    return {"data": data, "page_info": {"next_cursor": next_cursor, "has_next": has_next}}


def get_revision_diff(account_id, company_id, idea_id, revision, *, from_revision=None) -> dict:
    """版の差分（SC-22・D.4）。既定＝前版（revision-1）と比較。テキスト系は語句差分・その他は {old,new}。範囲外 404/422。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    iid = _parse_uuid(idea_id, field="idea_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        idea, _quest = _resolve_visible_idea(ts, iid, user)
        to_rev = repo.get_revision(ts, idea.id, revision)
        if to_rev is None:
            raise AppError(404, "not_found")  # 対象版が無い
        frm = from_revision if from_revision is not None else revision - 1
        if frm > revision:
            raise AppError(422, "validation_error", detail="from は revision 以下にしてください", errors=[{"field": "from"}])
        from_rev = repo.get_revision(ts, idea.id, frm) if frm >= 1 else None
        old = from_rev.changes if from_rev is not None else {}
        return {"from_revision": frm, "to_revision": revision, "fields": _diff_fields(old, to_rev.changes)}


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
            _publish_processing(ts, idea, user)
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
        _publish_processing(ts, idea, user)
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


# ---- 投票（D.5）・フォロー（D.6） ----


def _resolve_visible_idea(ts, iid, user):
    """アイデア＋クエストを解決し可視性門番を適用（範囲外 404）。投票/フォロー共通。"""
    idea = repo.get_idea(ts, iid)
    if idea is None:
        raise AppError(404, "not_found")
    if idea.status == "draft" and idea.author_id != user.id:
        raise AppError(404, "not_found")  # 下書きは本人のみ
    if quests_repo.get_active_member(ts, idea.quest_id, user.id) is None:
        raise AppError(404, "not_found")  # 非パーティーは秘匿（C.0）
    quest = quests_repo.get_quest(ts, idea.quest_id)
    return idea, quest


def _guard_votable(ts, idea, quest, user) -> None:
    """投票可否（D.5・サーバー強制）＝published＋未完了＋締切前＋vote 権限（owner は全権限）。"""
    if idea.status != "published":
        raise AppError(409, "conflict", detail="公開前のアイデアには投票できません", extra={"errors": [{"reason": "invalid_state"}]})
    _guard_not_completed(quest)
    if quest is not None and quest.deadline is not None and quest.deadline < date.today():
        raise AppError(409, "conflict", detail="締切後は投票できません", extra={"errors": [{"reason": "invalid_state"}]})
    if quest is not None and quest.owner_id == user.id:
        return
    member = quests_repo.get_active_member(ts, idea.quest_id, user.id)
    if member is None or "vote" not in quests_repo.get_permissions(ts, member.id):
        raise AppError(403, "forbidden", detail="投票の権限がありません")


def _award_vote_xp(ts, idea, user, created) -> bool:
    """投票 XP+5（各アイデア初回のみ・日次上限5/日・§8-⑥）。切替/取消/再投票では追加なし。

    冪等＝`activities(kind=xp_gain,reason=vote,ref_type=ideas,ref_id=idea_id)` の存在（投票行を消して再作成しても
    元帳は残るため二重付与しない）。日次上限は「初回投票が成立した回数」に効く（JST 日集計）。返り値＝付与したか。
    """
    if gami_repo.exists_ref(ts, user.id, ledger.XP_GAIN, "vote", "ideas", idea.id):
        return False
    start, end = jst_day_bounds_utc(datetime.now(timezone.utc))
    if gami_repo.count_reason_between(ts, user.id, "vote", start, end) >= _VOTE_XP_DAILY_CAP:
        return False
    ledger.grant(ts, user, kind=ledger.XP_GAIN, amount=_XP_VOTE, reason="vote",
                 ref_type="ideas", ref_id=idea.id, quest_id=idea.quest_id)
    return True


def vote_idea(account_id, company_id, idea_id, *, vote_type) -> dict:
    """投票を登録/切替（D.5・1人1票 upsert）。voted_revision を現版で更新（陳腐化解消）。返り値＝投票結果。"""
    iid = _parse_uuid(idea_id, field="idea_id")
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        idea, quest = _resolve_visible_idea(ts, iid, user)
        _guard_votable(ts, idea, quest, user)
        _, created = repo.upsert_vote(ts, idea.id, user.id, type=vote_type, voted_revision=idea.current_revision)
        xp_awarded = _award_vote_xp(ts, idea, user, created)
        vc = repo.count_votes(ts, idea.id)
        ts.commit()
    return {"my_vote": vote_type, "summary": {"approve": vc.get("approve", 0), "oppose": vc.get("oppose", 0)}, "xp_awarded": xp_awarded}


def remove_vote(account_id, company_id, idea_id) -> None:
    """投票を取消（D.5・冪等・XP は戻さない・§8-⑥）。完了後は 409。"""
    iid = _parse_uuid(idea_id, field="idea_id")
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        idea, quest = _resolve_visible_idea(ts, iid, user)
        _guard_not_completed(quest)
        repo.remove_vote(ts, idea.id, user.id)
        ts.commit()


def follow_idea(account_id, company_id, idea_id) -> None:
    """アイデアをフォロー（D.6・冪等）。門番＝パーティー所属（権限バッジ不問）。完了後の新規は 409。"""
    iid = _parse_uuid(idea_id, field="idea_id")
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        idea, quest = _resolve_visible_idea(ts, iid, user)
        _guard_not_completed(quest)  # 完了後の新規フォローは無意味＝409（D.6）
        repo.add_follow(ts, user.id, idea.id)
        ts.commit()


def unfollow_idea(account_id, company_id, idea_id) -> None:
    """フォロー解除（D.6・冪等）。完了後も許可（残存購読の後片付け・状態を汚さない）。"""
    iid = _parse_uuid(idea_id, field="idea_id")
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        idea, _quest = _resolve_visible_idea(ts, iid, user)
        repo.remove_follow(ts, user.id, idea.id)
        ts.commit()


# ---- 添付（D.3・§1.10・MinIO） ----


def add_attachments(account_id, company_id, idea_id, *, files) -> dict:
    """アイデアに添付を追加（D.3・multipart）。編集権限＝本人 or owner/quest_admin・完了は 409。

    files＝[(filename, data)]。全ファイルを先に検証（不正 1 件で保存しない）→ 件数上限（既存＋今回≤10）→
    storage.put ＋ DB 記帳。返り値＝追加後の添付一覧。
    """
    from app.infra.storage import MAX_ATTACHMENTS_PER_IDEA, get_storage, validate_attachment_upload

    iid = _parse_uuid(idea_id, field="idea_id")
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    if not files:
        raise AppError(422, "validation_error", detail="ファイルがありません", errors=[{"field": "files", "code": "empty"}])
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        idea = repo.get_idea(ts, iid)
        if idea is None:
            raise AppError(404, "not_found")
        quest = quests_repo.get_quest(ts, idea.quest_id)
        _authorize_edit_idea(ts, idea, quest, user)  # 本人 or owner/quest_admin（下書きは本人のみ可視）
        _guard_not_completed(quest)
        # 先に全件検証（不正で部分保存しない）＝拡張子 allowlist・サイズ・非空。mime は拡張子から導出。
        validated = [(fn, data, validate_attachment_upload(fn, data)) for (fn, data) in files]
        if repo.count_attachments(ts, idea.id) + len(validated) > MAX_ATTACHMENTS_PER_IDEA:
            raise AppError(422, "validation_error", detail=f"添付は1アイデア{MAX_ATTACHMENTS_PER_IDEA}件までです",
                           errors=[{"field": "files", "code": "too_many"}])
        storage = get_storage()
        for fn, data, mime in validated:
            key = storage.put(data, mime, prefix="idea-attachments")
            repo.add_attachment(ts, idea_id=idea.id, object_key=key, original_name=fn,
                                size_bytes=len(data), mime_type=mime, uploaded_by_id=user.id)
        ts.flush()
        result = {"attachments": _attachments_payload(ts, repo.list_attachments(ts, idea.id))}
        ts.commit()
    return result


def remove_attachment(account_id, company_id, idea_id, attachment_id) -> None:
    """添付を削除（D.3・編集権限・完了は 409）。DB 行削除＋MinIO オブジェクト削除（同一 UoW）。"""
    from app.infra.storage import get_storage

    iid = _parse_uuid(idea_id, field="idea_id")
    aid = _parse_uuid(attachment_id, field="attachment_id")
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
        att = repo.get_attachment(ts, aid)
        if att is None or att.idea_id != idea.id:
            raise AppError(404, "not_found")
        key = att.object_key
        repo.remove_attachment(ts, att)
        ts.flush()
        get_storage().remove(key)  # 失敗時は例外で UoW ロールバック（DB 行は残る）
        ts.commit()


def download_attachment(account_id, company_id, attachment_id) -> dict:
    """添付ダウンロード（D.3・§1.10）＝パーティー所属を検証し短TTL 署名URL を返す。範囲外は 404。"""
    from app.infra.storage import get_storage

    aid = _parse_uuid(attachment_id, field="attachment_id")
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        att = repo.get_attachment(ts, aid)
        if att is None:
            raise AppError(404, "not_found")
        # 添付の所属アイデアを解決＝アイデア添付（idea_id）／チャット添付（chat_message_id→chat_group→idea・E.3 共通 EP）。
        if att.idea_id is not None:
            idea = repo.get_idea(ts, att.idea_id)
        elif att.chat_message_id is not None:
            from app.tenant.chat import repository as chat_repo
            from app.tenant.chat.orm import ChatGroup

            msg = chat_repo.get_message(ts, att.chat_message_id)
            cg = ts.get(ChatGroup, msg.chat_group_id) if msg else None
            idea = repo.get_idea(ts, cg.idea_id) if cg else None
        else:
            raise AppError(404, "not_found")
        if idea is None:
            raise AppError(404, "not_found")
        if idea.status == "draft" and idea.author_id != user.id:
            raise AppError(404, "not_found")  # 下書きは本人のみ
        if quests_repo.get_active_member(ts, idea.quest_id, user.id) is None:
            raise AppError(404, "not_found")  # 非パーティーは秘匿（閲覧できる＝落とせる）
        return {"url": get_storage().presigned_get(att.object_key)}


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
    """公開中アイデアの保存ごとに1版（スナップショット）を追加し current_revision++（D.4）＋idea_updated 通知（H）。"""
    next_rev = idea.current_revision + 1
    rev = repo.add_revision(ts, idea.id, revision=next_rev, editor_id=editor_id, changes=_content_snapshot(ts, idea))
    idea.current_revision = next_rev
    _notify_idea_updated(ts, idea.id, rev.id, next_rev, editor_id)


def _notify_idea_updated(ts, idea_id, revision_id, revision, editor_id) -> None:
    """版追加時の idea_updated 通知（投票者＋フォロワー・編集者除く・FR-34/H.0）。編集と同一 UoW（取りこぼしなし）。"""
    recipients = (repo.list_voter_ids(ts, idea_id) | repo.list_follower_ids(ts, idea_id)) - {editor_id}
    if not recipients:
        return
    refs = {"ref_idea_id": idea_id, "ref_idea_revision_id": revision_id}
    notify_svc.notify(ts, [
        notify_svc.entry(r, "idea_updated", refs=refs, params={"revision": revision}) for r in recipients
    ])


def _content_snapshot(ts, idea) -> dict:
    """版に保存する対象フィールドの全値スナップショット（§8-⑤・D.4 line101）。"""
    return {
        "title": idea.title, "value": idea.value, "body": idea.body,
        "time_limit": idea.time_limit.isoformat() if idea.time_limit else None,
        "note": idea.note,
        "stakeholders": [{"label": s.label, "is_custom": s.is_custom} for s in repo.list_stakeholders(ts, idea.id)],
    }


# 版で追跡する対象フィールド（D.4・§5.14）。テキスト系＝語句差分、その他＝{old,new}。
_TEXT_FIELDS = ("title", "value", "body", "note")
_TRACKED_FIELDS = ("title", "value", "body", "time_limit", "note", "stakeholders")


def _encode_revision_cursor(revision: int) -> str:
    return base64.urlsafe_b64encode(f"rev|{revision}".encode()).decode()


def _decode_revision_cursor(cursor: str) -> int:
    try:
        prefix, rev = base64.urlsafe_b64decode(cursor.encode()).decode().split("|", 1)
        if prefix != "rev":
            raise ValueError
        return int(rev)
    except (binascii.Error, ValueError, UnicodeDecodeError):
        raise AppError(422, "validation_error", detail="cursor が不正です", errors=[{"field": "cursor"}])


def _revision_dto(ts, idea_id, rev, editors) -> dict:
    """版タイムラインの1行（D.4）。changed_fields＝前版比較で変わったフィールド（初版は空）。"""
    prev = repo.get_revision(ts, idea_id, rev.revision - 1) if rev.revision > 1 else None
    changed = _changed_fields(prev.changes if prev is not None else None, rev.changes)
    return {
        "revision": rev.revision,
        "editor": _author_dto(editors.get(rev.editor_id), rev.editor_id),
        "created_at": rev.created_at,
        "changed_fields": changed,
        "memo": rev.memo,
    }


def _changed_fields(old: dict | None, new: dict) -> list[str]:
    """前版スナップショット比較で変わったフィールド名（初版＝old None は空・D.4）。"""
    if old is None:
        return []
    return [f for f in _TRACKED_FIELDS if old.get(f) != new.get(f)]


def _diff_fields(old: dict, new: dict) -> dict:
    """2版のスナップショットから、変わったフィールドの差分を算出（D.4）。

    テキスト系（title/value/body/note）＝語句（文字）差分の add/del/equal セグメント。
    その他（time_limit/stakeholders）＝`{old,new}`（stakeholders はラベルを「・」連結）。
    """
    result: dict[str, dict] = {}
    for f in _TRACKED_FIELDS:
        ov, nv = old.get(f), new.get(f)
        if ov == nv:
            continue
        if f in _TEXT_FIELDS:
            result[f] = {"kind": "text", "segments": _text_diff_segments(ov or "", nv or "")}
        elif f == "stakeholders":
            result[f] = {"kind": "scalar", "old": _stakeholders_str(ov), "new": _stakeholders_str(nv)}
        else:  # time_limit
            result[f] = {"kind": "scalar", "old": ov, "new": nv}
    return result


def _text_diff_segments(old: str, new: str) -> list[dict]:
    """文字単位の差分セグメント（equal/add/del）。日本語対応のため文字レベル SequenceMatcher（D.4・語句差分は D.8）。"""
    sm = difflib.SequenceMatcher(a=old, b=new, autojunk=False)
    segments: list[dict] = []
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op == "equal":
            segments.append({"op": "equal", "text": old[i1:i2]})
        elif op == "delete":
            segments.append({"op": "del", "text": old[i1:i2]})
        elif op == "insert":
            segments.append({"op": "add", "text": new[j1:j2]})
        elif op == "replace":
            segments.append({"op": "del", "text": old[i1:i2]})
            segments.append({"op": "add", "text": new[j1:j2]})
    return segments


def _stakeholders_str(value) -> str:
    """利害関係者スナップショット（[{label,is_custom}]）を表示用の「・」連結ラベルに。"""
    if not value:
        return ""
    return "・".join((s.get("label") or "") for s in value)


def _publish_processing(ts, idea, user) -> None:
    """公開の瞬間の処理（D.2/D.4/E/G）。初版 revision=1 記録（通知なし）＋チャットグループ作成（E・1:1）＋投稿 XP+50。

    冪等は status 遷移（再 publish は 409）＋chat_groups の `UNIQUE(idea_id)`＋XP は ref 存在チェック
    （`reason=idea_post,ref_type=ideas,ref_id=idea_id`）で担保（多重呼びでも二重付与しない）。
    """
    _record_initial_revision(ts, idea, user.id)
    from app.tenant.chat import repository as chat_repo

    chat_repo.ensure_chat_group(ts, idea.id)  # E＝アイデアと 1:1（§5.15・公開時に自動作成）
    # 投稿 XP+50（G・§8-⑥・アイデア初回公開のみ）。付与先＝投稿者（idea.author_id＝公開者 user）。
    if not gami_repo.exists_ref(ts, user.id, ledger.XP_GAIN, "idea_post", "ideas", idea.id):
        ledger.grant(ts, user, kind=ledger.XP_GAIN, amount=_XP_IDEA_POST, reason="idea_post",
                     ref_type="ideas", ref_id=idea.id, quest_id=idea.quest_id)


def _record_initial_revision(ts, idea, editor_id) -> None:
    """公開処理の同一 UoW で初版 revision=1 を記録（D.4 line104・決定 2026-08-06）。

    差分の起点（`diff` の `from` 既定）と `votes.voted_revision` 判定の基準を revision=1 で常に存在させるため。
    `ideas.current_revision` は既定 1 のまま（インクリメントしない）。**通知は発火しない**（公開自体の通知は D の公開処理）。
    """
    repo.add_revision(ts, idea.id, revision=idea.current_revision, editor_id=editor_id, changes=_content_snapshot(ts, idea))


def _idea_card(ts, idea, viewer_id, users, vote_counts, followed, eval_states=None, comment_counts=None) -> dict:
    author = users.get(idea.author_id)
    my_vote = repo.get_vote(ts, idea.id, viewer_id)
    vc = vote_counts.get(idea.id, {"approve": 0, "oppose": 0})
    ev = (eval_states or {}).get(idea.id) or {"state": "pending", "overall_avg": None, "evaluator_count": 0}
    return {
        "evaluation": ev,  # SC-12 評価列（F 集計・D.1）＝state/overall_avg(n/5)/evaluator_count
        "id": str(idea.id),
        "title": idea.title,
        "status": idea.status,
        "author": _author_dto(author, idea.author_id),
        "vote_summary": {"approve": vc.get("approve", 0), "oppose": vc.get("oppose", 0)},
        "comment_count": (comment_counts or {}).get(idea.id, 0),  # E 非削除チャット件数（💬・D.1）
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
    # クエスト参照（SC-22 の「クエストへ戻る」導線・カテゴリーバッジ・凍結〔completed〕判定・D.1）。
    quest = quests_repo.get_quest(ts, idea.quest_id)
    quest_cats = [c.label for c in quests_repo.list_categories(ts, idea.quest_id)]
    quest_ref = {
        "id": str(idea.quest_id),
        "title": quest.title if quest else "",
        "status": quest.status if quest else "",
        "categories": quest_cats,
        "deadline": quest.deadline if quest else None,
    }
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
        "quest": quest_ref,
        "attachments": _attachments_payload(ts, repo.list_attachments(ts, idea.id)),
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


def _attachments_payload(ts, atts) -> list[dict]:
    """添付メタ配列を DTO 化（D.3・uploaded_by は表示用ユーザー・object_key 等は非露出）。"""
    uploader_ids = {a.uploaded_by_id for a in atts}
    users = quests_repo.get_users_by_ids(ts, uploader_ids) if uploader_ids else {}
    return [
        {
            "id": str(a.id),
            "original_name": a.original_name,
            "size_bytes": a.size_bytes,
            "mime_type": a.mime_type,
            "uploaded_by": _author_dto(users.get(a.uploaded_by_id), a.uploaded_by_id),
            "uploaded_at": a.uploaded_at,
        }
        for a in atts
    ]
