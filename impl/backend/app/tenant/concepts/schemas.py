"""ドメイン P（コンセプト）の API DTO（Pydantic・P.1/P.2）。

request は extra=forbid（Mass Assignment 防止・§2.2）。author_id/status/decision/監査列はクライアント入力を受けない
（状態遷移・選定・判定は専用EP）。名前は P 専用の一意名（Concept*）で OpenAPI schema 名の衝突を避ける。
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ConceptDecision = Literal["undecided", "go", "pivot", "kill"]
AssumptionVerdict = Literal["inconclusive", "supported", "refuted"]
ConceptCriticality = Literal["critical", "major", "minor"]


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


class ConceptAuthorDTO(BaseModel):
    user_id: str
    display_name: str
    avatar_image_url: str | None = None
    level: int | None = None


class ConceptVoteSummaryDTO(BaseModel):
    approve: int = 0
    oppose: int = 0


class ConceptVoteStateDTO(BaseModel):
    summary: ConceptVoteSummaryDTO = ConceptVoteSummaryDTO()
    my_vote: str | None = None


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
    author: ConceptAuthorDTO | None = None
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
    related_info: list[dict] = []  # N 委譲（info_links target_type=concepts）＝RelatedInfoPanel は別 read EP を叩く
    vote: ConceptVoteStateDTO = ConceptVoteStateDTO()  # 投票集計＋自分の投票（SC-61 投票パネル・P.5b）
    my_permissions: list[str] = []
    updated_at: datetime | None = None


class ConceptSelectResponse(BaseModel):
    id: str
    is_selected: bool


# ---- 前提＝検証プール（P.3）・リンク（P.4） ----


class AssumptionCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    statement: str = Field(min_length=1)


class AssumptionPatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    statement: str = Field(min_length=1)


class ValidationCreateRequest(BaseModel):
    """POST /assumptions/{id}/validations（P.3・追記型）。refuted は反証波及を発火。"""
    model_config = ConfigDict(extra="forbid")
    method: str = Field(min_length=1)
    verdict: AssumptionVerdict
    validated_on: date
    result: str | None = None
    scale: str | None = None


class LinkCreateRequest(BaseModel):
    """POST /concepts/{id}/assumptions（P.4）。既存前提を重要度付きでリンク。"""
    model_config = ConfigDict(extra="forbid")
    assumption_id: str
    criticality: ConceptCriticality = "major"


class LinkPatchRequest(BaseModel):
    """PATCH /concepts/{id}/assumptions/{aid}（P.4）。重要度変更／要再評価(stale)解除。"""
    model_config = ConfigDict(extra="forbid")
    criticality: ConceptCriticality | None = None
    is_stale: bool | None = None


class ValidationDTO(BaseModel):
    id: str
    method: str
    result: str | None = None
    verdict: str
    validated_on: date
    scale: str | None = None
    created_at: datetime | None = None


class LinkedConceptDTO(BaseModel):
    concept_id: str
    title: str
    criticality: str
    is_stale: bool


class AssumptionListItemDTO(BaseModel):
    id: str
    statement: str
    current_verdict: str
    validation_count: int = 0
    linked_concept_count: int = 0
    latest_validated_on: date | None = None


class AssumptionListResponse(BaseModel):
    items: list[AssumptionListItemDTO] = []
    cursor: str | None = None


class AssumptionDetailDTO(BaseModel):
    id: str
    quest_id: str
    statement: str
    current_verdict: str
    validations: list[ValidationDTO] = []
    linked_concepts: list[LinkedConceptDTO] = []
    related_info: list[dict] = []
    my_permissions: list[str] = []


class ValidationListResponse(BaseModel):
    items: list[ValidationDTO] = []


class ValidationAddResponse(BaseModel):
    """検証追記の結果（P.3）。refuted は stale_concept_ids に波及先を返す（P.7）。"""
    validation: ValidationDTO
    current_verdict: str
    stale_concept_ids: list[str] = []


class LinkDTO(BaseModel):
    concept_id: str
    assumption_id: str
    criticality: str
    is_stale: bool


# ---- コンセプト評価（P.5） ----

EvalStatus = Literal["draft", "submitted"]
EvalVisibility = Literal["party", "limited"]
Recommendation = Literal["go", "pivot", "kill"]


class ConceptEvaluationPutRequest(BaseModel):
    """PUT /concepts/{id}/evaluation（P.5）。submitted は中核5(1..5)＋総評＋推奨をサーバー検証。"""
    model_config = ConfigDict(extra="forbid")
    scores: dict[str, int] = Field(default_factory=dict)
    comments: dict[str, str] = Field(default_factory=dict)
    overall_comment: str | None = None
    recommendation: Recommendation | None = None
    visibility: EvalVisibility = "party"
    status: EvalStatus = "draft"


class ConceptEvaluationMeDTO(BaseModel):
    status: EvalStatus | None = None
    scores: dict[str, int] = {}
    comments: dict[str, str] = {}
    overall_comment: str | None = None
    recommendation: str | None = None
    visibility: EvalVisibility = "party"
    submitted_at: datetime | None = None


class ConceptEvaluatorDTO(BaseModel):
    evaluator_id: str
    evaluator: ConceptAuthorDTO | None = None
    recommendation: str | None = None
    scores: dict[str, int] = {}
    overall_comment: str | None = None
    comments: dict[str, str] = {}


class ConceptEvaluationAggregateDTO(BaseModel):
    aspects: dict[str, float] = {}
    overall_avg: float | None = None
    evaluator_count: int = 0
    recommendations: dict[str, int] = {}
    evaluators: list[ConceptEvaluatorDTO] = []
    my_evaluation: ConceptEvaluationMeDTO | None = None
    stale: bool = False  # リンク前提の反証で要再評価（SC-62 バナー源・P.7）
    my_permissions: list[str] = []


# ---- コンセプト投票（P.5b） ----


class ConceptVoteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["approve", "oppose"]


class ConceptVoteSummary(BaseModel):
    approve: int = 0
    oppose: int = 0


class ConceptVoteResponse(BaseModel):
    my_vote: str | None = None
    summary: ConceptVoteSummary = ConceptVoteSummary()
    xp_awarded: bool = False
    xp_delta: int = 0


# ---- コンセプト議論チャット（P.6） ----


class ConceptChatScopeItemDTO(BaseModel):
    scope_id: str
    kind: str
    label: str | None = None
    assumption_id: str | None = None
    position: int = 0
    unread_count: int = 0


class ConceptChatScopeListResponse(BaseModel):
    items: list[ConceptChatScopeItemDTO] = []


class ConceptGroupScopeCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["group"] = "group"
    label: str = Field(min_length=1)


class ConceptChatMessageDTO(BaseModel):
    id: str
    author_id: str
    body: str
    created_at: datetime | None = None


class ConceptChatMessageListResponse(BaseModel):
    items: list[ConceptChatMessageDTO] = []


class ConceptMessagePostRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    body: str = Field(min_length=1)


class ConceptReadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    last_read_message_id: str
