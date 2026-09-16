"""会社アカウント管理者 API のテスト（doc/テスト/B_会社・アカウント.md §2・API設計 B.2.1）。

`/admin/accounts`（`company_account_admin`・セッション会社固定）。system_admin は上位互換で可。
できる＝自社アカウントの発行/編集/disable/enable/password-reset（`general` のみ・ロール付与不可）。
できない＝`system_role` 付与、system_admin アカウントの disable。
"""
from __future__ import annotations

import uuid

from fastapi.testclient import TestClient

from app.control_plane.auth.orm import Account, OtpChallenge
from app.control_plane.mail_outbox.orm import MailOutboxEntry
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.main import app
from app.tenant.quest_group.orm import QuestGroup
from tests.admin.test_admin_accounts import _login, _login_system_admin
from tests.admin.test_admin_issue import _company, _csrf, _ident, issued  # noqa: F401 (issued は fixture)
from tests.conftest import SEED_COMPANY_CODE

ACCOUNTS = "/api/v1/admin/accounts"
COMPANY_QG = "/api/v1/admin/company-quest-groups"


def _login_company_admin(client, factory) -> dict:
    admin = factory.make_seed_company_account(system_role="company_account_admin")
    _login(client, admin["company_code"], admin["login_id"], admin["password"])
    return admin


def test_b_tc_044_company_admin_lists_own_quest_groups(client, factory):
    """B-TC-044 会社アカ管理者が自社の全クエストグループ一覧を取得（所属エディタ候補）。general は 403。根拠 B.2.1。"""
    _, db_id = _company(SEED_COMPANY_CODE)
    gid = uuid.uuid4()
    code = f"QGSELF-{uuid.uuid4().hex[:6].upper()}"
    with get_tenant_session(db_id) as ts:
        ts.add(QuestGroup(id=gid, quest_group_code=code, name="Self QG"))
        ts.commit()
    try:
        _login_company_admin(client, factory)
        r = client.get(COMPANY_QG)
        assert r.status_code == 200, r.text
        codes = [g["quest_group_code"] for g in r.json()["data"]]
        assert code in codes

        general = factory.make_seed_company_account(system_role="general")
        _login(client, general["company_code"], general["login_id"], general["password"])
        assert client.get(COMPANY_QG).status_code == 403
    finally:
        with get_tenant_session(db_id) as ts:
            ts.query(QuestGroup).filter_by(id=gid).delete()
            ts.commit()


def test_b_tc_040_company_admin_lists_own(client, factory):
    """B-TC-040 会社アカウント管理者が自社アカウント一覧を取得（セッション会社固定）。根拠 B.2.1。"""
    _login_company_admin(client, factory)
    r = client.get(ACCOUNTS)
    assert r.status_code == 200
    logins = [a["login_id"] for a in r.json()["data"]]
    assert "user@acme.example" in logins  # ACME-01 スコープ


def test_b_tc_041_company_admin_issues_general(client, factory, issued):
    """B-TC-041 発行＝201・`system_role=general` 固定・セッション会社（ACME-01）配下に作成。根拠 B.2.1。"""
    _login_company_admin(client, factory)
    r = client.post(ACCOUNTS, json=_ident(), headers=_csrf(client))
    assert r.status_code == 201, r.text
    body = r.json()
    issued.append(uuid.UUID(body["account_id"]))
    assert body["system_role"] == "general"
    cid, _ = _company(SEED_COMPANY_CODE)
    with control_session() as s:
        acc = s.query(Account).filter_by(id=uuid.UUID(body["account_id"])).one()
    assert acc.company_id == cid


def test_b_tc_042_company_admin_restrictions(client, factory):
    """B-TC-042 会社アカ管理者は `system_role` 付与不可（422）／system_admin の disable 不可（403）。根拠 B.2.1。"""
    _login_company_admin(client, factory)
    # (a) system_role をボディに入れると 422（extra=forbid＝受け取らない）
    r1 = client.post(ACCOUNTS, json={**_ident(), "system_role": "system_admin"}, headers=_csrf(client))
    assert r1.status_code == 422
    # (b) system_admin アカウント（同社に作成）を disable → 403
    sysadmin = factory.make_seed_company_account(system_role="system_admin")
    r2 = client.post(f"{ACCOUNTS}/{sysadmin['id']}/disable", headers=_csrf(client))
    assert r2.status_code == 403 and r2.json()["code"] == "forbidden"


def test_b_tc_043_authz_general_forbidden_sysadmin_ok(client, factory):
    """B-TC-043 general は 403／system_admin は上位互換で 200（B.2.1）。"""
    general = factory.make_seed_company_account()
    _login(client, general["company_code"], general["login_id"], general["password"])
    assert client.get(ACCOUNTS).status_code == 403

    tclient = TestClient(app)
    _login_system_admin(tclient)
    assert tclient.get(ACCOUNTS).status_code == 200  # 上位互換（session 会社=OPS）


