"""経営資料（strategy_documents）の永続化プリミティブ（データモデル §5.54・API R.1）。

呼び出し側 Tx に相乗（自身では commit しない）。一覧はサーバー委譲（q/status/doc_kind 絞り＋sort＋page）。
"""
from __future__ import annotations

import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core import list_query as lq
from app.tenant.strategy.orm import StrategyDocument

_SORT_COLUMNS = {
    "updated_at": StrategyDocument.updated_at,
    "created_at": StrategyDocument.created_at,
    "title": StrategyDocument.title,
    "doc_kind": StrategyDocument.doc_kind,
    "status": StrategyDocument.status,
    "period_from": StrategyDocument.period_from,
}


def create_document(session: Session, *, created_by_id: uuid.UUID, **fields) -> StrategyDocument:
    doc = StrategyDocument(id=uuid.uuid4(), created_by_id=created_by_id, **fields)
    session.add(doc)
    session.flush()
    return doc


def get_document(session: Session, doc_id: uuid.UUID) -> StrategyDocument | None:
    return session.get(StrategyDocument, doc_id)


def list_documents(
    session: Session, *, q: str | None, status: str | None, doc_kind: str | None,
    sort: str | None, page: int, per_page: int,
) -> tuple[list[StrategyDocument], int]:
    """一覧（サーバー委譲・R.1）＝(rows, total)。既定は全 status。sort はホワイトリスト（未知は 422）。"""
    conds = []
    if q:
        like = f"%{q}%"
        conds.append(or_(StrategyDocument.title.ilike(like), StrategyDocument.body_text.ilike(like)))
    if status:
        conds.append(StrategyDocument.status == status)
    if doc_kind:
        conds.append(StrategyDocument.doc_kind == doc_kind)

    order = lq.parse_sort(sort, _SORT_COLUMNS) or [StrategyDocument.updated_at.desc()]
    total = session.execute(select(func.count()).select_from(StrategyDocument).where(*conds)).scalar_one()
    rows = session.execute(
        select(StrategyDocument).where(*conds).order_by(*order)
        .offset((page - 1) * per_page).limit(per_page)
    ).scalars().all()
    return list(rows), int(total)


def selection_list(session: Session, *, q: str | None) -> list[StrategyDocument]:
    """選択用 軽量一覧（active のみ・R.0）＝クエストの適用資料選択に使う。"""
    conds = [StrategyDocument.status == "active"]
    if q:
        conds.append(StrategyDocument.title.ilike(f"%{q}%"))
    return list(session.execute(
        select(StrategyDocument).where(*conds).order_by(StrategyDocument.updated_at.desc())
    ).scalars().all())


# 物理削除は設けない（基本は論理削除＝アーカイブ・§R.1）。
