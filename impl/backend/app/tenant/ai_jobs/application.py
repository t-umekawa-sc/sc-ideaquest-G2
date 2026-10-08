"""AIジョブ基盤のユースケース（enqueue＋状態機械 process_once・FR-45・設計 §5）。

`enqueue_ai_job` は各機能ドメイン/汎用EPが呼ぶ（202＝ジョブID を返すだけ）。`process_ai_jobs_once` を
llm_worker.py がループで呼ぶ（テストは本関数を直接呼ぶ＝常駐不要）。ゲートウェイ呼び出しは `infra/llm`
（テストは FakeChat 注入＝外部未接続）。同時実行 N は最小スペック向けに既定1（config・§5.3）。

**Phase1 縦1本＝`info_summarize`**＝input.text を要約するだけ（機微本文の参照ID解決は follow-up・§10）。
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone

from app.control_plane.auth.orm import Company
from app.core.config import get_settings
from app.core.errors import AppError
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.infra.llm import gateway, registry
from app.tenant.ai_jobs import repository as repo
from app.tenant.ai_jobs.orm import AiJob
from app.tenant.notifications import service as notify_svc
from app.tenant.profile import repository as profile_repo
from app.tenant.realtime import events as rt_events

# AiJob は ref_*（ideas/quests/strategy_documents/info_items）へ FK を張る。SQLAlchemy は mapper 構成時に
# これら参照先テーブルが同一 metadata に登録済みであることを要求する。FastAPI は全 router 経由で各 ORM を
# 読み込むが、llm_worker は本モジュールだけを import するため、ここで FK 先 ORM を side-effect import して
# 登録しないと NoReferencedTableError で全ジョブの処理が落ちる（worker 単独起動の必須条件・§5.2a）。
from app.tenant.ideas import orm as _ideas_orm  # noqa: F401
from app.tenant.info import orm as _info_orm  # noqa: F401
from app.tenant.quests import orm as _quests_orm  # noqa: F401
from app.tenant.strategy import orm as _strategy_orm  # noqa: F401

# free 論理キーの単価スナップショット（自社ホスト＝従量課金なし・§4.2/§5.59）。
_FREE_RATE = {"input_rate": 0, "output_rate": 0, "currency": "JPY", "pricing_version": "phase1-free"}


def _resolve_company(company_id: uuid.UUID) -> Company | None:
    with control_session() as s:
        return s.get(Company, company_id)


def _company_id_for_db(db_identifier: str) -> uuid.UUID | None:
    """db_identifier → company_id（WS 封筒の cross-tenant フィルタ用・§1.5）。worker は db しか持たないため逆引き。"""
    with control_session() as s:
        row = s.query(Company.id).filter(Company.db_identifier == db_identifier).first()
    return row[0] if row else None


def _publish_job(requester_id, company_id, type_: str, data: dict) -> None:
    """依頼者本人の AIジョブ速報を WS へ（best-effort・L.3）＝SC-04 のライブ更新（ポーリング不要・S.1a）。"""
    if requester_id is None or company_id is None:
        return
    rt_events.publish_event(rt_events.ai_jobs_topic(requester_id), type_, data, company_id=company_id)


def _effective_enabled_keys(ts) -> set[str]:
    """会社で実際に使える論理キー集合（§4.2 2階層）＝free 既定 ON／paid 既定 OFF に明示設定を上書き。"""
    explicit = repo.model_settings(ts)  # 明示 ON/OFF
    result: set[str] = set()
    for key, billing in registry.catalog_billing().items():
        if key in explicit:
            if explicit[key]:
                result.add(key)
        elif billing == "free":  # 未登録の free は既定 ON
            result.add(key)
    return result


def _detail(job: AiJob) -> dict:
    return {
        "id": str(job.id), "task_type": job.task_type, "status": job.status, "execution": job.execution,
        "requested_model": job.requested_model, "provider": job.provider, "model": job.model,
        "input_tokens": job.input_tokens, "output_tokens": job.output_tokens, "cost_micros": job.cost_micros,
        "progress": job.progress, "error": job.error, "result": job.result,
        "ref_idea_id": str(job.ref_idea_id) if job.ref_idea_id else None,
        "ref_quest_id": str(job.ref_quest_id) if job.ref_quest_id else None,
        "ref_strategy_document_id": str(job.ref_strategy_document_id) if job.ref_strategy_document_id else None,
        "ref_info_item_id": str(job.ref_info_item_id) if job.ref_info_item_id else None,
        "created_at": job.created_at, "started_at": job.started_at, "finished_at": job.finished_at,
    }


def _list_item(job: AiJob) -> dict:
    return {
        "id": str(job.id), "task_type": job.task_type, "status": job.status,
        "progress": job.progress, "created_at": job.created_at, "finished_at": job.finished_at,
        "queue_position": None, "eta_seconds": None,  # queued 行のみ list_jobs で補完
        "ref_idea_id": str(job.ref_idea_id) if job.ref_idea_id else None,
        "ref_quest_id": str(job.ref_quest_id) if job.ref_quest_id else None,
        "ref_strategy_document_id": str(job.ref_strategy_document_id) if job.ref_strategy_document_id else None,
        "ref_info_item_id": str(job.ref_info_item_id) if job.ref_info_item_id else None,
    }


# ---- API 向け（account_id/company_id 解決＋依頼者スコープ・S.0/S.1/S.2） ----

def enqueue(account_id: uuid.UUID, company_id: uuid.UUID, *, task_type: str, input: dict,
            requested_model: str | None = None, ref_idea_id: uuid.UUID | None = None,
            ref_quest_id: uuid.UUID | None = None, ref_strategy_document_id: uuid.UUID | None = None,
            ref_info_item_id: uuid.UUID | None = None) -> dict:
    """ジョブ投入（202＝{id, status}）。モデル指定は registry＋会社有効性で検証（不正/無効/会社OFF は 422）。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        if requested_model is not None:
            try:
                registry.resolve_key(task_type, requested_model)  # 存在/有効（registry 既定）
            except gateway.LLMConfigError:
                raise AppError(422, "validation_error", detail="不正なモデル指定",
                               errors=[{"field": "model", "code": "invalid_model"}])
            if requested_model not in _effective_enabled_keys(ts):  # 会社で ON か（§4.2）
                raise AppError(422, "validation_error", detail="このモデルは会社で無効です",
                               errors=[{"field": "model", "code": "model_disabled"}])
            # paid キーは月次予算上限内のみ（無料ローカルは対象外・§4.2）。
            if registry.get(requested_model).billing == "paid":
                setting = repo.get_model_setting(ts, requested_model)
                budget = setting.monthly_budget_micros if setting else None
                if budget is not None and repo.month_cost(ts, _period_ym()) >= budget:
                    raise AppError(422, "validation_error", detail="月次予算の上限に達しています",
                                   errors=[{"field": "model", "code": "budget_exceeded"}])
        job = repo.create_job(ts, task_type=task_type, requested_by_id=user.id, input=input,
                              requested_model=requested_model, ref_idea_id=ref_idea_id,
                              ref_quest_id=ref_quest_id, ref_strategy_document_id=ref_strategy_document_id,
                              ref_info_item_id=ref_info_item_id)
        out = {"id": str(job.id), "status": job.status}
        _requester_id, _job_id = user.id, job.id
        ts.commit()
    # 投入速報＝SC-04 に新規 queued 行を即時反映（リロード不要・L.3）。
    _publish_job(_requester_id, company_id, "ai_job.changed", {"job_id": str(_job_id), "status": "queued"})
    return out


