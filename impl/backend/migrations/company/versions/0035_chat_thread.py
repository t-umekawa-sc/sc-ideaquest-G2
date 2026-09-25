"""company: チャット中核を chat_thread 親テーブルで完全独立化（§5.15〜§5.31・§5.45・ドメイン E/P）

チャット中核（chat_messages / chat_reads / reactions）が「置かれる相手（ホスト）」を列挙して知る
閉じた列挙設計（chat_group_id / concept_chat_scope_id の2 nullable FK＋CHECK num_nonnulls=1）を、
`thread_id` ただ一つで動く自己完結サブシステムへ一般化する。将来どのホストにチャットを足しても
chat 中核の migration/分岐は不要で、ホスト側が `chat_thread` を1本持つだけで済む。

- 新テーブル `chat_thread(id, owner_type, owner_id, created_at, UNIQUE(owner_type, owner_id))`。
  owner はポリモーフィック（'idea'＝chat_groups.id / 'concept_scope'＝concept_chat_scopes.id / 将来）。
  ホスト→thread のリンクだけソフト、chat 子テーブル→thread は堅い FK。
- 既存 chat_group / concept_chat_scope は「ホスト側の owner adapter」として存続（chat 中核は両者を知らない）。
- reactions の「1チャット1魔法（user×spell）」制約を thread ベースに張り替える。

前提: 実 DB は 0033（reactions は chat_group_id NOT NULL 単列・concept_chat_scope_id 無し）＝
旧 0034（reactions を polymorphic 2列化）は本 migration に統合し削除済み（down_revision=0033）。

Revision ID: 0035_chat_thread
Revises: 0033_concepts
Create Date: 2026-09-26
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0035_chat_thread"
down_revision = "0033_concepts"
branch_labels = None
depends_on = None

# thread 化する chat 子テーブル（メッセージ/既読/リアクション）。
_CHILD_TABLES = ("chat_messages", "chat_reads", "reactions")


def upgrade() -> None:
    # 1) chat_thread（会話の単一の親）。owner はホストのリンク表 PK を指すポリモーフィック参照。
    op.create_table(
        "chat_thread",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("owner_type", sa.Text(), nullable=False),
        sa.Column("owner_id", UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("owner_type", "owner_id", name="uq_chat_thread_owner"),
        sa.CheckConstraint("owner_type IN ('idea', 'concept_scope')", name="ck_chat_thread_owner_type"),
    )
    op.create_index("ix_chat_thread_owner", "chat_thread", ["owner_type", "owner_id"])

    # 2) backfill chat_thread（idea 由来＝chat_groups 1行=thread 1本／concept_scope 由来＝concept_chat_scopes 1行=thread 1本）
    op.execute(
        "INSERT INTO chat_thread (id, owner_type, owner_id, created_at) "
        "SELECT gen_random_uuid(), 'idea', cg.id, cg.created_at FROM chat_groups cg"
    )
    op.execute(
        "INSERT INTO chat_thread (id, owner_type, owner_id, created_at) "
        "SELECT gen_random_uuid(), 'concept_scope', s.id, now() FROM concept_chat_scopes s"
    )

    # 3) 3テーブルに thread_id（nullable）＋ FK→chat_thread を追加
    for tbl in _CHILD_TABLES:
        op.add_column(tbl, sa.Column("thread_id", UUID(as_uuid=True), nullable=True))
        op.create_foreign_key(f"fk_{tbl}_thread", tbl, "chat_thread", ["thread_id"], ["id"])

    # 4) backfill thread_id（owner_type ごとに埋める。reactions は 0033 状態＝idea 系のみ）
    for tbl in ("chat_messages", "chat_reads"):
        op.execute(
            f"UPDATE {tbl} m SET thread_id = t.id FROM chat_thread t "
            f"WHERE t.owner_type = 'idea' AND t.owner_id = m.chat_group_id AND m.chat_group_id IS NOT NULL"
        )
        op.execute(
            f"UPDATE {tbl} m SET thread_id = t.id FROM chat_thread t "
            f"WHERE t.owner_type = 'concept_scope' AND t.owner_id = m.concept_chat_scope_id "
            f"AND m.concept_chat_scope_id IS NOT NULL"
        )
    op.execute(
        "UPDATE reactions r SET thread_id = t.id FROM chat_thread t "
        "WHERE t.owner_type = 'idea' AND t.owner_id = r.chat_group_id AND r.chat_group_id IS NOT NULL"
    )

    # 5) 欠損0アサート（CHECK num_nonnulls=1 のおかげで旧列は必ずどちらか埋まっている＝全行 thread_id が付く想定）→ NOT NULL 化
    for tbl in _CHILD_TABLES:
        op.execute(
            sa.text(
                "DO $$ BEGIN "
                f"IF EXISTS (SELECT 1 FROM {tbl} WHERE thread_id IS NULL) THEN "
                f"RAISE EXCEPTION 'migration 0035: {tbl} に thread_id 欠損行があります（backfill 漏れ）'; "
                "END IF; END $$;"
            )
        )
        op.alter_column(tbl, "thread_id", existing_type=UUID(as_uuid=True), nullable=False)

    # 6) 旧オブジェクト（列挙設計の遺物）を drop
    # 6-a) chat_messages
    op.drop_constraint("ck_chat_messages_scope_xor", "chat_messages", type_="check")
    op.drop_constraint("fk_chat_messages_concept_scope", "chat_messages", type_="foreignkey")
    op.drop_index("ix_chat_messages_group_created", table_name="chat_messages")
    op.drop_index("ix_chat_messages_concept_scope_created", table_name="chat_messages")
    op.drop_column("chat_messages", "concept_chat_scope_id")
    op.drop_column("chat_messages", "chat_group_id")
    # 6-b) chat_reads
    op.drop_index("uq_chat_reads_concept_scope_user", table_name="chat_reads")
    op.drop_constraint("ck_chat_reads_scope_xor", "chat_reads", type_="check")
    op.drop_constraint("fk_chat_reads_concept_scope", "chat_reads", type_="foreignkey")
    op.drop_index("uq_chat_reads_group_user", table_name="chat_reads")
    op.drop_column("chat_reads", "concept_chat_scope_id")
    op.drop_column("chat_reads", "chat_group_id")
    # 6-c) reactions（chat_message_id ベースの uq_reactions_normal / uq_reactions_magic_message /
    #      ix_reactions_message は thread 化と無関係＝触らない）
    op.drop_index("uq_reactions_magic_group_user_spell", table_name="reactions")
    op.drop_column("reactions", "chat_group_id")

    # 7) 新オブジェクト（thread_id ベースへ張替）
    # E.1 keyset ペジネーション（created_at, id）を thread 単位で。
    op.create_index("ix_chat_messages_thread_created", "chat_messages", ["thread_id", "created_at", "id"])
    # 既読は (thread, user) で一意。
    op.create_index("uq_chat_reads_thread_user", "chat_reads", ["thread_id", "user_id"], unique=True)
    # 魔法①＝1チャット（thread）につき同一ユーザー×同一 Spell 1件（旧 group ベースから張替）。
    op.create_index(
        "uq_reactions_magic_thread_user_spell", "reactions", ["thread_id", "user_id", "spell_id"],
        unique=True, postgresql_where=sa.text("type = 'magic'"),
    )


def downgrade() -> None:
    # 7') 新 index を drop
    op.drop_index("uq_reactions_magic_thread_user_spell", table_name="reactions")
    op.drop_index("uq_chat_reads_thread_user", table_name="chat_reads")
    op.drop_index("ix_chat_messages_thread_created", table_name="chat_messages")

    # 6') 旧列・旧オブジェクトを復元（0033 状態へ）
    # 6'-c) reactions（chat_group_id NOT NULL 単列へ戻す）
    op.add_column("reactions", sa.Column("chat_group_id", UUID(as_uuid=True), nullable=True))
    op.create_foreign_key("reactions_chat_group_id_fkey", "reactions", "chat_groups", ["chat_group_id"], ["id"])
    op.execute(
        "UPDATE reactions r SET chat_group_id = t.owner_id FROM chat_thread t "
        "WHERE t.id = r.thread_id AND t.owner_type = 'idea'"
    )
    op.alter_column("reactions", "chat_group_id", existing_type=UUID(as_uuid=True), nullable=False)
    op.create_index(
        "uq_reactions_magic_group_user_spell", "reactions", ["chat_group_id", "user_id", "spell_id"],
        unique=True, postgresql_where=sa.text("type = 'magic'"),
    )
    # 6'-a/b) chat_messages / chat_reads（chat_group_id nullable ＋ concept_chat_scope_id ＋ CHECK/FK/index を復元）
    for tbl in ("chat_messages", "chat_reads"):
        op.add_column(tbl, sa.Column("chat_group_id", UUID(as_uuid=True), nullable=True))
        op.create_foreign_key(f"{tbl}_chat_group_id_fkey", tbl, "chat_groups", ["chat_group_id"], ["id"])
        op.add_column(tbl, sa.Column("concept_chat_scope_id", UUID(as_uuid=True), nullable=True))
        op.create_foreign_key(f"fk_{tbl}_concept_scope", tbl, "concept_chat_scopes", ["concept_chat_scope_id"], ["id"])
        op.execute(
            f"UPDATE {tbl} m SET chat_group_id = t.owner_id FROM chat_thread t "
            f"WHERE t.id = m.thread_id AND t.owner_type = 'idea'"
        )
        op.execute(
            f"UPDATE {tbl} m SET concept_chat_scope_id = t.owner_id FROM chat_thread t "
            f"WHERE t.id = m.thread_id AND t.owner_type = 'concept_scope'"
        )
        op.create_check_constraint(
            f"ck_{tbl}_scope_xor", tbl, "num_nonnulls(chat_group_id, concept_chat_scope_id) = 1"
        )
    op.create_index("ix_chat_messages_group_created", "chat_messages", ["chat_group_id", "created_at"])
    op.create_index("ix_chat_messages_concept_scope_created", "chat_messages",
                    ["concept_chat_scope_id", "created_at"],
                    postgresql_where=sa.text("concept_chat_scope_id IS NOT NULL"))
    op.create_index("uq_chat_reads_group_user", "chat_reads", ["chat_group_id", "user_id"], unique=True)
    op.create_index("uq_chat_reads_concept_scope_user", "chat_reads",
                    ["concept_chat_scope_id", "user_id"], unique=True,
                    postgresql_where=sa.text("concept_chat_scope_id IS NOT NULL"))

    # 3') thread_id 列・FK を drop
    for tbl in _CHILD_TABLES:
        op.drop_constraint(f"fk_{tbl}_thread", tbl, type_="foreignkey")
        op.drop_column(tbl, "thread_id")

    # 1') chat_thread を drop
    op.drop_index("ix_chat_thread_owner", table_name="chat_thread")
    op.drop_table("chat_thread")
