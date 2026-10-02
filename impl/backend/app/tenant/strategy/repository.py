"""経営資料（strategy_documents）の永続化プリミティブ（データモデル §5.54・API R.1）。

呼び出し側 Tx に相乗（自身では commit しない）。一覧はサーバー委譲（q/status/doc_kind 絞り＋sort＋page）。
"""
from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from app.core import list_query as lq
from app.tenant.strategy.orm import IdeaAlignment, QuestStrategyDocument, StrategyDocument

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


# ---- クエスト↔経営資料リンク（quest_strategy_documents・§5.56・R.1b） ----

def quest_candidates(session: Session, *, q: str | None = None, statuses: list[str] | None = None,
                     deadline_from=None, deadline_to=None, limit: int = 50) -> list:
    """全社の有効クエスト（非削除）を候補として返す（管理者が紐づけ対象を選ぶ・R.0）。

    絞り込み＝タイトル(q)／ステータス(statuses)／期限(deadline_from..deadline_to・未設定は範囲指定時に除外)。
    返り値＝(id, title, status, deadline, owner_name, created_at, icon_image_path)。
    """
    from app.tenant.profile.orm import User
    from app.tenant.quests.orm import Quest
    conds = [Quest.deleted_at.is_(None)]
    if q:
        conds.append(Quest.title.ilike(f"%{q}%"))
    if statuses:
        conds.append(Quest.status.in_(statuses))
    if deadline_from:
        conds.append(Quest.deadline.isnot(None))
        conds.append(Quest.deadline >= deadline_from)
    if deadline_to:
        conds.append(Quest.deadline.isnot(None))
        conds.append(Quest.deadline <= deadline_to)
    return session.execute(
        select(Quest.id, Quest.title, Quest.status, Quest.deadline, User.display_name, Quest.created_at,
               Quest.icon_image_path)
        .join(User, User.id == Quest.owner_id, isouter=True)
        .where(*conds).order_by(Quest.title).limit(limit)
    ).all()


def quests_for_doc(session: Session, doc_id: uuid.UUID) -> list:
    """当該経営資料に紐づく（適用中の）クエスト＝(id, title, status, deadline, owner_name, created_at, icon_image_path)。"""
    from app.tenant.profile.orm import User
    from app.tenant.quests.orm import Quest
    return session.execute(
        select(Quest.id, Quest.title, Quest.status, Quest.deadline, User.display_name, Quest.created_at,
               Quest.icon_image_path)
        .join(QuestStrategyDocument, QuestStrategyDocument.quest_id == Quest.id)
        .join(User, User.id == Quest.owner_id, isouter=True)
        .where(QuestStrategyDocument.strategy_document_id == doc_id, Quest.deleted_at.is_(None))
        .order_by(Quest.title)
    ).all()


def is_quest_linked(session: Session, doc_id: uuid.UUID, quest_id: uuid.UUID) -> bool:
    return session.execute(
        select(QuestStrategyDocument.id)
        .where(QuestStrategyDocument.strategy_document_id == doc_id, QuestStrategyDocument.quest_id == quest_id)
    ).first() is not None


def add_quest_link(session: Session, doc_id: uuid.UUID, quest_id: uuid.UUID) -> bool:
    """リンク追加（既存なら何もしない）。追加したら True。"""
    if is_quest_linked(session, doc_id, quest_id):
        return False
    session.add(QuestStrategyDocument(id=uuid.uuid4(), quest_id=quest_id, strategy_document_id=doc_id))
    return True


def remove_quest_link(session: Session, doc_id: uuid.UUID, quest_id: uuid.UUID) -> None:
    session.execute(
        delete(QuestStrategyDocument)
        .where(QuestStrategyDocument.strategy_document_id == doc_id, QuestStrategyDocument.quest_id == quest_id)
    )


def doc_ids_for_quest(session: Session, quest_id: uuid.UUID) -> list[uuid.UUID]:
    """当該クエストが適用中の経営資料ID（整合率の母集合・§5.56）。"""
    return list(session.execute(
        select(QuestStrategyDocument.strategy_document_id).where(QuestStrategyDocument.quest_id == quest_id)
    ).scalars().all())


def reconcile_quest_docs(session: Session, quest_id: uuid.UUID, doc_ids: list[uuid.UUID]) -> bool:
    """クエスト側から適用経営資料を『あるべき全体像』へ差分適用（quest_group_ids 同型・R.1b・§5.56）。

    追加/削除があれば True（呼び出し側が整合率再計算の要否判定に使う）。順序は無視（集合）。
    """
    current = set(doc_ids_for_quest(session, quest_id))
    target = set(doc_ids)
    added, removed = target - current, current - target
    for did in added:
        session.add(QuestStrategyDocument(id=uuid.uuid4(), quest_id=quest_id, strategy_document_id=did))
    if removed:
        session.execute(
            delete(QuestStrategyDocument)
            .where(QuestStrategyDocument.quest_id == quest_id,
                   QuestStrategyDocument.strategy_document_id.in_(removed))
        )
    return bool(added or removed)


def quest_ids_for_doc(session: Session, doc_id: uuid.UUID) -> list[uuid.UUID]:
    """当該経営資料を適用中のクエストID（資料更新時の再計算対象・§5.56）。"""
    return list(session.execute(
        select(QuestStrategyDocument.quest_id).where(QuestStrategyDocument.strategy_document_id == doc_id)
    ).scalars().all())


