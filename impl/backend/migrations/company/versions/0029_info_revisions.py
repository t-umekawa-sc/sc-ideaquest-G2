"""company: 情報インプットの内容編集履歴（info_item_revisions・N.2/§5.33 追補）

内容（title/body_html/source_url/参考資料）は作成者が status 非依存で編集可（API N.0）。判定後も編集
できるため、triage 時点の内容を追跡できるよう**内容の版スナップショット**を保持する（idea_revisions と
同型＝JSONB changes＋版番号＋編集者＋日時）。

Revision ID: 0029_info_revisions
Revises: 0028_info_input
Create Date: 2026-09-21
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0029_info_revisions"
down_revision = "0028_info_input"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "info_item_revisions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("info_item_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("info_items.id"), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("editor_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        # 版スナップショット（内容フィールド＝title/body_html/source_url）。差分は表示時に前版と比較。
        sa.Column("changes", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("info_item_id", "revision", name="uq_info_item_revisions"),
    )
    op.create_index("idx_info_item_revisions_item", "info_item_revisions", ["info_item_id"])


def downgrade() -> None:
    op.drop_index("idx_info_item_revisions_item", table_name="info_item_revisions")
    op.drop_table("info_item_revisions")
