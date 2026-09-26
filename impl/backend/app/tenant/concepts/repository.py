"""会社DB コンセプト段の永続化プリミティブ（§5.38-5.46・P.1〜P.6）。

方針（evaluations/ideas.repository と同じ）:
- 呼び出し側 Tx に相乗（自身では commit しない）＝application が UoW 境界を持つ。
- 認可（クエスト権限・門番・状態機械）・XP/コイン付与・通知は application 層で強制。本 repository は永続化の原子操作のみ。
- enum は String 列＝妥当値の検証は application/schemas 層（本層は素通し）。
"""
from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.tenant.concepts.orm import (
    Assumption,
    AssumptionValidation,
    Concept,
    ConceptAssumptionLink,
    ConceptChatScope,
    ConceptDecisionLog,
    ConceptEvaluation,
    ConceptEvaluationRevision,
    ConceptEvaluationScore,
    ConceptRevision,
    ConceptSourceIdea,
    ConceptVote,
)

# 評価観点（§3.6・ISO §8.3.3）＝中核5＋補助3。
CORE_ASPECTS: tuple[str, ...] = ("desirability", "feasibility", "viability", "assumption_strength", "differentiation")
AUX_ASPECTS: tuple[str, ...] = ("novelty", "sustainability", "ip")
ALL_ASPECTS: tuple[str, ...] = CORE_ASPECTS + AUX_ASPECTS


# ---- concepts（§5.38） -----------------------------------------------------

def create_concept(
    session: Session, *, quest_id: uuid.UUID, author_id: uuid.UUID, title: str,
    problem: str | None = None, value_proposition: str | None = None, target: str | None = None,
    differentiation: str | None = None, solution_form: str | None = None,
    viability: dict | None = None,
) -> Concept:
    """コンセプトを作成（既定 status=draft/decision=undecided/is_selected=false）。総合ルーム生成は application。"""
    c = Concept(
        id=uuid.uuid4(), quest_id=quest_id, author_id=author_id, title=title,
        problem=problem, value_proposition=value_proposition, target=target,
        differentiation=differentiation, solution_form=solution_form,
        viability=viability if viability is not None else {},
    )
    session.add(c)
    session.flush()
    return c


def get_concept(session: Session, concept_id: uuid.UUID, *, include_deleted: bool = False) -> Concept | None:
    stmt = select(Concept).where(Concept.id == concept_id)
    if not include_deleted:
        stmt = stmt.where(Concept.deleted_at.is_(None))
    return session.execute(stmt).scalars().first()


def list_concepts_for_quest(session: Session, quest_id: uuid.UUID) -> list[Concept]:
    """クエスト配下の非削除コンセプト（可視性の絞り＝draft の本人限定は application）。"""
    return list(
        session.execute(
            select(Concept).where(Concept.quest_id == quest_id, Concept.deleted_at.is_(None))
        ).scalars().all()
    )


def soft_delete_concept(session: Session, concept: Concept, *, deleted_by_id: uuid.UUID) -> None:
    concept.deleted_at = func.now()
    concept.deleted_by_id = deleted_by_id
    session.flush()


# ---- concept_source_ideas（§5.39・置換） -----------------------------------

def set_source_ideas(session: Session, concept_id: uuid.UUID, idea_ids: list[uuid.UUID]) -> None:
    """由来アイデアを置換セットで全置換（`UNIQUE(concept_id, idea_id)`）。重複は畳む。"""
    for row in session.execute(
        select(ConceptSourceIdea).where(ConceptSourceIdea.concept_id == concept_id)
    ).scalars().all():
        session.delete(row)
    session.flush()
    for idea_id in dict.fromkeys(idea_ids):  # 順序保持で重複排除
        session.add(ConceptSourceIdea(id=uuid.uuid4(), concept_id=concept_id, idea_id=idea_id))
    session.flush()


def list_source_idea_ids(session: Session, concept_id: uuid.UUID) -> list[uuid.UUID]:
    return list(
        session.execute(
            select(ConceptSourceIdea.idea_id).where(ConceptSourceIdea.concept_id == concept_id)
        ).scalars().all()
    )


# ---- assumptions / validations（§5.40/§5.41） ------------------------------

