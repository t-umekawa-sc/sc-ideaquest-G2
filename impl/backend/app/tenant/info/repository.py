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

from sqlalchemy import bindparam, func, select, text
from sqlalchemy.orm import Session

from app.core import list_query as lq
from app.tenant.info.orm import InfoItem, InfoLink, InfoToken
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

    返り値＝`{all, raw, curated}`（all=raw+curated＝非archived の総数）。status フィルタは含めない
    （タブを切り替えたときの各件数を表すため）。
    """
    conds = _non_status_conds(q=q, priorities=priorities, sources=sources,
                              impact_classes=impact_classes, roots_only=roots_only)
    rows = session.execute(
        select(InfoItem.status, func.count()).where(InfoItem.status != "archived", *conds)
        .group_by(InfoItem.status)
    ).all()
    by_status = {st: c for st, c in rows}
    raw = int(by_status.get("raw", 0))
    curated = int(by_status.get("curated", 0))
    return {"all": raw + curated, "raw": raw, "curated": curated}


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