def list_jobs(account_id: uuid.UUID, company_id: uuid.UUID, *, status=None, task_type=None,
              sort=None, page: int = 1, per_page: int = 20) -> dict:
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    page = max(1, page or 1)
    per_page = min(100, max(1, per_page or 20))
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        rows, total = repo.list_jobs(ts, requester_id=user.id, status=status, task_type=task_type,
                                     sort=sort, page=page, per_page=per_page)
        items = [_list_item(j) for j in rows]
        # queued 行だけ順番待ち位置＋概算 ETA を補完（会社全体の待ち行列基準・S.1）。
        queued_ids = [j.id for j in rows if j.status == "queued"]
        if queued_ids:
            info = repo.queue_info(ts, queued_ids, get_settings().llm_worker_concurrency)
            by_id = {it["id"]: it for it in items}
            for jid, qi in info.items():
                target = by_id.get(str(jid))
                if target:
                    target.update(qi)
        return {"data": items,
                "page_info": {"page": page, "per_page": per_page, "total": total,
                              "has_next": page * per_page < total}}


def list_running(account_id: uuid.UUID, company_id: uuid.UUID) -> dict:
    """SC-04 上部＝会社内 running の進捗率のみ（自分を除外・匿名・S.1a）。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        ratios = repo.running_progress(ts, exclude_requester_id=user.id)
        return {"data": [{"ratio": r} for r in ratios]}


def latest_generation(company_id: uuid.UUID, *, task_type: str, ref_strategy_document_id: uuid.UUID) -> dict | None:
    """経営資料に紐づく最新生成ジョブの状態＋結果（strategy の生成表示用・管理者スコープは呼び出し側）。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        job = repo.latest_by_ref(ts, task_type=task_type, ref_strategy_document_id=ref_strategy_document_id)
        if job is None:
            return None
        return {
            "job_id": str(job.id),
            "status": job.status,
            "result_text": (job.result or {}).get("text") if job.status == "succeeded" else None,
            "error": (job.error or {}).get("detail") if job.status == "failed" else None,
            "finished_at": job.finished_at.isoformat() if job.finished_at else None,
        }


