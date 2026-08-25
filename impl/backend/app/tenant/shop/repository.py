"""会社DB ショップ/装備の永続化プリミティブ（§5.25/§5.26・G.1/G.2）。

呼び出し側 Tx に相乗（自身では commit しない）。認可・残高・状態機械は application 層で強制。
"""
from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.tenant.shop.orm import Item, UserItem

SLOTS: tuple[str, ...] = ("head", "face", "body", "hand", "background")


def list_items(session: Session) -> list[Item]:
    return list(session.execute(select(Item).order_by(Item.slot, Item.sort_order)).scalars().all())


def get_item(session: Session, item_id: uuid.UUID) -> Item | None:
    return session.execute(select(Item).where(Item.id == item_id)).scalars().first()


def list_user_items(session: Session, user_id: uuid.UUID) -> list[UserItem]:
    return list(session.execute(select(UserItem).where(UserItem.user_id == user_id)).scalars().all())


def get_user_item(session: Session, user_id: uuid.UUID, item_id: uuid.UUID) -> UserItem | None:
    return session.execute(
        select(UserItem).where(UserItem.user_id == user_id, UserItem.item_id == item_id)
    ).scalars().first()


def create_user_item(session: Session, user_id: uuid.UUID, item: Item) -> UserItem:
    """購入＝所有行を作成（slot は items.slot を非正規化コピー・未装備・§5.26）。"""
    ui = UserItem(id=uuid.uuid4(), user_id=user_id, item_id=item.id, slot=item.slot, is_equipped=False)
    session.add(ui)
    return ui


def get_equipped_in_slot(session: Session, user_id: uuid.UUID, slot: str) -> UserItem | None:
    return session.execute(
        select(UserItem).where(UserItem.user_id == user_id, UserItem.slot == slot, UserItem.is_equipped.is_(True))
    ).scalars().first()
