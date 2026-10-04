"""アイデアコンテストの DTO（API設計 T.1）。公開性は会社設定 `access_mode` 一本化＝visibility は持たない。"""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ContestCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    theme: str = Field(min_length=1, max_length=255)
    description: str | None = None
    mode: str = "bounded"            # bounded | rolling
    status: str = "draft"            # 作成時は draft か即 open（以降は PATCH で前進）
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    auto_archive_days: int | None = None
    auto_approve: bool = False        # Tier1 参加の自動承認（社内でも誰でも即参加・既定=承認制）
    prize_config: dict | None = None


class ContestUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    theme: str | None = None
    description: str | None = None
    status: str | None = None        # 状態遷移（前進・後退とも隣接1段）
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    auto_archive_days: int | None = None
    auto_approve: bool | None = None  # Tier1 参加の自動承認
    prize_config: dict | None = None


class ContestListItem(BaseModel):
    id: str
    mode: str
    status: str
    theme: str
    description: str | None = None          # 応募ダイアログの概要用（SC-53・承認制×未参加はダイアログで確認）
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    created_at: datetime
    auto_approve: bool = False              # 誰でも参加可（行クリックで詳細遷移の分岐・SC-53）
    participant_count: int = 0             # Tier1 承認済み参加人数（ダイアログのメタ）
    my_status: str = "none"               # 閲覧者の参加状態：none | requested | approved | rejected | left


class ContestListResponse(BaseModel):
    data: list[ContestListItem]
    can_manage: bool = False               # 会社レベルの運営可否（全行共通＝contest_create/管理者）


class ParticipationResponse(BaseModel):
    status: str  # requested | approved | rejected | left


class ParticipationDecideRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: str = Field(pattern="^(approved|rejected)$")


class ContestIdeaFlagDTO(BaseModel):
    idea_id: str
    flag: str                        # hall_of_fame | shelved


class ContestDetail(BaseModel):
    id: str
    quest_id: str                    # backing quest（アイデア/投票/評価/チャットの接続先）
    mode: str
    status: str
    theme: str
    description: str | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    auto_archive_days: int | None = None
    auto_approve: bool = False        # Tier1 参加の自動承認（誰でも即参加）か承認制か
    prize_config: dict | None = None
    created_at: datetime
    idea_count: int = 0
    flags: list[ContestIdeaFlagDTO] = []   # 殿堂入り/お蔵入り（SC-54 タブ導出・入賞は ideas.is_selected）
    my_participating_idea_ids: list[str] = []  # ログインユーザーが議論に参加（投稿者 or Tier2承認）するアイデア（新着の議論の限定用）
    can_manage: bool = False               # 運営操作（状態遷移/削除/パーティタブ）可否＝管理者 or contest_create
    owner_user_id: str | None = None       # 主催者（created_by・パーティタブで所有者表示）
    owner_display_name: str | None = None


class ContestParticipantDTO(BaseModel):
    """Tier1 参加者1件（パーティタブ・運営用）。"""
    user_id: str
    display_name: str | None = None
    status: str                            # requested | approved | rejected | left
    is_evaluator: bool = False             # ②会社レベル能力 contest_evaluator 保持（審査員）
    requested_at: datetime | None = None
    decided_at: datetime | None = None


class ContestParticipantsResponse(BaseModel):
    data: list[ContestParticipantDTO]


class EvaluatorUpdateRequest(BaseModel):
    """審査員（contest_evaluator）付与/剥奪（パーティタブ・運営）。"""
    model_config = ConfigDict(extra="forbid")
    granted: bool


class IdeaParticipantBriefDTO(BaseModel):
    user_id: str
    display_name: str | None = None
    status: str                            # requested | approved | rejected | left


class IdeaParticipationContextDTO(BaseModel):
    """Tier2 参加の文脈（SC-22/SC-24 の参加導線用）。"""
    is_contest: bool
    is_author: bool
    my_status: str                         # author | none | requested | approved | rejected | left
    requests: list[IdeaParticipantBriefDTO] = []  # 投稿者にのみ返す（承認管理用）


class IdeaFlagUpdateRequest(BaseModel):
    """アイデアの入賞/殿堂入り/お蔵入りの手動設定（SC-54 アイデアタブ・運営）。"""
    model_config = ConfigDict(extra="forbid")
    flag: str                              # selected | hall_of_fame | shelved
    on: bool


class ContestCandidateDTO(BaseModel):
    """パーティ追加の候補ユーザー（会社の有効ユーザー・既参加/主催者は除外）。"""
    user_id: str
    display_name: str


class ContestCandidatesResponse(BaseModel):
    data: list[ContestCandidateDTO]
    next_cursor: str | None = None         # 「もっと見る」用カーソル（keyset・なければ null）
    has_next: bool = False


class ContestRankingEntry(BaseModel):
    """ランキング1件。軸により idea_id（成果軸）or user_id（貢献軸）のいずれかが主体。"""
    rank: int
    user_id: str                     # 受益者（成果軸=アイデア投稿者／貢献軸=本人）
    display_name: str | None = None
    idea_id: str | None = None       # 成果軸（approve_votes/avg_score）のみ
    metric: float                    # 集計値（投票数・平均点・活動件数）


class ContestRankingResponse(BaseModel):
    axis: str                        # approve_votes | avg_score | contribution
    data: list[ContestRankingEntry]


class ContestFinalizeResponse(BaseModel):
    """表彰確定の結果サマリ（冪等・再実行で件数は同じ・新規付与は0になる）。"""
    status: str                      # closed
    awarded_users: int               # 受賞ユーザー数（延べでなくユニーク）
    selected_ideas: int              # is_selected を立てたアイデア数
    granted_now: int                 # 本実行で新規に付与した台帳件数（再実行は0）
