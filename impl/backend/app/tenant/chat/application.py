"""ドメイン E（チャット）の application（imperative shell・E.1〜E.5）。

門番＝当該アイデアのクエストのパーティー所属（C.0）＋投稿/編集/削除は各権限（comment／本人／管理者）。
投稿 XP+5 は G ledger（日次上限10/日）。通知（H）・リアルタイム（L）は post-commit no-op フック。完了は 409（C.5）。
本コミットはコア会話（メッセージ CRUD・既読・活発度・添付・メンション）。リアクション/魔法の書込は後続。
"""
from __future__ import annotations

import base64
import binascii
import uuid
from datetime import datetime, timedelta, timezone

from app.control_plane.auth.orm import Company
from app.core.errors import AppError
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.chat import repository as repo
from app.tenant.gamification import ledger
from app.tenant.gamification import repository as gami_repo
from app.tenant.ideas import repository as ideas_repo
from app.tenant.notifications import service as notify_svc
from app.tenant.realtime import events as realtime_events
from app.tenant.profile import repository as profile_repo
from app.tenant.profile.orm import User
from app.tenant.quests import repository as quests_repo

_XP_CHAT = 5
_CHAT_XP_DAILY_CAP = 10
_JST = timezone(timedelta(hours=9))
_EXCERPT = 60


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


def _encode_cursor(m) -> str:
    return base64.urlsafe_b64encode(f"{m.created_at.isoformat()}|{m.id}".encode()).decode()


def _decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        created, mid = base64.urlsafe_b64decode(cursor.encode()).decode().split("|", 1)
        return datetime.fromisoformat(created), uuid.UUID(mid)
    except (binascii.Error, ValueError, UnicodeDecodeError):
        raise AppError(422, "validation_error", detail="cursor が不正です", errors=[{"field": "cursor"}])


# ---- 取得（E.1） ----


