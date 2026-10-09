"""company: 情報テンプレート本文ひな形を PM-JSON 化（`info_templates.body` jsonb 追加）＝TipTap 移行（TT4）。

お知らせ（0061）・情報（0062）と同型＝`body`（jsonb・正本）を追加し、`body_html` は PM-JSON からの
派生（`pm_to_html`・表示/適用時のフォールバック表示用）へ。テンプレを選ぶと `body`（PM-JSON）が情報登録
フォームの共有エディタへ適用される（SC-51 ピッカー・TT4）。既存行は空 doc でバックフィル（全てテストデータ）。

Revision ID: 0063_info_templates_pm_json
Revises: 0062_info_items_pm_json
Create Date: 2026-10-09
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = "0063_info_templates_pm_json"
down_revision = "0062_info_items_pm_json"
branch_labels = None
depends_on = None

_EMPTY_DOC = "'{\"type\":\"doc\",\"content\":[]}'::jsonb"


def upgrade() -> None:
    op.add_column(
        "info_templates",
        sa.Column("body", JSONB(), nullable=False, server_default=sa.text(_EMPTY_DOC)),
    )


def downgrade() -> None:
    op.drop_column("info_templates", "body")
