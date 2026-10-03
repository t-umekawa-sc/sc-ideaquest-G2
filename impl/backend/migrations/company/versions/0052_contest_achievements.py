"""company: アイデアコンテスト入賞バッジ（achievements シード・FR-46・設計 §6.2）

表彰確定（contests finalize）で各軸の順位に応じて付与する入賞実績＝rank 1→gold / 2→silver / 3→bronze の
3バッジ（軸横断で再利用）。condition は `{"type":"manual"}`＝実績エンジン（count/streak 等の自動判定）は
対象外（engine.compute は未知 type を met=False で無害化・engine._relevant も False）＝finalize から直接解除する。
報酬（XP/コイン）は contest の `prize_config` 側で付与するため、バッジ自体の `coin_reward` は 0（二重付与回避）。

Revision ID: 0052_contest_achievements
Revises: 0051_grant_quest_create
Create Date: 2026-10-03
"""
import json
import uuid

from alembic import op
import sqlalchemy as sa

revision = "0052_contest_achievements"
down_revision = "0051_grant_quest_create"
branch_labels = None
depends_on = None

_CONTEST_AWARD_CODES = ("contest_award_gold", "contest_award_silver", "contest_award_bronze")

_ROWS = [
    # code, tier, icon, ja, en, desc_ja, desc_en, sort
    ("contest_award_gold", "gold", "🥇", "コンテスト優勝", "Contest Gold",
     "アイデアコンテストでいずれかの軸の1位に輝く", "Rank 1st in a contest axis", 20),
    ("contest_award_silver", "silver", "🥈", "コンテスト準優勝", "Contest Silver",
     "アイデアコンテストでいずれかの軸の2位に入る", "Rank 2nd in a contest axis", 21),
    ("contest_award_bronze", "bronze", "🥉", "コンテスト入賞", "Contest Bronze",
     "アイデアコンテストでいずれかの軸の3位に入る", "Rank 3rd in a contest axis", 22),
]


def upgrade() -> None:
    for code, tier, icon, ja, en, dja, den, sort in _ROWS:
        op.execute(sa.text(
            "INSERT INTO achievements (id, code, category, tier, icon, name_ja, name_en, description_ja, description_en, "
            "condition, target_value, is_secret, coin_reward, sort_order) "
            "VALUES (:id, :code, 'コンテスト', :tier, :icon, :ja, :en, :dja, :den, CAST(:cond AS jsonb), NULL, false, 0, :sort) "
            "ON CONFLICT (code) DO NOTHING"
        ).bindparams(id=uuid.uuid4(), code=code, tier=tier, icon=icon, ja=ja, en=en, dja=dja, den=den,
                     cond=json.dumps({"type": "manual"}), sort=sort))


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM achievements WHERE code IN :codes").bindparams(
        sa.bindparam("codes", value=_CONTEST_AWARD_CODES, expanding=True)))
