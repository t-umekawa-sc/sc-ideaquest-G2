"""company: achievements / user_achievements を作成（§5.28/§5.29・ドメイン G 実績）＋実績カタログシード

実績は台帳（activities）追記の post-commit フックでサーバー判定・冪等（G.4・§8-⑲）。condition は jsonb で
ロジック定義（count/streak_login/level/all_spells/all_items）。tier 連動コイン報酬（bronze20/silver50/gold150）。
enum（achievement_tier）は §5.3 と同方針で String 列。

Revision ID: 0016_company_achievements
Revises: 0015_company_items
Create Date: 2026-08-25
"""
import json
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0016_company_achievements"
down_revision = "0015_company_items"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "achievements",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("code", sa.Text(), nullable=False, unique=True),
        sa.Column("category", sa.Text(), nullable=False),
        sa.Column("tier", sa.String(16), nullable=False),  # bronze/silver/gold
        sa.Column("icon", sa.Text(), nullable=False),
        sa.Column("name_ja", sa.Text(), nullable=False),
        sa.Column("name_en", sa.Text(), nullable=False),
        sa.Column("description_ja", sa.Text(), nullable=False),
        sa.Column("description_en", sa.Text(), nullable=False),
        sa.Column("condition", JSONB(), nullable=False),
        sa.Column("target_value", sa.Integer(), nullable=True),
        sa.Column("is_secret", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("coin_reward", sa.Integer(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )

    op.create_table(
        "user_achievements",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("achievement_id", UUID(as_uuid=True), sa.ForeignKey("achievements.id"), nullable=False),
        sa.Column("progress_current", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("progress_target", sa.Integer(), nullable=True),
        sa.Column("unlocked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("uq_user_achievements", "user_achievements", ["user_id", "achievement_id"], unique=True)

    _seed()


_COIN = {"bronze": 20, "silver": 50, "gold": 150}


def _seed() -> None:
    """実績カタログ（全社同一・§8-③・code upsert）。閾値は単発行動で発火しない値（テスト非破壊）。"""
    rows = [
        # code, category, tier, icon, ja, en, desc_ja, desc_en, condition, target, secret, sort
        ("evaluator_3", "評価", "bronze", "⭐", "評価者", "Evaluator", "評価を3件確定する", "Submit 3 evaluations", {"type": "count", "reason": "evaluation", "target": 3}, 3, False, 1),
        ("evaluator_10", "評価", "silver", "🌟", "熟練評価者", "Expert Evaluator", "評価を10件確定する", "Submit 10 evaluations", {"type": "count", "reason": "evaluation", "target": 10}, 10, False, 2),
        ("selector_2", "採用", "silver", "🏅", "選定される人", "Selected", "自分のアイデアが2件選定される", "Have 2 ideas selected", {"type": "count", "reason": "selection", "target": 2}, 2, False, 3),
        ("chatty_10", "議論", "bronze", "💬", "議論の人", "Talker", "チャットを10回投稿する", "Post 10 chat messages", {"type": "count", "reason": "chat", "target": 10}, 10, False, 4),
        ("voter_5", "投票", "bronze", "🗳️", "投票者", "Voter", "5件のアイデアに投票する", "Vote on 5 ideas", {"type": "count", "reason": "vote", "target": 5}, 5, False, 5),
        ("streak_7", "継続", "silver", "🔥", "皆勤（週）", "Weekly Streak", "7日連続でログインする", "Login 7 days in a row", {"type": "streak_login", "target": 7}, 7, False, 6),
        ("streak_30", "継続", "gold", "🏆", "皆勤（月）", "Monthly Streak", "30日連続でログインする", "Login 30 days in a row", {"type": "streak_login", "target": 30}, 30, False, 7),
        ("level_5", "成長", "bronze", "📈", "駆け出し", "Rising", "レベル5に到達する", "Reach level 5", {"type": "level", "target": 5}, 5, False, 8),
        ("level_10", "成長", "silver", "🚀", "一人前", "Seasoned", "レベル10に到達する", "Reach level 10", {"type": "level", "target": 10}, 10, False, 9),
        ("spellmaster", "魔法", "gold", "✨", "魔法の達人", "Spellmaster", "すべての魔法を解放する", "Unlock all spells", {"type": "all_spells"}, None, False, 10),
        ("collector", "装備", "gold", "👑", "コレクター", "Collector", "すべての装備を購入する", "Own all items", {"type": "all_items"}, None, False, 11),
        ("secret_evaluator", "シークレット", "gold", "🎖️", "評価の鬼", "Evaluation Master", "評価を20件確定する", "Submit 20 evaluations", {"type": "count", "reason": "evaluation", "target": 20}, 20, True, 12),
    ]
    for code, cat, tier, icon, ja, en, dja, den, cond, target, secret, sort in rows:
        op.execute(sa.text(
            "INSERT INTO achievements (id, code, category, tier, icon, name_ja, name_en, description_ja, description_en, "
            "condition, target_value, is_secret, coin_reward, sort_order) "
            "VALUES (:id, :code, :cat, :tier, :icon, :ja, :en, :dja, :den, CAST(:cond AS jsonb), :target, :secret, :coin, :sort) "
            "ON CONFLICT (code) DO NOTHING"
        ).bindparams(id=uuid.uuid4(), code=code, cat=cat, tier=tier, icon=icon, ja=ja, en=en, dja=dja, den=den,
                     cond=json.dumps(cond), target=target, secret=secret, coin=_COIN[tier], sort=sort))


def downgrade() -> None:
    op.drop_table("user_achievements")
    op.drop_table("achievements")
