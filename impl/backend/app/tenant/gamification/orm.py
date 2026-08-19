"""会社DB（テナントプレーン）ゲーミフィケーションの ORM。

`activities`＝XP/コイン/SP の付与・消費の元帳（canonical・データモデル §5.27・§7）。残高
（`users.xp/coin_balance/skill_point_balance`）はこの元帳から導かれるキャッシュで、付与/消費は
必ず `activities` 追記＋残高更新を同一Tx で行う（整合の唯一の入口＝`app.tenant.gamification.ledger`）。
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import CompanyBase


class Activity(CompanyBase):
    __tablename__ = "activities"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    # 種別（論理 enum activity_kind・§3）: xp_gain/coin_gain/coin_spend/sp_gain/sp_spend
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    # 増減量（消費も正の量・方向は kind で表す・§5.27）
    amount: Mapped[int] = mapped_column(Integer, nullable=False)
    # 事由（login/idea_post/vote/... levelup_sp/shop_purchase 等・§5.27/G.6）
    reason: Mapped[str] = mapped_column(String(64), nullable=False)
    # クエスト内ランキング集計用（FK なし＝quests 未実装・多態参照は整合をアプリ層で担保）
    quest_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    # 多態参照の discriminator＋ID（ref_type と ref_id は必ず対・§5.27）。login/levelup_sp では NULL
    ref_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    ref_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
