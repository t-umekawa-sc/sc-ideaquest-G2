"""アイデアコンテストの単一アクセスポリシー（設計 §2.3「唯一の分岐点」・FR-46）。

アイデアの可視/投票/チャット/評価は、当該アイデアの backing quest が**コンテスト配下か**で
ゲートが変わる（通常クエスト＝パーティー所属＋部署ゲート／コンテスト＝会社全体＋Tier/審査員）。
ここを**フォークせず単一のポリシー解決**に集約する（チャットの `_resolve_host` と同じ思想）。

各コアゲート（`quests/repository.can_access_quest`・投稿 `create_idea`・投票 `_guard_votable`・
チャット `_require_comment`・評価 `_is_evaluator`）は本モジュールへ委譲し、分岐を1箇所に閉じる
（§2.3 DRY・「一か所直せば両方直る」）。

- 可視  ＝ 会社全体（テナント内なら誰でも・パーティー/部署非依存）
- 投稿  ＝ Tier1 参加者（`contest_participants` approved・§5.1「自分のアイデア投稿」）
- 投票  ＝ Tier1 参加者（`contest_participants` approved・案X/決定A）
- チャット＝ Tier2 承認者（`idea_participants` approved・投稿者承認・決定A'）
- 評価  ＝ `contest_evaluator` 保持者のみ（運営指名の審査員・§5.2）
"""
from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from app.control_plane.auth.orm import Account
from app.db.control import control_session
from app.tenant.capabilities import application as caps_app
from app.tenant.contests import repository as contest_repo
from app.tenant.contests.orm import Contest
from app.tenant.profile.orm import User


def contest_of(session: Session, quest_id: uuid.UUID) -> Contest | None:
    """quest がコンテストの backing quest なら Contest を返す（通常クエストは None）。"""
    return contest_repo.contest_by_quest(session, quest_id)


def _is_company_admin_by_user(session: Session, user_id: uuid.UUID) -> bool:
    """user_id → account → control の system_role で管理者判定（can_view_contest 用・user_id しか無い門番から呼ぶ）。"""
    u = session.get(User, user_id)
    if u is None:
        return False
    with control_session() as s:
        acc = s.get(Account, u.account_id)
    return acc is not None and acc.system_role in ("company_account_admin", "system_admin")


def is_contest_manager(session: Session, user_id: uuid.UUID) -> bool:
    """運営＝②能力 `contest_create` 保持者 OR 会社アカウント管理者/システム管理者（作成/編集/可視の運営権限・決定I）。"""
    return (caps_app.user_has_capability(session, user_id, "contest_create")
            or _is_company_admin_by_user(session, user_id))


def can_view_contest(session: Session, contest: Contest, user_id: uuid.UUID) -> bool:
    """コンテストの中身（詳細/アイデア/議論/検索/活動/ランキング）の可視可否（改訂 2026-10-04・ユーザー要件・設計 §2.3）。

    - `auto_approve`（誰でも参加可）＝会社全体に公開（public 会社もサインアップで自動承認＝実質同じ・決定G）。
    - 承認制（`auto_approve=false`）は**参加資格のある者のみ**＝作成者 / Tier1 参加者 / 運営。
      未参加者は一覧のダイアログで概要＋応募のみ（SC-53）＝詳細・配下リソースは本ゲートで遮断する。
    """
    if contest.auto_approve:
        return True
    if contest.created_by_id == user_id:
        return True
    if contest_repo.is_contest_participant(session, contest.id, user_id):
        return True
    return is_contest_manager(session, user_id)


def can_post_idea(session: Session, contest: Contest, user_id: uuid.UUID) -> bool:
    """アイデア投稿＝Tier1 参加者（§5.1「閲覧＋自分のアイデア投稿＋投票」・決定A）＝member/idea_create 権限を置換。"""
    return contest_repo.is_contest_participant(session, contest.id, user_id)


def can_vote(session: Session, contest: Contest, user_id: uuid.UUID) -> bool:
    """投票＝Tier1 参加者（案X・決定A）。"""
    return contest_repo.is_contest_participant(session, contest.id, user_id)


def can_chat(session: Session, idea_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    """チャット＝Tier2 承認者（投稿者承認・決定A'）。"""
    return contest_repo.is_idea_participant(session, idea_id, user_id)


def can_evaluate(session: Session, user_id: uuid.UUID) -> bool:
    """評価＝`contest_evaluator` 保持者のみ（運営指名の審査員・§5.2）。投稿者でも非保持は不可。"""
    return caps_app.user_has_capability(session, user_id, "contest_evaluator")
