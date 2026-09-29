"""会社DB（テナントプレーン）の成果物横断トークン（派生・データモデル §5.36b entity_tokens）。

`info_tokens`（§5.36）を owner 非依存に一般化＝**情報／アイデア／コンセプト／クエスト／前提／経営資料**の本文を
同一機構（`janome`・`app/tenant/info/derive.py`）でトークン化し、自動関連付け（N.6）の双方向を都度再抽出なしで
行う土台にする。`chat_thread` の owner_type/owner_id 方式と同思想（多態・物理 FK なし・ソフト参照・§2.2#4）。

enum（owner_type）は §5.3 と同方針で DB enum 型は使わず String（Text）で持つ。呼び出し側 Tx に相乗（自身では commit しない）。
"""
from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import Integer, Numeric, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import CompanyBase


class EntityToken(CompanyBase):
    __tablename__ = "entity_tokens"
    __table_args__ = (UniqueConstraint("owner_type", "owner_id", "token", name="uq_entity_tokens"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # 論理 enum＝info/idea/concept/quest/assumption/strategy_doc（§5.36b・将来拡張は文字列追加のみ）。
    owner_type: Mapped[str] = mapped_column(Text, nullable=False)
    owner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)  # ソフト参照（多態・物理 FK なし）
    token: Mapped[str] = mapped_column(Text, nullable=False)
    weight: Mapped[Decimal | None] = mapped_column(Numeric(6, 4), nullable=True)  # TF-IDF 等（NULL なら count）
    count: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
