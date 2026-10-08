"""company: ai_jobs に監査列 created_by_id/created_program（データモデル §2.1・FR-50・SC-04）。

ai_jobs は共通監査カラム（§2.1）のうち `created_by_id`/`created_program` を持たず、「だれ/どの処理が起票したか」
を区別できなかった。AI 自動評価（idea_evaluate の published 自動起動・FR-50）は**システム起票**＝
`created_by_id=NULL`＋`created_program='auto_evaluate'` とし、**個人の処理状況（SC-04）一覧から除外**する
（本人が依頼した訳ではないジョブで個人一覧を汚さない・設計 §6）。`requested_by_id`（通知先＝公開者）は従来どおり。

- `created_by_id` uuid NULL（FK users・システム/バッチ起票は NULL）／`created_program` text NULL（起票主体の識別）。
- **既存行のバックフィル**＝これまでのジョブはすべてユーザー起票（自動起動は本リリースで初導入・既定 OFF）ゆえ
  `created_by_id = requested_by_id`・`created_program='user'` を補填（移行後も SC-04 に出続ける＝非破壊）。
- 他テーブルの §2.1 未準拠（created_by_id 等を持たない）は本移行の対象外（別件・バックログ）。

Revision ID: 0058_ai_jobs_created_by
Revises: 0057_ai_evaluation
Create Date: 2026-10-08
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "0058_ai_jobs_created_by"
down_revision = "0057_ai_evaluation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("ai_jobs", sa.Column("created_by_id", UUID(as_uuid=True), nullable=True))
    op.add_column("ai_jobs", sa.Column("created_program", sa.Text(), nullable=True))
    op.create_foreign_key("ai_jobs_created_by_id_fkey", "ai_jobs", "users", ["created_by_id"], ["id"])
    # 既存行＝すべてユーザー起票（自動起動は本リリース初導入）→ created_by_id を requested_by_id で補填（SC-04 維持）。
    op.execute("UPDATE ai_jobs SET created_by_id = requested_by_id, created_program = 'user' WHERE created_by_id IS NULL")
    # SC-04 個人一覧は created_by_id で絞るため索引を揃える（旧 requested_by_id 索引は running 等で引き続き利用）。
    op.create_index("ix_ai_jobs_creator", "ai_jobs", ["created_by_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_ai_jobs_creator", table_name="ai_jobs")
    op.drop_constraint("ai_jobs_created_by_id_fkey", "ai_jobs", type_="foreignkey")
    op.drop_column("ai_jobs", "created_program")
    op.drop_column("ai_jobs", "created_by_id")
