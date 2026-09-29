"""成果物横断トークン（entity_tokens・データモデル §5.36b）の汎用 repository（owner 非依存・DRY）。

各ドメイン（info/ideas/concepts/quests/concepts.assumptions/…）はここを通じて token を置換・読取する。
owner_type は単数形（info/idea/concept/quest/assumption/strategy_doc）。呼び出し側 Tx に相乗（自身では commit しない）。
"""
from __future__ import annotations

import uuid

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.tenant.tokens.orm import EntityToken


def replace_tokens(session: Session, owner_type: str, owner_id: uuid.UUID, tokens: list[tuple[str, int]]) -> None:
    """当該 owner の entity_tokens を全置換（本文保存時に同期再生成・§5.36b）。"""
    session.execute(
        delete(EntityToken).where(EntityToken.owner_type == owner_type, EntityToken.owner_id == owner_id)
    )
    for tok, cnt in tokens:
        session.add(EntityToken(owner_type=owner_type, owner_id=owner_id, token=tok, count=cnt))


def tokens_for(session: Session, owner_type: str, owner_id: uuid.UUID) -> list[tuple[str, int]]:
    """当該 owner の保存済みトークン＝`[(token, count), …]`（count 降順）。"""
    rows = session.execute(
        select(EntityToken.token, EntityToken.count)
        .where(EntityToken.owner_type == owner_type, EntityToken.owner_id == owner_id)
        .order_by(EntityToken.count.desc(), EntityToken.token.asc())
    ).all()
    return [(t, int(c)) for t, c in rows]


def all_tokens_by_type(session: Session, owner_type: str) -> dict[uuid.UUID, list[tuple[str, int]]]:
    """owner_type の全 owner の保存済みトークン＝`{owner_id: [(token, count), …]}`（類似度の一括入力）。"""
    rows = session.execute(
        select(EntityToken.owner_id, EntityToken.token, EntityToken.count)
        .where(EntityToken.owner_type == owner_type)
    ).all()
    out: dict[uuid.UUID, list[tuple[str, int]]] = {}
    for owner_id, token, count in rows:
        out.setdefault(owner_id, []).append((token, int(count)))
    return out


def tokens_for_owners(
    session: Session, owner_type: str, owner_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[tuple[str, int]]]:
    """指定 owner 群の保存済みトークン（候補限定の一括取得・空 ID リストは `{}`）。"""
    if not owner_ids:
        return {}
    rows = session.execute(
        select(EntityToken.owner_id, EntityToken.token, EntityToken.count)
        .where(EntityToken.owner_type == owner_type, EntityToken.owner_id.in_(owner_ids))
    ).all()
    out: dict[uuid.UUID, list[tuple[str, int]]] = {}
    for owner_id, token, count in rows:
        out.setdefault(owner_id, []).append((token, int(count)))
    return out
