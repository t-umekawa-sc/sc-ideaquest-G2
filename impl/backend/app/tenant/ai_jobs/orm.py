"""会社DB（テナントプレーン）の AIジョブ基盤モデル（データモデル §5.57-5.59・FR-45）。

- `ai_jobs`＝LLM を要する非同期処理の状態機械（queued→running→succeeded/failed/canceled）＝テーブル自身がキュー
  （mail_outbox と同思想）。ref_* は多態遷移先（notifications と同型・§2.2 #4）。
- `company_ai_model_settings`＝会社のモデル ON/OFF・予算（カタログ registry × 会社有効化の2階層・§5.58）。
- `ai_usage_events`＝利用量メータリング＝課金基礎（追記専用・単価スナップショット・論理削除しない・§5.59）。

enum（task_type/status/execution/billing）は §5.3 と同方針で DB enum 型を使わず String で持つ。
呼び出し側 Tx に相乗（自身では commit しない＝repository/application が制御）。
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import CompanyBase


class AiJob(CompanyBase):
    __tablename__ = "ai_jobs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    task_type: Mapped[str] = mapped_column(Text, nullable=False)                 # info_summarize/iso_generate 等（§3.3）
    status: Mapped[str] = mapped_column(Text, nullable=False, default="queued", server_default="queued")  # queued/running/succeeded/failed/canceled
    execution: Mapped[str] = mapped_column(Text, nullable=False, default="queued", server_default="queued")  # queued(worker)/immediate（§5.2）
    requested_by_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    # 監査列（§2.1）＝起票主体。ユーザー起票は created_by_id=本人／システム起票（自動評価など）は NULL＋created_program で識別。
    # SC-04 個人一覧は created_by_id でフィルタ＝システム起票ジョブは本人の一覧に出さない（requested_by_id は通知先として別途保持）。
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_program: Mapped[str | None] = mapped_column(Text, nullable=True)
    input: Mapped[dict] = mapped_column(JSONB, nullable=False)                   # プロンプト材料（機微は参照ID・§10）
    result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)            # 構造化結果（成功時）
    error: Mapped[dict | None] = mapped_column(JSONB, nullable=True)             # {code, detail}
    requested_model: Mapped[str | None] = mapped_column(Text, nullable=True)     # 指定した論理モデルキー（NULL=既定）
    provider: Mapped[str | None] = mapped_column(Text, nullable=True)            # 実行provider（物理・監査）
    model: Mapped[str | None] = mapped_column(Text, nullable=True)              # 実行model（物理・監査）
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cost_micros: Mapped[int | None] = mapped_column(BigInteger, nullable=True)   # 概算（課金基礎の正は ai_usage_events）
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    progress: Mapped[dict | None] = mapped_column(JSONB, nullable=True)          # {phase, ratio, partial?}（§5.6・復元源）
    cancel_requested: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    ref_idea_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("ideas.id"), nullable=True)
    ref_quest_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("quests.id"), nullable=True)
    ref_strategy_document_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("strategy_documents.id"), nullable=True)
    ref_info_item_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("info_items.id"), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)  # 論理削除（課金基礎は残す）
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class CompanyAiModelSetting(CompanyBase):
    __tablename__ = "company_ai_model_settings"
    __table_args__ = (UniqueConstraint("model_key", name="uq_company_ai_model_settings_key"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    model_key: Mapped[str] = mapped_column(Text, nullable=False)                 # registry の論理キー（§4.1）
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")  # free 既定ON/paid 既定OFF は app 層で
    monthly_budget_micros: Mapped[int | None] = mapped_column(BigInteger, nullable=True)  # paid 暴走防止（NULL=無制限）
    max_output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 会社別の生成トークン上限（NULL=無制限・無料ティア抑制等・S.5）
    enabled_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)  # 課金合意の記録
    enabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class CompanyAiSettings(CompanyBase):
    """会社横断（モデル非依存）の AI 動作ポリシー（会社DB シングルトン・§5.67）。

    初版は「公開時 自動評価」のみ。`auto_evaluate_on_publish` は nullable＝NULL はデプロイ既定
    （env `llm_auto_evaluate_on_publish`）を継承し、true/false は会社の明示上書き（解決順＝会社 > env）。
    """

    __tablename__ = "company_ai_settings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    auto_evaluate_on_publish: Mapped[bool | None] = mapped_column(Boolean, nullable=True)  # NULL=env 既定継承（§5.67）
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class AiUsageEvent(CompanyBase):
    """追記専用の課金基礎台帳（更新/論理削除しない・ジョブ削除後も残す・§5.59/§6.3）。"""

    __tablename__ = "ai_usage_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("ai_jobs.id", ondelete="SET NULL"), nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    period_ym: Mapped[int] = mapped_column(Integer, nullable=False)              # 202609 等（集計/予算判定キー）
    model_key: Mapped[str] = mapped_column(Text, nullable=False)
    provider: Mapped[str] = mapped_column(Text, nullable=False)
    model: Mapped[str] = mapped_column(Text, nullable=False)
    task_type: Mapped[str] = mapped_column(Text, nullable=False)
    requested_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    billing: Mapped[str] = mapped_column(Text, nullable=False)                   # free/paid（スナップショット）
    input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    extra_units: Mapped[dict | None] = mapped_column(JSONB, nullable=True)       # cached/reasoning トークン等
    rate_snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)           # {input_rate, output_rate, currency, pricing_version}
    cost_micros: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")  # free=0
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