def summary(account_id: uuid.UUID, company_id: uuid.UUID) -> dict:
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        return repo.summary(ts, user.id)


def get_job(account_id: uuid.UUID, company_id: uuid.UUID, job_id: str) -> dict:
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        job = repo.get_for_requester(ts, uuid.UUID(job_id), user.id)
        if job is None:
            raise AppError(404, "not_found")
        return _detail(job)


def cancel_job(account_id: uuid.UUID, company_id: uuid.UUID, job_id: str) -> dict:
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        job = repo.get_for_requester(ts, uuid.UUID(job_id), user.id)
        if job is None:
            raise AppError(404, "not_found")
        repo.request_cancel(ts, job)
        out = _detail(job)
        _requester_id, _status = user.id, job.status
        ts.commit()
    _publish_job(_requester_id, company_id, "ai_job.changed", {"job_id": job_id, "status": _status})
    return out


def list_models(account_id: uuid.UUID, company_id: uuid.UUID, task_type: str | None = None) -> dict:
    """会社で有効な論理キーを返す（`GET /ai-models`・S.2・ピッカー供給源）。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        enabled = _effective_enabled_keys(ts)
    return {"data": registry.list_models(task_type, enabled_keys=enabled)}


def _period_ym(now: datetime | None = None) -> int:
    now = now or datetime.now(timezone.utc)
    return now.year * 100 + now.month


# ---- 管理 API（会社モデル ON/OFF・予算・利用量・S.5・company_account_admin） ----

def admin_list_models(account_id: uuid.UUID, company_id: uuid.UUID) -> dict:
    """カタログ（registry 全キー）＋自社設定（enabled/billing/予算/当月利用）を返す（GET /admin/ai-models）。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    meta = registry.catalog_meta()  # key→{billing,label,description}（ピッカーと同一ソース・§9.2）
    with get_tenant_session(company.db_identifier) as ts:
        explicit = repo.model_settings(ts)
        settings_rows = {r.model_key: r for r in [repo.get_model_setting(ts, k) for k in meta] if r}
        effective = _effective_enabled_keys(ts)
        usage = repo.month_cost_by_model(ts, _period_ym())
        data = []
        for key, m in meta.items():
            row = settings_rows.get(key)
            u = usage.get(key, {"input_tokens": 0, "output_tokens": 0, "cost_micros": 0})
            data.append({
                "key": key, "billing": m["billing"], "label": m["label"], "description": m["description"],
                "enabled": key in effective,
                "monthly_budget_micros": row.monthly_budget_micros if row else None,
                "max_output_tokens": row.max_output_tokens if row else None,
                "current_month": {"tokens": u["input_tokens"] + u["output_tokens"], "cost_micros": u["cost_micros"]},
            })
    return {"data": data}


