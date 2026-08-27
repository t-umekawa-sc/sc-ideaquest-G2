"""H-TC-171: 通知一覧描画の ref 解決が N+1 にならない担保（`prime_refs`・§7 性能）。

catalog.render は各通知の ref（idea/quest/achievement/spell）を per-row `session.get` で引く。
`prime_refs` がページ分の ref を IN 一括ロードして identity map に載せるため、後続 get は追加クエリ無し
＝**SELECT 数が行数に比例しない**。ここでは achievement 通知（seed 済みマスタ＝ideas 生成不要）で検証。
"""
from __future__ import annotations

import uuid

from sqlalchemy import event, select
from sqlalchemy.engine import Engine

from app.control_plane.auth.orm import Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.achievements.orm import Achievement
from app.tenant.notifications import application as notif_app
from app.tenant.notifications import service as notify_svc
from app.tenant.notifications.orm import Notification
from app.tenant.profile.repository import get_user_by_account
from tests.admin.test_admin_accounts import _login
from tests.conftest import SEED_COMPANY_CODE


def _db() -> str:
    with control_session() as s:
        return s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().db_identifier


def _company_id() -> uuid.UUID:
    with control_session() as s:
        return s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().id


def _achievement_ids(n: int) -> list[uuid.UUID]:
    with get_tenant_session(_db()) as s:
        return list(s.execute(select(Achievement.id).limit(n)).scalars().all())


def _seed_achievement_notifs(recipient, ach_ids) -> None:
    """distinct 実績を参照する achievement 通知を各 1 イベントで作る（畳まれず K 行）。"""
    for aid in ach_ids:
        with get_tenant_session(_db()) as s:
            notify_svc.notify(s, [notify_svc.entry(recipient, "achievement", refs={"ref_achievement_id": aid})])
            s.commit()


def _count_selects(fn):
    counter = {"n": 0}

    def _on_exec(conn, cursor, statement, parameters, context, executemany):  # noqa: ANN001
        if statement.lstrip()[:6].upper() == "SELECT":
            counter["n"] += 1

    event.listen(Engine, "before_cursor_execute", _on_exec)
    try:
        result = fn()
    finally:
        event.remove(Engine, "before_cursor_execute", _on_exec)
    return counter["n"], result


def test_h_tc_171_list_render_no_n_plus_1(client, factory):
    acc = factory.make_seed_company_account()
    _login(client, SEED_COMPANY_CODE, acc["login_id"], acc["password"])
    with get_tenant_session(_db()) as s:
        uid = get_user_by_account(s, acc["id"]).id
        # login は security_new_device（A.9-⑧(a)）を発火する。本テストは achievement 通知の件数で
        # N+1 を測るため除去（他 notifications テストと同方式）。
        s.query(Notification).filter_by(recipient_id=uid, type="security_new_device").delete()
        s.commit()

    ids = _achievement_ids(7)
    assert len(ids) >= 7, "seed 実績が 7 件以上必要（migration 0016）"

    account_id, company_id = acc["id"], _company_id()  # acc["id"] は UUID オブジェクト

    # K=2
    _seed_achievement_notifs(uid, ids[:2])
    q2, r2 = _count_selects(lambda: notif_app.get_notifications(account_id, company_id))
    assert len(r2["data"]) == 2 and all(d["body"] for d in r2["data"])  # 描画は不変（body 埋まる）

    # K=7（+5 行）
    _seed_achievement_notifs(uid, ids[2:7])
    q7, r7 = _count_selects(lambda: notif_app.get_notifications(account_id, company_id))
    assert len(r7["data"]) == 7

    # SELECT 数が行数に比例しない＝K を増やしても同数（prime_refs の IN 一括ロード）。
    assert q2 == q7, f"N+1: SELECT が行数で増加（K=2:{q2} K=7:{q7}）"
