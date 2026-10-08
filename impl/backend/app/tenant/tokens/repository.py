"""成果物横断トークン（entity_tokens・データモデル §5.36b）の汎用 repository（owner 非依存・DRY）。

各ドメイン（info/ideas/concepts/quests/concepts.assumptions/…）はここを通じて token を置換・読取する。
owner_type は単数形（info/idea/concept/quest/assumption/strategy_doc）。呼び出し側 Tx に相乗（自身では commit しない）。
"""
from __future__ import annotations

import uuid

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.tenant.tokens.orm import EntityEmbedding, EntityToken


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


# ---- 埋め込みベクトル（entity_embeddings・意味的一致・A-2・FR-44） ----

def upsert_embedding(session: Session, owner_type: str, owner_id: uuid.UUID, *,
                     model: str, vector: list[float]) -> None:
    """当該 owner の埋め込みを1行 upsert（本文保存時に再生成）。model/dim も更新（差し替え追従）。"""
    row = session.execute(
        select(EntityEmbedding).where(
            EntityEmbedding.owner_type == owner_type, EntityEmbedding.owner_id == owner_id)
    ).scalar_one_or_none()
    if row is None:
        session.add(EntityEmbedding(owner_type=owner_type, owner_id=owner_id,
                                    model=model, dim=len(vector), vector=vector))
    else:
        row.model = model
        row.dim = len(vector)
        row.vector = vector


def embedding_for(session: Session, owner_type: str, owner_id: uuid.UUID, *, model: str) -> list[float] | None:
    """当該 owner の埋め込み（要求 model 一致のみ）。未生成/モデル不一致は None＝呼び出し側で再計算/フォールバック。"""
    row = session.execute(
        select(EntityEmbedding.vector, EntityEmbedding.model).where(
            EntityEmbedding.owner_type == owner_type, EntityEmbedding.owner_id == owner_id)
    ).first()
    if row is None or row[1] != model:
        return None
    return [float(x) for x in row[0]]


def embeddings_by_type(
    session: Session, owner_type: str, *, model: str
) -> dict[uuid.UUID, list[float]]:
    """当該 owner_type の保存済み埋め込みを一括取得（要求 model 一致のみ）。top-k 候補の母集団。

    モデル不一致/未生成の行は除外（cosine 比較は同一モデル空間でのみ意味を持つ）。owner 数がテナント規模で
    有界（経営資料は数十程度）な前提で全件読む＝ベクトル JSONB なので列は絞らず owner_id/vector のみ取る。
    """
    rows = session.execute(
        select(EntityEmbedding.owner_id, EntityEmbedding.vector).where(
            EntityEmbedding.owner_type == owner_type, EntityEmbedding.model == model)
    ).all()
    return {owner_id: [float(x) for x in vec] for owner_id, vec in rows}


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
