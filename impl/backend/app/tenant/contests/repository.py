"""アイデアコンテスト（contests）のデータアクセス（データモデル §5.60・FR-46）。

backing quest（1:1）の生成はアプリ層（quests repo を呼ぶ）。本 repo は contests 行の CRUD と一覧に徹する。
呼び出し側 Tx に相乗（自身では commit しない）。
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.tenant.contests.orm import Contest, ContestIdeaFlag, ContestParticipant, IdeaParticipant


def create(session: Session, *, quest_id: uuid.UUID, theme: str, description: str | None,
           mode: str, status: str, starts_at, ends_at, auto_archive_days: int | None,
           prize_config: dict | None, created_by_id: uuid.UUID, auto_approve: bool = False) -> Contest:
    c = Contest(id=uuid.uuid4(), quest_id=quest_id, theme=theme, description=description,
                mode=mode, status=status, starts_at=starts_at, ends_at=ends_at,
                auto_archive_days=auto_archive_days, prize_config=prize_config,
                created_by_id=created_by_id, auto_approve=auto_approve)
    session.add(c)
    session.flush()
    return c


def get(session: Session, contest_id: uuid.UUID) -> Contest | None:
    c = session.get(Contest, contest_id)
    if c is None or c.deleted_at is not None:
        return None
    return c


def list_all(session: Session, *, status: str | None = None) -> list[Contest]:
    """一覧（新着降順・論理削除除外）。status 指定で会期タブ絞り込み（MVP＝単純一覧・DataTable 委譲は後続）。"""
    stmt = select(Contest).where(Contest.deleted_at.is_(None))
    if status:
        stmt = stmt.where(Contest.status == status)
    return list(session.execute(stmt.order_by(Contest.created_at.desc())).scalars().all())


def touch(session: Session, contest: Contest) -> None:
    contest.updated_at = datetime.now(timezone.utc)


# ---- 参加 2階層（Tier1 contest_participants / Tier2 idea_participants・§5.61/5.62・T.2） ----

def get_contest_participation(session: Session, contest_id: uuid.UUID, user_id: uuid.UUID) -> ContestParticipant | None:
    return session.execute(
        select(ContestParticipant).where(ContestParticipant.contest_id == contest_id,
                                         ContestParticipant.user_id == user_id)
    ).scalars().first()


def upsert_contest_participation(session: Session, contest_id: uuid.UUID, user_id: uuid.UUID, *,
                                 status: str, decided_by_id: uuid.UUID | None = None) -> ContestParticipant:
    """Tier1 参加の作成/更新（冪等）。requested/approved/rejected/left を設定。"""
    row = get_contest_participation(session, contest_id, user_id)
    now = datetime.now(timezone.utc)
    if row is None:
        row = ContestParticipant(id=uuid.uuid4(), contest_id=contest_id, user_id=user_id, status=status)
        if status != "requested":
            row.decided_at, row.decided_by_id = now, decided_by_id
        session.add(row)
        session.flush()
        return row
    row.status = status
    if status != "requested":
        row.decided_at, row.decided_by_id = now, decided_by_id
    return row


def is_contest_participant(session: Session, contest_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    """Tier1 承認済みか（投票ゲート・案X）。"""
    row = get_contest_participation(session, contest_id, user_id)
    return row is not None and row.status == "approved"


def get_idea_participation(session: Session, idea_id: uuid.UUID, user_id: uuid.UUID) -> IdeaParticipant | None:
    return session.execute(
        select(IdeaParticipant).where(IdeaParticipant.idea_id == idea_id,
                                      IdeaParticipant.user_id == user_id)
    ).scalars().first()


def upsert_idea_participation(session: Session, idea_id: uuid.UUID, user_id: uuid.UUID, *,
                              status: str, decided_by_id: uuid.UUID | None = None) -> IdeaParticipant:
    """Tier2 参加の作成/更新（冪等）。承認主体はアイデア投稿者（decided_by_id）。"""
    row = get_idea_participation(session, idea_id, user_id)
    now = datetime.now(timezone.utc)
    if row is None:
        row = IdeaParticipant(id=uuid.uuid4(), idea_id=idea_id, user_id=user_id, status=status)
        if status != "requested":
            row.decided_at, row.decided_by_id = now, decided_by_id
        session.add(row)
        session.flush()
        return row
    row.status = status
    if status != "requested":
        row.decided_at, row.decided_by_id = now, decided_by_id
    return row


def is_idea_participant(session: Session, idea_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    """Tier2 承認済みか（チャットゲート）。"""
    row = get_idea_participation(session, idea_id, user_id)
    return row is not None and row.status == "approved"


def contest_by_quest(session: Session, quest_id: uuid.UUID) -> Contest | None:
    """backing quest から contest を引く（コンテスト配下か判定・単一ポリシー解決用）。"""
    c = session.execute(select(Contest).where(Contest.quest_id == quest_id,
                                              Contest.deleted_at.is_(None))).scalars().first()
    return c


# ---- 表彰・ランキング集計（会期スコープ＝backing quest×[starts_at, ends_at)・T.3/§6.1） ----
# いずれも既存テーブル（votes/evaluations/evaluation_scores/activities）を会期×backing quest で集計＝新テーブル不要。
# 遅延 import（contests→ideas/evaluations/gamification の読取・循環は実行時に解消）。

def rank_approve_votes(session: Session, quest_id: uuid.UUID, *, start, end) -> list[tuple]:
    """賛成投票数ランキング（アイデア単位・会期内）。返り値＝[(idea_id, author_id, count)] 降順（タイブレーク=初投票昇順）。"""
    from app.tenant.ideas.orm import Idea, Vote
    n = func.count().label("n")
    stmt = (select(Vote.idea_id, Idea.author_id, n)
            .join(Idea, Idea.id == Vote.idea_id)
            .where(Idea.quest_id == quest_id, Idea.status == "published", Vote.type == "approve")
            .group_by(Vote.idea_id, Idea.author_id)
            .order_by(n.desc(), func.min(Vote.voted_at).asc()))
    if start is not None:
        stmt = stmt.where(Vote.voted_at >= start)
    if end is not None:
        stmt = stmt.where(Vote.voted_at < end)
    return [(iid, aid, int(c)) for iid, aid, c in session.execute(stmt).all()]


def rank_avg_score(session: Session, quest_id: uuid.UUID, *, start, end) -> list[tuple]:
    """平均評価点ランキング（アイデア単位・submitted・会期内）。返り値＝[(idea_id, author_id, avg)] 降順。"""
    from app.tenant.evaluations.orm import Evaluation, EvaluationScore
    from app.tenant.ideas.orm import Idea
    avg = func.avg(EvaluationScore.score).label("avg")
    stmt = (select(Evaluation.idea_id, Idea.author_id, avg)
            .join(Idea, Idea.id == Evaluation.idea_id)
            .join(EvaluationScore, EvaluationScore.evaluation_id == Evaluation.id)
            .where(Idea.quest_id == quest_id, Idea.status == "published", Evaluation.status == "submitted")
            .group_by(Evaluation.idea_id, Idea.author_id)
            .order_by(avg.desc(), func.min(Evaluation.submitted_at).asc()))
    if start is not None:
        stmt = stmt.where(Evaluation.submitted_at >= start)
    if end is not None:
        stmt = stmt.where(Evaluation.submitted_at < end)
    return [(iid, aid, float(a)) for iid, aid, a in session.execute(stmt).all()]


def rank_contribution(session: Session, quest_id: uuid.UUID, *, start, end) -> list[tuple]:
    """活動貢献ランキング（ユーザー単位・reason∈{chat,evaluation,vote}・会期内）。返り値＝[(user_id, count)] 降順。"""
    from app.tenant.gamification.orm import Activity
    n = func.count().label("n")
    stmt = (select(Activity.user_id, n)
            .where(Activity.quest_id == quest_id, Activity.reason.in_(("chat", "evaluation", "vote")))
            .group_by(Activity.user_id)
            .order_by(n.desc(), func.min(Activity.created_at).asc()))
    if start is not None:
        stmt = stmt.where(Activity.created_at >= start)
    if end is not None:
        stmt = stmt.where(Activity.created_at < end)
    return [(uid, int(c)) for uid, c in session.execute(stmt).all()]


# ---- 恒久ステータス（殿堂入り/お蔵入り・contest_idea_flags・§5.64・T.1） ----

def get_idea_flag(session: Session, idea_id: uuid.UUID, flag: str) -> ContestIdeaFlag | None:
    return session.execute(
        select(ContestIdeaFlag).where(ContestIdeaFlag.idea_id == idea_id, ContestIdeaFlag.flag == flag)
    ).scalars().first()


def set_idea_flag(session: Session, *, contest_id: uuid.UUID, idea_id: uuid.UUID, flag: str,
                  granted_by_id: uuid.UUID | None = None) -> ContestIdeaFlag:
    """殿堂入り/お蔵入りを付与（冪等・UNIQUE(idea_id,flag)）。既存ならそのまま返す。"""
    row = get_idea_flag(session, idea_id, flag)
    if row is not None:
        return row
    row = ContestIdeaFlag(id=uuid.uuid4(), contest_id=contest_id, idea_id=idea_id, flag=flag,
                          granted_by_id=granted_by_id)
    session.add(row)
    session.flush()
    return row


def list_flags_for_contest(session: Session, contest_id: uuid.UUID) -> list[ContestIdeaFlag]:
    return list(session.execute(
        select(ContestIdeaFlag).where(ContestIdeaFlag.contest_id == contest_id)
    ).scalars().all())


def discussion_idea_ids(session: Session, quest_id: uuid.UUID, user_id: uuid.UUID) -> list[uuid.UUID]:
    """ログインユーザーが議論に参加しているアイデア id（自分が投稿者 or Tier2 approved）。
    「新着の議論」を本人関与のアイデアに限定する用途（SC-54・backing quest スコープ）。"""
    from app.tenant.ideas.orm import Idea
    stmt = select(Idea.id).where(
        Idea.quest_id == quest_id,
        or_(Idea.author_id == user_id,
            Idea.id.in_(select(IdeaParticipant.idea_id).where(
                IdeaParticipant.user_id == user_id, IdeaParticipant.status == "approved"))),
    )
    return list(session.execute(stmt).scalars().all())
