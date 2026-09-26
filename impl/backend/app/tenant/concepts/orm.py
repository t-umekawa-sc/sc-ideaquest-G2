"""会社DB コンセプト段の ORM（§5.38-5.46・ドメイン P・FR-42）。

②コンセプトの創造＋③コンセプトの検証。`concepts`（本体）＋`concept_source_ideas`（由来 M:N）＋
`assumptions`（クエスト単位の検証プール）＋`assumption_validations`（検証イベント・追記型）＋
`concept_assumption_links`（M:N＋criticality/is_stale）＋`concept_evaluations`＋`concept_evaluation_scores`
（中核5＋補助3）＋`concept_chat_scopes`（総合/グループ/前提スレッド）＋`concept_votes`。
enum（concept_status/concept_decision/assumption_verdict/concept_criticality/concept_eval_aspect/
concept_chat_scope_kind）は §5.3 と同方針で String 列で持つ。チャットは §5.45＝各 concept_chat_scope が
`chat_thread`（owner_type='concept_scope'）を1本持ち、チャット中核（chat_messages/chat_reads/reactions）は
thread_id ただ一つで動く（本モジュールはスコープ本体＝ホスト側 owner adapter のみ）。
"""
from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import CompanyBase


class Concept(CompanyBase):
    __tablename__ = "concepts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    quest_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("quests.id"), nullable=False)
    author_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    problem: Mapped[str | None] = mapped_column(Text, nullable=True)
    value_proposition: Mapped[str | None] = mapped_column(Text, nullable=True)
    target: Mapped[str | None] = mapped_column(Text, nullable=True)
    differentiation: Mapped[str | None] = mapped_column(Text, nullable=True)
    solution_form: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 価値実現モデル（ISO §8.3.3）＝柔軟構造。確定時の必須検証は application 層。
    viability: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    decision: Mapped[str] = mapped_column(String(16), nullable=False, default="undecided", server_default="undecided")
    decision_rationale: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft", server_default="draft")
    is_selected: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    current_revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ConceptSourceIdea(CompanyBase):
    __tablename__ = "concept_source_ideas"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    concept_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("concepts.id"), nullable=False)
    idea_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("ideas.id"), nullable=False)


class Assumption(CompanyBase):
    __tablename__ = "assumptions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    quest_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("quests.id"), nullable=False)
    statement: Mapped[str] = mapped_column(Text, nullable=False)
    # 最新の assumption_validations から導出したキャッシュ（イベント追記で更新）。
    current_verdict: Mapped[str] = mapped_column(
        String(16), nullable=False, default="inconclusive", server_default="inconclusive"
    )
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class AssumptionValidation(CompanyBase):
    __tablename__ = "assumption_validations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    assumption_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("assumptions.id"), nullable=False)
    method: Mapped[str] = mapped_column(Text, nullable=False)
    result: Mapped[str | None] = mapped_column(Text, nullable=True)
    verdict: Mapped[str] = mapped_column(String(16), nullable=False)  # supported/refuted/inconclusive
    validated_on: Mapped[date] = mapped_column(Date, nullable=False)  # 実施日（エビデンスの古さ）
    scale: Mapped[str | None] = mapped_column(Text, nullable=True)  # サンプル数/対象＝検証の強さ
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ConceptAssumptionLink(CompanyBase):
    __tablename__ = "concept_assumption_links"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    concept_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("concepts.id"), nullable=False)
    assumption_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("assumptions.id"), nullable=False)
    criticality: Mapped[str] = mapped_column(String(16), nullable=False, default="major", server_default="major")
    is_stale: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)


class ConceptEvaluation(CompanyBase):
    __tablename__ = "concept_evaluations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    concept_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("concepts.id"), nullable=False)
    evaluator_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    overall_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    recommendation: Mapped[str | None] = mapped_column(String(16), nullable=True)  # 評価者の Go/Pivot/Kill 推奨
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft", server_default="draft")
    visibility: Mapped[str] = mapped_column(String(16), nullable=False, default="party", server_default="party")
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ConceptEvaluationScore(CompanyBase):
    __tablename__ = "concept_evaluation_scores"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    concept_evaluation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("concept_evaluations.id"), nullable=False
    )
    aspect: Mapped[str] = mapped_column(String(24), nullable=False)  # 中核5＋補助3
    score: Mapped[int] = mapped_column(Integer, nullable=False)  # 1..5
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)


class ConceptChatScope(CompanyBase):
    __tablename__ = "concept_chat_scopes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    concept_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("concepts.id"), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)  # overall/group/assumption
    label: Mapped[str | None] = mapped_column(Text, nullable=True)
    assumption_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("assumptions.id"), nullable=True
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")


class ConceptVote(CompanyBase):
    __tablename__ = "concept_votes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    concept_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("concepts.id"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    type: Mapped[str] = mapped_column(String(16), nullable=False)  # approve/oppose（vote_type 共有）
    voted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ConceptRevision(CompanyBase):
    """コンセプト内容の版（変更履歴標準 §3.1・アイデア idea_revisions と同型）。"""
    __tablename__ = "concept_revisions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    concept_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("concepts.id"), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    editor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    changes: Mapped[dict] = mapped_column(JSONB, nullable=False)  # 版時点の追跡フィールド全値スナップショット
    memo: Mapped[str | None] = mapped_column(Text, nullable=True)  # 変更理由
    context_snapshot: Mapped[dict | None] = mapped_column(JSONB, nullable=True)  # 判断材料の数値サマリ（§3.3）
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ConceptEvaluationRevision(CompanyBase):
    """コンセプト評価の確定版スナップショット（変更履歴標準 §3.6・確定ごとに1版）。"""
    __tablename__ = "concept_evaluation_revisions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    evaluation_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("concept_evaluations.id", ondelete="CASCADE"), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    editor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    changes: Mapped[dict] = mapped_column(JSONB, nullable=False)  # scores/comments/overall_comment/recommendation/visibility
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ConceptDecisionLog(CompanyBase):
    """コンセプトの意思決定/ステータスの追記型ログ（変更履歴標準 §3.2）。"""
    __tablename__ = "concept_decision_log"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    concept_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("concepts.id"), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)  # status / decision
    from_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    to_value: Mapped[str] = mapped_column(Text, nullable=False)
    actor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    context_snapshot: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
