"""ドメイン G（ゲーミフィケーション）の API DTO＝魔法カタログ/解放（SC-32・E.4 魔法の前提）。"""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class SpellDTO(BaseModel):
    """魔法カタログ1件（§5.19）＋当該ユーザーの解放状態。"""

    id: str
    code: str
    name_ja: str
    name_en: str
    icon: str
    effect: str
    sp_cost: int
    rarity: str
    line: str
    requires_spell_id: str | None = None
    sort_order: int
    unlocked: bool = False
    can_unlock: bool = False  # 前提解放済み＋未所有＋SP 充足（サーバー算出・UX 出し分け）


class SpellCatalogResponse(BaseModel):
    data: list[SpellDTO]
    skill_point_balance: int


class SpellUnlockResponse(BaseModel):
    spell_id: str
    unlocked: bool
    skill_point_balance: int


# ---- ランキング（G.5） ----


class RankingUserDTO(BaseModel):
    id: str
    name: str
    avatar: str | None = None
    level: int | None = None


class RankingRowDTO(BaseModel):
    rank: int
    user: RankingUserDTO
    score: int
    xp: int
    coin: int


class RankingMeDTO(BaseModel):
    rank: int | None = None
    score: int = 0
    xp: int = 0
    coin: int = 0
    total_users: int = 0


class RankingCursorPageInfo(BaseModel):
    next_cursor: str | None = None
    has_next: bool


class RankingResponse(BaseModel):
    data: list[RankingRowDTO]
    page_info: RankingCursorPageInfo
    me: RankingMeDTO


# --- アクティビティフィード（SC-12 クエスト内 / SC-01 チーム・G.5.1） ---
class FeedActivityDTO(BaseModel):
    """他者フィードの1行（公開種別のみ）。actor＝実行者・`quest_title` はチームフィード（SC-01）のみ付与。"""
    id: str
    reason: str
    kind: str
    amount: int
    ref_type: str | None = None
    ref_id: str | None = None
    quest_id: str | None = None
    quest_title: str | None = None
    actor: RankingUserDTO
    created_at: datetime


class QuestFeedResponse(BaseModel):
    """`GET /quests/{quest_id}/activities`（SC-12・G.5.1）＝クエスト内フィード（カーソル・新しい順）。"""
    data: list[FeedActivityDTO]
    page_info: RankingCursorPageInfo


class TeamFeedResponse(BaseModel):
    """`GET /me/feed`（SC-01・G.5.1）＝参加クエスト横断のチームフィード（各行に quest 付き）。"""
    data: list[FeedActivityDTO]
    page_info: RankingCursorPageInfo
