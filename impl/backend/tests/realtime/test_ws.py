"""L-TC-101〜105: WS 配信ハブ（接続/認証/自動購読/通知配信/cross-tenant 遮断）。

配信ハブは lifespan で起動するため、WS テストは **context-managed の TestClient**（`with TestClient(app)`）で
lifespan を発火させる。publish は sync（`get_redis().publish` 経由＝`notify()` の post-commit）・購読は async ハブ。
"""
from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.control_plane.auth.orm import Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.main import app
from app.tenant.notifications import service as notify_svc
from app.tenant.notifications.orm import Notification
from app.tenant.profile.repository import get_user_by_account
from app.tenant.realtime.events import notifications_topic, publish_event
from tests.admin.test_admin_accounts import _login
from tests.conftest import SEED_COMPANY_CODE

REALTIME = "/api/v1/realtime"


def _db(company_code: str = SEED_COMPANY_CODE) -> str:
    with control_session() as s:
        return s.query(Company).filter_by(company_code=company_code).one().db_identifier


def _login_ws_user(client, factory):
    acc = factory.make_seed_company_account()
    _login(client, SEED_COMPANY_CODE, acc["login_id"], acc["password"])
    with get_tenant_session(_db()) as s:
        uid = get_user_by_account(s, acc["id"]).id
        # login が発火する security_new_device を除去（本テストは通知配信の挙動を検証）
        s.query(Notification).filter_by(recipient_id=uid, type="security_new_device").delete()
        s.commit()
        return acc, uid


def _seed_notify(user_id, actor="鈴木 花子") -> None:
    """別イベントで mention 通知を作り commit（after_commit で publish）。"""
    with get_tenant_session(_db()) as s:
        notify_svc.notify(s, [notify_svc.entry(user_id, "mention", params={"actor_name": actor})])
        s.commit()


def test_l_tc_101_unauth_rejected(factory):
    """L-TC-101 未認証は接続不可（accept せずクローズ）。"""
    with TestClient(app) as client:
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(REALTIME):
                pass


def test_l_tc_102_103_auth_autosubscribe_and_notify_delivery(factory):
    """L-TC-102/103 認証成功→notifications 自動購読→notify() post-commit で新着＋未読数を受信。"""
    with TestClient(app) as client:
        _acc, uid = _login_ws_user(client, factory)
        with client.websocket_connect(REALTIME) as ws:
            _seed_notify(uid, actor="鈴木 花子")
            evt = ws.receive_json()
            assert evt["topic"] == notifications_topic(uid)
            assert evt["type"] == "notification.created"
            assert "鈴木 花子" in evt["data"]["body"]
            assert evt["data"]["unread_count"] == 1


def test_l_tc_104_read_publishes_unread_count(factory):
    """L-TC-104 既読操作で notification.unread_count を受信。"""
    with TestClient(app) as client:
        acc, uid = _login_ws_user(client, factory)
        _seed_notify(uid)
        with client.websocket_connect(REALTIME) as ws:
            # 既読化（REST）→ unread_count=0 の同期イベント
            nid = client.get("/api/v1/notifications").json()["data"][0]["id"]
            r = client.post(f"/api/v1/notifications/{nid}/read",
                            headers={"X-CSRF-Token": client.cookies.get("iq_csrf")})
            assert r.status_code == 200, r.text
            evt = ws.receive_json()
            assert evt["type"] == "notification.unread_count"
            assert evt["data"]["unread_count"] == 0


def test_l_tc_105_cross_tenant_filtered(factory):
    """L-TC-105 company_id 不一致の event は届かない（一致 event のみ受信＝順序で検証）。"""
    with TestClient(app) as client:
        _acc, uid = _login_ws_user(client, factory)
        topic = notifications_topic(uid)
        with client.websocket_connect(REALTIME) as ws:
            # 別会社の company_id で publish（ハブが破棄）→ 直後に正しい notify → 受信は後者のみ
            publish_event(topic, "notification.created",
                          {"id": str(uuid.uuid4()), "body": "他社", "unread_count": 99},
                          company_id=str(uuid.uuid4()))
            _seed_notify(uid, actor="自社")
            evt = ws.receive_json()
            assert "自社" in evt["data"]["body"]  # 他社イベントは破棄され届かない
