"""company: concept_chat_scopes のユニーク制約を修正（group を複数許可・FR-42・§5.45）

0033 の `uq_concept_chat_scopes_kind` は `(concept_id, kind, coalesce(assumption_id, zero))` で、
`kind='group'` は assumption_id が常に NULL＝coalesce が zero-uuid に潰れるため **1 コンセプトにグループが
1 個しか作れない**バグだった（overall は 1／assumption は前提ごと 1 が意図で、group は 3〜5 の小集合が正・§5.45）。

修正＝ユニークを **overall/assumption のみ**に限定（`WHERE kind <> 'group'`）。group はアプリ側で
ラベル一致による重複回避（discussGroup）に委ねる。

Revision ID: 0036_concept_scope_kind_uq_fix
Revises: 0035_chat_thread
Create Date: 2026-09-26
"""
from alembic import op

revision = "0036_concept_scope_kind_uq_fix"
down_revision = "0035_chat_thread"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_concept_chat_scopes_kind")
    # overall（concept 内 1）＋assumption（前提ごと 1）のみ一意。group は除外＝複数可（§5.45）。
    op.execute(
        "CREATE UNIQUE INDEX uq_concept_chat_scopes_kind ON concept_chat_scopes "
        "(concept_id, kind, coalesce(assumption_id, '00000000-0000-0000-0000-000000000000'::uuid)) "
        "WHERE kind <> 'group'"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_concept_chat_scopes_kind")
    # 0033 の（バグを含む）全 kind 版へ復元。
    op.execute(
        "CREATE UNIQUE INDEX uq_concept_chat_scopes_kind ON concept_chat_scopes "
        "(concept_id, kind, coalesce(assumption_id, '00000000-0000-0000-0000-000000000000'::uuid))"
    )