# --- セルフ経路の編集/状態管理（B.2.1・`/admin/accounts/{id}`・セッション会社固定） -----------------
# 変更系ロジックは B.2 の system_admin 経路（B-TC-025〜034）と service 層を共有するが、
# **会社を URL でなくセッションから取る**認可境界（他社 IDOR・B-TC-048）はこの経路固有＝別途担保する。


def test_b_tc_045_company_admin_edits_own(client, factory):
    """B-TC-045 セルフ経路の編集＝差分 PATCH 200＋反映。email 変更で email_verified リセット（ADR-0009 §2.3）。根拠 B.2.1。"""
    from datetime import datetime, timezone

    target = factory.make_seed_company_account()  # ACME-01 general
    with control_session() as s:  # 事前に確認済みへ（DB 直更新）
        acc = s.query(Account).filter_by(id=target["id"]).one()
        acc.email_verified_at = datetime.now(timezone.utc)
        s.commit()
    _login_company_admin(client, factory)
    new_email = f"self-{uuid.uuid4().hex[:8]}@acme.example"

    r = client.patch(f"{ACCOUNTS}/{target['id']}",
                     json={"display_name": "SelfRenamed", "email": new_email}, headers=_csrf(client))

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["display_name"] == "SelfRenamed" and body["email"] == new_email
    assert body["email_verified"] is False  # 新アドレスは未確認へリセット


def test_b_tc_046_company_admin_disable_enable_own(client, factory):
    """B-TC-046 セルフ経路の disable/enable＝status 遷移（セッション会社固定）。根拠 B.2.1。"""
    target = factory.make_seed_company_account()  # ACME-01 general
    _login_company_admin(client, factory)

    r_dis = client.post(f"{ACCOUNTS}/{target['id']}/disable", headers=_csrf(client))
    assert r_dis.status_code == 200 and r_dis.json()["status"] == "disabled", r_dis.text

    r_en = client.post(f"{ACCOUNTS}/{target['id']}/enable", headers=_csrf(client))
    assert r_en.status_code == 200 and r_en.json()["status"] == "active", r_en.text


def test_b_tc_047_company_admin_password_reset_own(client, factory):
    """B-TC-047 セルフ経路の password-reset＝200 sent＋password_setup チャレンジ＋mail_outbox 1行（A.7）。根拠 B.2.1。"""
    target = factory.make_seed_company_account()  # ACME-01
    _login_company_admin(client, factory)

    r = client.post(f"{ACCOUNTS}/{target['id']}/password-reset", headers=_csrf(client))

    assert r.status_code == 200 and r.json()["status"] == "sent", r.text
    with control_session() as s:
        challenges = s.query(OtpChallenge).filter_by(account_id=target["id"], purpose="password_setup").all()
        mail = s.query(MailOutboxEntry).filter_by(account_id=target["id"]).all()
    assert len(challenges) >= 1
    assert len(mail) == 1 and mail[0].category == "password_setup" and mail[0].secret


def test_b_tc_048_company_admin_cross_company_idor_404(client, factory):
    """B-TC-048 セルフ経路は他社アカウントを操作不可＝404（セッション会社固定・§1.6）。根拠 B.2.1。"""
    other_co = factory.make_company()               # ACME-01 とは別会社
    other_acc = factory.make_account(other_co)      # 別会社配下のアカウント
    _login_company_admin(client, factory)           # ACME-01 の会社アカ管理者

    aid = other_acc["id"]
    assert client.patch(f"{ACCOUNTS}/{aid}", json={"display_name": "X"}, headers=_csrf(client)).status_code == 404
    assert client.post(f"{ACCOUNTS}/{aid}/disable", headers=_csrf(client)).status_code == 404
    assert client.post(f"{ACCOUNTS}/{aid}/enable", headers=_csrf(client)).status_code == 404
    assert client.post(f"{ACCOUNTS}/{aid}/password-reset", headers=_csrf(client)).status_code == 404


def test_b_tc_049_company_admin_edit_duplicate_identity_409(client, factory):
    """B-TC-049 セルフ経路 編集の一意再検証＝自社の別アカウントと login_id 衝突は 409（自己除外）。根拠 B.2.1。"""
    target = factory.make_seed_company_account()  # ACME-01
    _login_company_admin(client, factory)

    # seed の user@acme.example と衝突させる（自社スコープの一意検証）
    r = client.patch(f"{ACCOUNTS}/{target['id']}", json={"login_id": "user@acme.example"}, headers=_csrf(client))
    assert r.status_code == 409 and r.json()["errors"][0]["field"] == "login_id", r.text
