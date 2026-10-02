"""AIジョブ API（S.1/S.2・依頼者スコープ・doc/テスト/S_AIジョブ.md §1/§2）。

FakeChat（conftest autouse）で外部未接続。作成したジョブは finally で会社DBから掃除（共有dev DB を汚さない）。
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select

from app.control_plane.auth.orm import Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.ai_jobs.orm import AiJob, CompanyAiModelSetting
from app.tenant.profile.orm import User
from tests.admin.test_admin_accounts import _login
from tests.admin.test_admin_issue import _csrf
from tests.conftest import SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD

BASE = "/api/v1/ai-jobs"


def _db() -> str:
    with control_session() as s:
        return s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().db_identifier


def _cleanup(ids: list[str]) -> None:
    if not ids:
        return
    with get_tenant_session(_db()) as ts:
        ts.execute(AiJob.__table__.delete().where(AiJob.id.in_([uuid.UUID(i) for i in ids])))
        ts.commit()


def _enqueue(client, **body) -> dict:
    payload = {"task_type": "info_summarize", "input": {"text": "競合A社が値下げ"}}
    payload.update(body)
    return client.post(BASE, json=payload, headers=_csrf(client))


def _make(client):
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)


def test_s_tc_101_enqueue_and_list(client):
    """S-TC-101(api): enqueue=202 queued・自分の一覧に出る。"""
    _make(client)
    ids = []
    try:
        r = _enqueue(client)
        assert r.status_code == 202, r.text
        jid = r.json()["id"]
        ids.append(jid)
        assert r.json()["status"] == "queued"
        lst = client.get(BASE).json()
        assert jid in [row["id"] for row in lst["data"]]
    finally:
        _cleanup(ids)


def test_s_tc_110_default_model_ok(client):
    """S-TC-110(api): model 省略で 202（task_type 既定）。"""
    _make(client)
    ids = []
    try:
        r = _enqueue(client)  # model 省略
        assert r.status_code == 202, r.text
        ids.append(r.json()["id"])
    finally:
        _cleanup(ids)


def test_s_tc_112_bogus_model_422(client):
    """S-TC-112(api): registry に無いモデル指定は 422。"""
    _make(client)
    r = _enqueue(client, model="bogus-model")
    assert r.status_code == 422, r.text
    assert r.json()["errors"][0]["field"] == "model"


def test_s_tc_115_list_models(client):
    """S-TC-115(api): GET /ai-models＝会社で有効なキー（free 既定 ON）・既定フラグ。"""
    _make(client)
    r = client.get("/api/v1/ai-models", params={"task_type": "info_summarize"})
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    keys = {m["key"]: m for m in data}
    assert "qwen3-light" in keys  # free 既定 ON
    assert keys["qwen3-light"]["is_default"] is True and keys["qwen3-light"]["billing"] == "free"


def test_s_tc_108_other_and_missing_job_404(client):
    """S-TC-108(api): 存在しない/他人のジョブは 404（依頼者スコープ・存在秘匿）。"""
    _make(client)
    r = client.get(f"{BASE}/{uuid.uuid4()}")
    assert r.status_code == 404


def test_s_tc_109_summary_reflects_queued(client):
    """S-TC-109(api): summary の queued がジョブ投入を反映。"""
    _make(client)
    ids = []
    try:
        before = client.get(f"{BASE}/summary").json()["queued"]
        ids.append(_enqueue(client).json()["id"])
        after = client.get(f"{BASE}/summary").json()["queued"]
        assert after == before + 1
    finally:
        _cleanup(ids)


def test_cancel_queued_via_api(client):
    """queued を API でキャンセル＝canceled（S.1・§5.5）。"""
    _make(client)
    ids = []
    try:
        jid = _enqueue(client).json()["id"]
        ids.append(jid)
        r = client.post(f"{BASE}/{jid}/cancel", headers=_csrf(client))
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "canceled"
    finally:
        _cleanup(ids)


def test_enqueue_requires_csrf(client):
    """変更系は CSRF 必須（A.0）＝ヘッダ無し POST は 403。"""
    _make(client)
    r = client.post(BASE, json={"task_type": "info_summarize", "input": {"text": "x"}})
    assert r.status_code == 403


# ---- 管理（S.5・company_account_admin） ----

def _admin(client, factory):
    a = factory.make_seed_company_account(system_role="company_account_admin",
                                          display_name=f"llm管理_{uuid.uuid4().hex[:6]}")
    _login(client, SEED_COMPANY_CODE, a["login_id"], a["password"])
    return a


def _cleanup_settings(keys: list[str]) -> None:
    with get_tenant_session(_db()) as ts:
        ts.execute(CompanyAiModelSetting.__table__.delete().where(CompanyAiModelSetting.model_key.in_(keys)))
        ts.commit()


def test_admin_list_models_catalog(client, factory):
    """GET /admin/ai-models＝カタログ全キー＋自社設定（free 既定 ON・当月利用）。"""
    _admin(client, factory)
    r = client.get("/api/v1/admin/ai-models")
    assert r.status_code == 200, r.text
    data = {m["key"]: m for m in r.json()["data"]}
    assert "qwen3-light" in data and "qwen3-swallow" in data
    assert data["qwen3-light"]["billing"] == "free" and data["qwen3-light"]["enabled"] is True
    assert "current_month" in data["qwen3-light"]


def test_s_tc_120_admin_toggle_and_authz(client, factory):
    """S-TC-120: ON/OFF は admin のみ・一般は 403／未知キーは 422。"""
    # 一般ユーザーは 403。
    _make(client)
    assert client.patch("/api/v1/admin/ai-models/qwen3-light",
                        json={"enabled": False}, headers=_csrf(client)).status_code == 403
    # 管理者は変更できる。
    _admin(client, factory)
    try:
        r = client.patch("/api/v1/admin/ai-models/qwen3-swallow",
                         json={"enabled": False}, headers=_csrf(client))
        assert r.status_code == 200, r.text
        data = {m["key"]: m for m in r.json()["data"]}
        assert data["qwen3-swallow"]["enabled"] is False  # OFF 反映
        # 未知キーは 422。
        assert client.patch("/api/v1/admin/ai-models/bogus",
                           json={"enabled": True}, headers=_csrf(client)).status_code == 422
    finally:
        _cleanup_settings(["qwen3-swallow"])


def test_admin_model_disabled_blocks_enqueue(client, factory):
    """会社 OFF にしたキーを指定した enqueue は 422（§4.2 ガードレール・S-TC-113 相当）。"""
    _admin(client, factory)
    try:
        client.patch("/api/v1/admin/ai-models/qwen3-swallow",
                     json={"enabled": False}, headers=_csrf(client))
        # 一般ユーザーで OFF キーを指定 → 422。
        _make(client)
        r = _enqueue(client, model="qwen3-swallow")
        assert r.status_code == 422, r.text
        assert r.json()["errors"][0]["code"] == "model_disabled"
    finally:
        _cleanup_settings(["qwen3-swallow"])


def test_s_tc_125_admin_usage_shape(client, factory):
    """S-TC-125: GET /admin/ai-usage＝会社×モデル×月の集計（データ形）。"""
    _admin(client, factory)
    r = client.get("/api/v1/admin/ai-usage", params={"period_ym": 202609})
    assert r.status_code == 200, r.text
    assert isinstance(r.json()["data"], list)


def _two_user_ids(db: str) -> tuple[uuid.UUID, uuid.UUID]:
    """(自分=SEED_LOGIN の user.id, 他ユーザの user.id) を返す。"""
    with get_tenant_session(db) as ts:
        self_u = ts.execute(select(User).where(User.login_id == SEED_LOGIN)).scalars().first()
        other_u = ts.execute(select(User).where(User.id != self_u.id).limit(1)).scalars().first()
        return self_u.id, other_u.id


def _insert_running(db: str, requester_id: uuid.UUID, ratio: float | None) -> str:
    """会社DBに running の AiJob を直接 insert（他ユーザの実行中を再現）。"""
    with get_tenant_session(db) as ts:
        j = AiJob(task_type="info_summarize", status="running", requested_by_id=requester_id,
                  input={"text": "x"}, progress=({"ratio": ratio} if ratio is not None else None),
                  started_at=datetime.now(timezone.utc))
        ts.add(j)
        ts.commit()
        return str(j.id)


def test_s_tc_130_running_excludes_self_ratio_only(client):
    """S-TC-130(api): GET /ai-jobs/running＝会社 running で自分を除外・ratio のみ匿名（S.1a/S.0/S.7）。"""
    _make(client)
    db = _db()
    self_id, other_id = _two_user_ids(db)
    ids = []
    try:
        ids.append(_insert_running(db, other_id, 0.61))
        ids.append(_insert_running(db, other_id, 0.21))
        ids.append(_insert_running(db, self_id, 0.91))  # 自分＝除外されるべき
        r = client.get(f"{BASE}/running")
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        ratios = [d["ratio"] for d in data]
        assert 0.61 in ratios and 0.21 in ratios  # 他ユーザの running は進捗率で出る
        assert 0.91 not in ratios                  # 自分の running は上部に出ない
        assert all(set(d.keys()) == {"ratio"} for d in data)  # 匿名＝ratio のみ（依頼者/入力/種別なし）
    finally:
        _cleanup(ids)
