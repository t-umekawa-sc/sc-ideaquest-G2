"""全文検索の read（PGroonga・ドメイン J・§6）。3 種（idea/chat/attachment）を可視範囲 WHERE で絞り、
`pgroonga_score`＋`pgroonga_snippet_html` を DB 内で計算して返す。

- **可視範囲は索引ではなくクエリ WHERE で強制**（下書き/他パーティー/削除の漏洩防止・J.0）。
- `q` は**バインド変数**で PGroonga 演算子（`&@~`＝クエリ・複数語 AND）へ渡す（§2.2③・文字列連結しない）。
- スニペット＝`pgroonga_snippet_html`（PGroonga がユーザー文をエスケープ＋`<span class="keyword">` のみ注入・J.5）。
- 各 read は上限 `cap` 件まで（結果は通常小・app が合成/スコア順/ページングする）。
"""
from __future__ import annotations

import uuid

from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

# クエスト内可視のアイデア（published・非削除）に対するアイデア全文検索。
_IDEAS_SQL = text("""
    SELECT i.id AS idea_id, i.title AS idea_title, i.quest_id AS quest_id,
           NULL::uuid AS chat_message_id, NULL::uuid AS attachment_id,
           pgroonga_score(i.tableoid, i.ctid) AS score,
           array_to_string(pgroonga_snippet_html(
               i.title || ' ' || i.body || ' ' || i.value || ' ' || coalesce(i.note, ''),
               pgroonga_query_extract_keywords(:q)), ' … ') AS snippet,
           i.created_at AS sort_ts
    FROM ideas i
    WHERE i.quest_id IN :quest_ids AND i.status = 'published' AND i.deleted_at IS NULL
      AND (i.title || ' ' || i.body || ' ' || i.value || ' ' || coalesce(i.note, '')) &@~ :q
    ORDER BY score DESC, i.created_at DESC
    LIMIT :cap
""").bindparams(bindparam("quest_ids", expanding=True))

# 可視アイデアの chat_group 配下・非トゥームストーンのチャット本文検索。
_CHAT_SQL = text("""
    SELECT cg.idea_id AS idea_id, i.title AS idea_title, i.quest_id AS quest_id,
           cm.id AS chat_message_id, NULL::uuid AS attachment_id,
           pgroonga_score(cm.tableoid, cm.ctid) AS score,
           array_to_string(pgroonga_snippet_html(cm.body,
               pgroonga_query_extract_keywords(:q)), ' … ') AS snippet,
           cm.created_at AS sort_ts
    FROM chat_messages cm
    JOIN chat_groups cg ON cg.id = cm.chat_group_id
    JOIN ideas i ON i.id = cg.idea_id
    WHERE i.quest_id IN :quest_ids AND i.status = 'published' AND i.deleted_at IS NULL
      AND cm.is_deleted = false
      AND cm.body &@~ :q
    ORDER BY score DESC, cm.created_at DESC
    LIMIT :cap
""").bindparams(bindparam("quest_ids", expanding=True))

# 可視アイデア添付 or 可視チャット添付のファイル名検索（親が非可視/削除/トゥームストーンなら対象外）。
_ATTACH_SQL = text("""
    SELECT coalesce(ai.id, ci.id) AS idea_id, coalesce(ai.title, ci.title) AS idea_title,
           coalesce(ai.quest_id, ci.quest_id) AS quest_id,
           a.chat_message_id AS chat_message_id, a.id AS attachment_id,
           pgroonga_score(a.tableoid, a.ctid) AS score,
           array_to_string(pgroonga_snippet_html(a.original_name,
               pgroonga_query_extract_keywords(:q)), ' … ') AS snippet,
           a.uploaded_at AS sort_ts
    FROM attachments a
    LEFT JOIN ideas ai ON ai.id = a.idea_id AND ai.status = 'published' AND ai.deleted_at IS NULL
    LEFT JOIN chat_messages cm ON cm.id = a.chat_message_id AND cm.is_deleted = false
    LEFT JOIN chat_groups cg ON cg.id = cm.chat_group_id
    LEFT JOIN ideas ci ON ci.id = cg.idea_id AND ci.status = 'published' AND ci.deleted_at IS NULL
    WHERE a.original_name &@~ :q
      AND ( (ai.id IS NOT NULL AND ai.quest_id IN :quest_ids)
         OR (ci.id IS NOT NULL AND ci.quest_id IN :quest_ids) )
    ORDER BY score DESC, a.uploaded_at DESC
    LIMIT :cap
""").bindparams(bindparam("quest_ids", expanding=True))

_SQL = {"idea": _IDEAS_SQL, "chat": _CHAT_SQL, "attachment": _ATTACH_SQL}


def search(session: Session, kind: str, q: str, quest_ids: list[uuid.UUID], *, cap: int) -> list[dict]:
    rows = session.execute(_SQL[kind], {"q": q, "quest_ids": quest_ids, "cap": cap}).mappings().all()
    return [dict(r) for r in rows]