def get_chat(account_id, company_id, idea_id, *, limit=50, before=None, after=None) -> dict:
    """アイデアのチャット（SC-24・E.1）。門番＝パーティー所属。未読情報（chat_reads 基準）も返す。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    iid = _parse_uuid(idea_id, field="idea_id")
    before_c = _decode_cursor(before) if before else None
    after_c = _decode_cursor(after) if after else None
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        idea, _quest = _resolve_chat_idea(ts, iid, user)
        cg = repo.ensure_chat_group(ts, idea.id)
        rows, has_more = repo.list_messages(ts, cg.id, before=before_c, after=after_c, limit=limit)
        data = _messages_payload(ts, rows, viewer_id=user.id)
        # 未読（chat_reads 基準・E.5）。
        read = repo.get_read(ts, cg.id, user.id)
        read_cursor = _read_cursor(ts, read)
        first_unread = repo.first_message_after(ts, cg.id, read_cursor)
        unread = {
            "first_unread_message_id": str(first_unread.id) if first_unread else None,
            "unread_count": repo.count_messages_after(ts, cg.id, read_cursor),
        }
        next_cursor = _encode_cursor(rows[0]) if (has_more and rows and after_c is None) else (
            _encode_cursor(rows[-1]) if (has_more and rows and after_c is not None) else None)
        ts.commit()  # ensure_chat_group の遅延生成を確定
    return {"chat_group_id": str(cg.id), "data": data, "page_info": {"next_cursor": next_cursor, "has_next": has_more}, "unread": unread}


def get_chat_activity(account_id, company_id, idea_id, *, days=14) -> dict:
    """議論アクティビティ集計（SC-22 §4.4・D から委譲・E.1）。日次メッセージ数＋版マーカー。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    iid = _parse_uuid(idea_id, field="idea_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        idea, _quest = _resolve_chat_idea(ts, iid, user)
        cg = repo.get_chat_group_by_idea(ts, idea.id)
        since = datetime.now(timezone.utc) - timedelta(days=days)
        daily = [{"date": d.date().isoformat(), "message_count": n} for d, n in
                 (repo.daily_message_counts(ts, cg.id, since) if cg else [])]
        markers = [{"date": r.created_at.date().isoformat(), "revision": r.revision}
                   for r in ideas_repo.list_revisions(ts, idea.id)]
        total = repo.count_active_messages(ts, cg.id) if cg else 0
    return {"daily": daily, "revision_markers": markers, "total_messages": total}


# ---- 投稿・編集・削除（E.2） ----


def post_message(account_id, company_id, *, idea_id, body, quoted_message_ids, mention_ids, files) -> dict:
    """メッセージ投稿（multipart・E.2）。本文/メンション/引用（複数可）/添付を単一 UoW。空は 422。投稿 XP+5（日次上限）。"""
    from app.infra.storage import MAX_ATTACHMENTS_PER_IDEA, get_storage, validate_attachment_upload

    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    iid = _parse_uuid(idea_id, field="idea_id")
    body = (body or "").strip()
    if not body and not files:
        raise AppError(422, "validation_error", detail="本文か添付が必要です", errors=[{"field": "body", "code": "empty_message"}])
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        idea, quest = _resolve_chat_idea(ts, iid, user)
        _guard_not_completed(quest)
        _require_comment(ts, quest, user)
        cg = repo.ensure_chat_group(ts, idea.id)
        quote_ids = _validate_quotes(ts, cg.id, quoted_message_ids)
        mentions = _validate_mentions(ts, quest, mention_ids)
        # 添付は先に全件検証（不正で部分保存しない）。
        validated = [(fn, data, validate_attachment_upload(fn, len(data))) for (fn, data) in (files or [])]
        if len(validated) > MAX_ATTACHMENTS_PER_IDEA:
            raise AppError(422, "validation_error", detail=f"添付は1メッセージ{MAX_ATTACHMENTS_PER_IDEA}件までです",
                           errors=[{"field": "files", "code": "too_many"}])
        msg = repo.create_message(ts, chat_group_id=cg.id, author_id=user.id, body=body)
        if quote_ids:
            repo.add_quotes(ts, msg.id, quote_ids)
        if mentions:
            repo.replace_mentions(ts, msg.id, mentions)
        if validated:
            storage = get_storage()
            for fn, data, mime in validated:
                key = storage.put(data, mime, prefix="chat-attachments")
                repo.add_chat_attachment(ts, chat_message_id=msg.id, object_key=key, original_name=fn,
                                         size_bytes=len(data), mime_type=mime, uploaded_by_id=user.id)
        _award_chat_xp(ts, user, msg.id, idea.quest_id)
        payload = _messages_payload(ts, [msg], viewer_id=user.id)[0]
        ts.commit()
    _notify_message_posted(company_id, idea.id, msg.id)
    realtime_events.publish_event(realtime_events.chat_topic(cg.id), "chat.message.created",
                                  payload, company_id=company_id)  # 即時反映（L.3）
    return payload


def edit_message(account_id, company_id, message_id, *, body, mention_ids, files, remove_attachment_ids) -> dict:
    """自分のメッセージを編集（E.2・本人のみ）。本文上書き＋is_edited・メンション置換・添付追加/除去。完了は 409。"""
    from app.infra.storage import MAX_ATTACHMENTS_PER_IDEA, get_storage, validate_attachment_upload

    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    mid = _parse_uuid(message_id, field="message_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        msg, idea, quest, cg = _resolve_message(ts, mid, user)
        _guard_not_completed(quest)
        if msg.is_deleted:
            raise AppError(409, "conflict", detail="削除済みのメッセージは編集できません", extra={"errors": [{"reason": "invalid_state"}]})
        if msg.author_id != user.id:
            raise AppError(403, "forbidden", detail="自分のメッセージのみ編集できます")
        # 添付の除去。
        for aid in (remove_attachment_ids or []):
            att = repo.get_attachment(ts, _parse_uuid(aid, field="remove_attachment_ids"))
            if att is not None and att.chat_message_id == msg.id:
                repo.remove_attachment(ts, att)
        ts.flush()
        # 添付の追加（件数上限＝既存＋今回≤10）。
        validated = [(fn, data, validate_attachment_upload(fn, len(data))) for (fn, data) in (files or [])]
        if len(repo.list_attachments_for_message(ts, msg.id)) + len(validated) > MAX_ATTACHMENTS_PER_IDEA:
            raise AppError(422, "validation_error", detail=f"添付は1メッセージ{MAX_ATTACHMENTS_PER_IDEA}件までです",
                           errors=[{"field": "files", "code": "too_many"}])
        if body is not None:
            new_body = body.strip()
            if not new_body and not repo.list_attachments_for_message(ts, msg.id) and not validated:
                raise AppError(422, "validation_error", detail="本文か添付が必要です", errors=[{"field": "body", "code": "empty_message"}])
            msg.body = new_body
        if mention_ids is not None:
            repo.replace_mentions(ts, msg.id, _validate_mentions(ts, quest, mention_ids))
        if validated:
            storage = get_storage()
            for fn, data, mime in validated:
                key = storage.put(data, mime, prefix="chat-attachments")
                repo.add_chat_attachment(ts, chat_message_id=msg.id, object_key=key, original_name=fn,
                                         size_bytes=len(data), mime_type=mime, uploaded_by_id=user.id)
        msg.is_edited = True
        msg.updated_at = datetime.now(timezone.utc)
        payload = _messages_payload(ts, [msg], viewer_id=user.id)[0]
        ts.commit()
    _notify_message_updated(idea.id, msg.id)
    realtime_events.publish_event(realtime_events.chat_topic(cg.id), "chat.message.updated",
                                  payload, company_id=company_id)  # 即時反映（L.3）
    return payload


def delete_message(account_id, company_id, message_id) -> dict:
    """メッセージを論理削除（E.2・本人＋owner/quest_admin）。トゥームストーン化。完了は 409。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    mid = _parse_uuid(message_id, field="message_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        msg, idea, quest, cg = _resolve_message(ts, mid, user)
        _guard_not_completed(quest)
        if msg.is_deleted:
            raise AppError(409, "conflict", detail="削除済みのメッセージです", extra={"errors": [{"reason": "invalid_state"}]})
        if not _can_delete(ts, quest, msg, user):
            raise AppError(403, "forbidden", detail="このメッセージを削除する権限がありません")
        msg.is_deleted = True
        msg.deleted_by_id = user.id
        msg.deleted_at = datetime.now(timezone.utc)
        ts.commit()
    _notify_message_deleted(idea.id, msg.id)
    tombstone = {"id": str(msg.id), "is_deleted": True,
                 "deleted_at": msg.deleted_at.isoformat() if msg.deleted_at else None}
    realtime_events.publish_event(realtime_events.chat_topic(cg.id), "chat.message.deleted",
                                  tombstone, company_id=company_id)  # トゥームストーン即時反映（L.3）
    return {"id": str(msg.id), "is_deleted": True, "deleted_at": msg.deleted_at}


def mark_read(account_id, company_id, idea_id, *, last_read_message_id) -> dict:
    """既読位置を更新（E.5・後退防止 upsert）。完了後も許可（読み取り系の副作用）。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    iid = _parse_uuid(idea_id, field="idea_id")
    lrid = _parse_uuid(last_read_message_id, field="last_read_message_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        idea, _quest = _resolve_chat_idea(ts, iid, user)
        cg = repo.ensure_chat_group(ts, idea.id)
        target = repo.get_message(ts, lrid)
        if target is None or target.chat_group_id != cg.id:
            raise AppError(404, "not_found")
        # 後退防止＝既存 last_read より新しい位置のみ前進。
        cur = repo.get_read(ts, cg.id, user.id)
        cur_cursor = _read_cursor(ts, cur)
        if cur_cursor is None or (target.created_at, target.id) > cur_cursor:
            repo.upsert_read(ts, cg.id, user.id, target.id)
        ts.commit()
    return {"last_read_message_id": str(lrid), "unread_count": 0}


# ---- リアクション（通常＋魔法・E.4） ----


def add_reaction(account_id, company_id, message_id, *, type, emoji=None, spell_id=None) -> dict:
    """リアクション付与（E.4）。通常＝絵文字マスタ／魔法＝解放済み＋1メッセージ1魔法＋1チャット1回。完了は 409。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    mid = _parse_uuid(message_id, field="message_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        msg, idea, quest, cg = _resolve_message(ts, mid, user)
        _guard_not_completed(quest)
        if msg.is_deleted:
            raise AppError(409, "conflict", detail="削除済みのメッセージです", extra={"errors": [{"reason": "invalid_state"}]})
        if type == "normal":
            if not emoji or repo.get_active_emoji(ts, emoji) is None:
                raise AppError(422, "validation_error", detail="使用できない絵文字です", errors=[{"field": "emoji", "code": "invalid_reaction_emoji"}])
            if repo.get_normal_reaction(ts, msg.id, user.id, emoji) is None:  # 同一ユーザー×同一絵文字は冪等
                repo.add_reaction(ts, chat_message_id=msg.id, chat_group_id=cg.id, user_id=user.id, type="normal", emoji=emoji)
        elif type == "magic":
            sid = _parse_uuid(str(spell_id), field="spell_id")
            if repo.get_spell(ts, sid) is None:
                raise AppError(404, "not_found")
            if not repo.is_spell_unlocked(ts, user.id, sid):
                raise AppError(403, "forbidden", detail="この魔法は未解放です", extra={"errors": [{"reason": "spell_not_unlocked"}]})
            if repo.get_magic_reaction_of_message(ts, msg.id) is not None:
                raise AppError(409, "conflict", detail="このメッセージには既に魔法が付いています", extra={"errors": [{"reason": "message_already_has_magic"}]})
            if repo.get_user_magic_in_group(ts, cg.id, user.id, sid) is not None:
                raise AppError(409, "conflict", detail="この魔法はこのチャットで既に使用済みです", extra={"errors": [{"reason": "spell_already_used_in_chat"}]})
            repo.add_reaction(ts, chat_message_id=msg.id, chat_group_id=cg.id, user_id=user.id, type="magic", spell_id=sid)
            magic_spell_id = sid
        else:
            raise AppError(422, "validation_error", detail="type が不正です", errors=[{"field": "type"}])
        result = {"reactions": _message_reactions(ts, msg, user.id)}
        author_id = msg.author_id
        ts.commit()
    if type == "magic":
        _notify_reaction(company_id, idea.id, msg.id, author_id, user.id, magic_spell_id)
    realtime_events.publish_event(
        realtime_events.chat_topic(cg.id), "chat.reaction.added",
        {"message_id": str(msg.id), "reactions": result["reactions"]}, company_id=company_id)  # L.3
    return result


def remove_reaction(account_id, company_id, message_id, *, emoji=None, magic=False) -> dict:
    """リアクション取消（E.4・自分の分のみ）。通常＝emoji／魔法＝type=magic。完了は 409。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    mid = _parse_uuid(message_id, field="message_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        msg, _idea, quest, cg = _resolve_message(ts, mid, user)
        _guard_not_completed(quest)
        if magic:
            r = repo.get_magic_reaction_of_message(ts, msg.id)
            if r is not None and r.user_id == user.id:  # 他人の魔法は取消不可
                repo.remove_reaction(ts, r)
        elif emoji:
            r = repo.get_normal_reaction(ts, msg.id, user.id, emoji)
            if r is not None:
                repo.remove_reaction(ts, r)
        result = {"reactions": _message_reactions(ts, msg, user.id)}
        ts.commit()
    realtime_events.publish_event(
        realtime_events.chat_topic(cg.id), "chat.reaction.removed",
        {"message_id": str(msg.id), "reactions": result["reactions"]}, company_id=company_id)  # L.3
    return result


def _message_reactions(ts, msg, viewer_id) -> dict:
    """当該メッセージのリアクション集計（E.1 の reactions 形）。"""
    rs = repo.list_reactions_for_messages(ts, [msg.id]).get(msg.id, [])
    users = quests_repo.get_users_by_ids(ts, {r.user_id for r in rs}) if rs else {}
    spells = {s.id: s for s in repo.list_spells(ts)}
    return _reactions_dto(rs, viewer_id, users, spells)


def _notify_reaction(company_id, idea_id, message_id, author_id, reactor_id, spell_id) -> None:
    """魔法リアクション付与時の magic_reaction 通知（対象メッセージの投稿者宛・H.0/E.6）。post-commit。

    自分のメッセージへの自分の魔法は通知しない（宛先＝投稿者・reactor 除く）。魔法名は識別子を凍結（取得時解決・H.1）。
    """
    def _build(ts):
        if author_id == reactor_id:
            return []
        actor = ts.get(User, reactor_id)
        return [notify_svc.entry(
            author_id, "magic_reaction",
            refs={"ref_idea_id": idea_id, "ref_chat_message_id": message_id},
            params={"actor_name": actor.display_name if actor else None, "spell_id": str(spell_id)},
        )]

    notify_svc.dispatch(company_id, _build)


# ---- ドメイン関数（門番・認可・検証・表現） ----


def _resolve_chat_idea(ts, iid, user):
    """公開アイデア＋クエストを解決し門番を適用（draft/不在/非パーティーは 404・E.0）。"""
    idea = ideas_repo.get_idea(ts, iid)
    if idea is None or idea.status != "published":
        raise AppError(404, "not_found")  # 未公開アイデアにチャットは無い
    if quests_repo.get_active_member(ts, idea.quest_id, user.id) is None:
        raise AppError(404, "not_found")  # 非パーティーは秘匿（C.0）
    quest = quests_repo.get_quest(ts, idea.quest_id)
    return idea, quest


def _resolve_message(ts, mid, user):
    """メッセージ→チャット→アイデア→クエストを解決し門番を適用。返り値＝(msg, idea, quest, chat_group)。"""
    from app.tenant.chat.orm import ChatGroup

    msg = repo.get_message(ts, mid)
    if msg is None:
        raise AppError(404, "not_found")
    cg = ts.get(ChatGroup, msg.chat_group_id)
    if cg is None:
        raise AppError(404, "not_found")
    idea, quest = _resolve_chat_idea(ts, cg.idea_id, user)
    return msg, idea, quest, cg


def _perms_of(ts, quest, user) -> list[str]:
    member = quests_repo.get_active_member(ts, quest.id, user.id) if quest is not None else None
    return quests_repo.get_permissions(ts, member.id) if member is not None else []


def _require_comment(ts, quest, user) -> None:
    if quest is not None and quest.owner_id == user.id:
        return
    if "comment" not in _perms_of(ts, quest, user):
        raise AppError(403, "forbidden", detail="投稿するにはコメント権限が必要です")


def _can_delete(ts, quest, msg, user) -> bool:
    if msg.author_id == user.id:
        return True
    if quest is not None and quest.owner_id == user.id:
        return True
    return "quest_admin" in _perms_of(ts, quest, user)


def _guard_not_completed(quest) -> None:
    if quest is not None and quest.status == "completed":
        raise AppError(409, "conflict", detail="完了後は変更できません", extra={"errors": [{"reason": "invalid_state"}]})


def _validate_quotes(ts, chat_group_id, quoted_message_ids) -> list[uuid.UUID]:
    """引用元（複数可）を検証（E.2）。各引用元は同一 chat_group 内のみ（他は 422）。重複は集約。"""
    result: list[uuid.UUID] = []
    seen: set[uuid.UUID] = set()
    for raw in (quoted_message_ids or []):
        rid = _parse_uuid(str(raw), field="quoted_message_ids")
        if rid in seen:
            continue
        src = repo.get_message(ts, rid)
        if src is None or src.chat_group_id != chat_group_id:
            raise AppError(422, "validation_error", detail="引用元が不正です", errors=[{"field": "quoted_message_ids"}])
        seen.add(rid)
        result.append(rid)
    return result


def _validate_mentions(ts, quest, mention_ids) -> list[uuid.UUID]:
    """メンションは当該パーティーのメンバーに限定（非メンバーは 422 invalid_mention・E.2）。"""
    result: list[uuid.UUID] = []
    for raw in (mention_ids or []):
        uid = _parse_uuid(raw, field="mentions")
        is_member = quests_repo.get_active_member(ts, quest.id, uid) is not None or (quest is not None and quest.owner_id == uid)
        if not is_member:
            raise AppError(422, "validation_error", detail="パーティー外のユーザーはメンションできません", errors=[{"field": "mentions", "code": "invalid_mention"}])
        result.append(uid)
    return result


def _award_chat_xp(ts, user, message_id, quest_id) -> None:
    """投稿 XP+5（日次上限 10/日・JST 日・§8-⑥）。上限到達後は付与なしで成功。"""
    now = datetime.now(timezone.utc)
    start_jst = now.astimezone(_JST).replace(hour=0, minute=0, second=0, microsecond=0)
    start = start_jst.astimezone(timezone.utc)
    if gami_repo.count_reason_between(ts, user.id, "chat", start, start + timedelta(days=1)) >= _CHAT_XP_DAILY_CAP:
        return
    ledger.grant(ts, user, kind=ledger.XP_GAIN, amount=_XP_CHAT, reason="chat",
                 ref_type="chat_messages", ref_id=message_id, quest_id=quest_id)


def _read_cursor(ts, read):
    """chat_reads の last_read_message_id を (created_at, id) カーソルへ。行/参照が無ければ None（全件未読）。"""
    if read is None or read.last_read_message_id is None:
        return None
    m = repo.get_message(ts, read.last_read_message_id)
    return (m.created_at, m.id) if m is not None else None


def _messages_payload(ts, messages, *, viewer_id) -> list[dict]:
    """メッセージ表現の配列（E.1）。削除済みはトゥームストーン化。author/attachments/mentions/reactions を合成。"""
    active = [m for m in messages if not m.is_deleted]
    ids = [m.id for m in active]
    # 引用返信（複数可）の解決（同一グループ内・抜粋 or トゥームストーン）。
    quotes_map = repo.get_quotes_for_messages(ts, ids)  # message_id -> [quoted_id]
    quoted_ids = {qid for qs in quotes_map.values() for qid in qs}
    quoted_msgs = {qid: repo.get_message(ts, qid) for qid in quoted_ids}
    author_ids = {m.author_id for m in active} | {q.author_id for q in quoted_msgs.values() if q is not None}
    atts = repo.get_attachments_for_messages(ts, ids)
    mentions = repo.get_mentions_for_messages(ts, ids)
    reactions = repo.list_reactions_for_messages(ts, ids)
    for rs in reactions.values():
        author_ids |= {r.user_id for r in rs}
    mention_uids = {u for us in mentions.values() for u in us}
    users = quests_repo.get_users_by_ids(ts, author_ids | mention_uids)
    spells = {s.id: s for s in repo.list_spells(ts)}

    out = []
    for m in messages:
        if m.is_deleted:
            out.append({"id": str(m.id), "is_deleted": True, "deleted_at": m.deleted_at, "created_at": m.created_at})
            continue
        quotes = []
        for qid in quotes_map.get(m.id, []):
            src = quoted_msgs.get(qid)
            if src is None:
                quotes.append({"id": str(qid), "author_name": "", "excerpt": "（削除された投稿）"})
            elif src.is_deleted:
                quotes.append({"id": str(src.id), "author_name": "", "excerpt": "このメッセージは削除されました"})
            else:
                a = users.get(src.author_id)
                quotes.append({"id": str(src.id), "author_name": (a.display_name if a else ""), "excerpt": src.body[:_EXCERPT]})
        out.append({
            "id": str(m.id),
            "author": _author_dto(users.get(m.author_id), m.author_id),
            "is_mine": m.author_id == viewer_id,
            "body": m.body,
            "created_at": m.created_at,
            "is_edited": m.is_edited,
            "is_deleted": False,
            "quotes": quotes,
            "attachments": [_attachment_dto(a) for a in atts.get(m.id, [])],
            "mentions": [{"user_id": str(u), "name": (users.get(u).display_name if users.get(u) else "")} for u in mentions.get(m.id, [])],
            "reactions": _reactions_dto(reactions.get(m.id, []), viewer_id, users, spells),
        })
    return out


def _attachment_dto(a) -> dict:
    return {
        "id": str(a.id),
        "original_name": a.original_name,
        "size_bytes": a.size_bytes,
        "mime_type": a.mime_type,
        "kind": "image" if (a.mime_type or "").startswith("image/") else "file",
    }


def _reactions_dto(rs, viewer_id, users, spells) -> dict:
    """{normal:[{emoji,count,reacted_by_me,users}], magic:{spell_id,effect,icon,actor}|null}（E.1）。"""
    normal: dict[str, dict] = {}
    magic = None
    for r in rs:
        if r.type == "normal" and r.emoji:
            g = normal.setdefault(r.emoji, {"emoji": r.emoji, "count": 0, "reacted_by_me": False, "users": []})
            g["count"] += 1
            if r.user_id == viewer_id:
                g["reacted_by_me"] = True
            u = users.get(r.user_id)
            g["users"].append(u.display_name if u else "")
        elif r.type == "magic" and r.spell_id:
            sp = spells.get(r.spell_id)
            actor = users.get(r.user_id)
            magic = {
                "spell_id": str(r.spell_id),
                "effect": sp.effect if sp else None,
                "icon": sp.icon if sp else None,
                "actor": actor.display_name if actor else "",
                "mine": r.user_id == viewer_id,
            }
    return {"normal": list(normal.values()), "magic": magic}


def _author_dto(user, user_id) -> dict:
    return {
        "id": str(user_id),
        "name": user.display_name if user else "",
        "avatar": _image_url(user.avatar_image_path) if user else None,
        "level": user.level if user else None,
    }


def _notify_message_posted(company_id, idea_id, message_id) -> None:
    """投稿時の通知（H・E.6）＝mention（被メンション）／idea_comment（アイデア投稿者）／follow_comment（フォロワー）。post-commit。

    宛先単位で最具体1件に畳む（notify の dedup・H.1）。いずれも投稿者本人は除外（自分の投稿で自分に通知しない）。
    """
    def _build(ts):
        msg = repo.get_message(ts, message_id)
        idea = ideas_repo.get_idea(ts, idea_id)
        if msg is None or idea is None:
            return []
        author_id = msg.author_id
        actor = ts.get(User, author_id)
        params = {"actor_name": actor.display_name if actor else None}
        refs = {"ref_idea_id": idea_id, "ref_chat_message_id": message_id}
        entries = []
        mentioned = repo.get_mentions_for_messages(ts, [message_id]).get(message_id, [])
        for m in mentioned:
            if m != author_id:
                entries.append(notify_svc.entry(m, "mention", refs=refs, params=params))
        if idea.author_id != author_id:
            entries.append(notify_svc.entry(idea.author_id, "idea_comment", refs=refs, params=params))
        for f in ideas_repo.list_follower_ids(ts, idea_id):
            if f != author_id:
                entries.append(notify_svc.entry(f, "follow_comment", refs=refs, params=params))
        return entries

    notify_svc.dispatch(company_id, _build)


def _notify_message_updated(idea_id, message_id) -> None:
    return None


def _notify_message_deleted(idea_id, message_id) -> None:
    return None
