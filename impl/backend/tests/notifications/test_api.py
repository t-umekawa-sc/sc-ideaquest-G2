"""H-TC-101〜143: 通知 API＋生成/重複排除（SC-02＋ヘッダーベル・H.2/H.3/H.1）。

throwaway アカウントでログイン（決定性）。通知は `notify()` を tenant セッションで直接呼んで宛先に作る
（発火の縦スライスは achievement をレジャーフック経由で end-to-end 検証）。すべて自分宛スコープ（IDOR・H.4）。
"""
from __future__ import annotations

import uuid

from app.control_plane.auth.orm import Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.gamification import ledger
from app.tenant.notifications import service as notify_svc
from app.tenant.notifications.orm import Notification
from app.tenant.profile.orm import User
from app.tenant.profile.repository import get_user_by_account
from tests.admin.test_admin_accounts import _login
from tests.conftest import SEED_COMPANY_CODE

NOTIF = "/api/v1/notifications"


def _db() -> str:
    with control_session() as s:
        return s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().db_identifier


def _csrf(client) -> dict:
    return {"X-CSRF-Token": client.cookies.get("iq_csrf")}


def _login_new(client, factory) -> uuid.UUID:
    acc = factory.make_seed_company_account()
    _login(client, SEED_COMPANY_CODE, acc["login_id"], acc["password"])
    with get_tenant_session(_db()) as s:
        uid = get_user_by_account(s, acc["id"]).id
        # login は security_new_device（A.9-⑧(a)）を発火する。本ファイルは他種別の挙動を検証するため除去
        # （security_* の発火自体は tests/notifications/test_security.py で検証）。
        s.query(Notification).filter_by(recipient_id=uid, type="security_new_device").delete()
        s.commit()
        return uid


def _seed(entries: list[dict]) -> None:
    """1イベント＝1回の `notify()`（同一宛先は最具体1件に畳まれる＝dedup を通す）。"""
    with get_tenant_session(_db()) as s:
        notify_svc.notify(s, entries)
        s.commit()


def _seed_each(entries: list[dict]) -> None:
    """各 entry を別イベント（別 `notify()`）として作る＝同一宛先でも畳まれず複数行になる。"""
    for e in entries:
        with get_tenant_session(_db()) as s:
            notify_svc.notify(s, [e])
            s.commit()


def _mention(recipient, actor="鈴木 花子") -> dict:
    return notify_svc.entry(recipient, "mention", params={"actor_name": actor})


# ---- 1. 取得・未読数・既読/未読 ----

def test_h_tc_101_empty_list(client, factory):
    _login_new(client, factory)
    r = client.get(NOTIF)
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["data"] == [] and b["unread_count"] == 0 and b["page_info"]["has_next"] is False


def test_h_tc_102_list_render_and_unread(client, factory):
    uid = _login_new(client, factory)
    _seed([_mention(uid, actor="鈴木 花子")])
    b = client.get(NOTIF).json()
    assert b["unread_count"] == 1 and len(b["data"]) == 1
    n = b["data"][0]
    assert n["type"] == "mention" and n["is_read"] is False and "鈴木 花子" in n["body"]


def test_h_tc_103_unread_count_only(client, factory):
    uid = _login_new(client, factory)
    _seed_each([_mention(uid), notify_svc.entry(uid, "follow_selection", refs={"ref_idea_id": None})])
    # 別イベント2件（follow_selection は idea なしでも body 生成可）。未読2件。
    assert client.get(f"{NOTIF}/unread-count").json() == {"unread_count": 2}


def test_h_tc_104_read_idempotent(client, factory):
    uid = _login_new(client, factory)
    _seed([_mention(uid)])
    nid = client.get(NOTIF).json()["data"][0]["id"]
    r1 = client.post(f"{NOTIF}/{nid}/read", headers=_csrf(client))
    assert r1.status_code == 200 and r1.json()["is_read"] is True and r1.json()["unread_count"] == 0
    r2 = client.post(f"{NOTIF}/{nid}/read", headers=_csrf(client))  # 冪等
    assert r2.status_code == 200 and r2.json()["unread_count"] == 0


def test_h_tc_105_unread_back(client, factory):
    uid = _login_new(client, factory)
    _seed([_mention(uid)])
    nid = client.get(NOTIF).json()["data"][0]["id"]
    client.post(f"{NOTIF}/{nid}/read", headers=_csrf(client))
    r = client.post(f"{NOTIF}/{nid}/unread", headers=_csrf(client))
    assert r.status_code == 200 and r.json()["is_read"] is False and r.json()["unread_count"] == 1


def test_h_tc_106_read_all_type_filter(client, factory):
    uid = _login_new(client, factory)
    _seed_each([_mention(uid), _mention(uid, actor="佐藤"),
                notify_svc.entry(uid, "achievement", refs={"ref_achievement_id": None}, params={"tier": "bronze", "coin": 20})])
    r = client.post(f"{NOTIF}/read-all", json={"type": "mention"}, headers=_csrf(client))
    assert r.status_code == 200 and r.json()["updated"] == 2 and r.json()["unread_count"] == 1
    # type 無し＝全既読
    r2 = client.post(f"{NOTIF}/read-all", json={}, headers=_csrf(client))
    assert r2.json()["unread_count"] == 0


