"""company: 情報本文を PM-JSON 化（`info_items.body` jsonb 追加）＝リッチテキスト統一（TipTap移行・TT0b）。

お知らせ（0061）と同型＝`body`（jsonb・正本）を追加し、`body_html`/`body_text` は PM-JSON からの派生へ
（`body_html`＝`pm_to_html`＝表示用・`body_text`＝`pm_to_text`＝全文検索/トークン/要約の元）。版管理
（`info_item_revisions`）は従来どおり `body_html` スナップショットを保持＝表示用 HTML 履歴ゆえ無改修。
既存行は空 doc でバックフィル（本文は全てテストデータ＝全削除可）。info_templates は TT4（SC-55）で移行。

Revision ID: 0062_info_items_pm_json
Revises: 0061_announcements_pm_json
Create Date: 2026-10-09
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = "0062_info_items_pm_json"
down_revision = "0061_announcements_pm_json"
branch_labels = None
depends_on = None

_EMPTY_DOC = "'{\"type\":\"doc\",\"content\":[]}'::jsonb"


def upgrade() -> None:
    op.add_column(
        "info_items",
        sa.Column("body", JSONB(), nullable=False, server_default=sa.text(_EMPTY_DOC)),
    )


def downgrade() -> None:
    op.drop_column("info_items", "body")
