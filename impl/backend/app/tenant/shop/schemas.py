"""ドメイン G（ショップ/装備）の API DTO（§3.2・G.1/G.2）。"""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class ItemDTO(BaseModel):
    id: str
    code: str
    name_ja: str
    name_en: str
    slot: str  # head/face/body/hand/background
    rarity: str  # common/standard/rare
    price_coin: int
    owned: bool = False
    is_equipped: bool = False


class ItemListResponse(BaseModel):
    data: list[ItemDTO]
    coin_balance: int


class PurchaseResponse(BaseModel):
    item_id: str
    owned: bool
    coin_balance: int


class MyItemEntry(BaseModel):
    item_id: str
    name: str
    rarity: str
    is_equipped: bool


class MyItemsResponse(BaseModel):
    slots: dict[str, list[MyItemEntry]]
    equipped: dict[str, str | None]


class EquipmentRequest(BaseModel):
    """PUT /me/equipment（部分マップ・キー有=設定／null=外す／キー無=不変）。"""

    model_config = ConfigDict(extra="forbid")

    head: str | None = None
    face: str | None = None
    body: str | None = None
    hand: str | None = None
    background: str | None = None


class EquipmentResponse(BaseModel):
    equipped: dict[str, str | None]