def test_h_tc_107_filter_state_and_type(client, factory):
    uid = _login_new(client, factory)
    _seed([_mention(uid)])
    read_nid = client.get(NOTIF).json()["data"][0]["id"]
    client.post(f"{NOTIF}/{read_nid}/read", headers=_csrf(client))
    _seed_each([_mention(uid, actor="田中"),
                notify_svc.entry(uid, "achievement", refs={"ref_achievement_id": None}, params={"tier": "gold", "coin": 150})])
    b = client.get(f"{NOTIF}?state=unread&type=mention").json()
    assert len(b["data"]) == 1 and b["data"][0]["type"] == "mention" and b["data"][0]["is_read"] is False


def test_h_tc_108_cursor_pagination(client, factory):
    uid = _login_new(client, factory)
    _seed_each([_mention(uid, actor=f"u{i}") for i in range(3)])
    p1 = client.get(f"{NOTIF}?limit=2").json()
    assert len(p1["data"]) == 2 and p1["page_info"]["has_next"] is True
    cur = p1["page_info"]["next_cursor"]
    assert cur
    p2 = client.get(f"{NOTIF}?limit=2&cursor={cur}").json()
    assert len(p2["data"]) == 1 and p2["page_info"]["has_next"] is False
    # ページ跨りで重複なし（新着降順）。
    ids = {d["id"] for d in p1["data"]} | {d["id"] for d in p2["data"]}
    assert len(ids) == 3


def test_h_tc_109_invalid_type_422(client, factory):
    _login_new(client, factory)
    r = client.get(f"{NOTIF}?type=bogus")
    assert r.status_code == 422
    assert r.json()["errors"][0]["field"] == "type"


# ---- 2. セキュリティ（IDOR・認可） ----

def test_h_tc_121_others_not_listed(client, factory):
    # B を作りログインして user_id 確保→B 宛に通知→A でログインして一覧
    b_uid = _login_new(client, factory)
    _seed([_mention(b_uid, actor="他人宛")])
    a_uid = _login_new(client, factory)
    _seed([_mention(a_uid, actor="自分宛")])
    b = client.get(NOTIF).json()
    assert len(b["data"]) == 1 and "自分宛" in b["data"][0]["body"]


def test_h_tc_122_idor_read_404(client, factory):
    b_uid = _login_new(client, factory)
    _seed([_mention(b_uid)])
    with get_tenant_session(_db()) as s:
        from app.tenant.notifications.orm import Notification
        other_id = s.query(Notification).filter_by(recipient_id=b_uid).one().id
    _login_new(client, factory)  # A に切替
    r = client.post(f"{NOTIF}/{other_id}/read", headers=_csrf(client))
    assert r.status_code == 404
    # 当該行は不変（B のまま未読）
    with get_tenant_session(_db()) as s:
        from app.tenant.notifications.orm import Notification
        assert s.get(Notification, other_id).is_read is False


def test_h_tc_123_csrf_and_unauth(client, factory):
    uid = _login_new(client, factory)
    _seed([_mention(uid)])
    nid = client.get(NOTIF).json()["data"][0]["id"]
    assert client.post(f"{NOTIF}/{nid}/read").status_code == 403  # CSRF なし
    assert client.post(f"{NOTIF}/read-all", json={}).status_code == 403
    client.cookies.clear()
    assert client.get(NOTIF).status_code == 401  # 未認証


# ---- 3. 生成・重複排除（notify・H.1） ----

def test_h_tc_141_dedup_most_specific(client, factory):
    uid = _login_new(client, factory)
    # 同一宛先に mention（具体）＋follow_comment（一般）→ mention 1件に畳む。
    _seed([
        notify_svc.entry(uid, "follow_comment", refs={"ref_idea_id": None}),
        _mention(uid, actor="メンション主"),
    ])
    b = client.get(NOTIF).json()
    assert len(b["data"]) == 1 and b["data"][0]["type"] == "mention"


def test_h_tc_142_distinct_recipients(client, factory):
    a_uid = _login_new(client, factory)
    b_uid = _login_new(client, factory)  # A はログイン後 B に切替（両ユーザー mirror 確保）
    _seed([_mention(a_uid, actor="Aへ"), notify_svc.entry(b_uid, "follow_comment", refs={"ref_idea_id": None})])
    # 現在 B でログイン中→B は follow_comment 1件のみ
    b = client.get(NOTIF).json()
    assert len(b["data"]) == 1 and b["data"][0]["type"] == "follow_comment"


def test_h_tc_143_achievement_via_ledger_hook(client, factory):
    acc = factory.make_seed_company_account()
    _login(client, SEED_COMPANY_CODE, acc["login_id"], acc["password"])
    with get_tenant_session(_db()) as s:
        uid = get_user_by_account(s, acc["id"]).id
    # 評価3件付与（reason=evaluation×3・engine 後フックで evaluator_3 達成→achievement 通知）。
    for _ in range(3):
        with get_tenant_session(_db()) as s:
            u = s.get(User, uid)
            ledger.grant(s, u, kind=ledger.XP_GAIN, amount=30, reason="evaluation",
                         ref_type="evaluations", ref_id=uuid.uuid4())
            s.commit()
    b = client.get(f"{NOTIF}?type=achievement").json()
    assert len(b["data"]) == 1
    n = b["data"][0]
    assert n["type"] == "achievement" and "評価者" in n["body"] and n["meta"]["coin"] == 20
