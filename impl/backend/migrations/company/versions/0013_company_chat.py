"""company: chat_groups / chat_messages / chat_mentions / reactions / reaction_emojis / chat_reads /
spells / user_spells を作成（§5.15〜§5.20・§5.30・§5.31・ドメイン E）＋マスタシード（reaction_emojis 6・spells 6）

enum（reaction_type/spell_effect/spell_line/rarity）は §5.3 と同方針で String 列。reactions は部分ユニーク
（魔法①②・通常重複防止）と CHECK を張る。spells は自己参照 requires_spell_id をコード解決で後埋め。
attachments.chat_message_id は 0010 で FK なし作成 → 本 migration で FK を付与（§5.12）。

Revision ID: 0013_company_chat
Revises: 0012_company_evaluations
Create Date: 2026-08-25
"""
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0013_company_chat"
down_revision = "0012_company_evaluations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "chat_groups",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("idea_id", UUID(as_uuid=True), sa.ForeignKey("ideas.id"), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "chat_messages",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("chat_group_id", UUID(as_uuid=True), sa.ForeignKey("chat_groups.id"), nullable=False),
        sa.Column("author_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("reply_to_message_id", UUID(as_uuid=True), sa.ForeignKey("chat_messages.id"), nullable=True),
        sa.Column("is_edited", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("deleted_by_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_chat_messages_group_created", "chat_messages", ["chat_group_id", "created_at"])

    op.create_table(
        "chat_mentions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("chat_message_id", UUID(as_uuid=True), sa.ForeignKey("chat_messages.id"), nullable=False),
        sa.Column("mentioned_user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
    )
    op.create_index("uq_chat_mentions_msg_user", "chat_mentions", ["chat_message_id", "mentioned_user_id"], unique=True)
    op.create_index("ix_chat_mentions_user", "chat_mentions", ["mentioned_user_id"])

    op.create_table(
        "reaction_emojis",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("code", sa.Text(), nullable=False, unique=True),
        sa.Column("emoji", sa.Text(), nullable=False, unique=True),
        sa.Column("label_ja", sa.Text(), nullable=False),
        sa.Column("label_en", sa.Text(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.create_index("ix_reaction_emojis_active_sort", "reaction_emojis", ["is_active", "sort_order"])

    op.create_table(
        "spells",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("code", sa.Text(), nullable=False, unique=True),
        sa.Column("name_ja", sa.Text(), nullable=False),
        sa.Column("name_en", sa.Text(), nullable=False),
        sa.Column("icon", sa.Text(), nullable=False),
        sa.Column("effect", sa.String(16), nullable=False),  # fire/ice/thunder/sparkle/rainbow/aura
        sa.Column("sp_cost", sa.Integer(), nullable=False),
        sa.Column("rarity", sa.String(16), nullable=False),  # common/standard/rare
        sa.Column("line", sa.String(16), nullable=False),  # flame / quiet_light
        sa.Column("requires_spell_id", UUID(as_uuid=True), sa.ForeignKey("spells.id"), nullable=True),
        sa.Column("description_ja", sa.Text(), nullable=True),
        sa.Column("description_en", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.CheckConstraint("sp_cost > 0", name="ck_spells_sp_cost_positive"),
    )

    op.create_table(
        "user_spells",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("spell_id", UUID(as_uuid=True), sa.ForeignKey("spells.id"), nullable=False),
        sa.Column("unlocked_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("uq_user_spells_user_spell", "user_spells", ["user_id", "spell_id"], unique=True)

    op.create_table(
        "reactions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("chat_message_id", UUID(as_uuid=True), sa.ForeignKey("chat_messages.id"), nullable=False),
        sa.Column("chat_group_id", UUID(as_uuid=True), sa.ForeignKey("chat_groups.id"), nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("type", sa.String(16), nullable=False),  # normal / magic
        sa.Column("emoji", sa.Text(), nullable=True),
        sa.Column("spell_id", UUID(as_uuid=True), sa.ForeignKey("spells.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "(type='normal' AND emoji IS NOT NULL AND spell_id IS NULL) OR "
            "(type='magic' AND spell_id IS NOT NULL AND emoji IS NULL)",
            name="ck_reactions_type_shape",
        ),
    )
    op.create_index("ix_reactions_message", "reactions", ["chat_message_id"])
    # 通常＝同一ユーザー×同一絵文字は不可（部分ユニーク）。
    op.create_index("uq_reactions_normal", "reactions", ["chat_message_id", "user_id", "emoji"],
                    unique=True, postgresql_where=sa.text("type = 'normal'"))
    # 魔法①＝1アイデアチャットにつき同一ユーザー×同一 Spell 1件。
    op.create_index("uq_reactions_magic_group_user_spell", "reactions", ["chat_group_id", "user_id", "spell_id"],
                    unique=True, postgresql_where=sa.text("type = 'magic'"))
    # 魔法②＝1メッセージに魔法1件（早い者勝ち）。
    op.create_index("uq_reactions_magic_message", "reactions", ["chat_message_id"],
                    unique=True, postgresql_where=sa.text("type = 'magic'"))

    op.create_table(
        "chat_reads",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("chat_group_id", UUID(as_uuid=True), sa.ForeignKey("chat_groups.id"), nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("last_read_message_id", UUID(as_uuid=True), sa.ForeignKey("chat_messages.id"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("uq_chat_reads_group_user", "chat_reads", ["chat_group_id", "user_id"], unique=True)

    # attachments.chat_message_id に FK を付与（0010 は E 未作成のため FK なしで作成・§5.12）。
    op.create_foreign_key(
        "attachments_chat_message_id_fkey", "attachments", "chat_messages", ["chat_message_id"], ["id"],
    )

    _seed_masters()


def _seed_masters() -> None:
    """reaction_emojis（6）・spells（6・自己参照は code 解決で後埋め）を冪等シード（§8-③・§8-⑪）。"""
    emojis = [
        ("thumbsup", "👍", "いいね", "Like", 1),
        ("heart", "❤️", "ありがとう", "Thanks", 2),
        ("smile", "😄", "わらい", "Haha", 3),
        ("tada", "🎉", "おめでとう", "Congrats", 4),
        ("pray", "🙏", "感謝", "Grateful", 5),
        ("eyes", "👀", "確認", "Looking", 6),
    ]
    for code, emoji, ja, en, sort in emojis:
        op.execute(sa.text(
            "INSERT INTO reaction_emojis (id, code, emoji, label_ja, label_en, sort_order, is_active) "
            "VALUES (:id, :code, :emoji, :ja, :en, :sort, true) ON CONFLICT (code) DO NOTHING"
        ).bindparams(id=uuid.uuid4(), code=code, emoji=emoji, ja=ja, en=en, sort=sort))

    # spells＝(code, ja, en, icon, effect, sp_cost, rarity, line, requires_code, sort)
    spells = [
        ("flame_1", "炎", "Flame", "🔥", "fire", 1, "common", "flame", None, 1),
        ("flame_2", "雷", "Thunder", "⚡", "thunder", 2, "standard", "flame", "flame_1", 2),
        ("flame_3", "虹", "Rainbow", "🌈", "rainbow", 3, "rare", "flame", "flame_2", 3),
        ("light_1", "氷", "Ice", "❄️", "ice", 1, "common", "quiet_light", None, 1),
        ("light_2", "キラキラ", "Sparkle", "✨", "sparkle", 2, "standard", "quiet_light", "light_1", 2),
        ("light_3", "オーラ", "Aura", "🌟", "aura", 3, "rare", "quiet_light", "light_2", 3),
    ]
    for code, ja, en, icon, effect, cost, rarity, line, _req, sort in spells:
        op.execute(sa.text(
            "INSERT INTO spells (id, code, name_ja, name_en, icon, effect, sp_cost, rarity, line, sort_order) "
            "VALUES (:id, :code, :ja, :en, :icon, :effect, :cost, :rarity, :line, :sort) ON CONFLICT (code) DO NOTHING"
        ).bindparams(id=uuid.uuid4(), code=code, ja=ja, en=en, icon=icon, effect=effect, cost=cost,
                     rarity=rarity, line=line, sort=sort))
    # 前提魔法（自己参照）を code 解決で後埋め。
    for code, _ja, _en, _icon, _effect, _cost, _rarity, _line, req, _sort in spells:
        if req:
            op.execute(sa.text(
                "UPDATE spells SET requires_spell_id = (SELECT id FROM spells WHERE code = :req) WHERE code = :code"
            ).bindparams(req=req, code=code))


def downgrade() -> None:
    op.drop_constraint("attachments_chat_message_id_fkey", "attachments", type_="foreignkey")
    op.drop_table("chat_reads")
    op.drop_table("reactions")
    op.drop_table("user_spells")
    op.drop_table("spells")
    op.drop_table("reaction_emojis")
    op.drop_table("chat_mentions")
    op.drop_table("chat_messages")
    op.drop_table("chat_groups")