def create_assumption(
    session: Session, *, quest_id: uuid.UUID, statement: str, created_by_id: uuid.UUID | None,
) -> Assumption:
    """前提を作成（既定 current_verdict=inconclusive）。"""
    a = Assumption(id=uuid.uuid4(), quest_id=quest_id, statement=statement, created_by_id=created_by_id)
    session.add(a)
    session.flush()
    return a


def get_assumption(session: Session, assumption_id: uuid.UUID) -> Assumption | None:
    return session.execute(
        select(Assumption).where(Assumption.id == assumption_id)
    ).scalars().first()


def list_assumptions_for_quest(session: Session, quest_id: uuid.UUID) -> list[Assumption]:
    return list(
        session.execute(select(Assumption).where(Assumption.quest_id == quest_id)).scalars().all()
    )


def add_validation(
    session: Session, *, assumption_id: uuid.UUID, method: str, verdict: str, validated_on: date,
    result: str | None = None, scale: str | None = None, created_by_id: uuid.UUID | None = None,
) -> AssumptionValidation:
    """検証イベントを追記（追記型で履歴）＋前提の current_verdict を最新イベントから再導出。"""
    v = AssumptionValidation(
        id=uuid.uuid4(), assumption_id=assumption_id, method=method, verdict=verdict,
        validated_on=validated_on, result=result, scale=scale, created_by_id=created_by_id,
    )
    session.add(v)
    session.flush()
    _recompute_current_verdict(session, assumption_id)
    return v


def list_validations(session: Session, assumption_id: uuid.UUID) -> list[AssumptionValidation]:
    """検証履歴（実施日降順・同日は記録日降順＝最新が先頭）。"""
    return list(
        session.execute(
            select(AssumptionValidation)
            .where(AssumptionValidation.assumption_id == assumption_id)
            .order_by(AssumptionValidation.validated_on.desc(), AssumptionValidation.created_at.desc())
        ).scalars().all()
    )


def _recompute_current_verdict(session: Session, assumption_id: uuid.UUID) -> None:
    """前提の現在判定＝最新の検証イベント（実施日→記録日の降順で先頭）の判定。無ければ inconclusive。"""
    latest = session.execute(
        select(AssumptionValidation.verdict)
        .where(AssumptionValidation.assumption_id == assumption_id)
        .order_by(AssumptionValidation.validated_on.desc(), AssumptionValidation.created_at.desc())
        .limit(1)
    ).scalars().first()
    assumption = get_assumption(session, assumption_id)
    if assumption is not None:
        assumption.current_verdict = latest or "inconclusive"
        session.flush()


def delete_assumption(session: Session, assumption_id: uuid.UUID) -> bool:
    """前提を削除。リンクが1件でも有れば削除せず False（先に解除を促す・P.3）。未リンクなら削除して True。"""
    linked = session.execute(
        select(func.count()).select_from(ConceptAssumptionLink).where(
            ConceptAssumptionLink.assumption_id == assumption_id
        )
    ).scalar_one()
    if linked:
        return False
    for row in session.execute(
        select(AssumptionValidation).where(AssumptionValidation.assumption_id == assumption_id)
    ).scalars().all():
        session.delete(row)
    a = get_assumption(session, assumption_id)
    if a is not None:
        session.delete(a)
    session.flush()
    return True


# ---- concept_assumption_links（§5.42） -------------------------------------

def link_assumption(
    session: Session, *, concept_id: uuid.UUID, assumption_id: uuid.UUID,
    criticality: str = "major", created_by_id: uuid.UUID | None = None,
) -> ConceptAssumptionLink:
    link = ConceptAssumptionLink(
        id=uuid.uuid4(), concept_id=concept_id, assumption_id=assumption_id,
        criticality=criticality, created_by_id=created_by_id,
    )
    session.add(link)
    session.flush()
    return link


def get_link(session: Session, concept_id: uuid.UUID, assumption_id: uuid.UUID) -> ConceptAssumptionLink | None:
    return session.execute(
        select(ConceptAssumptionLink).where(
            ConceptAssumptionLink.concept_id == concept_id,
            ConceptAssumptionLink.assumption_id == assumption_id,
        )
    ).scalars().first()


def list_links_for_concept(session: Session, concept_id: uuid.UUID) -> list[ConceptAssumptionLink]:
    return list(
        session.execute(
            select(ConceptAssumptionLink).where(ConceptAssumptionLink.concept_id == concept_id)
        ).scalars().all()
    )


