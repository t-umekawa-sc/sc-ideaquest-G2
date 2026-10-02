"""アイデアコンテストの単一アクセスポリシー（設計 §2.3「唯一の分岐点」・FR-46）。

アイデアの可視/投票/チャット/評価は、当該アイデアの backing quest が**コンテスト配下か**で
ゲートが変わる（通常クエスト＝パーティー所属＋部署ゲート／コンテスト＝会社全体＋Tier/審査員）。
ここを**フォークせず単一のポリシー解決**に集約する（チャットの `_resolve_host` と同じ思想）。

各コアゲート（`quests/repository.can_access_quest`・投票 `_guard_votable`・チャット `_require_comment`・
評価 `_is_evaluator`）は本モジュールへ委譲し、分岐を1箇所に閉じる（§2.3 DRY・「一か所直せば両方直る」）。

- 可視  ＝ 会社全体（テナント内なら誰でも・パーティー/部署非依存）
- 投票  ＝ Tier1 参加者（`contest_participants` approved・案X/決定A）
- チャット＝ Tier2 承認者（`idea_participants` approved・投稿者承認・決定A'）
- 評価  ＝ `contest_evaluator` 保持者のみ（運営指名の審査員・§5.2）
"""
from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from app.tenant.capabilities import application as caps_app
from app.tenant.contests import repository as contest_repo
from app.tenant.contests.orm import Contest


def contest_of(session: Session, quest_id: uuid.UUID) -> Contest | None:
    """quest がコンテストの backing quest なら Contest を返す（通常クエストは None）。"""
    return contest_repo.contest_by_quest(session, quest_id)


def can_vote(session: Session, contest: Contest, user_id: uuid.UUID) -> bool:
    """投票＝Tier1 参加者（案X・決定A）。"""
    return contest_repo.is_contest_participant(session, contest.id, user_id)


def can_chat(session: Session, idea_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    """チャット＝Tier2 承認者（投稿者承認・決定A'）。"""
    return contest_repo.is_idea_participant(session, idea_id, user_id)


def can_evaluate(session: Session, user_id: uuid.UUID) -> bool:
    """評価＝`contest_evaluator` 保持者のみ（運営指名の審査員・§5.2）。投稿者でも非保持は不可。"""
    return caps_app.user_has_capability(session, user_id, "contest_evaluator")
