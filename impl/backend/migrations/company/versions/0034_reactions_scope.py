"""company: reactions をコンセプト・スコープ対応に一般化（FR-42・チャット共通化 Phase 1）

チャットのフル機能をコンセプト議論（総合/グループ/前提スレッド）にも展開するため、`reactions` を
アイデア(chat_group_id) だけでなく コンセプトルーム(concept_chat_scope_id) のメッセージにも付けられるよう
一般化する。0033 で `chat_messages`/`chat_reads` は既に対応済み。ここでは `reactions` に対し
`chat_group_id` を NULL 可へ緩和＋`concept_chat_scope_id` 列を追加＋どちらか一方の CHECK（num_nonnulls=1）。

Revision ID: 0034_reactions_scope
Revises: 0033_concepts
Create Date: 2026-09-25
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0034_reactions_scope"
down_revision = "0033_concepts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("reactions", sa.Column("concept_chat_scope_id", UUID(as_uuid=True), sa.ForeignKey("concept_chat_scopes.id"), nullable=True))
    op.alter_column("reactions", "chat_group_id", existing_type=UUID(as_uuid=True), nullable=True)
    # アイデア(chat_group_id) or コンセプトルーム(concept_chat_scope_id) のどちらか一方（データモデル §5.45 と同方針）。
    op.create_check_constraint(
        "ck_reactions_one_container",
        "reactions",
        "num_nonnulls(chat_group_id, concept_chat_scope_id) = 1",
    )


def downgrade() -> None:
    op.drop_constraint("ck_reactions_one_container", "reactions", type_="check")
    # 既存の scope 反応を消してから NOT NULL へ戻す（無ければ no-op）。
    op.execute("DELETE FROM reactions WHERE chat_group_id IS NULL")
    op.alter_column("reactions", "chat_group_id", existing_type=UUID(as_uuid=True), nullable=False)
    op.drop_column("reactions", "concept_chat_scope_id")