def admin_patch_model(account_id: uuid.UUID, company_id: uuid.UUID, key: str, *,
                      enabled: bool | None, monthly_budget_micros: int | None,
                      max_output_tokens: int | None = None) -> dict:
    """会社モデルの ON/OFF・予算・出力上限変更（PATCH /admin/ai-models/{key}）。paid ON＝課金合意（enabled_by/at 記録）。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    if key not in registry.catalog_billing():  # 未知キーは 422
        raise AppError(422, "validation_error", detail="不明なモデルキー",
                       errors=[{"field": "key", "code": "invalid_model"}])
    if max_output_tokens is not None and max_output_tokens < 0:
        raise AppError(422, "validation_error", detail="出力トークン上限は0以上",
                       errors=[{"field": "max_output_tokens", "code": "invalid_range"}])
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        repo.upsert_model_setting(ts, key, enabled=enabled, monthly_budget_micros=monthly_budget_micros,
                                  max_output_tokens=max_output_tokens, actor_id=user.id)
        ts.commit()
    return admin_list_models(account_id, company_id)


def admin_usage(account_id: uuid.UUID, company_id: uuid.UUID, *, period_ym: int | None = None,
                model_key: str | None = None) -> dict:
    """会社×モデル×月の利用量/コスト集計（GET /admin/ai-usage・§6.3）。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        rows = repo.usage_aggregate(ts, period_ym=period_ym, model_key=model_key)
    return {"data": rows}


def enqueue_ai_job(
    db_identifier: str,
    *,
    task_type: str,
    requested_by_id: uuid.UUID,
    input: dict,
    requested_model: str | None = None,
    ref_idea_id: uuid.UUID | None = None,
    ref_quest_id: uuid.UUID | None = None,
    ref_strategy_document_id: uuid.UUID | None = None,
    ref_info_item_id: uuid.UUID | None = None,
) -> uuid.UUID:
    """ジョブを queued で投入し、ジョブID を返す（202 相当・結果は待たない）。

    モデル指定（requested_model）は registry で検証＝不正/無効は LLMConfigError（呼び出し側で 422）。
    """
    if requested_model is not None:
        registry.resolve_key(task_type, requested_model)  # 検証（副作用で例外）
    with get_tenant_session(db_identifier) as session:
        job = repo.create_job(
            session,
            task_type=task_type,
            requested_by_id=requested_by_id,
            input=input,
            requested_model=requested_model,
            ref_idea_id=ref_idea_id,
            ref_quest_id=ref_quest_id,
            ref_strategy_document_id=ref_strategy_document_id,
            ref_info_item_id=ref_info_item_id,
        )
        job_id = job.id
        session.commit()
    return job_id


def _build_messages(job: AiJob, ts=None) -> list[dict]:
    """task_type ごとにプロンプトを組む。文脈は enqueue 側ドメインが input に用意済み（本層は汎用のまま）。

    例外＝idea_evaluate/concept_evaluate は参照ID入力なので、実行中セッション `ts` から評価ドメインが文脈を収集する
    （機微本文の滞留を最小化・F.7.2）＝本層は評価ドメインへ遅延 import で委譲するだけ。
    """
    if job.task_type == "idea_evaluate":
        from app.tenant.evaluations import ai_eval
        idea_id = (job.input or {}).get("idea_id")
        if not idea_id:
            raise _PermanentError("input.idea_id is required for idea_evaluate")
        try:
            return ai_eval.build_messages(ts, uuid.UUID(str(idea_id)))
        except ai_eval.AiEvalError as exc:
            raise _PermanentError(str(exc)) from exc
    if job.task_type == "concept_evaluate":
        from app.tenant.concepts import ai_eval as concept_ai_eval
        concept_id = (job.input or {}).get("concept_id")
        if not concept_id:
            raise _PermanentError("input.concept_id is required for concept_evaluate")
        try:
            return concept_ai_eval.build_messages(ts, uuid.UUID(str(concept_id)))
        except concept_ai_eval.AiEvalError as exc:
            raise _PermanentError(str(exc)) from exc
    if job.task_type == "info_summarize":
        text = (job.input or {}).get("text", "")
        if not text:
            raise _PermanentError("input.text is required for info_summarize")
        return [
            {"role": "system", "content": "次の文章を日本語で簡潔に要約してください。"},
            {"role": "user", "content": str(text)},
        ]
    if job.task_type == "iso_generate":
        # 経営資料整合 Phase2（FR-44/FR-45・設計 §8）＝経営資料＋関連の構造化 Markdown（enqueue 時に
        # strategy ドメインが export で用意）を基に ISO56001 §6 のたたき台を生成。本層は strategy に非依存。
        context = (job.input or {}).get("context_md", "")
        if not context:
            raise _PermanentError("input.context_md is required for iso_generate")
        system = (
            "あなたは ISO56001（イノベーションマネジメント）に詳しい社内のファシリテーターです。"
            "以下の会社の経営資料と、関連する現場のアイデア・情報・コンセプトを基に、"
            "ISO56001 §6（計画）の『意図（ビジョン）』『戦略・方向性』『イノベーション方針』の"
            "たたき台を日本語で生成してください。各項目を見出し付きで簡潔にまとめ、"
            "経営資料に無い事実は創作しないでください。最後に人による確定が前提です。"
        )
        return [
            {"role": "system", "content": system},
            {"role": "user", "content": str(context)},
        ]
    raise _PermanentError(f"unsupported task_type: {job.task_type}")


