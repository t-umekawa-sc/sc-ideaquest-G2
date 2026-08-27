"""company: users.avatar_base 列を追加（3D アバターの男女2ベース・データモデル §5.3／画面 SC-31 §9.2）

3D アバターのベース体を男女 2 体（male/female）から選べるようにするため、選択を会社 DB の users に保持する。
enum は §5.3 と同方針で String 列（値は data model の avatar_base ＝ male/female・将来 animal_*）。
NOT NULL・server_default 'male'（既存行は既定の male で充当）。会社 DB 単独列＝管理 DB からのミラー対象外。

Revision ID: 0019_company_avatar_base
Revises: 0018_company_pgroonga_fts
Create Date: 2026-08-27

（注: alembic_version.version_num は varchar(32)。revision id は 32 字以内にする。）
"""
from alembic import op
import sqlalchemy as sa

revision = "0019_company_avatar_base"
down_revision = "0018_company_pgroonga_fts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("avatar_base", sa.String(16), nullable=False, server_default="male"),
    )


def downgrade() -> None:
    op.drop_column("users", "avatar_base")
