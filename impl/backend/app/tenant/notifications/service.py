"""通知サービス `notify()`（生成・内部・H.1）。各発火ドメインが呼ぶ内部サービス（HTTP EP ではない）。

- **重複排除**＝1 イベント×1 宛先＝最も具体的な種別で1件（`TYPE_PRIORITY`・H.1）。発火側は候補 entries を渡し、
  H が宛先単位で最優先1件に畳む。
- **params 凍結**＝ref から辿れない/変わりうる値（actor_name/revision/tier/coin/spell 識別子）をイベント時点で保存。
- **Redis publish（`notifications:{user_id}`）**＝L（WS）実装まで no-op（§1.12・H.0）。行 INSERT が真実（REST）。
- **信頼性＝at-most-once**（post-commit best-effort・§3.5-(3)）＝二重生成しない／取りこぼしうる。`dispatch` は
  例外を飲み込み本処理（既にコミット済み）を壊さない。
"""
from __future__ import annotations

import functools
import logging
import uuid
from typing import Callable, Iterable

from sqlalchemy import event
from sqlalchemy.orm import Session

from app.control_plane.auth.orm import Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.notifications import catalog, repository as repo
from app.tenant.notifications.orm import Notification
from app.tenant.profile.orm import User
from app.tenant.realtime.events import notifications_topic, publish_event

logger = logging.getLogger("app.notifications")

# 具体度の優先順位（小さいほど具体・H.1）。同一イベントで1宛先が複数該当したら最優先1件のみ生成。
TYPE_PRIORITY = {
    "mention": 0,
    "magic_reaction": 1,
    "idea_comment": 2,
    "follow_comment": 3,
    "follow_selection": 4,
    "follow_evaluation": 5,
    "idea_updated": 6,
    "achievement": 7,
    "quest_party_invited": 8,
    "security_new_device": 9,
    "security_password_changed": 10,
}

_REF_KEYS = (
    "ref_idea_id", "ref_chat_message_id", "ref_idea_revision_id", "ref_achievement_id", "ref_quest_id",
)


def entry(recipient_id: uuid.UUID, type: str, *, refs: dict | None = None, params: dict | None = None) -> dict:
    """通知候補1件を組み立てる（発火ドメインが使うヘルパ）。"""
    return {"recipient_id": recipient_id, "type": type, "refs": refs or {}, "params": params or {}}


def notify(session: Session, entries: Iterable[dict]) -> list[Notification]:
    """候補 entries を宛先単位で最優先1件に畳んで INSERT（commit は呼び出し側・H.1）。生成行を返す。"""
    best: dict[uuid.UUID, dict] = {}
    for e in entries:
        rid = e["recipient_id"]
        if rid is None:
            continue
        cur = best.get(rid)
        if cur is None or TYPE_PRIORITY.get(e["type"], 99) < TYPE_PRIORITY.get(cur["type"], 99):
            best[rid] = e
    created: list[Notification] = []
    for e in best.values():
        refs = {k: e["refs"].get(k) for k in _REF_KEYS}
        n = Notification(
            id=uuid.uuid4(), recipient_id=e["recipient_id"], type=e["type"],
            params=e["params"] or None, is_read=False, **refs,
        )
        repo.add(session, n)
        created.append(n)
    _queue_created(session, created)  # post-commit で `notifications:{user_id}` へ配信（L.3）
    return created


# --- リアルタイム配信（L・post-commit best-effort・§1.12/L.3）------------------------------

@functools.lru_cache(maxsize=256)
def _company_id_for_db(db_identifier: str) -> str | None:
    """会社DB 名→company_id（安定・キャッシュ）。WS 封筒の cross-tenant フィルタ用（§1.5）。"""
    with control_session() as s:
        c = s.query(Company).filter_by(db_identifier=db_identifier).one_or_none()
        return str(c.id) if c else None


def _company_id_of(session: Session) -> str | None:
    try:
        return _company_id_for_db(session.get_bind().url.database)
    except Exception:  # noqa: BLE001
        return None


def _ensure_after_commit(session: Session) -> None:
    """このセッションの commit 後に保留配信を publish（rollback では捨てる）。1 セッション 1 回だけ登録。"""
    if session.info.get("_rt_hooked"):
        return
    session.info["_rt_hooked"] = True
    event.listen(session, "after_commit", _flush_pending)
    event.listen(session, "after_rollback", _drop_pending)