def set_link_criticality_stale(
    session: Session, link: ConceptAssumptionLink, *, criticality: str | None = None, is_stale: bool | None = None,
) -> ConceptAssumptionLink:
    if criticality is not None:
        link.criticality = criticality
    if is_stale is not None:
        link.is_stale = is_stale
    session.flush()
    return link


def unlink_assumption(session: Session, concept_id: uuid.UUID, assumption_id: uuid.UUID) -> bool:
    """リンク解除（前提本体・エビデンスは残す＝単一ソース）。解除できたら True。"""
    link = get_link(session, concept_id, assumption_id)
    if link is None:
        return False
    session.delete(link)
    session.flush()
    return True


def mark_links_stale_for_assumption(session: Session, assumption_id: uuid.UUID) -> list[uuid.UUID]:
    """共有前提の反証波及＝リンク先の全リンクを is_stale=true にし、対象コンセプトIDを返す（通知は application）。"""
    links = list(
        session.execute(
            select(ConceptAssumptionLink).where(ConceptAssumptionLink.assumption_id == assumption_id)
        ).scalars().all()
    )
    affected: list[uuid.UUID] = []
    for link in links:
        link.is_stale = True
        affected.append(link.concept_id)
    session.flush()
    return affected


# ---- concept_evaluations / scores（§5.43/§5.44） ---------------------------

def get_evaluation(session: Session, concept_id: uuid.UUID, evaluator_id: uuid.UUID) -> ConceptEvaluation | None:
    return session.execute(
        select(ConceptEvaluation).where(
            ConceptEvaluation.concept_id == concept_id, ConceptEvaluation.evaluator_id == evaluator_id
        )
    ).scalars().first()


def upsert_evaluation(
    session: Session, concept_id: uuid.UUID, evaluator_id: uuid.UUID, *,
    overall_comment: str | None, recommendation: str | None, status: str, visibility: str,
) -> tuple[ConceptEvaluation, bool]:
    """評価を登録/更新（upsert・1人1評価）。返り値＝(evaluation, created)。submitted_at は application が管理。"""
    existing = get_evaluation(session, concept_id, evaluator_id)
    if existing is not None:
        existing.overall_comment = overall_comment
        existing.recommendation = recommendation
        existing.status = status
        existing.visibility = visibility
        return existing, False
    ev = ConceptEvaluation(
        id=uuid.uuid4(), concept_id=concept_id, evaluator_id=evaluator_id,
        overall_comment=overall_comment, recommendation=recommendation, status=status, visibility=visibility,
    )
    session.add(ev)
    session.flush()
    return ev, True


def replace_scores(
    session: Session, concept_evaluation_id: uuid.UUID, entries: list[tuple[str, int, str | None]],
) -> None:
    """観点スコアを置換セットで全置換（`UNIQUE(concept_evaluation_id, aspect)`）。entries＝(aspect, score, comment)。"""
    for row in session.execute(
        select(ConceptEvaluationScore).where(ConceptEvaluationScore.concept_evaluation_id == concept_evaluation_id)
    ).scalars().all():
        session.delete(row)
    session.flush()
    for aspect, score, comment in entries:
        session.add(ConceptEvaluationScore(
            id=uuid.uuid4(), concept_evaluation_id=concept_evaluation_id, aspect=aspect, score=score, comment=comment,
        ))
    session.flush()


def list_evaluations_for_concept(
    session: Session, concept_id: uuid.UUID, *, status: str | None = None,
) -> list[ConceptEvaluation]:
    stmt = select(ConceptEvaluation).where(ConceptEvaluation.concept_id == concept_id)
    if status is not None:
        stmt = stmt.where(ConceptEvaluation.status == status)
    return list(session.execute(stmt).scalars().all())


def get_scores_for_evaluations(
    session: Session, evaluation_ids: list[uuid.UUID],
) -> dict[uuid.UUID, list[ConceptEvaluationScore]]:
    """複数評価の観点スコアをまとめて取得（N+1 回避）。"""
    result: dict[uuid.UUID, list[ConceptEvaluationScore]] = {}
    if not evaluation_ids:
        return result
    rows = session.execute(
        select(ConceptEvaluationScore).where(ConceptEvaluationScore.concept_evaluation_id.in_(evaluation_ids))
    ).scalars().all()
    for s in rows:
        result.setdefault(s.concept_evaluation_id, []).append(s)
    return result


