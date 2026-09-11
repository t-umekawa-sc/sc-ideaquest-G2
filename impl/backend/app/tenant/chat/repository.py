"""会社DB チャットの永続化プリミティブ（§5.15〜§5.18・§5.30・§5.31・E.1〜E.5）。

方針（他 repository と同じ）: 呼び出し側 Tx に相乗（自身では commit しない）。認可・状態機械・XP は application 層で強制。
添付は ideas.orm.Attachment を共有（`chat_message_id` を設定・§5.12）。
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import and_, func, or_, select, tuple_
from sqlalchemy.orm import Session, aliased

from app.tenant.chat.orm import ChatGroup, ChatMention, ChatMessage, ChatMessageQuote, ChatRead, Reaction, ReactionEmoji, Spell, UserSpell
from app.tenant.ideas.orm import Attachment, Idea


# ---- チャットグループ（§5.15・publish で作成／アクセス時に遅延生成） ----

def get_chat_group_by_idea(session: Session, idea_id: uuid.UUID) -> ChatGroup | None:
    return session.execute(select(ChatGroup).where(ChatGroup.idea_id == idea_id)).scalars().first()


def list_chat_group_ids_for_quest(session: Session, quest_id: uuid.UUID) -> list[uuid.UUID]:
    """当該クエストの全アイデアの chat_group_id（L.4 購読失効の対象特定）。"""
    from app.tenant.ideas.orm import Idea

    return list(
        session.execute(
            select(ChatGroup.id).join(Idea, Idea.id == ChatGroup.idea_id).where(Idea.quest_id == quest_id)
        ).scalars().all()
    )


def list_chat_group_ids_for_group_member(session: Session, group_id: uuid.UUID, user_id: uuid.UUID) -> list[uuid.UUID]:
    """クエストグループ内クエストで当該ユーザーが有効パーティー員である chat_group_id（L.4＝グループ除去の失効対象）。

    グループ除去（control_plane）で対象ユーザーがグループ内で購読し得た chat のみを特定＝過剰失効を出さない。
    """
    from app.tenant.ideas.orm import Idea
    from app.tenant.quests.orm import Quest, QuestMember

    return list(
        session.execute(
            select(ChatGroup.id)
            .join(Idea, Idea.id == ChatGroup.idea_id)
            .join(Quest, Quest.id == Idea.quest_id)
            .join(
                QuestMember,
                and_(
                    QuestMember.quest_id == Quest.id,
                    QuestMember.user_id == user_id,
                    QuestMember.removed_at.is_(None),
                ),
            )
            .where(Quest.quest_group_id == group_id)
        ).scalars().all()
    )


def ensure_chat_group(session: Session, idea_id: uuid.UUID) -> ChatGroup:
    """アイデアのチャットグループを取得、無ければ作成（`UNIQUE(idea_id)`・冪等）。"""
    cg = get_chat_group_by_idea(session, idea_id)
    if cg is not None:
        return cg
    cg = ChatGroup(id=uuid.uuid4(), idea_id=idea_id)
    session.add(cg)
    session.flush()
    return cg


# ---- メッセージ（§5.16） ----

def create_message(
    session: Session, *, chat_group_id: uuid.UUID, author_id: uuid.UUID, body: str,
    message_id: uuid.UUID | None = None,
) -> ChatMessage:
    msg = ChatMessage(id=message_id or uuid.uuid4(), chat_group_id=chat_group_id, author_id=author_id, body=body)
    session.add(msg)
    session.flush()
    return msg


def add_quotes(session: Session, message_id: uuid.UUID, quoted_message_ids: list[uuid.UUID]) -> None:
    """引用返信（複数可・§5.16b）。同一メッセージの重複引用は 1 件に集約。"""
    seen: set[uuid.UUID] = set()
    for qid in quoted_message_ids:
        if qid in seen:
            continue
        seen.add(qid)
        session.add(ChatMessageQuote(id=uuid.uuid4(), chat_message_id=message_id, quoted_message_id=qid))


def replace_quotes(session: Session, message_id: uuid.UUID, quoted_message_ids: list[uuid.UUID]) -> None:
    """編集時の引用置換（E.2・メンション置換と同流儀）＝既存を全削除して与えられた集合で作り直す。"""
    for row in session.execute(select(ChatMessageQuote).where(ChatMessageQuote.chat_message_id == message_id)).scalars().all():
        session.delete(row)
    session.flush()
    add_quotes(session, message_id, quoted_message_ids)


def get_quotes_for_messages(session: Session, message_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[uuid.UUID]]:
    result: dict[uuid.UUID, list[uuid.UUID]] = {}
    if not message_ids:
        return result
    rows = session.execute(
        select(ChatMessageQuote.chat_message_id, ChatMessageQuote.quoted_message_id)
        .where(ChatMessageQuote.chat_message_id.in_(message_ids)).order_by(ChatMessageQuote.id)
    ).all()
    for mid, qid in rows:
        result.setdefault(mid, []).append(qid)
    return result


def get_message(session: Session, message_id: uuid.UUID) -> ChatMessage | None:
    return session.execute(select(ChatMessage).where(ChatMessage.id == message_id)).scalars().first()


def get_messages_by_ids(session: Session, ids) -> dict[uuid.UUID, ChatMessage]:
    """message_id→ChatMessage の dict（引用元の一括解決・per-id N+1 回避）。"""
    id_list = list(ids)
    if not id_list:
        return {}
    return {m.id: m for m in session.execute(select(ChatMessage).where(ChatMessage.id.in_(id_list))).scalars().all()}


def list_messages(
    session: Session, chat_group_id: uuid.UUID, *,
    before: tuple[datetime, uuid.UUID] | None = None,
    after: tuple[datetime, uuid.UUID] | None = None,
    limit: int = 50,
) -> tuple[list[ChatMessage], bool]:
    """メッセージをキーセットで取得（§1.8・E.1）。返り値＝(時系列昇順の配列, has_more)。

    - `after`＝カーソルより新しい方を昇順で（WS 再同期）。
    - それ以外（`before` or 既定）＝過去へ遡上。末尾 `limit` 件（既定）or `before` より古い `limit` 件を降順取得し昇順へ反転。
      has_more＝さらに過去があるか（初期/遡上）。
    """
    if after is not None:
        stmt = (
            select(ChatMessage)
            .where(ChatMessage.chat_group_id == chat_group_id,
                   tuple_(ChatMessage.created_at, ChatMessage.id) > tuple_(after[0], after[1]))
            .order_by(ChatMessage.created_at.asc(), ChatMessage.id.asc())
            .limit(limit + 1)
        )
        rows = list(session.execute(stmt).scalars().all())
        has_more = len(rows) > limit
        return rows[:limit], has_more
    stmt = select(ChatMessage).where(ChatMessage.chat_group_id == chat_group_id)
    if before is not None:
        stmt = stmt.where(tuple_(ChatMessage.created_at, ChatMessage.id) < tuple_(before[0], before[1]))
    stmt = stmt.order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc()).limit(limit + 1)
    rows = list(session.execute(stmt).scalars().all())
    has_more = len(rows) > limit
    rows = rows[:limit]
    rows.reverse()  # 表示は時系列昇順
    return rows, has_more


def list_recent_messages(session: Session, chat_group_id: uuid.UUID, limit: int) -> list[ChatMessage]:
    """直近 `limit` 件（新しい順・SC-22 chat_preview 用）。"""
    return list(session.execute(
        select(ChatMessage).where(ChatMessage.chat_group_id == chat_group_id)
        .order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc()).limit(limit)
    ).scalars().all())


def count_active_messages(session: Session, chat_group_id: uuid.UUID) -> int:
    return int(session.execute(
        select(func.count()).select_from(ChatMessage)
        .where(ChatMessage.chat_group_id == chat_group_id, ChatMessage.is_deleted.is_(False))
    ).scalar_one())


def count_active_messages_for_ideas(session: Session, idea_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    """複数アイデアの非削除チャット件数（SC-12 一覧の 💬 コメント数・D.1）。chat_group 未生成は 0（結果に出ない）。"""
    if not idea_ids:
        return {}
    rows = session.execute(
        select(ChatGroup.idea_id, func.count(ChatMessage.id))
        .join(ChatMessage, and_(ChatMessage.chat_group_id == ChatGroup.id, ChatMessage.is_deleted.is_(False)))
        .where(ChatGroup.idea_id.in_(idea_ids))
        .group_by(ChatGroup.idea_id)
    ).all()
    return {iid: int(n) for iid, n in rows}


def unread_counts_for_ideas(session: Session, idea_ids: list[uuid.UUID], user_id: uuid.UUID) -> dict[uuid.UUID, int]:
    """アイデアごとの「自分の未読（他ユーザー投稿）」件数（💬 新着の議論・レビュー#3）。

    自分の既読カーソル（`chat_reads.last_read_message_id` の `(created_at, id)`）より後の、**自分以外**が投稿した
    未削除メッセージ数。chat_reads 行が無ければ全件が未読。自分の投稿は数えない（他ユーザーのやり取りに気付く目的）。
    未読なし/chat_group 未生成は結果に出ない（＝0）。
    """
    if not idea_ids:
        return {}
    last_read = aliased(ChatMessage)  # 既読カーソルのメッセージ（(created_at,id) 取得用）
    rows = session.execute(
        select(ChatGroup.idea_id, func.count(ChatMessage.id))
        .select_from(ChatGroup)
        .join(ChatMessage, and_(
            ChatMessage.chat_group_id == ChatGroup.id,
            ChatMessage.is_deleted.is_(False),
            ChatMessage.author_id != user_id,  # 自分の投稿は未読に数えない
        ))
        .outerjoin(ChatRead, and_(ChatRead.chat_group_id == ChatGroup.id, ChatRead.user_id == user_id))
        .outerjoin(last_read, last_read.id == ChatRead.last_read_message_id)
        .where(
            ChatGroup.idea_id.in_(idea_ids),
            or_(
                ChatRead.last_read_message_id.is_(None),  # 既読カーソル無し＝全件未読
                tuple_(ChatMessage.created_at, ChatMessage.id) > tuple_(last_read.created_at, last_read.id),
            ),
        )
        .group_by(ChatGroup.idea_id)
    ).all()
    return {iid: int(n) for iid, n in rows}


def last_message_at_for_ideas(session: Session, idea_ids: list[uuid.UUID]) -> dict[uuid.UUID, datetime]:
    """アイデアごとの最終チャット時刻（💬 新着の議論のソート/表示用）。非削除メッセージの max(created_at)。"""
    if not idea_ids:
        return {}
    rows = session.execute(
        select(ChatGroup.idea_id, func.max(ChatMessage.created_at))
        .select_from(ChatGroup)
        .join(ChatMessage, and_(ChatMessage.chat_group_id == ChatGroup.id, ChatMessage.is_deleted.is_(False)))
        .where(ChatGroup.idea_id.in_(idea_ids))
        .group_by(ChatGroup.idea_id)
    ).all()
    return {iid: dt for iid, dt in rows}


def ideas_with_unread(session: Session, user_id: uuid.UUID, quest_ids: list[uuid.UUID],
                      limit: int = 8) -> list[tuple[uuid.UUID, int, datetime]]:
    """参加クエスト（quest_ids）の公開アイデアのうち、自分の未読（他ユーザー投稿）があるものを
    最終チャット時刻の新しい順に返す（💬 新着の議論・ダッシュボード横断）。返り＝[(idea_id, unread, last_at)]。

    未読の定義は `unread_counts_for_ideas` と同じ（他ユーザー投稿・既読カーソル後）。last_at は全メッセージの
    最終時刻（並び用）。unread が 0 のアイデアは返さない（HAVING）。
    """
    if not quest_ids:
        return []
    last_read = aliased(ChatMessage)
    is_unread = and_(
        ChatMessage.author_id != user_id,
        or_(ChatRead.last_read_message_id.is_(None),
            tuple_(ChatMessage.created_at, ChatMessage.id) > tuple_(last_read.created_at, last_read.id)),
    )
    unread_ct = func.count(ChatMessage.id).filter(is_unread)  # FILTER＝未読のみ計数（Postgres）
    rows = session.execute(
        select(ChatGroup.idea_id, unread_ct.label("unread"), func.max(ChatMessage.created_at).label("last_at"))
        .select_from(ChatGroup)
        .join(Idea, and_(Idea.id == ChatGroup.idea_id, Idea.status == "published", Idea.deleted_at.is_(None)))
        .join(ChatMessage, and_(ChatMessage.chat_group_id == ChatGroup.id, ChatMessage.is_deleted.is_(False)))
        .outerjoin(ChatRead, and_(ChatRead.chat_group_id == ChatGroup.id, ChatRead.user_id == user_id))
        .outerjoin(last_read, last_read.id == ChatRead.last_read_message_id)
        .where(Idea.quest_id.in_(quest_ids))
        .group_by(ChatGroup.idea_id)
        .having(unread_ct > 0)
        .order_by(func.max(ChatMessage.created_at).desc())
        .limit(limit)
    ).all()
    return [(iid, int(u), last_at) for iid, u, last_at in rows]


def count_messages_after(session: Session, chat_group_id: uuid.UUID, cursor: tuple[datetime, uuid.UUID] | None) -> int:
    """既読カーソル（created_at,id）より後の未削除メッセージ数（未読件数・E.5）。cursor None＝全件。"""
    stmt = select(func.count()).select_from(ChatMessage).where(
        ChatMessage.chat_group_id == chat_group_id, ChatMessage.is_deleted.is_(False))
    if cursor is not None:
        stmt = stmt.where(tuple_(ChatMessage.created_at, ChatMessage.id) > tuple_(cursor[0], cursor[1]))
    return int(session.execute(stmt).scalar_one())


def first_message_after(session: Session, chat_group_id: uuid.UUID, cursor: tuple[datetime, uuid.UUID] | None) -> ChatMessage | None:
    """既読カーソルの直後（最初の未読）＝未読セパレータ位置（E.5）。"""
    stmt = select(ChatMessage).where(
        ChatMessage.chat_group_id == chat_group_id, ChatMessage.is_deleted.is_(False))
    if cursor is not None:
        stmt = stmt.where(tuple_(ChatMessage.created_at, ChatMessage.id) > tuple_(cursor[0], cursor[1]))
    stmt = stmt.order_by(ChatMessage.created_at.asc(), ChatMessage.id.asc()).limit(1)
    return session.execute(stmt).scalars().first()


def daily_message_counts(session: Session, chat_group_id: uuid.UUID, since: datetime) -> list[tuple]:
    """日次メッセージ数（chat-activity・削除除外・created_at の日単位）。返り値＝[(date, count)]。"""
    day = func.date_trunc("day", ChatMessage.created_at)
    rows = session.execute(
        select(day.label("d"), func.count()).where(
            ChatMessage.chat_group_id == chat_group_id, ChatMessage.is_deleted.is_(False),
            ChatMessage.created_at >= since,
        ).group_by(day).order_by(day)
    ).all()
    return [(d, int(n)) for d, n in rows]


# ---- メンション（§5.17） ----

def replace_mentions(session: Session, message_id: uuid.UUID, user_ids: list[uuid.UUID]) -> None:
    for row in session.execute(select(ChatMention).where(ChatMention.chat_message_id == message_id)).scalars().all():
        session.delete(row)
    session.flush()
    seen: set[uuid.UUID] = set()
    for uid in user_ids:
        if uid in seen:
            continue
        seen.add(uid)
        session.add(ChatMention(id=uuid.uuid4(), chat_message_id=message_id, mentioned_user_id=uid))


def get_mentions_for_messages(session: Session, message_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[uuid.UUID]]:
    result: dict[uuid.UUID, list[uuid.UUID]] = {}
    if not message_ids:
        return result
    rows = session.execute(
        select(ChatMention.chat_message_id, ChatMention.mentioned_user_id)
        .where(ChatMention.chat_message_id.in_(message_ids))
    ).all()
    for mid, uid in rows:
        result.setdefault(mid, []).append(uid)
    return result


# ---- 添付（attachments 共有・chat_message_id を設定・§5.12） ----

def add_chat_attachment(
    session: Session, *, chat_message_id: uuid.UUID, object_key: str, original_name: str,
    size_bytes: int, mime_type: str, uploaded_by_id: uuid.UUID,
) -> Attachment:
    att = Attachment(
        id=uuid.uuid4(), chat_message_id=chat_message_id, object_key=object_key, original_name=original_name,
        size_bytes=size_bytes, mime_type=mime_type, uploaded_by_id=uploaded_by_id,
    )
    session.add(att)
    return att


def get_attachments_for_messages(session: Session, message_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[Attachment]]:
    result: dict[uuid.UUID, list[Attachment]] = {}
    if not message_ids:
        return result
    rows = session.execute(
        select(Attachment).where(Attachment.chat_message_id.in_(message_ids)).order_by(Attachment.uploaded_at)
    ).scalars().all()
    for a in rows:
        result.setdefault(a.chat_message_id, []).append(a)
    return result


def list_attachments_for_message(session: Session, message_id: uuid.UUID) -> list[Attachment]:
    return list(session.execute(
        select(Attachment).where(Attachment.chat_message_id == message_id).order_by(Attachment.uploaded_at)
    ).scalars().all())


def get_attachment(session: Session, attachment_id: uuid.UUID) -> Attachment | None:
    return session.execute(select(Attachment).where(Attachment.id == attachment_id)).scalars().first()


def remove_attachment(session: Session, attachment: Attachment) -> None:
    session.delete(attachment)


# ---- 既読（§5.31） ----

def get_read(session: Session, chat_group_id: uuid.UUID, user_id: uuid.UUID) -> ChatRead | None:
    return session.execute(
        select(ChatRead).where(ChatRead.chat_group_id == chat_group_id, ChatRead.user_id == user_id)
    ).scalars().first()


def upsert_read(session: Session, chat_group_id: uuid.UUID, user_id: uuid.UUID, last_read_message_id: uuid.UUID) -> ChatRead:
    row = get_read(session, chat_group_id, user_id)
    if row is None:
        row = ChatRead(id=uuid.uuid4(), chat_group_id=chat_group_id, user_id=user_id, last_read_message_id=last_read_message_id)
        session.add(row)
        return row
    row.last_read_message_id = last_read_message_id
    return row


# ---- リアクション（§5.18・E.4） ----

def list_reactions_for_messages(session: Session, message_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[Reaction]]:
    result: dict[uuid.UUID, list[Reaction]] = {}
    if not message_ids:
        return result
    rows = session.execute(select(Reaction).where(Reaction.chat_message_id.in_(message_ids))).scalars().all()
    for r in rows:
        result.setdefault(r.chat_message_id, []).append(r)
    return result


def get_normal_reaction(session: Session, message_id: uuid.UUID, user_id: uuid.UUID, emoji: str) -> Reaction | None:
    return session.execute(
        select(Reaction).where(
            Reaction.chat_message_id == message_id, Reaction.user_id == user_id,
            Reaction.type == "normal", Reaction.emoji == emoji)
    ).scalars().first()


def get_magic_reaction_of_message(session: Session, message_id: uuid.UUID) -> Reaction | None:
    return session.execute(
        select(Reaction).where(Reaction.chat_message_id == message_id, Reaction.type == "magic")
    ).scalars().first()


def get_user_magic_in_group(session: Session, chat_group_id: uuid.UUID, user_id: uuid.UUID, spell_id: uuid.UUID) -> Reaction | None:
    return session.execute(
        select(Reaction).where(
            Reaction.chat_group_id == chat_group_id, Reaction.user_id == user_id,
            Reaction.type == "magic", Reaction.spell_id == spell_id)
    ).scalars().first()


def add_reaction(
    session: Session, *, chat_message_id: uuid.UUID, chat_group_id: uuid.UUID, user_id: uuid.UUID,
    type: str, emoji: str | None = None, spell_id: uuid.UUID | None = None,
) -> Reaction:
    r = Reaction(id=uuid.uuid4(), chat_message_id=chat_message_id, chat_group_id=chat_group_id,
                 user_id=user_id, type=type, emoji=emoji, spell_id=spell_id)
    session.add(r)
    session.flush()
    return r


def remove_reaction(session: Session, reaction: Reaction) -> None:
    session.delete(reaction)


# ---- マスタ（reaction_emojis / spells・§5.30/§5.19/§5.20） ----

def list_active_emojis(session: Session) -> list[ReactionEmoji]:
    return list(session.execute(
        select(ReactionEmoji).where(ReactionEmoji.is_active.is_(True)).order_by(ReactionEmoji.sort_order)
    ).scalars().all())


def get_active_emoji(session: Session, emoji: str) -> ReactionEmoji | None:
    return session.execute(
        select(ReactionEmoji).where(ReactionEmoji.emoji == emoji, ReactionEmoji.is_active.is_(True))
    ).scalars().first()


def list_spells(session: Session) -> list[Spell]:
    return list(session.execute(select(Spell).order_by(Spell.line, Spell.sort_order)).scalars().all())


def get_spell(session: Session, spell_id: uuid.UUID) -> Spell | None:
    return session.execute(select(Spell).where(Spell.id == spell_id)).scalars().first()


def is_spell_unlocked(session: Session, user_id: uuid.UUID, spell_id: uuid.UUID) -> bool:
    return session.execute(
        select(UserSpell.id).where(UserSpell.user_id == user_id, UserSpell.spell_id == spell_id)
    ).first() is not None


def add_user_spell(session: Session, user_id: uuid.UUID, spell_id: uuid.UUID) -> UserSpell:
    us = UserSpell(id=uuid.uuid4(), user_id=user_id, spell_id=spell_id)
    session.add(us)
    return us


def list_user_spell_ids(session: Session, user_id: uuid.UUID) -> set[uuid.UUID]:
    return set(session.execute(select(UserSpell.spell_id).where(UserSpell.user_id == user_id)).scalars().all())
