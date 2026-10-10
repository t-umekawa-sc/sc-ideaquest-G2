"""ドメイン F（評価）の API DTO（Pydantic・§3.2・F.1/F.2/F.3）。

request は extra=forbid（Mass Assignment 防止・§2.2）。evaluator_id/submitted_at/監査列はクライアント入力を受けない。
名前は F 専用の一意名（Evaluation*）で OpenAPI schema 名の衝突を避ける。
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ASPECTS = ("novelty", "impact", "feasibility", "fit", "cost")

EvaluationStatus = Literal["draft", "submitted"]
# private＝投稿者＋その評価者のみ（owner/quest_admin も不可・limited より 1 段狭い・2026-10-08）。
EvaluationVisibility = Literal["party", "limited", "private"]


# ---- request（登録/更新・F.2） ----


class EvaluationPutRequest(BaseModel):
    """PUT /ideas/{id}/evaluation（F.2）。submitted は全5観点＋総評をサーバー検証。"""

    model_config = ConfigDict(extra="forbid")

    scores: dict[str, int] = Field(default_factory=dict)  # {aspect: 1..5}
    comments: dict[str, str] = Field(default_factory=dict)  # {aspect: comment}（任意）
    overall_comment: str | None = None
    visibility: EvaluationVisibility = "party"
    status: EvaluationStatus = "draft"


# ---- response（自分の評価・集計・F.1） ----


class EvaluationAuthorDTO(BaseModel):
    user_id: str
    display_name: str
    avatar_image_url: str | None = None
    level: int | None = None


class EvaluationRevisionDTO(BaseModel):
    """自分の評価の確定版1行（SC-25 折り畳みUI・§3.6）。changed_fields＝前版比の変更（初版は空）。"""
    revision: int
    created_at: datetime
    changed_fields: list[str] = []


class EvaluationMeDTO(BaseModel):
    """自分の評価/下書き（SC-25 読み込み・F.1）。未作成は status=null。

    xp_delta＝この確定(submitted)で実際に付与した評価 XP（初回のみ +30・冪等スキップ/下書き保存/参照時は 0）
    ＝獲得フィードバック用（#8）。金額の正はサーバー（F 台帳 evaluation=+30）。
    revisions＝確定ごとの版メタ（折り畳みUI・差分は別 EP で取得・§3.6）。
    """

    status: EvaluationStatus | None = None
    scores: dict[str, int] = {}
    comments: dict[str, str] = {}
    overall_comment: str | None = None
    visibility: EvaluationVisibility = "party"
    submitted_at: datetime | None = None
    xp_delta: int = 0
    revisions: list[EvaluationRevisionDTO] = []


class EvaluationDiffSegment(BaseModel):
    op: Literal["equal", "add", "del"]
    text: str


class EvaluationDiffField(BaseModel):
    kind: Literal["text", "scalar"]
    segments: list[EvaluationDiffSegment] | None = None
    old: str | None = None
    new: str | None = None


class EvaluationRevisionDiffResponse(BaseModel):
    from_revision: int
    to_revision: int
    fields: dict[str, EvaluationDiffField] = {}


class EvaluationEvaluatorDTO(BaseModel):
    """集計に含める1評価者の内訳（SC-22 §4.6・可視な評価のみ・人間のみ）。"""

    evaluator: EvaluationAuthorDTO
    scores: dict[str, int] = {}
    comments: dict[str, str] = {}
    overall_comment: str | None = None
    visibility: str | None = None       # party/limited/private（代表コメント母集団・#13・F.1.1）
    submitted_at: datetime | None = None  # 同点タイブレーク「先に確定」用（F.1.1）


class AiEvaluationDTO(BaseModel):
    """AI 評価の別枠ブロック（FR-50・F.7.4）。人間の evaluators[] とは分離して返す。"""

    scores: dict[str, int] = {}
    comments: dict[str, str] = {}
    overall_comment: str | None = None
    model: str | None = None
    generated_at: datetime | None = None
    job_id: uuid.UUID | None = None


class AiEvaluationJobResponse(BaseModel):
    """AI 評価の生成/再生成 enqueue 応答（202 相当・F.7.3）。"""

    job_id: str
    status: str = "queued"


class EvaluationCoinDTO(BaseModel):
    """投稿者コイン（F.4）。projected＝現時点の見込み・finalized＝確定額（確定済みのみ）。"""

    projected: int = 0
    finalized: int | None = None
    finalized_at: datetime | None = None


class EvaluationAggregateDTO(BaseModel):
    """評価結果の集計（SC-22 §4.6 右レール・F.1）。閲覧者に可視な評価のみで算定。"""

    aspects: dict[str, float] = {}  # 観点別平均
    overall_avg: float | None = None
    evaluator_count: int = 0          # 人間の提出済み人数（AI は数えない・F.1）
    evaluators: list[EvaluationEvaluatorDTO] = []  # 人間の評価者のみ
    ai_evaluation: AiEvaluationDTO | None = None   # AI 評価の別枠ブロック（FR-50・F.7.4）
    ai_evaluation_available: bool = False  # 会社で AI 評価モデルが有効か＝手動実行ボタンの表示判定（F.7.3）
    coin: EvaluationCoinDTO = EvaluationCoinDTO()
    my_evaluation: EvaluationMeDTO | None = None
    my_permissions: list[str] = []  # UX 出し分け（evaluate/select）


class IdeaSelectResponse(BaseModel):
    """POST/DELETE /ideas/{id}/select（F.3）。"""

    id: str
    is_selected: bool
    # この呼び出しで新規に投稿者 XP を付与したか（初回選定のみ true・冪等）。再選定は false＝祝福を出さない。
    xp_awarded: bool = False