def _flush_pending(session: Session) -> None:
    for topic, type_, data in session.info.pop("_rt_pending", []):
        company_id = data.pop("_company_id", None)  # 内部キー＝封筒へ。data からは除く
        publish_event(topic, type_, data, company_id=company_id)


def _drop_pending(session: Session) -> None:
    session.info.pop("_rt_pending", None)


def _queue(session: Session, topic: str, type_: str, data: dict) -> None:
    data["_company_id"] = _company_id_of(session)  # 封筒 company_id（_flush で取り出す）
    session.info.setdefault("_rt_pending", []).append((topic, type_, data))
    _ensure_after_commit(session)


def _created_data(session: Session, n: Notification, unread_count: int, locale: str | None = None) -> dict:
    """`notification.created` の data＝REST 表現（H.2）＋unread_count（速報 best-effort・§8-⑳）。"""
    r = catalog.render(session, n, locale)
    return {
        "id": str(n.id), "type": n.type, "body": r["body"], "context": r["context"],
        "icon": r["icon"], "tag": r["tag"], "meta": r["meta"], "is_read": n.is_read,
        "created_at": n.created_at.isoformat() if n.created_at else None,
        "ref": {
            "idea_id": str(n.ref_idea_id) if n.ref_idea_id else None,
            "chat_message_id": str(n.ref_chat_message_id) if n.ref_chat_message_id else None,
            "idea_revision_id": str(n.ref_idea_revision_id) if n.ref_idea_revision_id else None,
            "achievement_id": str(n.ref_achievement_id) if n.ref_achievement_id else None,
            "quest_id": str(n.ref_quest_id) if n.ref_quest_id else None,
        },
        "unread_count": unread_count,
    }


def _queue_created(session: Session, created: list[Notification]) -> None:
    for n in created:
        unread = repo.unread_count(session, n.recipient_id)  # INSERT 後（同一 Tx・未 commit）
        recipient = session.get(User, n.recipient_id)  # 受信者 locale で速報を描画（§2.1・§4.6 ミラー）
        locale = recipient.locale if recipient else None
        _queue(session, notifications_topic(n.recipient_id), "notification.created",
               _created_data(session, n, unread, locale))


def publish_unread_count(session: Session, recipient_id: uuid.UUID, unread_count: int) -> None:
    """既読/未読操作でベルの未読数を同期（`notification.unread_count`・post-commit・L.3）。"""
    _queue(session, notifications_topic(recipient_id), "notification.unread_count",
           {"unread_count": unread_count})


def _resolve_company(company_id: uuid.UUID) -> Company | None:
    with control_session() as s:
        return s.get(Company, company_id)


def notify_account(
    company_id: uuid.UUID, account_id: uuid.UUID, type: str, *, params: dict | None = None
) -> None:
    """コントロールプレーン発火の cross-plane 通知（H.0・A.9-⑧）。

    認証フロー（別プレーン）が `company_id`＋`account_id` を渡す。テナントDBで account→user を解決して
    post-commit dispatch する（best-effort・at-most-once）。宛先が解決できなければ何もしない。
    """
    def builder(ts: Session) -> list[dict]:
        from app.tenant.profile.repository import get_user_by_account
        user = get_user_by_account(ts, account_id)
        if user is None:
            return []
        return [entry(user.id, type, params=params)]

    dispatch(company_id, builder)


def dispatch(company_id: uuid.UUID, builder: Callable[[Session], Iterable[dict]]) -> None:
    """post-commit の通知生成（別セッション・best-effort・at-most-once・H.1）。

    `builder(ts)` が候補 entries を返す（宛先解決は builder が担う）。例外は握り潰す（本処理は既にコミット済み）。
    """
    try:
        company = _resolve_company(company_id)
        if company is None:
            return
        with get_tenant_session(company.db_identifier) as ts:
            entries = list(builder(ts))
            if entries:
                notify(ts, entries)
                ts.commit()
    except Exception:  # noqa: BLE001 — 通知は副作用の殻。本処理成功を優先（§3.5-(3)）。
        logger.warning("notify dispatch failed (company=%s)", company_id, exc_info=True)
