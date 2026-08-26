"""会社DB 評価・観点スコアの永続化プリミティブ（§5.21/§5.22・F.1〜F.4）。

方針（ideas.repository と同じ）:
- 呼び出し側 Tx に相乗（自身では commit しない）＝application が UoW 境界を持つ。
- 認可（権限・門番・状態機械）・XP/コイン付与は application 層で強制。本 repository は永続化の原子操作のみ。
"""
from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.tenant.evaluations.orm import Evaluation, EvaluationScore

ASPECTS: tuple[str, ...] = ("novelty", "impact", "feasibility", "fit", "cost")


def get_evaluation(session: Session, idea_id: uuid.UUID, evaluator_id: uuid.UUID) -> Evaluation | None:
    """評価者1人1評価（`UNIQUE(idea_id, evaluator_id)`）を取得。無ければ None。"""
    return session.execute(
        select(Evaluation).where(Evaluation.idea_id == idea_id, Evaluation.evaluator_id == evaluator_id)
    ).scalars().first()


def upsert_evaluation(
    session: Session, idea_id: uuid.UUID, evaluator_id: uuid.UUID,
    *, overall_comment: str | None, status: str, visibility: str,
) -> tuple[Evaluation, bool]:
    """評価を登録/更新（upsert・1人1評価）。返り値＝(evaluation, created)。submitted_at は application が管理。"""
    existing = get_evaluation(session, idea_id, evaluator_id)
    if existing is not None:
        existing.overall_comment = overall_comment
        existing.status = status
        existing.visibility = visibility
        return existing, False
    ev = Evaluation(
        id=uuid.uuid4(), idea_id=idea_id, evaluator_id=evaluator_id,
        overall_comment=overall_comment, status=status, visibility=visibility,
    )
    session.add(ev)
    session.flush()
    return ev, True


def list_scores(session: Session, evaluation_id: uuid.UUID) -> list[EvaluationScore]:
    return list(
        session.execute(
            select(EvaluationScore).where(EvaluationScore.evaluation_id == evaluation_id)
        ).scalars().all()
    )


def replace_scores(session: Session, evaluation_id: uuid.UUID, entries: list[tuple[str, int, str | None]]) -> None:
    """観点スコアを置換セットで全置換（`UNIQUE(evaluation_id, aspect)`・§5.22）。entries＝(aspect, score, comment)。"""
    for row in session.execute(
        select(EvaluationScore).where(EvaluationScore.evaluation_id == evaluation_id)
    ).scalars().all():
        session.delete(row)
    session.flush()
    for aspect, score, comment in entries:
        session.add(EvaluationScore(id=uuid.uuid4(), evaluation_id=evaluation_id, aspect=aspect, score=score, comment=comment))


def list_draft_evaluations_by_evaluator(session: Session, evaluator_id: uuid.UUID) -> list[Evaluation]:
    """本人の下書き評価（全アイデア横断・SC-01 下書き・I.3）。進捗 scored/5 は application が `list_scores` で算出。"""
    return list(
        session.execute(
            select(Evaluation).where(
                Evaluation.evaluator_id == evaluator_id, Evaluation.status == "draft"
            )
        ).scalars().all()
    )


def list_submitted_evaluations_for_ideas(session: Session, idea_ids: list[uuid.UUID]) -> list[Evaluation]:
    """複数アイデアの submitted 評価を一括取得（SC-12 一覧の評価集計・D.1）。"""
    if not idea_ids:
        return []
    return list(
        session.execute(
            select(Evaluation).where(
                Evaluation.idea_id.in_(idea_ids), Evaluation.status == "submitted"
            )
        ).scalars().all()
    )


def list_evaluations_for_idea(session: Session, idea_id: uuid.UUID, *, status: str | None = None) -> list[Evaluation]:
    """アイデアの評価一覧（新しい提出順の安定化は application 側）。status 指定で絞る（例＝'submitted'）。"""
    stmt = select(Evaluation).where(Evaluation.idea_id == idea_id)
    if status is not None:
        stmt = stmt.where(Evaluation.status == status)
    return list(session.execute(stmt).scalars().all())


def get_scores_for_evaluations(session: Session, evaluation_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[EvaluationScore]]:
    """複数評価の観点スコアをまとめて取得（N+1 回避）。"""
    result: dict[uuid.UUID, list[EvaluationScore]] = {}
    if not evaluation_ids:
        return result
    rows = session.execute(
        select(EvaluationScore).where(EvaluationScore.evaluation_id.in_(evaluation_ids))
    ).scalars().all()
    for s in rows:
        result.setdefault(s.evaluation_id, []).append(s)
    return result
