"""company: 全文検索（PGroonga）拡張＋索引（ドメイン J・データモデル §6）

会社DB のみに PGroonga を導入し、横断全文検索の対象列に pgroonga 索引を張る（§6）。
- ideas＝`title||' '||body||' '||value||' '||coalesce(note,'')` の連結式に索引（4列横断）。
- chat_messages＝`body`。
- attachments＝`original_name`（ファイル名検索）。
索引は同期更新（書込 Tx 内で更新・別同期処理不要・J.2）。可視範囲は索引ではなくクエリ WHERE で強制（J.0）。

Revision ID: 0018_company_pgroonga_fts
Revises: 0017_company_notifications
Create Date: 2026-08-26

（注: alembic_version.version_num は varchar(32)。revision id は 32 字以内にする。）
"""
from alembic import op

revision = "0018_company_pgroonga_fts"
down_revision = "0017_company_notifications"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pgroonga")
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_ideas_fts ON ideas "
        "USING pgroonga ((title || ' ' || body || ' ' || value || ' ' || coalesce(note, '')))"
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_chat_messages_fts ON chat_messages USING pgroonga (body)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_attachments_fts ON attachments USING pgroonga (original_name)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_attachments_fts")
    op.execute("DROP INDEX IF EXISTS idx_chat_messages_fts")
    op.execute("DROP INDEX IF EXISTS idx_ideas_fts")
    op.execute("DROP EXTENSION IF EXISTS pgroonga")
