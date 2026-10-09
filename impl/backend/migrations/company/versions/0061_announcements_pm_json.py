"""company: お知らせ本文を PM-JSON 化（`announcements.body` jsonb 追加）＝リッチテキスト統一（TipTap移行・TT0）。

リッチテキストの保存形式を HTML から **PM-JSON（TipTap/ProseMirror）**へ転換（ユーザー決定 2026-10-09）。
`body`（jsonb・正本）を追加し、`body_html`/`body_text` は PM-JSON からの**派生列**として維持する
（`body_html`＝`pm_to_html`＝表示用・`body_text`＝`pm_to_text`＝全文検索/抜粋用）。
既存行は空 doc でバックフィル（本文は全てテストデータ＝全削除可・設計 §4-2 の PM-JSON 採用）。

Revision ID: 0061_announcements_pm_json
Revises: 0060_info_templates
Create Date: 2026-10-09
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = "0061_announcements_pm_json"
down_revision = "0060_info_templates"
branch_labels = None
depends_on = None

_EMPTY_DOC = "'{\"type\":\"doc\",\"content\":[]}'::jsonb"


def upgrade() -> None:
    # 正本列 body（PM-JSON）。既存行は空 doc でバックフィル（本文はテストデータ＝全削除可）。
    op.add_column(
        "announcements",
        sa.Column("body", JSONB(), nullable=False, server_default=sa.text(_EMPTY_DOC)),
    )


def downgrade() -> None:
    op.drop_column("announcements", "body")
