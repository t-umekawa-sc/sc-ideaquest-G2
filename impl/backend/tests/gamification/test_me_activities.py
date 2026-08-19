"""GET /me/activities（活動履歴・G.6／API設計 §1.8 カーソル）のテスト。

会社DB `activities` を新しい順で返す（kind/period 絞り込み・キーセットカーソル）。読取専用。
ログイン成功でログイン XP の activity が1件入る前提。追加分は台帳サービス ledger.grant で作る。
"""
from __future__ import annotations

import uuid

from app.control_plane.auth.orm import Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.gamification import ledger
from app.tenant.profile.repository import get_user_by_account
from tests.admin.test_admin_accounts import _login
from tests.conftest import SEED_COMPANY_CODE

ACTS = "/api/v1/me/activities"


def _db_identifier() -> str:
    with control_session() as s:
        return s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().db_identifier


def _grant(dbid: str, account_id, *, kind: str, amount: int, reason: str, ref_type=None, ref_id=None):
    """1件ずつ別 Tx で付与＝created_at を確実に分離（新しい順の決定性を担保）。"""
    with get_tenant_session(dbid) as s:
        user = get_user_by_account(s, account_id)
        ledger.grant(s, user, kind=kind, amount=amount, reason=reason, ref_type=ref_type, ref_id=ref_id)
        s.commit()


def _seed(client, factory) -> dict:
    """ログイン（login XP 1件）＋履歴を積む。新しい順＝shop_purchase→evaluation_coin→idea_post→login。"""
    acc = factory.make_seed_company_account()
    _login(client, SEED_COMPANY_CODE, acc["login_id"], acc["password"])  # activity: login(xp10)
    dbid = _db_identifier()
    _grant(dbid, acc["id"], kind=ledger.XP_GAIN, amount=50, reason="idea_post",
           ref_type="ideas", ref_id=uuid.uuid4())
    _grant(dbid, acc["id"], kind=ledger.COIN_GAIN, amount=30, reason="evaluation_coin",
           ref_type="ideas", ref_id=uuid.uuid4())
    _grant(dbid, acc["id"], kind=ledger.COIN_SPEND, amount=20, reason="shop_purchase",
           ref_type="items", ref_id=uuid.uuid4())
    return acc


def test_activities_newest_first_and_shape(client, factory):
    """G-TC-act-01 新しい順で一覧・共通形（data/page_info）・DTO フィールド。"""
    _seed(client, factory)
    body = client.get(ACTS).json()
    assert set(body.keys()) == {"data", "page_info"}
    reasons = [a["reason"] for a in body["data"]]
    assert reasons == ["shop_purchase", "evaluation_coin", "idea_post", "login"]
    row = body["data"][0]
    assert set(row.keys()) == {"id", "kind", "amount", "reason", "quest_id", "ref_type", "ref_id", "created_at"}
    assert row["kind"] == "coin_spend" and row["amount"] == 20 and row["ref_type"] == "items"
    assert body["page_info"] == {"next_cursor": None, "has_next": False}


def test_activities_kind_filter(client, factory):
    """G-TC-act-02 kind で絞り込み（xp_gain＝login＋idea_post の2件）。"""
    _seed(client, factory)
    body = client.get(ACTS, params={"kind": "xp_gain"}).json()
    assert [a["reason"] for a in body["data"]] == ["idea_post", "login"]
    assert all(a["kind"] == "xp_gain" for a in body["data"])


def test_activities_cursor_pagination(client, factory):
    """G-TC-act-03 limit＋カーソルで重複なく全件走査（新しい順・§1.8）。"""
    _seed(client, factory)
    p1 = client.get(ACTS, params={"limit": 2}).json()
    assert [a["reason"] for a in p1["data"]] == ["shop_purchase", "evaluation_coin"]
    assert p1["page_info"]["has_next"] is True and p1["page_info"]["next_cursor"]

    p2 = client.get(ACTS, params={"limit": 2, "cursor": p1["page_info"]["next_cursor"]}).json()
    assert [a["reason"] for a in p2["data"]] == ["idea_post", "login"]
    assert p2["page_info"]["has_next"] is False and p2["page_info"]["next_cursor"] is None


def test_activities_bad_cursor_422(client, factory):
    """G-TC-act-04 壊れたカーソルは 422（field=cursor）。"""
    acc = factory.make_seed_company_account()
    _login(client, SEED_COMPANY_CODE, acc["login_id"], acc["password"])
    r = client.get(ACTS, params={"cursor": "not-a-valid-cursor!!"})
    assert r.status_code == 422


def test_activities_invalid_kind_422(client, factory):
    """G-TC-act-05 未知の kind は 422（Literal 検証）。"""
    acc = factory.make_seed_company_account()
    _login(client, SEED_COMPANY_CODE, acc["login_id"], acc["password"])
    assert client.get(ACTS, params={"kind": "bogus"}).status_code == 422
