"""お知らせ の会社DB read/write（U・データ層）。業務計算なし。表示対象ゲート（published×掲載期間内×未削除）と
並び（pinned→published_at 降順）、既読（冪等 upsert）を提供。"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.tenant.announcements.orm import Announcement, AnnouncementRead


def _visible_cond():
    """表示対象＝published かつ掲載期間内 かつ未削除（U.0）。"""
    now = func.now()
    return and_(
        Announcement.deleted_at.is_(None),
        Announcement.status == "published",
        or_(Announcement.starts_at.is_(None), Announcement.starts_at <= now),
        or_(Announcement.ends_at.is_(None), Announcement.ends_at > now),
    )


def get(session: Session, announcement_id: uuid.UUID) -> Announcement | None:
    a = session.get(Announcement, announcement_id)
    return a if (a is not None and a.deleted_at is None) else None


def get_visible(session: Session, announcement_id: uuid.UUID) -> Announcement | None:
    """閲覧者向けの単一取得（表示対象のみ・draft/期間外/削除は None）。"""
    return session.execute(
        select(Announcement).where(Announcement.id == announcement_id, _visible_cond())
    ).scalar_one_or_none()


def list_visible(session: Session, *, limit: int, offset: int = 0) -> list[Announcement]:
    """閲覧一覧＝表示対象を pinned→published_at 降順。offset/limit（カーソルは application が offset をエンコード）。"""
    stmt = (
        select(Announcement).where(_visible_cond())
        .order_by(Announcement.pinned.desc(), Announcement.published_at.desc().nullslast(), Announcement.id.desc())
        .offset(offset).limit(limit)
    )
    return list(session.execute(stmt).scalars().all())


def list_all_admin(session: Session) -> list[Announcement]:
    """管理一覧＝draft/archived 含む全件（未削除）。pinned→published_at/created_at 降順。"""
    stmt = (
        select(Announcement).where(Announcement.deleted_at.is_(None))
        .order_by(Announcement.pinned.desc(),
                  func.coalesce(Announcement.published_at, Announcement.created_at).desc(),
                  Announcement.id.desc())
    )
    return list(session.execute(stmt).scalars().all())


def read_ids_for(session: Session, user_id: uuid.UUID, announcement_ids: list[uuid.UUID]) -> set[uuid.UUID]:
    """指定ユーザーが既読のお知らせ id 集合（is_read 付与用）。"""
    return set(read_map_for(session, user_id, announcement_ids).keys())


def read_map_for(session: Session, user_id: uuid.UUID, announcement_ids: list[uuid.UUID]) -> dict[uuid.UUID, object]:
    """指定ユーザーの既読 {announcement_id: read_at}（is_read＋既読日時の付与用）。"""
    if not announcement_ids:
        return {}
    rows = session.execute(
        select(AnnouncementRead.announcement_id, AnnouncementRead.read_at).where(
            AnnouncementRead.user_id == user_id,
            AnnouncementRead.announcement_id.in_(announcement_ids),
        )
    ).all()
    return {aid: read_at for aid, read_at in rows}


def unread_count(session: Session, user_id: uuid.UUID) -> int:
    """表示対象のうち当該ユーザーが未読の件数。"""
    read_sub = select(AnnouncementRead.announcement_id).where(AnnouncementRead.user_id == user_id)
    return int(session.execute(
        select(func.count()).select_from(Announcement).where(_visible_cond(), Announcement.id.notin_(read_sub))
    ).scalar() or 0)


def count_reads(session: Session, announcement_id: uuid.UUID) -> int:
    return int(session.execute(
        select(func.count()).select_from(AnnouncementRead).where(AnnouncementRead.announcement_id == announcement_id)
    ).scalar() or 0)


def mark_read(session: Session, announcement_id: uuid.UUID, user_id: uuid.UUID) -> None:
    """既読化（冪等＝既存なら何もしない）。"""
    exists = session.execute(
        select(AnnouncementRead.id).where(
            AnnouncementRead.announcement_id == announcement_id, AnnouncementRead.user_id == user_id)
    ).scalar_one_or_none()
    if exists is None:
        session.add(AnnouncementRead(announcement_id=announcement_id, user_id=user_id))


def create(session: Session, **fields) -> Announcement:
    a = Announcement(**fields)
    session.add(a)
    session.flush()
    return a
