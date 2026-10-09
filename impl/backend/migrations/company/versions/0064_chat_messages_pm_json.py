"""company: チャット本文を PM-JSON 化（`chat_messages.body` text→jsonb）＝リッチテキスト統一（TipTap移行・TT5）。

お知らせ（0061）・情報（0062）・テンプレ（0063）と同型の保存形式 PM-JSON へ。チャットは既存 `body`（text・
Markdown ライト）を **jsonb 正本**へ型変更する（追加列ではなく置換）。表示は `pm_to_html` 派生（DTO `body_html`）、
全文検索/要約/引用抜粋は `pm_to_text`。メンションは mention ノード（`{id,label}`・`@全員`=番兵 `id:"__all__"`）で
本文に内包しつつ、宛先 `mentions[]` 展開はフロント責務（サーバー契約不変）。

既存チャットは全てテストデータ＝全削除可（ユーザー言明）。text→jsonb の安全な変換のため、`chat_messages` と
その従属（`chat_mentions`/`chat_message_quotes`/`reactions`/チャット添付）を削除し、`chat_reads` の既読位置を
NULL 化してから列型を変換する（空テーブルでの型変換＝不正 JSON の混入を避ける）。

Revision ID: 0064_chat_messages_pm_json
Revises: 0063_info_templates_pm_json
Create Date: 2026-10-09
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = "0064_chat_messages_pm_json"
down_revision = "0063_info_templates_pm_json"
branch_labels = None
depends_on = None

_EMPTY_DOC = "'{\"type\":\"doc\",\"content\":[]}'::jsonb"


def upgrade() -> None:
    # 既存チャットデータの削除（従属 FK を先に・全てテストデータ）。
    op.execute("DELETE FROM chat_mentions")
    op.execute("DELETE FROM chat_message_quotes")
    op.execute("DELETE FROM reactions")
    op.execute("UPDATE chat_reads SET last_read_message_id = NULL")
    op.execute("DELETE FROM attachments WHERE chat_message_id IS NOT NULL")
    op.execute("DELETE FROM chat_messages")
    # 空テーブルで text→jsonb（USING は空 doc・残行が無いため実質無評価）。
    op.alter_column(
        "chat_messages", "body",
        type_=JSONB(), existing_nullable=False,
        postgresql_using=_EMPTY_DOC,
    )


def downgrade() -> None:
    op.alter_column(
        "chat_messages", "body",
        type_=sa.Text(), existing_nullable=False,
        postgresql_using="body::text",
    )