class _PermanentError(Exception):
    """入力不正など恒久失敗（リトライしない＝即 failed）。"""


def _notify_completion(session, job: AiJob, *, ok: bool) -> None:
    """完了/失敗を依頼者へ通知（既存 notifications 再利用・§8・S.6）。ref は job の idea/quest を流用。

    notifications は info_item/ai_job の ref 列を持たないため、Phase1 は idea/quest のみ ref に載せ、
    それ以外（info_summarize 等）は ref 無し＝frontend が ai_task_* を SC-04 へ誘導する。
    """
    refs = {}
    if job.ref_idea_id:
        refs["ref_idea_id"] = job.ref_idea_id
    if job.ref_quest_id:
        refs["ref_quest_id"] = job.ref_quest_id
    ntype = "ai_task_done" if ok else "ai_task_failed"
    params = {"task_type": job.task_type}
    if not ok and job.error:
        params["error"] = job.error
    recipients = [job.requested_by_id]
    # 評価ジョブの**失敗**は依頼者に加えて評価者権限保持者（owner 含む）へも通知（FR-50・F.7/P.5a・§6-5）＝
    # 自動起動は system/author 起点で依頼者だけだと気づけないため。graceful（解決失敗でも依頼者通知は出す）。
    if not ok and job.task_type in ("idea_evaluate", "concept_evaluate"):
        try:
            from app.tenant.evaluations import application as eval_app
            inp = job.input or {}
            quest = None
            if job.task_type == "idea_evaluate" and (job.ref_idea_id or inp.get("idea_id")):
                from app.tenant.ideas import repository as ideas_repo
                from app.tenant.quests import repository as quests_repo
                idea = ideas_repo.get_idea(session, job.ref_idea_id or uuid.UUID(str(inp.get("idea_id"))))
                quest = quests_repo.get_quest(session, idea.quest_id) if idea is not None else None
            elif job.task_type == "concept_evaluate" and job.ref_quest_id:
                from app.tenant.quests import repository as quests_repo
                quest = quests_repo.get_quest(session, job.ref_quest_id)
            for uid in eval_app.eval_failure_recipient_ids(session, quest):
                if uid not in recipients:
                    recipients.append(uid)
        except Exception:  # noqa: BLE001 — 宛先解決の失敗で通知全体を止めない
            logging.getLogger("app").warning("eval failure recipients resolve failed for job=%s", job.id, exc_info=True)
    notify_svc.notify(session, [notify_svc.entry(r, ntype, refs=refs, params=params) for r in recipients])


def process_ai_jobs_once(db_identifier: str) -> dict:
    """1 巡だけ処理する（§5.3/§5.4）。処理件数の要約を返す。llm_worker がループで呼ぶ。

    (0) 孤児回収＋queued キャンセル反映 → (1) N 件確保（queued→running）→ (2) 1 件ずつ実行。
    """
    s = get_settings()
    stats = {"succeeded": 0, "failed": 0, "canceled": 0, "reclaimed": 0}
    threshold = datetime.now(timezone.utc) - timedelta(seconds=s.llm_job_running_reclaim_seconds)
    with get_tenant_session(db_identifier) as session:
        stats["reclaimed"] = repo.reclaim_stuck_running(session, threshold)
        stats["canceled"] = repo.cancel_queued_requested(session)
        job_ids = repo.claim_queued(session, s.llm_worker_concurrency)
        session.commit()

    for job_id in job_ids:
        outcome = _process_one(db_identifier, job_id)
        if outcome in stats:
            stats[outcome] += 1
    return stats


