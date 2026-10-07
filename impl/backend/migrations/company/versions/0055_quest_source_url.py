"""company: クエストの出典URL（quests.source_url・任意・FR-47 昇格の由来可視リンク＋汎用）。

クエスト登録フォームに任意の「出典URL」を持たせる（情報インプットの出典URLと同趣旨）。アイデア→クエスト
昇格（T.5）時は由来アイデアへの内部リンク `/ideas/{origin_idea_id}` を自動セット（人間向けの可視リンク＝
機械リンク origin_idea_id と併存）。値は http/https の外部URL または `/` 始まりの内部パスを許容（app 層で検証）。
既定 NULL＝従来どおり（非破壊）。

Revision ID: 0055_quest_source_url
Revises: 0054_announcements
Create Date: 2026-10-07
"""
from alembic import op
import sqlalchemy as sa

revision = "0055_quest_source_url"
down_revision = "0054_announcements"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("quests", sa.Column("source_url", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("quests", "source_url")
