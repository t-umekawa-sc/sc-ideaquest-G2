"""会社DB 情報インプットの永続化プリミティブ（一覧クエリ・派生集計・ワードクラウド・N.1/N.6・§5.33-5.36）。

方針（quests.repository と同じ）:
- いずれも呼び出し側の Tx に相乗（自身では commit しない）＝application が UoW 境界を持つ。
- 一覧は番号ページャ（DataTable サーバー委譲・§1.8.1）。ソートは `list_query` でホワイトリスト適用。
- 既定の可視範囲＝archived 除外（status != 'archived'）。全文検索 `q` は PGroonga `&@~`（バインド変数・§2.2③）。
- 派生集計（link_count/follow_up_count）と登録者表示名は N+1 回避で一括取得する。
本 repository は永続化の原子操作のみ（認可・業務判断は application 層）。
"""
from __future__ import annotations

import uuid

from sqlalchemy import bindparam, delete, func, select, text
from sqlalchemy.orm import Session

from app.core import list_query as lq
from app.tenant.info.orm import InfoAttachment, InfoCurator, InfoItem, InfoLink, InfoToken
from app.tenant.profile.orm import User

# 全文検索の対象式＝FTS 索引（idx_info_items_fts）と一致（title＋body_text・§1.11）。
_FTS_EXPR = "(info_items.title || ' ' || coalesce(info_items.body_text, '')) &@~ :q"


def _non_status_conds(
    *,
    q: str | None,
    priorities: list[str] | None,
    sources: list[str] | None,
    impact_classes: list[str] | None,
    roots_only: bool,
) -> list:
    """status/archived を除く共通 WHERE（一覧・status facet で共用）。"""
    conds: list = []
    if q:
        conds.append(text(_FTS_EXPR).bindparams(bindparam("q", value=q)))
    if priorities:
        conds.append(InfoItem.priority.in_(priorities))
    if sources:
        conds.append(InfoItem.source.in_(sources))
    if impact_classes:
        conds.append(InfoItem.impact_class.in_(impact_classes))
    if roots_only:
        conds.append(InfoItem.parent_info_id.is_(None))  # 続報を束ねる＝根のみ（§12-1）
    return conds


def build_info_list_query(
    *,
    q: str | None = None,
    statuses: list[str] | None = None,
    priorities: list[str] | None = None,
    sources: list[str] | None = None,
    impact_classes: list[str] | None = None,
    roots_only: bool = False,
    sort: str | None = None,
):
    """情報一覧の (rows_stmt, count_stmt)（§1.8.1・list_query の sort をホワイトリスト適用）。

    既定は archived 除外。status を明示した場合はその集合のみ（archived 明示時のみ archived を含む）。
    未知ソートキーは list_query が 422（呼び出し前に検証）。
    """
    conds = _non_status_conds(q=q, priorities=priorities, sources=sources,
                              impact_classes=impact_classes, roots_only=roots_only)
    if statuses:
        conds.append(InfoItem.status.in_(statuses))
    else:
        conds.append(InfoItem.status != "archived")

    # 未棄却リンク数（集計列ソート用の scalar subquery・§5.35）。
    link_count_col = (
        select(func.count()).select_from(InfoLink)
        .where(InfoLink.info_item_id == InfoItem.id, InfoLink.rejected_at.is_(None))
        .scalar_subquery()
    )
    sort_cols = {
        "created_at": InfoItem.created_at,
        "title": InfoItem.title,
        "status": InfoItem.status,
        "priority": InfoItem.priority,
        "due_date": InfoItem.due_date,
        "link_count": link_count_col,
    }
    order = lq.parse_sort(sort, sort_cols)
    rows_stmt = select(InfoItem).where(*conds)
    if order:
        rows_stmt = rows_stmt.order_by(*order, InfoItem.id)
    else:
        rows_stmt = rows_stmt.order_by(InfoItem.created_at.desc(), InfoItem.id.desc())  # 既定＝新着
    count_stmt = select(func.count()).select_from(InfoItem).where(*conds)
    return rows_stmt, count_stmt