def _active_company_dbs() -> list[str]:
    """有効な会社の db_identifier 一覧（llm_worker が全会社DBを巡回するため・§5.2(a)）。"""
    with control_session() as s:
        rows = s.query(Company.db_identifier).filter(Company.status == "active").all()
    return [r[0] for r in rows]


def process_all_companies_once() -> dict:
    """全有効会社DBを1巡ずつ処理する（llm_worker がループで呼ぶ）。会社別 stats を合算して返す。

    1社の失敗が他社を止めないよう会社ごとに例外を隔離する（mail_worker と同思想）。
    """
    agg = {"succeeded": 0, "failed": 0, "canceled": 0, "reclaimed": 0, "companies": 0, "errors": 0}
    for db in _active_company_dbs():
        agg["companies"] += 1
        try:
            stats = process_ai_jobs_once(db)
            for k in ("succeeded", "failed", "canceled", "reclaimed"):
                agg[k] += stats.get(k, 0)
        except Exception:  # noqa: BLE001（1社の失敗で全体を止めない・次巡で再試行）
            agg["errors"] += 1
    return agg


def _process_one(db_identifier: str, job_id: uuid.UUID) -> str:
    """1 件を実行する＝ゲートウェイ呼び出し→成功で succeeded＋usage 記録／失敗で retry/failed。"""
    s = get_settings()
    company_id = _company_id_for_db(db_identifier)
    # 1) 実行に必要な値を読み出す（別 Tx＝running は確保済み）＋実行中の初期進捗を書く。
    with get_tenant_session(db_identifier) as session:
        job = repo.get(session, job_id)
        if job is None or job.status != "running":
            return "skip"
        task_type, requested_model = job.task_type, job.requested_model
        requester = job.requested_by_id
        try:
            messages = _build_messages(job, session)
        except _PermanentError as exc:
            job.status = "failed"
            job.error = {"code": "invalid_input", "detail": str(exc)}
            job.finished_at = datetime.now(timezone.utc)
            _notify_completion(session, job, ok=False)
            session.commit()
            _publish_job(requester, company_id, "ai_job.changed", {"job_id": str(job_id), "status": "failed"})
            return "failed"
        # 会社別の生成トークン上限（S.5・無料ティア抑制等）を解決＝当該モデルの会社設定（NULL=無制限）。
        _resolved_key = registry.resolve_key(task_type, requested_model)
        _setting = repo.get_model_setting(session, _resolved_key)
        max_output_tokens = _setting.max_output_tokens if _setting else None
        repo.set_progress(session, job_id, {"phase": "生成中", "ratio": 0.0 if max_output_tokens else None})
        session.commit()
    # 実行開始＝SC-04 で「実行中・0%」を即時反映（L.3）。
    _publish_job(requester, company_id, "ai_job.changed", {"job_id": str(job_id), "status": "running"})

    # 進捗コールバック＝ストリーミングのトークン毎に呼ばれる。DB/WS への反映はトークン差分でスロットル（§5.6）。
    _step = max(1, max_output_tokens // 10) if max_output_tokens else 24
    _last = [0]

    def _on_progress(tokens: int) -> None:
        if tokens - _last[0] < _step:
            return
        _last[0] = tokens
        ratio = min(1.0, tokens / max_output_tokens) if max_output_tokens else None
        with get_tenant_session(db_identifier) as ps:
            repo.set_progress(ps, job_id, {"phase": "生成中", "ratio": ratio, "tokens": tokens})
            ps.commit()
        _publish_job(requester, company_id, "ai_job.progress",
                     {"job_id": str(job_id), "ratio": ratio, "tokens": tokens})

    # 2) 論理キー解決＋ゲートウェイ呼び出し（DB 接続を持たずに）。会社上限があれば max_tokens を付与。
    try:
        key = registry.resolve_key(task_type, requested_model)
        spec = registry.get(key)
        _params = {"max_tokens": max_output_tokens} if max_output_tokens and max_output_tokens > 0 else None
        result = gateway.complete(task_type, messages, model=key, params=_params, on_progress=_on_progress)
    except gateway.LLMConfigError as exc:
        r = _fail_permanent(db_identifier, job_id, "invalid_model", str(exc))
        _publish_job(requester, company_id, "ai_job.changed", {"job_id": str(job_id), "status": "failed"})
        return r
    except gateway.LLMUnavailable as exc:
        r = _fail_retryable(db_identifier, job_id, str(exc), s.llm_job_max_attempts)
        _publish_job(requester, company_id, "ai_job.changed", {"job_id": str(job_id)})
        return r

    # 3) 成功＝succeeded＋result＋usage 記録（課金基礎は追記専用台帳へ）。
    now = datetime.now(timezone.utc)
    period_ym = now.year * 100 + now.month
    cost_micros = 0  # Phase1 は free のみ（従量課金なし・§4.2）
    with get_tenant_session(db_identifier) as session:
        job = repo.get(session, job_id)
        if job is None:
            return "skip"
        # idea_evaluate/concept_evaluate＝生成結果(JSON)を評価として保存（検証失敗＝ジョブ failed＝人間評価のみで進行）。
        if task_type in ("idea_evaluate", "concept_evaluate"):
            inp = job.input or {}
            reg_by = inp.get("regenerated_by")
            editor = uuid.UUID(str(reg_by)) if reg_by else None
            try:
                if task_type == "idea_evaluate":
                    from app.tenant.evaluations import ai_eval
                    ai_eval.apply_result(session, idea_id=uuid.UUID(str(inp.get("idea_id"))),
                                         ai_job_id=job.id, model=result.model, editor_id=editor, text=result.text)
                else:
                    from app.tenant.concepts import ai_eval as concept_ai_eval
                    concept_ai_eval.apply_result(session, concept_id=uuid.UUID(str(inp.get("concept_id"))),
                                                 ai_job_id=job.id, model=result.model, editor_id=editor, text=result.text)
            except ValueError as exc:  # AiEvalError（ValueError 派生）＝出力不正＝恒久失敗
                job.status = "failed"
                job.error = {"code": "invalid_output", "detail": str(exc)}
                job.finished_at = now
                _notify_completion(session, job, ok=False)
                session.commit()
                _publish_job(requester, company_id, "ai_job.changed", {"job_id": str(job_id), "status": "failed"})
                return "failed"
        job.status = "succeeded"
        job.result = {"text": result.text}
        job.provider = result.provider
        job.model = result.model
        job.input_tokens = result.input_tokens
        job.output_tokens = result.output_tokens
        job.cost_micros = cost_micros
        job.progress = None  # 完了＝進捗はクリア（一覧は「—」表示に戻る）
        job.finished_at = now
        repo.record_usage(
            session,
            job_id=job.id,
            period_ym=period_ym,
            model_key=key,
            provider=result.provider,
            model=result.model,
            task_type=task_type,
            requested_by_id=requester,
            billing=spec.billing,
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens,
            rate_snapshot=_FREE_RATE,
            cost_micros=cost_micros,
        )
        _notify_completion(session, job, ok=True)
        session.commit()
    _publish_job(requester, company_id, "ai_job.changed", {"job_id": str(job_id), "status": "succeeded"})
    return "succeeded"


def _fail_permanent(db_identifier: str, job_id: uuid.UUID, code: str, detail: str) -> str:
    with get_tenant_session(db_identifier) as session:
        job = repo.get(session, job_id)
        if job is None:
            return "skip"
        job.status = "failed"
        job.error = {"code": code, "detail": detail}
        job.finished_at = datetime.now(timezone.utc)
        _notify_completion(session, job, ok=False)
        session.commit()
    return "failed"


def _fail_retryable(db_identifier: str, job_id: uuid.UUID, detail: str, max_attempts: int) -> str:
    """到達不能等＝attempts++。上限未満は queued（次巡で再試行）、上限で failed。"""
    with get_tenant_session(db_identifier) as session:
        job = repo.get(session, job_id)
        if job is None:
            return "skip"
        job.attempts += 1
        if job.attempts >= max_attempts:
            job.status = "failed"
            job.error = {"code": "llm_unavailable", "detail": detail}
            job.finished_at = datetime.now(timezone.utc)
            _notify_completion(session, job, ok=False)  # 終端失敗のみ通知（再試行では出さない）
        else:
            job.status = "queued"  # 次巡で再試行
            job.started_at = None
        session.commit()
    return "failed" if job is not None and job.status == "failed" else "retry"
