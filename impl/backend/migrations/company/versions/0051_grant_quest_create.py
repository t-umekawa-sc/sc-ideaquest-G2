"""company: 既存クエスト作成者へ quest_create を自動付与（FR-47・決定K・移行）。

「現状は誰でもクエスト作成可」を②会社レベル能力 `quest_create` で制約するにあたり、**既存のクエスト
作成者（quests.owner_id の distinct）には自動付与して『作れていた人は作れ続ける』を担保**する。以降の
新規は付与制（会社アカウント管理者が付与）、管理者は常時保持（能力行なしでも作成可・アプリ側ゲート）。

冪等＝既に有効な quest_create 行がある user はスキップ。移行付与は granted_by_id=NULL（システム移行の印）。

（注: alembic_version.version_num は varchar(32)。revision id は 32 字以内。）

Revision ID: 0051_grant_quest_create
Revises: 0050_contests
Create Date: 2026-10-02
"""
from alembic import op

revision = "0051_grant_quest_create"
down_revision = "0050_contests"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO user_capabilities (id, user_id, capability, granted_by_id, granted_at)
        SELECT gen_random_uuid(), q.owner_id, 'quest_create', NULL, now()
        FROM (SELECT DISTINCT owner_id FROM quests) q
        WHERE NOT EXISTS (
            SELECT 1 FROM user_capabilities uc
            WHERE uc.user_id = q.owner_id
              AND uc.capability = 'quest_create'
              AND uc.revoked_at IS NULL
        )
        """
    )


def downgrade() -> None:
    # 移行で付与した分（granted_by_id IS NULL）のみ取り消す。
    op.execute(
        "DELETE FROM user_capabilities WHERE capability = 'quest_create' AND granted_by_id IS NULL"
    )