def status_counts(
    session: Session,
    *,
    q: str | None = None,
    priorities: list[str] | None = None,
    sources: list[str] | None = None,
    impact_classes: list[str] | None = None,
    roots_only: bool = False,
) -> dict[str, int]:
    """状態タブの件数バッジ（facet・SC-50）＝archived 除外・status 以外の現行フィルタを反映。

    返り値＝`{all, raw, curated, archived}`（all=raw+curated＝非archived の総数／archived は別枠＝
    アーカイブ タブ用）。status フィルタは含めない（タブを切り替えたときの各件数を表すため）。
    """
    conds = _non_status_conds(q=q, priorities=priorities, sources=sources,
                              impact_classes=impact_classes, roots_only=roots_only)
    rows = session.execute(
        select(InfoItem.status, func.count()).where(*conds).group_by(InfoItem.status)
    ).all()
    by_status = {st: int(c) for st, c in rows}
    raw = by_status.get("raw", 0)
    curated = by_status.get("curated", 0)
    archived = by_status.get("archived", 0)
    return {"all": raw + curated, "raw": raw, "curated": curated, "archived": archived}


def link_counts_for_items(session: Session, ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    """情報ごとの未棄却リンク数（一覧 DTO・N+1 回避・§5.35）。"""
    if not ids:
        return {}
    rows = session.execute(
        select(InfoLink.info_item_id, func.count())
        .where(InfoLink.info_item_id.in_(ids), InfoLink.rejected_at.is_(None))
        .group_by(InfoLink.info_item_id)
    ).all()
    return {iid: c for iid, c in rows}


def follow_up_counts_for_items(session: Session, ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    """情報ごとの続報件数（parent_info_id 参照・§12-1）。"""
    if not ids:
        return {}
    rows = session.execute(
        select(InfoItem.parent_info_id, func.count())
        .where(InfoItem.parent_info_id.in_(ids))
        .group_by(InfoItem.parent_info_id)
    ).all()
    return {pid: c for pid, c in rows}


def categories_for_items(session: Session, ids: list[uuid.UUID]) -> dict[uuid.UUID, list[str]]:
    """情報ごとのカテゴリ（#8・複数可・§5.34）。"""
    if not ids:
        return {}
    from app.tenant.info.orm import InfoItemCategory
    rows = session.execute(
        select(InfoItemCategory.info_item_id, InfoItemCategory.category)
        .where(InfoItemCategory.info_item_id.in_(ids))
    ).all()
    out: dict[uuid.UUID, list[str]] = {}
    for iid, cat in rows:
        out.setdefault(iid, []).append(cat)
    return out


def users_by_ids(session: Session, ids: list[uuid.UUID]) -> dict[uuid.UUID, User]:
    """登録者の表示名/アバターを一括取得（N+1 回避）。"""
    if not ids:
        return {}
    rows = session.execute(select(User).where(User.id.in_(ids))).scalars().all()
    return {u.id: u for u in rows}


# ---- 登録（POST /info-items・N.2）----

def create_info_item(
    session: Session,
    *,
    created_by_id: uuid.UUID,
    title: str,
    body_html: str | None = None,
    body_text: str | None = None,
    summary: str | None = None,
    source_url: str | None = None,
    parent_info_id: uuid.UUID | None = None,
    info_id: uuid.UUID | None = None,
) -> InfoItem:
    """情報を1件作成（低摩擦登録＝status=raw・N.2）。派生（body_text/summary）は呼び出し側が算出して渡す。"""
    item = InfoItem(
        id=info_id or uuid.uuid4(), created_by_id=created_by_id, title=title,
        body_html=body_html, body_text=body_text, summary=summary, source_url=source_url,
        parent_info_id=parent_info_id, status="raw",
    )
    session.add(item)
    return item


def replace_tokens(session: Session, info_id: uuid.UUID, tokens: list[tuple[str, int]]) -> None:
    """当該情報の info_tokens を全置換（保存時に再生成・§5.36）。"""
    session.execute(delete(InfoToken).where(InfoToken.info_item_id == info_id))
    for tok, cnt in tokens:
        session.add(InfoToken(info_item_id=info_id, token=tok, count=cnt))


def replace_categories(session: Session, info_id: uuid.UUID, categories: list[str]) -> None:
    """情報カテゴリ（#8）を全置換（差分ではなく置換・§5.34）。重複は除去。"""
    from app.tenant.info.orm import InfoItemCategory
    session.execute(delete(InfoItemCategory).where(InfoItemCategory.info_item_id == info_id))
    for cat in dict.fromkeys(categories):
        session.add(InfoItemCategory(info_item_id=info_id, category=cat))


def add_revision(session: Session, info_id: uuid.UUID, editor_id: uuid.UUID, changes: dict) -> int:
    """内容の版スナップショットを追加（版番号は info_item ごとに連番・§12）。付与した版番号を返す。"""
    from app.tenant.info.orm import InfoItemRevision
    nxt = (session.execute(
        select(func.coalesce(func.max(InfoItemRevision.revision), 0)).where(InfoItemRevision.info_item_id == info_id)
    ).scalar_one()) + 1
    session.add(InfoItemRevision(info_item_id=info_id, revision=nxt, editor_id=editor_id, changes=changes))
    return nxt


def revision_count(session: Session, info_id: uuid.UUID) -> int:
    """内容編集履歴の版数（テスト/表示補助）。"""
    from app.tenant.info.orm import InfoItemRevision
    return int(session.execute(
        select(func.count()).select_from(InfoItemRevision).where(InfoItemRevision.info_item_id == info_id)
    ).scalar_one())


def snapshot_parent_links(session: Session, parent_id: uuid.UUID, new_info_id: uuid.UUID) -> int:
    """続報登録時＝親の**未棄却**リンクを `origin=auto` で複製（§12-1）。複製件数を返す。"""
    parent_links = session.execute(
        select(InfoLink).where(InfoLink.info_item_id == parent_id, InfoLink.rejected_at.is_(None))
    ).scalars().all()
    for l in parent_links:
        session.add(InfoLink(info_item_id=new_info_id, target_type=l.target_type, target_id=l.target_id,
                             kind=l.kind, origin="auto", score=l.score))
    return len(parent_links)


# ---- 関連リンク（/info-links・N.3）----

def find_link(session: Session, info_item_id: uuid.UUID, target_type: str, target_id: uuid.UUID) -> InfoLink | None:
    """同一 (info, target_type, target_id) のリンクを検索（重複検出・棄却済みも含む・§5.35 UNIQUE）。"""
    return session.execute(
        select(InfoLink).where(
            InfoLink.info_item_id == info_item_id,
            InfoLink.target_type == target_type,
            InfoLink.target_id == target_id,
        )
    ).scalars().first()


def create_link(session: Session, *, info_item_id: uuid.UUID, target_type: str, target_id: uuid.UUID,
                kind: str = "related", origin: str = "manual") -> InfoLink:
    """手動リンクを1件作成（origin=manual・既定 kind=related・§N.3）。重複検出は呼び出し側で。"""
    link = InfoLink(info_item_id=info_item_id, target_type=target_type, target_id=target_id,
                    kind=kind, origin=origin)
    session.add(link)
    return link


def get_link(session: Session, link_id: uuid.UUID) -> InfoLink | None:
    return session.get(InfoLink, link_id)


def search_link_candidates(session: Session, *, target_type: str, q: str, limit: int = 20) -> list[dict]:
    """リンク候補をタイトル検索（ideas=published・非削除／quests=非削除）。未実装ドメインは空（§N.3）。"""
    from app.tenant.ideas.orm import Idea
    from app.tenant.quests.orm import Quest
    like = f"%{q}%"
    if target_type == "ideas":
        rows = session.execute(
            select(Idea.id, Idea.title).where(
                Idea.deleted_at.is_(None), Idea.status == "published", Idea.title.ilike(like)
            ).order_by(Idea.title.asc()).limit(limit)
        ).all()
    elif target_type == "quests":
        rows = session.execute(
            select(Quest.id, Quest.title).where(
                Quest.deleted_at.is_(None), Quest.title.ilike(like)
            ).order_by(Quest.title.asc()).limit(limit)
        ).all()
    else:
        return []  # concepts/assumptions＝未実装ドメイン
    return [{"target_type": target_type, "target_id": str(i), "title": t} for i, t in rows]


# ---- 詳細（GET /info-items/{id}・N.1）----

def get_info_item(session: Session, info_id: uuid.UUID) -> InfoItem | None:
    """情報を1件取得（不在は None）。"""
    return session.get(InfoItem, info_id)


def links_for_item(session: Session, info_id: uuid.UUID) -> list[InfoLink]:
    """当該情報の関連リンク（棄却済みも含む＝DTO で rejected を返す・§N.3）。"""
    return list(session.execute(
        select(InfoLink).where(InfoLink.info_item_id == info_id)
    ).scalars().all())


def resolve_link_titles(session: Session, links: list[InfoLink]) -> dict[uuid.UUID, str]:
    """関連リンクの target_title を成果物から解決（ideas/quests＝実装済ドメイン）。未実装/不在は含めない。"""
    from app.tenant.ideas.orm import Idea
    from app.tenant.quests.orm import Quest
    out: dict[uuid.UUID, str] = {}
    idea_ids = [l.target_id for l in links if l.target_type == "ideas"]
    quest_ids = [l.target_id for l in links if l.target_type == "quests"]
    if idea_ids:
        for iid, title in session.execute(select(Idea.id, Idea.title).where(Idea.id.in_(idea_ids))).all():
            out[iid] = title
    if quest_ids:
        for qid, title in session.execute(select(Quest.id, Quest.title).where(Quest.id.in_(quest_ids))).all():
            out[qid] = title
    return out


def follow_up_items(session: Session, info_id: uuid.UUID) -> list[InfoItem]:
    """続報（子）の情報を時系列（created_at 昇順）で（§12-1）。"""
    return list(session.execute(
        select(InfoItem).where(InfoItem.parent_info_id == info_id).order_by(InfoItem.created_at.asc())
    ).scalars().all())


def tokens_top(session: Session, info_id: uuid.UUID, *, limit: int) -> list[dict]:
    """当該情報のトークン上位（ミニ・ワードクラウド・count 降順・§5.36）。"""
    rows = session.execute(
        select(InfoToken.token, InfoToken.count)
        .where(InfoToken.info_item_id == info_id)
        .order_by(InfoToken.count.desc(), InfoToken.token.asc()).limit(limit)
    ).all()
    max_c = int(rows[0].count) if rows else 0
    return [{"token": t, "count": int(c), "weight": round(int(c) / max_c, 4) if max_c else None} for t, c in rows]


def is_curator(session: Session, user_id: uuid.UUID) -> bool:
    """情報判定権限（info_curator・未剥奪）を持つか（§5.37）。"""
    return session.execute(
        select(InfoCurator.id).where(InfoCurator.user_id == user_id, InfoCurator.revoked_at.is_(None)).limit(1)
    ).first() is not None


# ---- 参考資料（info_attachments・N.2・§5.33）----


def list_attachments(session: Session, info_id: uuid.UUID) -> list[InfoAttachment]:
    """当該情報の参考資料（アップロード時系列＝uploaded_at 昇順）。"""
    return list(session.execute(
        select(InfoAttachment).where(InfoAttachment.info_item_id == info_id)
        .order_by(InfoAttachment.uploaded_at.asc())
    ).scalars().all())


def count_attachments(session: Session, info_id: uuid.UUID) -> int:
    """当該情報の参考資料件数（上限チェック用）。"""
    return int(session.execute(
        select(func.count(InfoAttachment.id)).where(InfoAttachment.info_item_id == info_id)
    ).scalar() or 0)


def get_attachment(session: Session, attachment_id: uuid.UUID) -> InfoAttachment | None:
    """参考資料を1件取得（不在は None）。"""
    return session.get(InfoAttachment, attachment_id)


def add_attachment(session: Session, *, info_item_id: uuid.UUID, object_key: str, original_name: str,
                   size_bytes: int, mime_type: str, uploaded_by_id: uuid.UUID) -> InfoAttachment:
    """参考資料を記帳（物理は application で MinIO put 済み）。"""
    att = InfoAttachment(
        info_item_id=info_item_id, object_key=object_key, original_name=original_name,
        size_bytes=size_bytes, mime_type=mime_type, uploaded_by_id=uploaded_by_id,
    )
    session.add(att)
    return att


def remove_attachment(session: Session, att: InfoAttachment) -> None:
    """参考資料の行を削除（MinIO オブジェクト削除は application 側）。"""
    session.delete(att)


def word_cloud(session: Session, *, limit: int) -> list[dict]:
    """ワードクラウド＝保存済み info_tokens の頻度集計（archived 除外・count 降順・N.6/§5.36）。

    weight は最頻値を 1.0 とした正規化（0..1）。同数は token 昇順で安定化。
    """
    stmt = (
        select(InfoToken.token, func.sum(InfoToken.count).label("cnt"))
        .join(InfoItem, InfoItem.id == InfoToken.info_item_id)
        .where(InfoItem.status != "archived")
        .group_by(InfoToken.token)
        .order_by(func.sum(InfoToken.count).desc(), InfoToken.token.asc())
        .limit(limit)
    )
    rows = session.execute(stmt).all()
    max_c = int(rows[0].cnt) if rows else 0
    return [
        {"token": tok, "count": int(cnt),
         "weight": round(int(cnt) / max_c, 4) if max_c else None}
        for tok, cnt in rows
    ]