def aggregate_scores(session: Session, concept_id: uuid.UUID) -> dict:
    """submitted 評価の観点別平均・中核5の総合平均・推奨内訳・評価者数（可視性の適用は application）。"""
    evals = list_evaluations_for_concept(session, concept_id, status="submitted")
    scores = get_scores_for_evaluations(session, [e.id for e in evals])
    by_aspect: dict[str, list[int]] = {}
    for eid, rows in scores.items():
        for s in rows:
            by_aspect.setdefault(s.aspect, []).append(s.score)
    aspects = {a: (sum(v) / len(v)) for a, v in by_aspect.items() if v}
    core = [aspects[a] for a in CORE_ASPECTS if a in aspects]
    overall_avg = (sum(core) / len(core)) if core else None
    recommendations: dict[str, int] = {}
    for e in evals:
        if e.recommendation:
            recommendations[e.recommendation] = recommendations.get(e.recommendation, 0) + 1
    return {
        "aspects": aspects,
        "overall_avg": overall_avg,
        "evaluator_count": len(evals),
        "recommendations": recommendations,
    }


# ---- concept_votes（§5.46） ------------------------------------------------

def get_vote(session: Session, concept_id: uuid.UUID, user_id: uuid.UUID) -> ConceptVote | None:
    return session.execute(
        select(ConceptVote).where(ConceptVote.concept_id == concept_id, ConceptVote.user_id == user_id)
    ).scalars().first()


def upsert_vote(session: Session, concept_id: uuid.UUID, user_id: uuid.UUID, *, type: str) -> tuple[ConceptVote, bool]:
    """投票を登録/切替（1人1票）。返り値＝(vote, created)。XP 付与は application（初回のみ）。"""
    existing = get_vote(session, concept_id, user_id)
    if existing is not None:
        existing.type = type
        session.flush()
        return existing, False
    v = ConceptVote(id=uuid.uuid4(), concept_id=concept_id, user_id=user_id, type=type)
    session.add(v)
    session.flush()
    return v, True