def all_linked_quest_ids(session: Session) -> list[uuid.UUID]:
    """経営資料が1件でも紐づく全クエストID（重複排除）＝会社の方式変更時に整合率を全再計算する対象。"""
    return list(session.execute(
        select(QuestStrategyDocument.quest_id).distinct()
    ).scalars().all())


# ---- 整合率（idea_alignment・§5.55・R.2） ----

def upsert_alignment(session: Session, idea_id: uuid.UUID, doc_id: uuid.UUID, *, score: float,
                     method: str = "keyword", matched_tokens=None) -> None:
    """(idea, doc) の整合率を upsert（UNIQUE(idea_id, strategy_document_id)）。"""
    row = session.execute(
        select(IdeaAlignment).where(IdeaAlignment.idea_id == idea_id, IdeaAlignment.strategy_document_id == doc_id)
    ).scalars().first()
    if row is None:
        session.add(IdeaAlignment(idea_id=idea_id, strategy_document_id=doc_id,
                                  score=Decimal(str(round(score, 3))), method=method, matched_tokens=matched_tokens))
    else:
        row.score = Decimal(str(round(score, 3)))
        row.method = method
        row.matched_tokens = matched_tokens


def prune_alignment(session: Session, idea_id: uuid.UUID, keep_doc_ids: list[uuid.UUID]) -> None:
    """当該アイデアの整合率行のうち、現在の母集合に無い経営資料の分を削除（選択解除の反映）。"""
    conds = [IdeaAlignment.idea_id == idea_id]
    if keep_doc_ids:
        conds.append(IdeaAlignment.strategy_document_id.notin_(keep_doc_ids))
    session.execute(delete(IdeaAlignment).where(*conds))


def alignments_for_idea(session: Session, idea_id: uuid.UUID) -> list:
    """当該アイデアの整合率一覧＝(score, method, matched_tokens, doc_id, doc_title)（最大採用/ブレイクダウン用）。"""
    return session.execute(
        select(IdeaAlignment.score, IdeaAlignment.method, IdeaAlignment.matched_tokens,
               StrategyDocument.id, StrategyDocument.title)
        .join(StrategyDocument, StrategyDocument.id == IdeaAlignment.strategy_document_id)
        .where(IdeaAlignment.idea_id == idea_id)
        .order_by(IdeaAlignment.score.desc())
    ).all()


def ideas_for_doc(session: Session, doc_id: uuid.UUID, *, limit: int = 10) -> list:
    """当該経営資料に整合するアイデア＝(idea_id, title, score)（score 降順・上位 limit・Markdown export・R.5）。"""
    from app.tenant.ideas.orm import Idea
    return session.execute(
        select(Idea.id, Idea.title, IdeaAlignment.score)
        .join(Idea, Idea.id == IdeaAlignment.idea_id)
        .where(IdeaAlignment.strategy_document_id == doc_id, Idea.deleted_at.is_(None))
        .order_by(IdeaAlignment.score.desc(), Idea.title.asc())
        .limit(limit)
    ).all()


def idea_ids_for_doc(session: Session, doc_id: uuid.UUID) -> list[uuid.UUID]:
    """当該経営資料に整合する（非削除）アイデアの ID 全件（周辺ワードクラウドの語像集約・R.4b）。"""
    from app.tenant.ideas.orm import Idea
    return list(session.execute(
        select(IdeaAlignment.idea_id)
        .join(Idea, Idea.id == IdeaAlignment.idea_id)
        .where(IdeaAlignment.strategy_document_id == doc_id, Idea.deleted_at.is_(None))
    ).scalars().all())


def published_idea_ids_for_quest(session: Session, quest_id: uuid.UUID) -> list[uuid.UUID]:
    """当該クエストの公開アイデアID（クエストの資料選択変更で整合率を再計算する対象）。"""
    from app.tenant.ideas.orm import Idea
    return list(session.execute(
        select(Idea.id).where(Idea.quest_id == quest_id, Idea.deleted_at.is_(None), Idea.status == "published")
    ).scalars().all())


def strategy_docs_for_quest(session: Session, quest_id: uuid.UUID) -> list:
    """当該クエストが適用中の経営資料＝(id, title)（クエスト詳細/編集プリフィル用・R.1b/§5.56）。"""
    return session.execute(
        select(StrategyDocument.id, StrategyDocument.title)
        .join(QuestStrategyDocument, QuestStrategyDocument.strategy_document_id == StrategyDocument.id)
        .where(QuestStrategyDocument.quest_id == quest_id)
        .order_by(StrategyDocument.title)
    ).all()


def strategy_titles_for_quest(session: Session, quest_id: uuid.UUID) -> list[str]:
    """当該クエストが適用中の経営資料タイトル（版スナップショット用・§3.1）。"""
    rows = session.execute(
        select(StrategyDocument.title)
        .join(QuestStrategyDocument, QuestStrategyDocument.strategy_document_id == StrategyDocument.id)
        .where(QuestStrategyDocument.quest_id == quest_id)
    ).scalars().all()
    return sorted(rows)
