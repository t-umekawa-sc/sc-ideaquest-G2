"""company: items / user_items を作成（§5.25/§5.26・ドメイン G ショップ/装備）＋アイテムシード（全社同一）

enum（equipment_slot/rarity）は §5.3 と同方針で String 列。user_items は所有（UNIQUE(user_id,item_id)）と
「同スロット1点装備」（部分ユニーク UNIQUE(user_id, slot) WHERE is_equipped・§8-⑩）を DB 制約で担保。
アイテムのアイコン（絵文字）はフロントの presentation（§5.25 に icon 列は持たない・part_ref は VRM 用）。

Revision ID: 0015_company_items
Revises: 0014_company_chat_quotes
Create Date: 2026-08-25
"""
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0015_company_items"
down_revision = "0014_company_chat_quotes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "items",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("code", sa.Text(), nullable=False, unique=True),
        sa.Column("name_ja", sa.Text(), nullable=False),
        sa.Column("name_en", sa.Text(), nullable=False),
        sa.Column("slot", sa.String(16), nullable=False),  # head/face/body/hand/background
        sa.Column("rarity", sa.String(16), nullable=False),  # common/standard/rare
        sa.Column("price_coin", sa.Integer(), nullable=False),
        sa.Column("part_ref", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.CheckConstraint("price_coin >= 0", name="ck_items_price_nonneg"),
    )

    op.create_table(
        "user_items",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("item_id", UUID(as_uuid=True), sa.ForeignKey("items.id"), nullable=False),
        sa.Column("slot", sa.String(16), nullable=False),  # items.slot の非正規化コピー
        sa.Column("is_equipped", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("acquired_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("uq_user_items_user_item", "user_items", ["user_id", "item_id"], unique=True)
    op.create_index("uq_user_items_equipped_slot", "user_items", ["user_id", "slot"],
                    unique=True, postgresql_where=sa.text("is_equipped"))

    _seed_items()


def _seed_items() -> None:
    """装備カタログ（全社同一シード・§8-③・code upsert）。帯＝コモン10〜30/標準50〜150/レア300〜800。"""
    items = [
        # code, ja, en, slot, rarity, price, sort
        ("crown", "王冠", "Crown", "head", "rare", 600, 1),
        ("tophat", "シルクハット", "Top Hat", "head", "standard", 120, 2),
        ("cap", "キャップ", "Cap", "head", "common", 20, 3),
        ("straw", "麦わら帽", "Straw Hat", "head", "common", 20, 4),
        ("shades", "サングラス", "Shades", "face", "standard", 90, 1),
        ("glasses", "メガネ", "Glasses", "face", "common", 15, 2),
        ("mask", "マスク", "Mask", "face", "common", 15, 3),
        ("armor", "アーマー", "Armor", "body", "rare", 700, 1),
        ("suit", "スーツ", "Suit", "body", "standard", 150, 2),
        ("coat", "ロングコート", "Long Coat", "body", "standard", 120, 3),
        ("gi", "道着", "Gi", "body", "common", 30, 4),
        ("sword", "剣", "Sword", "hand", "rare", 500, 1),
        ("wand", "魔法の杖", "Wand", "hand", "standard", 120, 2),
        ("hammer", "大槌", "Hammer", "hand", "standard", 90, 3),
        ("book", "本", "Book", "hand", "common", 25, 4),
        ("castle", "古城", "Castle", "background", "rare", 500, 1),
        ("galaxy", "星空", "Galaxy", "background", "rare", 400, 2),
        ("sunset", "夕焼けの海", "Sunset Sea", "background", "standard", 100, 3),
        ("forest", "森", "Forest", "background", "common", 25, 4),
    ]
    for code, ja, en, slot, rarity, price, sort in items:
        op.execute(sa.text(
            "INSERT INTO items (id, code, name_ja, name_en, slot, rarity, price_coin, sort_order) "
            "VALUES (:id, :code, :ja, :en, :slot, :rarity, :price, :sort) ON CONFLICT (code) DO NOTHING"
        ).bindparams(id=uuid.uuid4(), code=code, ja=ja, en=en, slot=slot, rarity=rarity, price=price, sort=sort))


def downgrade() -> None:
    op.drop_table("user_items")
    op.drop_table("items")
