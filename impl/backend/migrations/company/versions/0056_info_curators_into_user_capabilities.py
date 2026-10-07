"""company: 情報判定権限 info_curators を user_capabilities へ統合（クリーン移行・FR-47・決定D）。

②会社レベル能力を単一レジストリ `user_capabilities` に集約する方針（§3.1）に従い、既存 `info_curators` の
行を `user_capabilities(capability='info_curator')` へ移行（granted_by_id/granted_at/revoked_at を保持）し、
旧テーブルを DROP する（1能力1テーブルの増殖を止め、付与/剥奪/管理UI/監査を1本化＝DRY）。

- 有効（revoked_at IS NULL）行は user_capabilities の部分 UNIQUE(user_id,capability) WHERE revoked_at IS NULL と
  整合するよう、既に有効な info_curator がある user はスキップ（通常は未使用のため発生しない）。
- 剥奪済み行はそのまま移送（監査保持）。

Revision ID: 0056_info_curators_merge
Revises: 0055_quest_source_url
Create Date: 2026-10-07
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0056_info_curators_merge"
down_revision = "0055_quest_source_url"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 既存 info_curators を user_capabilities(capability='info_curator') へ移行（id は新規採番）。
    op.execute(sa.text(
        """
        INSERT INTO user_capabilities (id, user_id, capability, granted_by_id, granted_at, revoked_at)
        SELECT gen_random_uuid(), ic.user_id, 'info_curator', ic.granted_by_id, ic.granted_at, ic.revoked_at
        FROM info_curators ic
        WHERE NOT (
            ic.revoked_at IS NULL AND EXISTS (
                SELECT 1 FROM user_capabilities uc
                WHERE uc.user_id = ic.user_id AND uc.capability = 'info_curator' AND uc.revoked_at IS NULL
            )
        )
        """
    ))
    op.drop_index("ix_info_curators_user", table_name="info_curators")
    op.drop_index("ix_info_curators_active", table_name="info_curators")
    op.drop_table("info_curators")


def downgrade() -> None:
    # 旧テーブルを再作成（0028 と同形）し、info_curator 能力行を戻してから user_capabilities 側を削除。
    op.create_table(
        "info_curators",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("granted_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("granted_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_info_curators_active", "info_curators", ["user_id"], unique=True,
                    postgresql_where=sa.text("revoked_at IS NULL"))
    op.create_index("ix_info_curators_user", "info_curators", ["user_id"])
    op.execute(sa.text(
        """
        INSERT INTO info_curators (id, user_id, granted_by_id, granted_at, revoked_at)
        SELECT gen_random_uuid(), user_id, granted_by_id, granted_at, revoked_at
        FROM user_capabilities WHERE capability = 'info_curator'
        """
    ))
    op.execute(sa.text("DELETE FROM user_capabilities WHERE capability = 'info_curator'"))
