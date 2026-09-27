"""company: ソリューション開発（FR-43・ISO④⑤）＝projects/project_members/tasks/task_dependencies/
spec_decisions/spec_decision_votes ＋ users.delivery_xp ＋ chat_thread CHECK に 'task' 追加。

Revision ID: 0041_solutions
Revises: 0040_evaluation_revisions
Create Date: 2026-09-27
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0041_solutions"
down_revision = "0040_evaluation_revisions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 開発XP（別軸・§5.49）＝users にキャッシュ列を追加。
    op.add_column("users", sa.Column("delivery_xp", sa.BigInteger(), nullable=False, server_default="0"))

    # projects（ルート・コンセプト由来 or コンセプト非依存＝単純タスク管理・§5.49）
    op.create_table(
        "projects",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("concept_id", UUID(as_uuid=True), sa.ForeignKey("concepts.id", ondelete="SET NULL"), nullable=True),
        sa.Column("quest_id", UUID(as_uuid=True), nullable=True),  # ソフト参照（quests 未 FK 慣行に合わせる）
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="planning"),
        sa.Column("deployment", JSONB(), nullable=False, server_default="{}"),
        sa.Column("external_link", JSONB(), nullable=True),
        sa.Column("owner_account_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    # 1コンセプト1プロジェクト＝部分ユニーク（NULL は重複可＝コンセプト非依存を複数作れる）
    op.create_index("uq_projects_concept", "projects", ["concept_id"], unique=True, postgresql_where=sa.text("concept_id IS NOT NULL"))
    op.create_index("ix_projects_quest", "projects", ["quest_id"])
    op.create_index("ix_projects_status_updated", "projects", ["status", "updated_at"])

    # project_members（開発担当・§5.49b）
    op.create_table(
        "project_members",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("role", sa.String(16), nullable=False, server_default="member"),
        sa.Column("added_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("project_id", "user_id", name="uq_project_members"),
    )
    op.create_index("ix_project_members_project_role", "project_members", ["project_id", "role"])
    op.create_index("ix_project_members_user", "project_members", ["user_id"])

    # tasks（自己参照ツリー・§5.50）
    op.create_table(
        "tasks",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("parent_task_id", UUID(as_uuid=True), sa.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=True),
        sa.Column("kind", sa.String(16), nullable=False, server_default="task"),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("assignee_account_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="todo"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("done_at", sa.DateTime(timezone=True), nullable=True),
        # 将来拡張の器（MVP 未使用・§3.6）
        sa.Column("estimate_value", sa.Numeric(), nullable=True),
        sa.Column("estimate_unit", sa.String(16), nullable=True),
        sa.Column("planned_start", sa.Date(), nullable=True),
        sa.Column("planned_end", sa.Date(), nullable=True),
        sa.Column("actual_start", sa.Date(), nullable=True),
        sa.Column("actual_end", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_tasks_project_parent_sort", "tasks", ["project_id", "parent_task_id", "sort_order"])
    op.create_index("ix_tasks_assignee_status", "tasks", ["assignee_account_id", "status"])
    op.create_index("ix_tasks_project_status", "tasks", ["project_id", "status"])

    # task_dependencies（器のみ・MVP 未配線・§5.51）
    op.create_table(
        "task_dependencies",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("task_id", UUID(as_uuid=True), sa.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("depends_on_task_id", UUID(as_uuid=True), sa.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("dep_type", sa.String(24), nullable=False, server_default="finish_to_start"),
        sa.UniqueConstraint("task_id", "depends_on_task_id", name="uq_task_dependencies"),
    )

    # spec_decisions / spec_decision_votes（器のみ・Phase2 未配線・§5.52/5.53）
    op.create_table(
        "spec_decisions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("task_id", UUID(as_uuid=True), sa.ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("options", JSONB(), nullable=False, server_default="[]"),
        sa.Column("status", sa.String(16), nullable=False, server_default="open"),
        sa.Column("decided_option", sa.Text(), nullable=True),
        sa.Column("raised_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "spec_decision_votes",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("spec_decision_id", UUID(as_uuid=True), sa.ForeignKey("spec_decisions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("option_key", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("spec_decision_id", "user_id", name="uq_spec_decision_votes"),
    )

    # chat_thread の CHECK を 'task' 込みに広げる（§5.14b・タスクをチャットホストに）
    op.drop_constraint("ck_chat_thread_owner_type", "chat_thread", type_="check")
    op.create_check_constraint(
        "ck_chat_thread_owner_type", "chat_thread",
        "owner_type IN ('idea', 'concept_scope', 'task')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_chat_thread_owner_type", "chat_thread", type_="check")
    op.create_check_constraint(
        "ck_chat_thread_owner_type", "chat_thread",
        "owner_type IN ('idea', 'concept_scope')",
    )
    op.drop_table("spec_decision_votes")
    op.drop_table("spec_decisions")
    op.drop_table("task_dependencies")
    op.drop_index("ix_tasks_project_status", table_name="tasks")
    op.drop_index("ix_tasks_assignee_status", table_name="tasks")
    op.drop_index("ix_tasks_project_parent_sort", table_name="tasks")
    op.drop_table("tasks")
    op.drop_index("ix_project_members_user", table_name="project_members")
    op.drop_index("ix_project_members_project_role", table_name="project_members")
    op.drop_table("project_members")
    op.drop_index("ix_projects_status_updated", table_name="projects")
    op.drop_index("ix_projects_quest", table_name="projects")
    op.drop_index("uq_projects_concept", table_name="projects")
    op.drop_table("projects")
    op.drop_column("users", "delivery_xp")
