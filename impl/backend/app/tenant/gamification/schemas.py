"""ドメイン G（ゲーミフィケーション）の API DTO＝魔法カタログ/解放（SC-32・E.4 魔法の前提）。"""
from __future__ import annotations

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
