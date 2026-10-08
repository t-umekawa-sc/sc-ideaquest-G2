"""C-TC-315〜317: 管理者お勧めトグル（PUT /quests/{id}/recommended・SC-13・company_account_admin 向け）。

管理者のみ `quests.recommended` を設定/解除でき、発見可能クエストに限る（おすすめ候補母集団に効く）。
冪等・カタログDTO `recommended` に反映。非管理者は 403（二重防御）・発見不可は 404（存在秘匿）。
共有 dev DB 対応＝全社可視（部署リンク無し）の自分の seed クエスト id で照合。仕様の正＝API設計 C.9.1。
"""
from __future__ import annotations

import uuid

from sqlalchemy import text as _sqltext

from app.control_plane.auth.orm import Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.profile.orm import User
from app.tenant.quests import repository as quests_repo
from tests.admin.test_admin_accounts import _login
from tests.conftest import SEED_COMPANY_CODE

CATALOG = "/api/v1/quest-catalog"


def _csrf(client) -> dict:
    return {"X-CSRF-Token": client.cookies.get("iq_csrf")}


def _seed_db() -> str:
    with control_session() as s:
        return s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().db_identifier


def _make_quest(db: str, *, discoverable: bool):
    """全社可視（部署リンク無し）の discoverable/非discoverable クエストを seed。(qid, owner_id) を返す。"""
    owner = uuid.uuid4()
    qid = uuid.uuid4()
    with get_tenant_session(db) as ts:
        ts.add(User(id=owner, account_id=uuid.uuid4(), display_name="Owner315", locale="ja", status="active"))
        q = quests_repo.create_quest(ts, quest_id=qid, owner_id=owner, title="トグル対象", color="#3B82F6", status="recruiting")
        q.discoverable = discoverable
        q.recommended = False
        ts.commit()
    return qid, owner


def _cleanup(db: str, qid: uuid.UUID, owner: uuid.UUID) -> None:
    with get_tenant_session(db) as ts:
        ts.execute(_sqltext("DELETE FROM quest_members WHERE quest_id=:q"), {"q": str(qid)})
        ts.execute(_sqltext("DELETE FROM quest_revisions WHERE quest_id=:q"), {"q": str(qid)})
        ts.execute(_sqltext("DELETE FROM quests WHERE id=:q"), {"q": str(qid)})
        ts.execute(_sqltext("DELETE FROM users WHERE id=:o"), {"o": str(owner)})
        ts.commit()


def _url(qid: uuid.UUID) -> str:
    return f"/api/v1/quests/{qid}/recommended"


def _catalog_row(client, qid: uuid.UUID):
    data = client.get(CATALOG).json()["data"]
    return next((c for c in data if c["id"] == str(qid)), None)


def test_c_tc_315_admin_set_and_clear(client, factory):
    """C-TC-315: 管理者が設定/解除＝quests.recommended を更新しカタログDTOに反映（冪等）。"""
    db = _seed_db()
    qid, owner = _make_quest(db, discoverable=True)
    admin = factory.make_seed_company_account(
        system_role="company_account_admin", display_name=f"管理_{uuid.uuid4().hex[:6]}")
    try:
        _login(client, SEED_COMPANY_CODE, admin["login_id"], admin["password"])
        # 設定＝true
        r = client.put(_url(qid), json={"recommended": True}, headers=_csrf(client))
        assert r.status_code == 200, r.text
        assert r.json()["recommended"] is True
        row = _catalog_row(client, qid)
        assert row is not None and row["recommended"] is True
        # 解除＝false（冪等・別状態へ）
        r2 = client.put(_url(qid), json={"recommended": False}, headers=_csrf(client))
        assert r2.status_code == 200 and r2.json()["recommended"] is False
        row2 = _catalog_row(client, qid)
        assert row2 is not None and row2["recommended"] is False
    finally:
        _cleanup(db, qid, owner)


def test_c_tc_316_non_admin_forbidden(client, factory):
    """C-TC-316: 非管理者（general）は 403・quests.recommended は不変（require_company_account_admin 二重防御）。"""
    db = _seed_db()
    qid, owner = _make_quest(db, discoverable=True)
    user = factory.make_seed_company_account(display_name=f"一般_{uuid.uuid4().hex[:6]}")
    try:
        _login(client, SEED_COMPANY_CODE, user["login_id"], user["password"])
        r = client.put(_url(qid), json={"recommended": True}, headers=_csrf(client))
        assert r.status_code == 403, r.text
        with get_tenant_session(db) as ts:
            assert quests_repo.get_quest(ts, qid).recommended is False
    finally:
        _cleanup(db, qid, owner)


def test_c_tc_317_non_discoverable_not_found(client, factory):
    """C-TC-317: 発見不可（非discoverable）クエストは 404（存在秘匿・おすすめ候補でないものに立てられない）。"""
    db = _seed_db()
    qid, owner = _make_quest(db, discoverable=False)
    admin = factory.make_seed_company_account(
        system_role="company_account_admin", display_name=f"管理_{uuid.uuid4().hex[:6]}")
    try:
        _login(client, SEED_COMPANY_CODE, admin["login_id"], admin["password"])
        r = client.put(_url(qid), json={"recommended": True}, headers=_csrf(client))
        assert r.status_code == 404, r.text
    finally:
        _cleanup(db, qid, owner)
