"""経営資料整合 Phase2 in-app 生成（iso_generate・FR-44 Phase2・設計 §8・doc/テスト/R_経営資料.md）。

LLM 呼び出しは FakeChat（conftest autouse・決定的・外部未接続）。生成は AIジョブ基盤（FR-45）に委譲。
"""
from __future__ import annotations

import uuid

from sqlalchemy import select

from app.db.tenant import get_tenant_session
from app.tenant.ai_jobs.orm import AiJob, AiUsageEvent
from app.tenant.strategy.orm import IdeaAlignment, StrategyDocument
from app.tenant.tokens.orm import EntityToken
from tests.admin.test_admin_accounts import _login
from tests.admin.test_admin_issue import _csrf
from tests.conftest import SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD
from tests.strategy.test_strategy_crud import BASE, _admin, _body, _seed_db


def _cleanup(did: uuid.UUID) -> None:
    # 掃除順＝ai_usage_events（requested_by_id→users / job_id→ai_jobs を参照）→ai_jobs→doc（FK RESTRICT 回避）。
    with get_tenant_session(_seed_db()) as ts:
        job_ids = [r[0] for r in ts.execute(select(AiJob.id).where(AiJob.ref_strategy_document_id == did)).all()]
        if job_ids:
            ts.execute(AiUsageEvent.__table__.delete().where(AiUsageEvent.job_id.in_(job_ids)))
        ts.execute(AiJob.__table__.delete().where(AiJob.ref_strategy_document_id == did))
        ts.execute(IdeaAlignment.__table__.delete().where(IdeaAlignment.strategy_document_id == did))
        ts.execute(EntityToken.__table__.delete().where(EntityToken.owner_type == "strategy_doc", EntityToken.owner_id == did))
        ts.execute(StrategyDocument.__table__.delete().where(StrategyDocument.id == did))
        ts.commit()


def test_r_tc_120_iso_generate_vertical(client, factory):
    """R-TC-120: Phase2 in-app 生成＝経営資料→iso_generate 投入→worker(FakeChat)→succeeded→生成取得。"""
    _admin(client, factory)
    did = uuid.UUID(client.post(BASE, json=_body(f"中計_{uuid.uuid4().hex[:6]}"), headers=_csrf(client)).json()["id"])
    try:
        r = client.post(f"{BASE}/{did}/generate", headers=_csrf(client))
        assert r.status_code == 202, r.text
        assert r.json()["status"] == "queued"
        # 生成前＝まだ結果なし（queued）。
        g0 = client.get(f"{BASE}/{did}/generation").json()
        assert g0 is not None and g0["status"] == "queued" and g0["result_text"] is None
        # ワーカー1巡（FakeChat で決定的に succeeded）。
        from app.tenant.ai_jobs import application as ai_jobs
        stats = ai_jobs.process_ai_jobs_once(_seed_db())
        assert stats["succeeded"] >= 1
        # 生成結果＝succeeded ＋ 生成ドラフト（result_text）。
        g = client.get(f"{BASE}/{did}/generation").json()
        assert g["status"] == "succeeded"
        assert g["result_text"]
    finally:
        _cleanup(did)


def test_r_tc_121_generate_requires_admin(client, factory):
    """R-TC-121: 生成は管理者のみ（一般ユーザーは 403）。"""
    _admin(client, factory)
    did = uuid.UUID(client.post(BASE, json=_body(f"権限_{uuid.uuid4().hex[:6]}"), headers=_csrf(client)).json()["id"])
    try:
        _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)  # 一般ユーザーへ切替
        r = client.post(f"{BASE}/{did}/generate", headers=_csrf(client))
        assert r.status_code == 403, r.text
    finally:
        _cleanup(did)


def _job_requested_models(did: uuid.UUID) -> list[str | None]:
    with get_tenant_session(_seed_db()) as ts:
        return [r[0] for r in ts.execute(
            select(AiJob.requested_model).where(AiJob.ref_strategy_document_id == did)).all()]


def test_r_tc_124_generate_with_model(client, factory):
    """R-TC-124: 生成のモデル指定＝model=有効キーで投入ジョブの requested_model に反映（省略時は null）。"""
    _admin(client, factory)
    did = uuid.UUID(client.post(BASE, json=_body(f"モデル_{uuid.uuid4().hex[:6]}"), headers=_csrf(client)).json()["id"])
    try:
        # 明示モデル指定＝requested_model に載る。
        r = client.post(f"{BASE}/{did}/generate", json={"model": "qwen3-light"}, headers=_csrf(client))
        assert r.status_code == 202, r.text
        assert "qwen3-light" in _job_requested_models(did)
        # 省略＝requested_model は null（task_type 既定へ委譲）。
        r2 = client.post(f"{BASE}/{did}/generate", headers=_csrf(client))
        assert r2.status_code == 202, r2.text
        assert None in _job_requested_models(did)
    finally:
        _cleanup(did)


def test_r_tc_125_generate_invalid_model_422(client, factory):
    """R-TC-125: 生成の不正モデルは 422（ジョブは作られない）。"""
    _admin(client, factory)
    did = uuid.UUID(client.post(BASE, json=_body(f"不正_{uuid.uuid4().hex[:6]}"), headers=_csrf(client)).json()["id"])
    try:
        r = client.post(f"{BASE}/{did}/generate", json={"model": "bogus-model"}, headers=_csrf(client))
        assert r.status_code == 422, r.text
        assert _job_requested_models(did) == []  # ジョブ未作成
    finally:
        _cleanup(did)
