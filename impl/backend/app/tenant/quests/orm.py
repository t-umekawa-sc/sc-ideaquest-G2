"""会社DB（テナントプレーン）のクエスト・カテゴリ・パーティー・権限モデル（データモデル §5.6〜§5.9）。

- `quests`＝クエスト本体（`owner_id`＝作成者＝所有者・剥奪不可・§5.6）。論理削除は `deleted_at`＋`deleted_by_id`。
- `quest_categories`＝クエストカテゴリ（複数可・`UNIQUE(quest_id, label)`・§5.7）。置換セットで運用。
- `quest_members`＝パーティー（クエスト参加者・§5.8）。除外は `removed_at` トゥームストーン、
  有効参加は部分ユニーク `UNIQUE(quest_id, user_id) WHERE removed_at IS NULL`（index は migration 側）。
- `quest_member_permissions`＝参加者権限（6 権限・`UNIQUE(quest_member_id, permission)`・§5.9）。

enum（`quest_status`/`permission_type`）は §5.3 と同方針で会社DBでも String で持つ（DB enum 型は使わない）。
呼び出し側 Tx に相乗する repository と組み合わせる（自身では commit しない・quest_group と同方針）。
"""
from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import CompanyBase


class Quest(CompanyBase):
    __tablename__ = "quests"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # 参加部署（クエストグループ）は `quest_group_links` に多対多（0..N）で保持＝クエスト本体は単一グループ FK を
    # 持たない（FR-38 再設計・2026-09-11・§5.6/§5.6b。主グループ〔quest_group_id〕は撤去）。
    # 作成者＝既定で所有者（`owner` 権限・剥奪不可・§5.6/C.0）。
    owner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    # プリセットパレット hex（既定色）。バリデーションは application 側（§C.6 入力検証）。
    color: Mapped[str] = mapped_column(String(32), nullable=False)
    purpose: Mapped[str | None] = mapped_column(String, nullable=True)
    deadline: Mapped[date | None] = mapped_column(Date, nullable=True)
    # quest_status（draft/recruiting/in_progress/evaluating/completed・§3）。会社DBでも String で持つ。
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="draft", server_default="draft")
    # MinIO キー・任意（§1.10）。未設定時は「件名頭文字＋所有者アバター」（フロント表示）。
    icon_image_path: Mapped[str | None] = mapped_column(String, nullable=True)
    # 発見公開フラグ（掲示板 SC-13 に出すか・per-quest opt-in・既定 OFF・FR-40／§5.6）。
    # ON でも中身は非公開＝メタのみ（発見門番 can_discover_quest）。
    discoverable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    # 論理削除（トゥームストーン）。NULL＝有効。値あり＝削除済み（一覧/参照から除外・§5.6）。
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class QuestGroupLink(CompanyBase):
    """クエスト×クエストグループ＝参加部署（アクセス条件・複数部署横断・データモデル §5.6b・FR-38）。

    フラットな 0..N・すべて同格（主グループ〔primary〕概念は廃止・2026-09-11 再設計）。門番（アクセス条件）と
    パーティー候補は本テーブルの全グループを対象にする（0 件なら部署条件なし＝会社全体）。
    """
    __tablename__ = "quest_group_links"
    __table_args__ = (
        UniqueConstraint("quest_id", "quest_group_id", name="uq_quest_group_links"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    quest_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("quests.id"), nullable=False)
    quest_group_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("quest_groups.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class QuestJoinRequest(CompanyBase):
    """クエスト参加リクエスト（FR-40・データモデル §5.8b）。

    1ユーザー1行（`UNIQUE(quest_id, user_id)`）＝却下（rejected）は非終端で行を残し後日承諾（rejected→approved）。
    承認で `quest_members` に追加（application）。
    """
    __tablename__ = "quest_join_requests"
    __table_args__ = (UniqueConstraint("quest_id", "user_id", name="uq_quest_join_requests"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    quest_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("quests.id"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    # join_request_status（pending/approved/rejected/withdrawn・§3）。会社DBでも String で持つ。
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending", server_default="pending")
    message: Mapped[str | None] = mapped_column(Text(), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decided_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)


class QuestFollow(CompanyBase):
    """クエストフォロー＝watch（FR-40・データモデル §5.8c）。アイデアの follows とは別テーブル（対象/通知の混線回避）。"""
    __tablename__ = "quest_follows"
    __table_args__ = (UniqueConstraint("quest_id", "user_id", name="uq_quest_follows"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    quest_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("quests.id"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class QuestCategory(CompanyBase):
    __tablename__ = "quest_categories"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    quest_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("quests.id"), nullable=False)
    # 事前定義値 or 自由入力の正規化後（トリム＋大小文字/全半角正規化は application・§5.7）。
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    # 事前定義候補に一致しないラベルは is_custom=true（§5.7）。
    is_custom: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")


class QuestMember(CompanyBase):
    __tablename__ = "quest_members"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    quest_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("quests.id"), nullable=False)
    # 候補は当該クエストの所属グループメンバーに限定（application で強制・§5.8/C.3）。
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    # 再追加（トゥームストーン復活）時は now() に更新＝現在の参加開始を表す（§5.8）。
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    # パーティー除外の論理削除（トゥームストーン）。NULL＝有効な参加。門番/候補は removed_at IS NULL で絞る（§5.8）。
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class QuestMemberPermission(CompanyBase):
    __tablename__ = "quest_member_permissions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    quest_member_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("quest_members.id"), nullable=False
    )
    # permission_type（6 権限・§3）。会社DBでも String で持つ。
    permission: Mapped[str] = mapped_column(String(32), nullable=False)
    granted_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    granted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class QuestOutcome(CompanyBase):
    """クエスト最終結果の人手記入分（FR-39・アイデア選別の申し送りの④振り返り・⑤次アクション・KPI・(c)要約キャッシュ）。

    ①選定アイデア/②評価・選別サマリ/③意思決定は既存集計の合成で導出＝本テーブルには持たない（クエスト1件＝0..1）。
    """

    __tablename__ = "quest_outcomes"

    quest_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("quests.id"), primary_key=True)
    summary: Mapped[str | None] = mapped_column(Text(), nullable=True)         # 成果（総括）
    learnings: Mapped[str | None] = mapped_column(Text(), nullable=True)       # 学び・課題（ISO56001 §10）
    next_actions: Mapped[str | None] = mapped_column(Text(), nullable=True)    # 次アクション
    metrics: Mapped[list] = mapped_column(JSONB(), nullable=False, server_default="[]")  # 指標 [{label,value}]
    chat_summary: Mapped[str | None] = mapped_column(Text(), nullable=True)    # (c) 抽出型自動要約のキャッシュ（Phase 3）
    chat_summary_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class QuestOutcomeRevision(CompanyBase):
    """振り返り（総括）内容の版（変更履歴標準 §3.1・§10 改善の記録）。"""

    __tablename__ = "quest_outcome_revisions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    quest_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("quests.id"), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    editor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    changes: Mapped[dict] = mapped_column(JSONB(), nullable=False)  # summary/learnings/next_actions/metrics
    memo: Mapped[str | None] = mapped_column(Text(), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