def delete_vote(session: Session, concept_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    existing = get_vote(session, concept_id, user_id)
    if existing is None:
        return False
    session.delete(existing)
    session.flush()
    return True


def count_votes(session: Session, concept_id: uuid.UUID) -> dict[str, int]:
    rows = session.execute(
        select(ConceptVote.type, func.count()).where(ConceptVote.concept_id == concept_id).group_by(ConceptVote.type)
    ).all()
    return {t: n for t, n in rows}


# ---- concept_chat_scopes（§5.45） ------------------------------------------

def create_chat_scope(
    session: Session, *, concept_id: uuid.UUID, kind: str, label: str | None = None,
    assumption_id: uuid.UUID | None = None, position: int = 0,
) -> ConceptChatScope:
    scope = ConceptChatScope(
        id=uuid.uuid4(), concept_id=concept_id, kind=kind, label=label,
        assumption_id=assumption_id, position=position,
    )
    session.add(scope)
    session.flush()
    # concept_scope ホストのチャットスレッドを冪等生成（チャット中核は thread_id で動く・§5.45）。
    from app.tenant.chat import repository as chat_repo

    chat_repo.ensure_chat_thread(session, "concept_scope", scope.id)
    return scope


def get_scope_thread(session: Session, scope_id: uuid.UUID):
    """スコープのチャットスレッド（冪等生成して返す・チャット中核委譲の入口）。"""
    from app.tenant.chat import repository as chat_repo

    return chat_repo.ensure_chat_thread(session, "concept_scope", scope_id)


def list_chat_scopes(session: Session, concept_id: uuid.UUID) -> list[ConceptChatScope]:
    return list(
        session.execute(
            select(ConceptChatScope)
            .where(ConceptChatScope.concept_id == concept_id)
            .order_by(ConceptChatScope.position)
        ).scalars().all()
    )


def get_assumption_scope(
    session: Session, concept_id: uuid.UUID, assumption_id: uuid.UUID,
) -> ConceptChatScope | None:
    return session.execute(
        select(ConceptChatScope).where(
            ConceptChatScope.concept_id == concept_id,
            ConceptChatScope.kind == "assumption",
            ConceptChatScope.assumption_id == assumption_id,
        )
    ).scalars().first()


def remove_assumption_scope(session: Session, concept_id: uuid.UUID, assumption_id: uuid.UUID) -> None:
    """前提リンク解除に伴い、その前提スレッド（assumption スコープ）を除去（重複リンク防止）。"""
    scope = get_assumption_scope(session, concept_id, assumption_id)
    if scope is not None:
        session.delete(scope)
        session.flush()


def next_scope_position(session: Session, concept_id: uuid.UUID) -> int:
    current = session.execute(
        select(func.max(ConceptChatScope.position)).where(ConceptChatScope.concept_id == concept_id)
    ).scalar_one_or_none()
    return (current + 1) if current is not None else 0


def get_chat_scope(session: Session, scope_id: uuid.UUID) -> ConceptChatScope | None:
    return session.execute(
        select(ConceptChatScope).where(ConceptChatScope.id == scope_id)
    ).scalars().first()


# ---- コンセプト議論メッセージ/既読（§5.45・E 機構を chat_messages/chat_reads で共有） ----

def post_scope_message(
    session: Session, *, scope_id: uuid.UUID, author_id: uuid.UUID, body: str, message_id: uuid.UUID | None = None,
):
    """コンセプトルームへ投稿（scope の thread に紐付け・E 機構共有）。"""
    from app.tenant.chat.orm import ChatMessage

    thread = get_scope_thread(session, scope_id)
    msg = ChatMessage(id=message_id or uuid.uuid4(), thread_id=thread.id, author_id=author_id, body=body)
    session.add(msg)
    session.flush()
    return msg


def get_scope_message(session: Session, message_id: uuid.UUID):
    from app.tenant.chat.orm import ChatMessage

    return session.execute(select(ChatMessage).where(ChatMessage.id == message_id)).scalars().first()


def list_scope_messages(session: Session, scope_id: uuid.UUID, *, limit: int = 50):
    """スコープのメッセージ（作成日昇順・非削除・E.1 同形の簡易版）。"""
    from app.tenant.chat.orm import ChatMessage

    thread = get_scope_thread(session, scope_id)
    return list(
        session.execute(
            select(ChatMessage)
            .where(ChatMessage.thread_id == thread.id, ChatMessage.is_deleted.is_(False))
            .order_by(ChatMessage.created_at, ChatMessage.id)
            .limit(limit)
        ).scalars().all()
    )


def upsert_scope_read(session: Session, scope_id: uuid.UUID, user_id: uuid.UUID, last_read_message_id: uuid.UUID) -> None:
    from app.tenant.chat.orm import ChatRead

    thread = get_scope_thread(session, scope_id)
    existing = session.execute(
        select(ChatRead).where(ChatRead.thread_id == thread.id, ChatRead.user_id == user_id)
    ).scalars().first()
    if existing is not None:
        existing.last_read_message_id = last_read_message_id
        existing.updated_at = func.now()
    else:
        session.add(ChatRead(
            id=uuid.uuid4(), thread_id=thread.id, user_id=user_id,
            last_read_message_id=last_read_message_id,
        ))
    session.flush()


def unread_count_for_scope(session: Session, scope_id: uuid.UUID, user_id: uuid.UUID) -> int:
    """既読位置より後の非削除メッセージ数（自分の投稿も含む簡易集計）。未読既読が無ければ全件。"""
    from app.tenant.chat.orm import ChatMessage, ChatRead

    thread = get_scope_thread(session, scope_id)
    read = session.execute(
        select(ChatRead.last_read_message_id).where(
            ChatRead.thread_id == thread.id, ChatRead.user_id == user_id
        )
    ).scalars().first()
    base = select(func.count()).select_from(ChatMessage).where(
        ChatMessage.thread_id == thread.id, ChatMessage.is_deleted.is_(False)
    )
    if read:
        anchor = session.execute(
            select(ChatMessage.created_at).where(ChatMessage.id == read)
        ).scalars().first()
        if anchor is not None:
            base = base.where(ChatMessage.created_at > anchor)
    return session.execute(base).scalar_one()


# ---- 変更履歴（内容の版・意思決定ログ・§3.1/§3.2） ------------------------------

def add_revision(
    session: Session, concept_id: uuid.UUID, *, revision: int, editor_id: uuid.UUID,
    changes: dict, memo: str | None = None, context_snapshot: dict | None = None,
) -> ConceptRevision:
    rev = ConceptRevision(
        id=uuid.uuid4(), concept_id=concept_id, revision=revision, editor_id=editor_id,
        changes=changes, memo=memo, context_snapshot=context_snapshot,
    )
    session.add(rev)
    session.flush()
    return rev


def list_revisions(session: Session, concept_id: uuid.UUID, *, cursor: int | None = None, limit: int = 50) -> list[ConceptRevision]:
    """版タイムライン（新しい順・cursor=revision より前）。"""
    stmt = select(ConceptRevision).where(ConceptRevision.concept_id == concept_id)
    if cursor is not None:
        stmt = stmt.where(ConceptRevision.revision < cursor)
    stmt = stmt.order_by(ConceptRevision.revision.desc()).limit(limit)
    return list(session.execute(stmt).scalars().all())


def get_revision(session: Session, concept_id: uuid.UUID, revision: int) -> ConceptRevision | None:
    return session.execute(
        select(ConceptRevision).where(ConceptRevision.concept_id == concept_id, ConceptRevision.revision == revision)
    ).scalars().first()


def add_decision_log(
    session: Session, concept_id: uuid.UUID, *, kind: str, from_value: str | None, to_value: str,
    actor_id: uuid.UUID, reason: str | None = None, context_snapshot: dict | None = None,
) -> ConceptDecisionLog:
    log = ConceptDecisionLog(
        id=uuid.uuid4(), concept_id=concept_id, kind=kind, from_value=from_value, to_value=to_value,
        actor_id=actor_id, reason=reason, context_snapshot=context_snapshot,
    )
    session.add(log)
    session.flush()
    return log


def list_decision_log(session: Session, concept_id: uuid.UUID) -> list[ConceptDecisionLog]:
    """意思決定/ステータスの遷移ログ（新しい順）。"""
    return list(session.execute(
        select(ConceptDecisionLog).where(ConceptDecisionLog.concept_id == concept_id)
        .order_by(ConceptDecisionLog.created_at.desc(), ConceptDecisionLog.id.desc())
    ).scalars().all())


def verdict_counts_for_concept(session: Session, concept_id: uuid.UUID) -> dict[str, int]:
    """リンクされた前提の current_verdict 内訳（判断材料スナップ用・§3.3）。"""
    rows = session.execute(
        select(Assumption.current_verdict, func.count())
        .select_from(ConceptAssumptionLink)
        .join(Assumption, Assumption.id == ConceptAssumptionLink.assumption_id)
        .where(ConceptAssumptionLink.concept_id == concept_id)
        .group_by(Assumption.current_verdict)
    ).all()
    return {v: int(n) for v, n in rows}


# ---- コンセプト評価の確定版（変更履歴標準 §3.6） ----

def add_eval_revision(session: Session, evaluation_id: uuid.UUID, *, revision: int, editor_id: uuid.UUID, changes: dict) -> ConceptEvaluationRevision:
    rev = ConceptEvaluationRevision(id=uuid.uuid4(), evaluation_id=evaluation_id, revision=revision, editor_id=editor_id, changes=changes)
    session.add(rev)
    session.flush()
    return rev


def list_eval_revisions(session: Session, evaluation_id: uuid.UUID) -> list[ConceptEvaluationRevision]:
    return list(session.execute(
        select(ConceptEvaluationRevision).where(ConceptEvaluationRevision.evaluation_id == evaluation_id)
        .order_by(ConceptEvaluationRevision.revision.desc())
    ).scalars().all())


def get_eval_revision(session: Session, evaluation_id: uuid.UUID, revision: int) -> ConceptEvaluationRevision | None:
    return session.execute(
        select(ConceptEvaluationRevision).where(ConceptEvaluationRevision.evaluation_id == evaluation_id, ConceptEvaluationRevision.revision == revision)
    ).scalars().first()


def latest_eval_revision(session: Session, evaluation_id: uuid.UUID) -> ConceptEvaluationRevision | None:
    return session.execute(
        select(ConceptEvaluationRevision).where(ConceptEvaluationRevision.evaluation_id == evaluation_id)
        .order_by(ConceptEvaluationRevision.revision.desc()).limit(1)
    ).scalars().first()
