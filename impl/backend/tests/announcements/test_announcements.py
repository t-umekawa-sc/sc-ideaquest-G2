"""U. お知らせ（FR-49）＝閲覧/既読/管理/選別。api は seed 会社 ACME-01・throwaway アカウント。"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import text as _text

from app.db.tenant import get_tenant_session
from tests.conftest import SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD
from tests.admin.test_admin_accounts import _login
from tests.admin.test_admin_issue import _csrf
from tests.contests.test_contests import _admin, _seed_db

BASE = "/api/v1/announcements"
ADMIN = "/api/v1/admin/announcements"


def _mk(client, **over) -> dict:
    body = {"title": f"お知らせ_{uuid.uuid4().hex[:6]}", "body_html": "<p>本文</p>", "status": "published", "pinned": False}
    body.update(over)
    r = client.post(ADMIN, json=body, headers=_csrf(client))
    assert r.status_code == 201, r.text
    return r.json()


def _cleanup(ids: list[str]) -> None:
    with get_tenant_session(_seed_db()) as ts:
        for i in ids:
            ts.execute(_text("DELETE FROM announcement_reads WHERE announcement_id=:i"), {"i": i})
            ts.execute(_text("DELETE FROM announcements WHERE id=:i"), {"i": i})
        ts.commit()


def test_u_tc_101_list_visible_and_order(client, factory):
    """U-TC-101: 一覧＝published・掲載期間内のみ／pinned→published_at 降順／unread_count 同梱。"""
    _admin(client, factory)
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    pin = _mk(client, title="PIN", pinned=True)
    a1 = _mk(client, title="A1")
    a2 = _mk(client, title="A2")
    draft = _mk(client, title="DRAFT", status="draft")
    expired = _mk(client, title="EXP", ends_at=past)
    ids = [pin["id"], a1["id"], a2["id"], draft["id"], expired["id"]]
    try:
        part = factory.make_seed_company_account(display_name=f"閲覧_{uuid.uuid4().hex[:6]}")
        _login(client, SEED_COMPANY_CODE, part["login_id"], part["password"])
        r = client.get(f"{BASE}?limit=50").json()
        got = [x["id"] for x in r["data"]]
        assert draft["id"] not in got and expired["id"] not in got  # draft/期間外は出ない
        assert pin["id"] in got and got.index(pin["id"]) == 0        # pinned 先頭
        assert pin["id"] in got and a1["id"] in got and a2["id"] in got
        assert r["unread_count"] >= 3                                # 未読（自分の作成物ではない＝未読）
    finally:
        _cleanup(ids)


def test_u_tc_102_unread_filter(client, factory):
    """U-TC-102: unread=true で未読のみ（既読は出ない）。"""
    _admin(client, factory)
    a1 = _mk(client, title="U1")
    a2 = _mk(client, title="U2")
    ids = [a1["id"], a2["id"]]
    try:
        part = factory.make_seed_company_account(display_name=f"未読_{uuid.uuid4().hex[:6]}")
        _login(client, SEED_COMPANY_CODE, part["login_id"], part["password"])
        client.post(f"{BASE}/{a1['id']}/read", headers=_csrf(client))  # a1 既読化
        got = [x["id"] for x in client.get(f"{BASE}?unread=true&limit=50").json()["data"]]
        assert a2["id"] in got and a1["id"] not in got
    finally:
        _cleanup(ids)


def test_u_tc_103_detail_visibility(client, factory):
    """U-TC-103: 詳細＝published 200／draft・不存在 404。"""
    _admin(client, factory)
    pub = _mk(client, title="PUB")
    draft = _mk(client, title="DR", status="draft")
    ids = [pub["id"], draft["id"]]
    try:
        part = factory.make_seed_company_account(display_name=f"詳細_{uuid.uuid4().hex[:6]}")
        _login(client, SEED_COMPANY_CODE, part["login_id"], part["password"])
        d = client.get(f"{BASE}/{pub['id']}")
        assert d.status_code == 200 and "body_html" in d.json()
        assert client.get(f"{BASE}/{draft['id']}").status_code == 404
        assert client.get(f"{BASE}/{uuid.uuid4()}").status_code == 404
    finally:
        _cleanup(ids)


def test_u_tc_104_read_idempotent(client, factory):
    """U-TC-104: 既読化は冪等（2回とも200）＋未読数が1減。"""
    _admin(client, factory)
    a = _mk(client, title="R1")
    ids = [a["id"]]
    try:
        part = factory.make_seed_company_account(display_name=f"既読_{uuid.uuid4().hex[:6]}")
        _login(client, SEED_COMPANY_CODE, part["login_id"], part["password"])
        before = client.get(f"{BASE}?limit=50").json()["unread_count"]
        assert client.post(f"{BASE}/{a['id']}/read", headers=_csrf(client)).status_code == 200
        assert client.post(f"{BASE}/{a['id']}/read", headers=_csrf(client)).status_code == 200  # 冪等
        after = client.get(f"{BASE}?limit=50").json()
        assert after["unread_count"] == before - 1
        item = next(x for x in after["data"] if x["id"] == a["id"])
        assert item["is_read"] is True and item["read_at"]  # 既読日時が入る（SC-95 列・未読は null）
    finally:
        _cleanup(ids)


def test_u_tc_105_admin_only(client, factory):
    """U-TC-105: 作成/編集/削除は管理者のみ・一般は403。"""
    admin = _admin(client, factory)
    a = _mk(client, title="ADM")
    ids = [a["id"]]
    try:
        part = factory.make_seed_company_account(display_name=f"一般_{uuid.uuid4().hex[:6]}")
        _login(client, SEED_COMPANY_CODE, part["login_id"], part["password"])
        assert client.post(ADMIN, json={"title": "x", "body_html": "<p>x</p>"}, headers=_csrf(client)).status_code == 403
        assert client.patch(f"{ADMIN}/{a['id']}", json={"pinned": True}, headers=_csrf(client)).status_code == 403
        assert client.delete(f"{ADMIN}/{a['id']}", headers=_csrf(client)).status_code == 403
        # 管理者は 200/204。
        _login(client, SEED_COMPANY_CODE, admin["login_id"], admin["password"])
        assert client.patch(f"{ADMIN}/{a['id']}", json={"pinned": True}, headers=_csrf(client)).status_code == 200
    finally:
        _cleanup(ids)


def test_u_tc_106_sanitize_and_published_at(client, factory):
    """U-TC-106: body_html サニタイズ（XSS 無害化）＋body_text 派生＋published_at 設定。"""
    _admin(client, factory)
    dirty = '<p>安全<strong>太字</strong></p><script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">x</a>'
    a = _mk(client, title="SAN", body_html=dirty, status="published")
    ids = [a["id"]]
    try:
        with get_tenant_session(_seed_db()) as ts:
            row = ts.execute(_text("SELECT body_html, body_text, published_at FROM announcements WHERE id=:i"),
                             {"i": a["id"]}).one()
        html, text, pub = row
        assert "<script>" not in html and "onerror" not in html and "javascript:" not in html  # 無害化
        assert "<strong>" in html                                   # 許可タグは残る
        assert "<" not in text and "太字" in text                    # body_text は平文
        assert pub is not None                                      # published→published_at 設定
    finally:
        _cleanup(ids)


def test_u_tc_107_pin_and_logical_delete(client, factory):
    """U-TC-107: ピン留めトグルで一覧先頭／論理削除で一覧・詳細から消える。"""
    _admin(client, factory)
    a1 = _mk(client, title="P1")
    a2 = _mk(client, title="P2")
    ids = [a1["id"], a2["id"]]
    try:
        # a2 をピン留め → 先頭に。
        client.patch(f"{ADMIN}/{a2['id']}", json={"pinned": True}, headers=_csrf(client))
        part = factory.make_seed_company_account(display_name=f"ピン_{uuid.uuid4().hex[:6]}")
        _login(client, SEED_COMPANY_CODE, part["login_id"], part["password"])
        got = [x["id"] for x in client.get(f"{BASE}?limit=50").json()["data"]]
        assert got and got[0] == a2["id"]
        # 管理者が a1 を論理削除 → 一覧/詳細から消える。
        _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)  # 念のため戻すが削除は管理者で
    finally:
        pass
    # 削除は管理者で実行（別 try で確実にクリーンアップ）。
    admin2 = None
    try:
        admin2 = _admin(client, factory)
        assert client.delete(f"{ADMIN}/{a1['id']}", headers=_csrf(client)).status_code == 204
        part = factory.make_seed_company_account(display_name=f"ピン2_{uuid.uuid4().hex[:6]}")
        _login(client, SEED_COMPANY_CODE, part["login_id"], part["password"])
        got = [x["id"] for x in client.get(f"{BASE}?limit=50").json()["data"]]
        assert a1["id"] not in got
        assert client.get(f"{BASE}/{a1['id']}").status_code == 404
    finally:
        _cleanup(ids)


def test_u_tc_108_dashboard_panel_selection(client, factory):
    """U-TC-108(int): ダッシュボードパネル選別（§4.3a）＝ピン優先→未読で埋める→既読非ピン除外（最大3）＋未読数。"""
    from app.tenant.announcements import application as ann_app
    from tests.contests.test_contests import _user_id

    _admin(client, factory)
    pin1 = _mk(client, title="DPIN1", pinned=True)
    pin2 = _mk(client, title="DPIN2", pinned=True)
    u1 = _mk(client, title="DU1")
    u2 = _mk(client, title="DU2")
    read1 = _mk(client, title="DREAD1")
    ids = [pin1["id"], pin2["id"], u1["id"], u2["id"], read1["id"]]
    try:
        part = factory.make_seed_company_account(display_name=f"パネル_{uuid.uuid4().hex[:6]}")
        uid = _user_id(part["id"])
        _login(client, SEED_COMPANY_CODE, part["login_id"], part["password"])
        client.post(f"{BASE}/{read1['id']}/read", headers=_csrf(client))  # read1 を既読化（非ピン）
        with get_tenant_session(_seed_db()) as ts:
            panel = ann_app.dashboard_panel(ts, uid)
        got = {x["id"] for x in panel["data"]}
        assert len(panel["data"]) == 3                      # 最大3
        assert pin1["id"] in got and pin2["id"] in got      # ピン2件は必ず入る
        assert read1["id"] not in got                       # 既読かつ非ピンは出ない
        assert panel["unread_count"] >= 4                   # 未読（pin含む作成物・自分では未読）
    finally:
        _cleanup(ids)


def test_u_tc_109_pick_dashboard_pure():
    """U-TC-109(unit): ダッシュボード選別＝ピン優先→未読→既読非ピン除外（最大3）。"""
    from app.tenant.announcements.application import pick_dashboard_announcements as pick

    class R:
        def __init__(self, k, pinned, is_read):
            self.k, self.pinned, self.is_read = k, pinned, is_read
    # 並びは pinned→published_at 降順で渡される前提（ピン2・未読非ピン2・既読非ピン1）。
    items = [R("pin1", True, False), R("pin2", True, True),
             R("u1", False, False), R("u2", False, False), R("read1", False, True)]
    out = [r.k for r in pick(items, limit=3)]
    assert out == ["pin1", "pin2", "u1"]          # ピン2件→未読1件で3件・既読非ピンは出ない
    assert "read1" not in out and "u2" not in out
    # 全件ピン無し＆既読なら空。
    allread = [R("x", False, True), R("y", False, True)]
    assert pick(allread, limit=3) == []
