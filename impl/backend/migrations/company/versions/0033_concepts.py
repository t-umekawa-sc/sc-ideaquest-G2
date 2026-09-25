"""company: コンセプト段（FR-42・ISO56002 ②③・concepts ほか §5.38-5.46）

②コンセプトの創造＋③コンセプトの検証（データモデル §5.38-5.46）。concepts（本体）＋concept_source_ideas
（由来アイデア M:N）＋assumptions（クエスト単位の検証プール）＋assumption_validations（検証イベント・追記型）
＋concept_assumption_links（M:N＋criticality/is_stale）＋concept_evaluations＋concept_evaluation_scores
（中核5＋補助3）＋concept_chat_scopes（総合/グループ/前提スレッド）＋concept_votes。enum は §5.3 と同方針で
String 列＋CHECK。チャットは §5.45 の最小侵襲拡張＝chat_messages/chat_reads に concept_chat_scope_id を追加
し chat_group_id を NULL 可へ緩和＋どちらか一方の CHECK（num_nonnulls=1）。

Revision ID: 0033_concepts
Revises: 0032_info_link_disposition
Create Date: 2026-09-25

（注: alembic_version.version_num は varchar(32)。revision id は 32 字以内にする。）
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = "0033_concepts"
down_revision = "0032_info_link_disposition"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 5.38 concepts（アイデアからの昇華・クエスト＝検証プールに属す）
    op.create_table(
        "concepts",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("quest_id", UUID(as_uuid=True), sa.ForeignKey("quests.id"), nullable=False),
        sa.Column("author_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("problem", sa.Text(), nullable=True),
        sa.Column("value_proposition", sa.Text(), nullable=True),
        sa.Column("target", sa.Text(), nullable=True),
        sa.Column("differentiation", sa.Text(), nullable=True),
        sa.Column("solution_form", sa.Text(), nullable=True),
        sa.Column("viability", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("decision", sa.String(16), nullable=False, server_default="undecided"),
        sa.Column("decision_rationale", sa.Text(), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="draft"),
        sa.Column("is_selected", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("current_revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_concepts_quest_status_active", "concepts", ["quest_id", "status"],
                    postgresql_where=sa.text("deleted_at IS NULL"))
    op.create_index("ix_concepts_quest_selected", "concepts", ["quest_id"],
                    postgresql_where=sa.text("is_selected"))
    op.create_index("ix_concepts_author", "concepts", ["author_id"])

    # 5.39 concept_source_ideas（由来アイデア M:N）
    op.create_table(
        "concept_source_ideas",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("concept_id", UUID(as_uuid=True), sa.ForeignKey("concepts.id"), nullable=False),
        sa.Column("idea_id", UUID(as_uuid=True), sa.ForeignKey("ideas.id"), nullable=False),
    )
    op.create_index("uq_concept_source_ideas", "concept_source_ideas", ["concept_id", "idea_id"], unique=True)
    op.create_index("ix_concept_source_ideas_idea", "concept_source_ideas", ["idea_id"])

    # 5.40 assumptions（クエスト単位の検証プール・第一級）
    op.create_table(
        "assumptions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("quest_id", UUID(as_uuid=True), sa.ForeignKey("quests.id"), nullable=False),
        sa.Column("statement", sa.Text(), nullable=False),
        sa.Column("current_verdict", sa.String(16), nullable=False, server_default="inconclusive"),
        sa.Column("created_by_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_assumptions_quest", "assumptions", ["quest_id"])
    op.create_index("ix_assumptions_quest_verdict", "assumptions", ["quest_id", "current_verdict"])

    # 5.41 assumption_validations（検証イベント・追記型で履歴）
    op.create_table(
        "assumption_validations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("assumption_id", UUID(as_uuid=True), sa.ForeignKey("assumptions.id"), nullable=False),
        sa.Column("method", sa.Text(), nullable=False),
        sa.Column("result", sa.Text(), nullable=True),
        sa.Column("verdict", sa.String(16), nullable=False),
        sa.Column("validated_on", sa.Date(), nullable=False),
        sa.Column("scale", sa.Text(), nullable=True),
        sa.Column("created_by_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.execute(
        "CREATE INDEX ix_assumption_validations_latest ON assumption_validations "
        "(assumption_id, validated_on DESC)"
    )
    op.create_index("ix_assumption_validations_created", "assumption_validations", ["assumption_id", "created_at"])

    # 5.42 concept_assumption_links（M:N＋重要度＋要再評価）
    op.create_table(
        "concept_assumption_links",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("concept_id", UUID(as_uuid=True), sa.ForeignKey("concepts.id"), nullable=False),
        sa.Column("assumption_id", UUID(as_uuid=True), sa.ForeignKey("assumptions.id"), nullable=False),
        sa.Column("criticality", sa.String(16), nullable=False, server_default="major"),
        sa.Column("is_stale", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_by_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
    )
    op.create_index("uq_concept_assumption_links", "concept_assumption_links",
                    ["concept_id", "assumption_id"], unique=True)
    op.create_index("ix_concept_assumption_links_assumption", "concept_assumption_links", ["assumption_id"])
    op.create_index("ix_concept_assumption_links_stale", "concept_assumption_links", ["concept_id"],
                    postgresql_where=sa.text("is_stale"))

    # 5.43 concept_evaluations（評価者の Go/Pivot/Kill 推奨込み）
    op.create_table(
        "concept_evaluations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("concept_id", UUID(as_uuid=True), sa.ForeignKey("concepts.id"), nullable=False),
        sa.Column("evaluator_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("overall_comment", sa.Text(), nullable=True),
        sa.Column("recommendation", sa.String(16), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="draft"),
        sa.Column("visibility", sa.String(16), nullable=False, server_default="party"),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("uq_concept_evaluations_concept_evaluator", "concept_evaluations",
                    ["concept_id", "evaluator_id"], unique=True)
    op.create_index("ix_concept_evaluations_concept_status", "concept_evaluations", ["concept_id", "status"])

    # 5.44 concept_evaluation_scores（中核5＋補助3・1..5）
    op.create_table(
        "concept_evaluation_scores",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("concept_evaluation_id", UUID(as_uuid=True),
                  sa.ForeignKey("concept_evaluations.id"), nullable=False),
        sa.Column("aspect", sa.String(24), nullable=False),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.CheckConstraint("score >= 1 AND score <= 5", name="ck_concept_evaluation_scores_range"),
    )
    op.create_index("uq_concept_evaluation_scores_eval_aspect", "concept_evaluation_scores",
                    ["concept_evaluation_id", "aspect"], unique=True)

    # 5.45 concept_chat_scopes（総合/グループ/前提スレッド）
    op.create_table(
        "concept_chat_scopes",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("concept_id", UUID(as_uuid=True), sa.ForeignKey("concepts.id"), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("label", sa.Text(), nullable=True),
        sa.Column("assumption_id", UUID(as_uuid=True), sa.ForeignKey("assumptions.id"), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index("ix_concept_chat_scopes_concept_pos", "concept_chat_scopes", ["concept_id", "position"])
    # 同一前提スレッドの重複防止＋overall は concept 内 1 件（assumption_id NULL も含め一意化）。
    op.execute(
        "CREATE UNIQUE INDEX uq_concept_chat_scopes_kind ON concept_chat_scopes "
        "(concept_id, kind, coalesce(assumption_id, '00000000-0000-0000-0000-000000000000'::uuid))"
    )
    op.create_index("ix_concept_chat_scopes_assumption", "concept_chat_scopes", ["assumption_id"],
                    postgresql_where=sa.text("assumption_id IS NOT NULL"))

    # 5.46 concept_votes（賛成/反対・1人1票）
    op.create_table(
        "concept_votes",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("concept_id", UUID(as_uuid=True), sa.ForeignKey("concepts.id"), nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("type", sa.String(16), nullable=False),
        sa.Column("voted_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("uq_concept_votes_concept_user", "concept_votes", ["concept_id", "user_id"], unique=True)

    # 5.45 チャット一般化（最小侵襲拡張）＝chat_messages / chat_reads に concept_chat_scope_id を足し、
    # chat_group_id を NULL 可へ緩和＋どちらか一方の CHECK（num_nonnulls=1）。
    for tbl in ("chat_messages", "chat_reads"):
        op.add_column(tbl, sa.Column("concept_chat_scope_id", UUID(as_uuid=True), nullable=True))
        op.create_foreign_key(
            f"fk_{tbl}_concept_scope", tbl, "concept_chat_scopes", ["concept_chat_scope_id"], ["id"]
        )
        op.alter_column(tbl, "chat_group_id", existing_type=UUID(as_uuid=True), nullable=True)
        op.create_check_constraint(
            f"ck_{tbl}_scope_xor", tbl,
            "num_nonnulls(chat_group_id, concept_chat_scope_id) = 1",
        )
    # メッセージのスコープ別取得（E.1 同形のカーソル）。
    op.create_index("ix_chat_messages_concept_scope_created", "chat_messages",
                    ["concept_chat_scope_id", "created_at"],
                    postgresql_where=sa.text("concept_chat_scope_id IS NOT NULL"))
    # コンセプトルームの既読は (scope, user) で一意（既存 group 用 unique とは別の部分一意）。
    op.create_index("uq_chat_reads_concept_scope_user", "chat_reads",
                    ["concept_chat_scope_id", "user_id"], unique=True,
                    postgresql_where=sa.text("concept_chat_scope_id IS NOT NULL"))


def downgrade() -> None:
    op.drop_index("uq_chat_reads_concept_scope_user", table_name="chat_reads")
    op.drop_index("ix_chat_messages_concept_scope_created", table_name="chat_messages")
    for tbl in ("chat_messages", "chat_reads"):
        op.drop_constraint(f"ck_{tbl}_scope_xor", tbl, type_="check")
        op.drop_constraint(f"fk_{tbl}_concept_scope", tbl, type_="foreignkey")
        # concept 行を除去してから NOT NULL に戻す（残す方が安全な dev もあるが規約に合わせ復元）。
        op.execute(f"DELETE FROM {tbl} WHERE concept_chat_scope_id IS NOT NULL")
        op.alter_column(tbl, "chat_group_id", existing_type=UUID(as_uuid=True), nullable=False)
        op.drop_column(tbl, "concept_chat_scope_id")

    op.drop_index("uq_concept_votes_concept_user", table_name="concept_votes")
    op.drop_table("concept_votes")
    op.drop_index("ix_concept_chat_scopes_assumption", table_name="concept_chat_scopes")
    op.execute("DROP INDEX IF EXISTS uq_concept_chat_scopes_kind")
    op.drop_index("ix_concept_chat_scopes_concept_pos", table_name="concept_chat_scopes")
    op.drop_table("concept_chat_scopes")
    op.drop_index("uq_concept_evaluation_scores_eval_aspect", table_name="concept_evaluation_scores")
    op.drop_table("concept_evaluation_scores")
    op.drop_index("ix_concept_evaluations_concept_status", table_name="concept_evaluations")
    op.drop_index("uq_concept_evaluations_concept_evaluator", table_name="concept_evaluations")
    op.drop_table("concept_evaluations")
    op.drop_index("ix_concept_assumption_links_stale", table_name="concept_assumption_links")
    op.drop_index("ix_concept_assumption_links_assumption", table_name="concept_assumption_links")
    op.drop_index("uq_concept_assumption_links", table_name="concept_assumption_links")
    op.drop_table("concept_assumption_links")
    op.drop_index("ix_assumption_validations_created", table_name="assumption_validations")
    op.drop_index("ix_assumption_validations_latest", table_name="assumption_validations")
    op.drop_table("assumption_validations")
    op.drop_index("ix_assumptions_quest_verdict", table_name="assumptions")
    op.drop_index("ix_assumptions_quest", table_name="assumptions")
    op.drop_table("assumptions")
    op.drop_index("ix_concept_source_ideas_idea", table_name="concept_source_ideas")
    op.drop_index("uq_concept_source_ideas", table_name="concept_source_ideas")
    op.drop_table("concept_source_ideas")
    op.drop_index("ix_concepts_author", table_name="concepts")
    op.drop_index("ix_concepts_quest_selected", table_name="concepts")
    op.drop_index("ix_concepts_quest_status_active", table_name="concepts")
    op.drop_table("concepts")
