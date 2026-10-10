"""会社の AI 動作ポリシー（S.5b・§5.67・公開時自動評価の会社別 ON/OFF）。

doc/テスト/S_AIジョブ.md §4b（S-TC-215〜219）。FakeChat（conftest autouse）で外部未接続。
シングルトン company_ai_settings は finally で NULL（デプロイ既定継承）へ戻す（共有dev DB を汚さない）。
"""
from __future__ import annotations

import uuid

from app.control_plane.auth.orm import Company
from app.core.config import get_settings
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.ai_jobs.orm import AiJob, CompanyAiSettings
from app.tenant.profile.orm import User
from tests.admin.test_admin_accounts import _login
from tests.admin.test_admin_issue import _csrf
from tests.conftest import SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD

POLICY = "/api/v1/admin/ai-policy"


def _db() -> str:
    with control_session() as s:
        return s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().db_identifier


def _admin(client, factory):
    a = factory.make_seed_company_account(system_role="company_account_admin",
                                          display_name=f"aipolicy_{uuid.uuid4().hex[:6]}")
    _login(client, SEED_COMPANY_CODE, a["login_id"], a["password"])
    return a


def _reset_policy() -> None:
    with get_tenant_session(_db()) as ts:
        ts.execute(CompanyAiSettings.__table__.update().values(
            auto_evaluate_on_publish=None, updated_by_id=None))
        ts.commit()


def test_s_tc_215_get_default_inherits_deploy(client, factory):
    """S-TC-215: 会社未設定（seed NULL）なら生値 null・effective==deploy_default。"""
    _admin(client, factory)
    try:
        _reset_policy()
        r = client.get(POLICY)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["auto_evaluate_on_publish"] is None
        assert body["effective"] == body["deploy_default"]
    finally:
        _reset_policy()


def test_s_tc_216_patch_explicit_on_off(client, factory):
    """S-TC-216: 明示 ON/OFF で生値と effective が変わり updated_by を記録。"""
    _admin(client, factory)
    try:
        r = client.patch(POLICY, json={"auto_evaluate_on_publish": True}, headers=_csrf(client))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["auto_evaluate_on_publish"] is True and body["effective"] is True
        # 監査＝updated_by_id が記録される。
        with get_tenant_session(_db()) as ts:
            row = ts.query(CompanyAiSettings).first()
            assert row is not None and row.updated_by_id is not None

        r = client.patch(POLICY, json={"auto_evaluate_on_publish": False}, headers=_csrf(client))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["auto_evaluate_on_publish"] is False and body["effective"] is False
    finally:
        _reset_policy()


def test_s_tc_217_patch_null_resets_to_inherit(client, factory):
    """S-TC-217: null で継承リセット＝effective が deploy_default に戻る。"""
    _admin(client, factory)
    try:
        client.patch(POLICY, json={"auto_evaluate_on_publish": True}, headers=_csrf(client))
        r = client.patch(POLICY, json={"auto_evaluate_on_publish": None}, headers=_csrf(client))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["auto_evaluate_on_publish"] is None
        assert body["effective"] == body["deploy_default"]
    finally:
        _reset_policy()


def test_s_tc_218_authz_general_forbidden(client):
    """S-TC-218: 一般ユーザーは取得/変更とも 403（company_account_admin 限定）。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    assert client.get(POLICY).status_code == 403
    assert client.patch(POLICY, json={"auto_evaluate_on_publish": True},
                        headers=_csrf(client)).status_code == 403


def test_s_tc_219_auto_evaluate_company_over_env(client, monkeypatch):
    """S-TC-219(int): 公開時自動評価は会社値優先＝会社 OFF なら env ON でも enqueue しない／会社 ON なら enqueue。"""
    import pytest

    from app.tenant.ideas.application import _enqueue_idea_ai_evaluation
    from app.tenant.ideas.orm import Idea

    # env をデプロイ既定 ON に（会社値が優先されることを示すため）。
    monkeypatch.setattr(get_settings(), "llm_auto_evaluate_on_publish", True)
    db = _db()
    with get_tenant_session(db) as ts:
        user_id = ts.query(User.id).first()[0]
        idea_row = ts.query(Idea.id).first()  # ref_idea_id は ideas.id への FK ＝実在 idea を使う
    if idea_row is None:
        pytest.skip("seed に idea が無い")
    idea_id = idea_row[0]

    def _idea_eval_job_ids() -> set[uuid.UUID]:
        with get_tenant_session(db) as ts:
            rows = ts.query(AiJob.id).filter(
                AiJob.task_type == "idea_evaluate", AiJob.ref_idea_id == idea_id).all()
            return {r[0] for r in rows}

    before = _idea_eval_job_ids()
    created: list[uuid.UUID] = []
    try:
        # (1) 会社 OFF＝env ON でも enqueue されない（会社値優先）。
        with get_tenant_session(db) as ts:
            ts.execute(CompanyAiSettings.__table__.update().values(auto_evaluate_on_publish=False))
            ts.commit()
        _enqueue_idea_ai_evaluation(db, idea_id, user_id)
        assert _idea_eval_job_ids() == before  # 新規ジョブは生まれない

        # (2) 会社 ON＝enqueue される（新規1件）。
        with get_tenant_session(db) as ts:
            ts.execute(CompanyAiSettings.__table__.update().values(auto_evaluate_on_publish=True))
            ts.commit()
        _enqueue_idea_ai_evaluation(db, idea_id, user_id)
        new = _idea_eval_job_ids() - before
        assert len(new) == 1
        created.extend(new)
    finally:
        if created:
            with get_tenant_session(db) as ts:
                ts.execute(AiJob.__table__.delete().where(AiJob.id.in_(created)))
                ts.commit()
        _reset_policy()
