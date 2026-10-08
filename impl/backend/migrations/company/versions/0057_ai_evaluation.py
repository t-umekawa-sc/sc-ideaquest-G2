"""company: AI 評価（独立した評価者）＝evaluations/concept_evaluations を拡張（FR-50）。

AI（LLM）が独立した評価者として評価を付与する（[アイデアLLM自動評価 設計]）。別テーブルにせず既存
`evaluations`/`concept_evaluations` を拡張し、F.1 集計/F.4 コインの既存ロジックを無改修で流用する（DRY）。

- `evaluator_kind`（human|ai・既定 human）を追加。既存行は server_default='human' で埋まる。
- `evaluator_id` を nullable 化（AI 行は NULL・アカウント無し）。
- `ai_job_id`（ai_jobs 参照・nullable）・`model`（物理モデル名・監査・nullable）を追加。
- AI 行の一意性＝部分ユニーク `UNIQUE(idea_id) WHERE evaluator_kind='ai'`（1アイデア最新 AI 評価1件）。
- 整合 CHECK＝human⇒evaluator_id NOT NULL & ai_job_id NULL／ai⇒evaluator_id NULL & ai_job_id NOT NULL。
- 版テーブル（evaluation_revisions / concept_evaluation_revisions）の editor_id を nullable 化
  （AI 自動生成＝NULL／再生成＝実行した評価者）。

enum（evaluation_visibility に 'private' 追加）は String 列保持のため DB 変更不要（アプリ層で検証）。

Revision ID: 0057_ai_evaluation
Revises: 0056_info_curators_merge
Create Date: 2026-10-08
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0057_ai_evaluation"
down_revision = "0056_info_curators_merge"
branch_labels = None
depends_on = None


def _extend(table: str, owner_col: str) -> None:
    """evaluations / concept_evaluations を同型に拡張する。owner_col＝idea_id / concept_id。"""
    op.add_column(table, sa.Column("evaluator_kind", sa.String(16), nullable=False, server_default="human"))
    op.add_column(table, sa.Column("ai_job_id", UUID(as_uuid=True), nullable=True))
    op.add_column(table, sa.Column("model", sa.Text(), nullable=True))
    op.create_foreign_key(f"fk_{table}_ai_job", table, "ai_jobs", ["ai_job_id"], ["id"])
    # evaluator_id を nullable 化（AI 行は NULL）。
    op.alter_column(table, "evaluator_id", existing_type=UUID(as_uuid=True), nullable=True)
    # AI 評価は 1 対象につき最新 1 件（部分ユニーク）。
    op.create_index(
        f"uq_{table}_ai_one", table, [owner_col], unique=True,
        postgresql_where=sa.text("evaluator_kind = 'ai'"),
    )
    # 種別と列の整合（human⇒evaluator_id あり/ai_job なし・ai⇒evaluator_id なし/ai_job あり）。
    op.create_check_constraint(
        f"ck_{table}_kind", table,
        "(evaluator_kind = 'human' AND evaluator_id IS NOT NULL AND ai_job_id IS NULL) "
        "OR (evaluator_kind = 'ai' AND evaluator_id IS NULL AND ai_job_id IS NOT NULL)",
    )


def _extend_down(table: str) -> None:
    op.drop_constraint(f"ck_{table}_kind", table, type_="check")
    op.drop_index(f"uq_{table}_ai_one", table_name=table)
    op.alter_column(table, "evaluator_id", existing_type=UUID(as_uuid=True), nullable=False)
    op.drop_constraint(f"fk_{table}_ai_job", table, type_="foreignkey")
    op.drop_column(table, "model")
    op.drop_column(table, "ai_job_id")
    op.drop_column(table, "evaluator_kind")


def upgrade() -> None:
    _extend("evaluations", "idea_id")
    _extend("concept_evaluations", "concept_id")
    # 版の editor_id を nullable 化（AI 自動生成版は NULL）。
    op.alter_column("evaluation_revisions", "editor_id", existing_type=UUID(as_uuid=True), nullable=True)
    op.alter_column("concept_evaluation_revisions", "editor_id", existing_type=UUID(as_uuid=True), nullable=True)


def downgrade() -> None:
    op.alter_column("concept_evaluation_revisions", "editor_id", existing_type=UUID(as_uuid=True), nullable=False)
    op.alter_column("evaluation_revisions", "editor_id", existing_type=UUID(as_uuid=True), nullable=False)
    _extend_down("concept_evaluations")
    _extend_down("evaluations")
