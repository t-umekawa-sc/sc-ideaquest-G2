"""ドメイン P（コンセプト）の API DTO（Pydantic・P.1/P.2）。

request は extra=forbid（Mass Assignment 防止・§2.2）。author_id/status/decision/監査列はクライアント入力を受けない
（状態遷移・選定・判定は専用EP）。名前は P 専用の一意名（Concept*）で OpenAPI schema 名の衝突を避ける。
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ConceptDecision = Literal["undecided", "go", "pivot", "kill"]


# ---- request（登録/編集・判定・P.2） ----


class ConceptCreateRequest(BaseModel):
    """POST /quests/{quest_id}/concepts（P.2）。既定 draft・作成時に総合ルーム自動生成。"""

    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1)
    source_idea_ids: list[str] = Field(default_factory=list)
    problem: str | None = None
    value_proposition: str | None = None
    target: str | None = None
    differentiation: str | None = None
    solution_form: str | None = None
    viability: dict = Field(default_factory=dict)


class ConceptPatchRequest(BaseModel):
    """PATCH /concepts/{id}（P.2）。部分更新。source_idea_ids は指定時のみ差し替え。"""

    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1)
    source_idea_ids: list[str] | None = None
    problem: str | None = None
    value_proposition: str | None = None
    target: str | None = None
    differentiation: str | None = None
    solution_form: str | None = None
    viability: dict | None = None


class ConceptDecisionRequest(BaseModel):
    """PUT /concepts/{id}/decision（P.2）。owner/quest_admin のみ。"""

    model_config = ConfigDict(extra="forbid")

    decision: ConceptDecision
    decision_rationale: str | None = None


# ---- response（P.1） ----


class ConceptSourceIdeaDTO(BaseModel):
    idea_id: str
    title: str | None = None


class ConceptAssumptionDTO(BaseModel):
    assumption_id: str
    statement: str
    criticality: str
    is_stale: bool
    current_verdict: str


class ConceptChatScopeDTO(BaseModel):
    scope_id: str
    kind: str
    label: str | None = None
    assumption_id: str | None = None
    position: int = 0


class ConceptEvalSummaryDTO(BaseModel):
    aspects: dict[str, float] = {}
    overall_avg: float | None = None
    evaluator_count: int = 0
    recommendations: dict[str, int] = {}


class ConceptListItemDTO(BaseModel):
    id: str
    title: str
    status: str
    decision: str
    is_selected: bool
    source_idea_count: int = 0
    assumption_count: int = 0
    eval_summary: ConceptEvalSummaryDTO = ConceptEvalSummaryDTO()
    author_id: str
    updated_at: datetime | None = None


class ConceptListResponse(BaseModel):
    items: list[ConceptListItemDTO] = []
    cursor: str | None = None


class ConceptDetailDTO(BaseModel):
    id: str
    quest_id: str
    author_id: str
    title: str
    problem: str | None = None
    value_proposition: str | None = None
    target: str | None = None
    differentiation: str | None = None
    solution_form: str | None = None
    viability: dict = {}
    decision: str
    decision_rationale: str | None = None
    status: str
    is_selected: bool
    current_revision: int
    source_ideas: list[ConceptSourceIdeaDTO] = []
    assumptions: list[ConceptAssumptionDTO] = []
    evaluation: ConceptEvalSummaryDTO = ConceptEvalSummaryDTO()
    chat_scopes: list[ConceptChatScopeDTO] = []
    related_info: list[dict] = []  # N 委譲（info_links target_type=concepts）＝結線は情報ドメイン実装時
    my_permissions: list[str] = []
    updated_at: datetime | None = None


class ConceptSelectResponse(BaseModel):
    id: str
    is_selected: bool
