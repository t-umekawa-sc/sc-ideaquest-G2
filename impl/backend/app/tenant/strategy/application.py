"""経営資料（strategy_documents）のユースケース（ドメイン R.1・管理者スコープ）。

認可は router の Depends(require_company_account_admin)＝会社アカウント管理者/system_admin（機微資料）。
選択用一覧のみ require_me（クエスト作成者が適用資料を選ぶ・R.0）。会社/ユーザーはセッション由来（§1.5）。
本文（構造化項目＋body_md 連結の body_text）を entity_tokens（owner_type='strategy_doc'）へ同期（整合率の素材）。
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from app.control_plane.auth.orm import Company
from app.core.errors import AppError
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.profile import repository as profile_repo
from app.tenant.profile.orm import User
from app.tenant.strategy import repository as repo
from app.tenant.strategy.schemas import DOC_KINDS

_TEXT_FIELDS = ("intent", "policy_commitment", "strategy", "objectives", "body_md")


def _resolve_company(company_id: uuid.UUID) -> Company | None:
    with control_session() as s:
        return s.get(Company, company_id)


def _compose_body_text(doc) -> str:
    """構造化項目＋focus_areas＋body_md を連結した平文（トークン化/検索の素材・§5.54）。"""
    parts: list[str] = [getattr(doc, f) or "" for f in _TEXT_FIELDS]
    parts.append(" ".join(doc.focus_areas or []))
    return " ".join(p for p in parts if p).strip()


def _validate(*, doc_kind: str | None, status: str | None, period_from: date | None, period_to: date | None) -> None:
    errors = []
    if doc_kind is not None and doc_kind not in DOC_KINDS:
        errors.append({"field": "doc_kind", "code": "invalid_enum"})
    if status is not None and status not in ("active", "archived"):
        errors.append({"field": "status", "code": "invalid_enum"})
    if period_from and period_to and period_from > period_to:
        errors.append({"field": "period_to", "code": "invalid_range"})
    if errors:
        raise AppError(422, "validation_error", detail="入力内容を確認してください", errors=errors)


def _detail(ts, doc) -> dict:
    creator = ts.get(User, doc.created_by_id)
    return {
        "id": str(doc.id), "title": doc.title, "doc_kind": doc.doc_kind,
        "intent": doc.intent, "policy_commitment": doc.policy_commitment, "strategy": doc.strategy,
        "focus_areas": list(doc.focus_areas or []), "objectives": doc.objectives, "body_md": doc.body_md,
        "period_from": doc.period_from, "period_to": doc.period_to, "status": doc.status,
        "created_by": (creator.display_name if creator else None),
        "created_at": doc.created_at, "updated_at": doc.updated_at,
    }


def _related_curated_info(ts, doc, company) -> tuple[list[dict], int, float]:
    """当該資料とトークン関連度が閾値以上の curated（非アーカイブ）情報＝`([{id,title,impact_class,score}], 全curated数, 閾値)`。

    関連度＝`derive.token_cosine`（決定的）。閾値は会社別 `auto_link_threshold`（N.6 と同じ「効いている」基準を流用・
    既定 0.12）。R.4（影響率/機会率/脅威率）と R.5（Markdown export）で共用（DRY）。score 降順。
    """
    from app.tenant.info import application as info_app  # 遅延 import（DRY・循環回避）
    from app.tenant.info import derive
    from app.tenant.info import repository as info_repo
    from app.tenant.tokens import repository as tokens_repo

    threshold = info_app.auto_link_threshold_of(company)
    curated = info_repo.curated_impact(ts)  # [(info_id, title, impact_class), …]
    info_total = len(curated)
    doc_tokens = tokens_repo.tokens_for(ts, "strategy_doc", doc.id)
    if info_total == 0 or not doc_tokens:
        return [], info_total, threshold
    info_tokens = tokens_repo.tokens_for_owners(ts, "info", [iid for iid, _, _ in curated])
    related: list[dict] = []
    for iid, title, klass in curated:
        score = derive.token_cosine(doc_tokens, info_tokens.get(iid, []))
        if score >= threshold:
            related.append({"id": str(iid), "title": title, "impact_class": klass, "score": round(score, 3)})
    related.sort(key=lambda r: r["score"], reverse=True)
    return related, info_total, threshold


def _impact_rates(ts, doc, company) -> dict:
    """経営資料への情報の影響サマリ（R.4・詳細 read 同梱・決定的・設計 §4.2）。母集団 0 でもゼロ除算せず全 0 を返す。"""
    related, info_total, threshold = _related_curated_info(ts, doc, company)
    related_count = len(related)
    base = {"info_total": info_total, "related_count": related_count,
            "opportunity_count": 0, "threat_count": 0,
            "impact_rate": 0.0, "opportunity_rate": 0.0, "threat_rate": 0.0,
            "threshold": round(threshold, 3)}
    if related_count == 0:
        return base
    opp = sum(1 for r in related if r["impact_class"] == "opportunity")
    thr = sum(1 for r in related if r["impact_class"] == "threat")
    return {
        **base,
        "impact_rate": round(related_count / info_total, 3),
        "opportunity_count": opp,
        "threat_count": thr,
        "opportunity_rate": round(opp / related_count, 3),
        "threat_rate": round(thr / related_count, 3),
    }


def _persist_tokens(ts, doc) -> None:
    """本文を entity_tokens／entity_embeddings（owner_type='strategy_doc'）へ同期（整合率の素材・§5.36b・A-2）。"""
    from app.tenant.info import application as info_app  # 遅延 import（derive+tokens_repo を再利用・DRY）
    info_app.persist_entity_tokens(ts, "strategy_doc", doc.id, doc.body_text)
    info_app.persist_entity_embedding(ts, "strategy_doc", doc.id, doc.body_text)  # 意味的一致の入力（A-2・FR-44）


def _list_item(doc) -> dict:
    return {
        "id": str(doc.id), "title": doc.title, "doc_kind": doc.doc_kind, "status": doc.status,
        "focus_areas": list(doc.focus_areas or []),
        "period_from": doc.period_from, "period_to": doc.period_to, "updated_at": doc.updated_at,
    }


# ---- 管理者 CRUD（R.1） ----

def create_document(account_id: uuid.UUID, company_id: uuid.UUID, *, body) -> dict:
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    _validate(doc_kind=body.doc_kind, status=None, period_from=body.period_from, period_to=body.period_to)
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        doc = repo.create_document(
            ts, created_by_id=user.id, title=body.title.strip(), doc_kind=body.doc_kind,
            intent=body.intent, policy_commitment=body.policy_commitment, strategy=body.strategy,
            focus_areas=body.focus_areas or [], objectives=body.objectives, body_md=body.body_md,
            period_from=body.period_from, period_to=body.period_to, status="active",
        )
        doc.body_text = _compose_body_text(doc)
        ts.flush()
        _persist_tokens(ts, doc)
        payload = _detail(ts, doc)
        ts.commit()
    return payload


def list_documents(account_id: uuid.UUID, company_id: uuid.UUID, *, q, status, doc_kind, sort, page, per_page) -> dict:
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    page = max(1, page or 1)
    per_page = min(100, max(1, per_page or 20))
    with get_tenant_session(company.db_identifier) as ts:
        rows, total = repo.list_documents(ts, q=q, status=status, doc_kind=doc_kind, sort=sort, page=page, per_page=per_page)
        return {
            "data": [_list_item(d) for d in rows],
            "page_info": {"page": page, "per_page": per_page, "total": total, "has_next": page * per_page < total},
        }


def get_document(account_id: uuid.UUID, company_id: uuid.UUID, doc_id: str) -> dict:
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    did = _parse_uuid(doc_id)
    with get_tenant_session(company.db_identifier) as ts:
        doc = repo.get_document(ts, did)
        if doc is None:
            raise AppError(404, "not_found")
        payload = _detail(ts, doc)
        payload["impact"] = _impact_rates(ts, doc, company)  # 影響率/機会率/脅威率を同梱（R.4）
        return payload


def _word_cloud(ts, doc, company, *, limit: int = 40) -> dict:
    """この方針まわりの語像（R.4b・設計§7＝集約でのみ UI 化）＝関連情報（R.4 母集団）＋関連アイデア（idea_alignment）
    ＋関連コンセプト（トークン重なり）の entity_tokens を頻度集約。weight は最頻値を 1.0 とした正規化。母集団 0 は空。
    """
    from app.tenant.strategy import export as export_mod
    from app.tenant.tokens import repository as tokens_repo

    related_info, _total, _threshold = _related_curated_info(ts, doc, company)
    info_ids = [uuid.UUID(r["id"]) for r in related_info]
    idea_ids = repo.idea_ids_for_doc(ts, doc.id)
    concept_ids = [cid for cid, _score in export_mod.related_concept_ids(ts, doc, company, limit=100)]

    agg: dict[str, int] = {}
    for owner_type, ids in (("info", info_ids), ("idea", idea_ids), ("concept", concept_ids)):
        for _oid, toks in tokens_repo.tokens_for_owners(ts, owner_type, ids).items():
            for token, count in toks:
                agg[token] = agg.get(token, 0) + int(count)
    items = sorted(agg.items(), key=lambda kv: (-kv[1], kv[0]))[:limit]
    max_c = items[0][1] if items else 0
    tokens = [{"token": t, "count": c, "weight": round(c / max_c, 3) if max_c else 0.0} for t, c in items]
    return {"tokens": tokens, "related_count": len(info_ids) + len(idea_ids) + len(concept_ids)}


def word_cloud(account_id: uuid.UUID, company_id: uuid.UUID, doc_id: str) -> dict:
    """この方針まわりの語像を返す（R.4b・管理者スコープ・read）。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    did = _parse_uuid(doc_id)
    with get_tenant_session(company.db_identifier) as ts:
        doc = repo.get_document(ts, did)
        if doc is None:
            raise AppError(404, "not_found")
        return _word_cloud(ts, doc, company)


def export_markdown(account_id: uuid.UUID, company_id: uuid.UUID, doc_id: str) -> str:
    """経営資料＋関連（アイデア/情報/コンセプト）を構造化 Markdown で返す（R.5・AI 用・外部送信しない）。"""
    from app.tenant.strategy import export as export_mod

    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    did = _parse_uuid(doc_id)
    with get_tenant_session(company.db_identifier) as ts:
        doc = repo.get_document(ts, did)
        if doc is None:
            raise AppError(404, "not_found")
        related, _total, _threshold = _related_curated_info(ts, doc, company)
        return export_mod.build_markdown(ts, doc, company, related)


def generate_iso(account_id: uuid.UUID, company_id: uuid.UUID, doc_id: str) -> dict:
    """Phase2 in-app 生成（FR-44 Phase2・設計 §8）＝経営資料＋関連の構造化 Markdown を文脈に
    AIジョブ基盤（FR-45）へ `iso_generate` を投入。文脈は本層（strategy）で用意し input に載せる
    （worker は strategy 非依存のまま・LLM 物理は基盤に閉じる＝データ主権）。202＝{id, status}。"""
    from app.tenant.ai_jobs import application as ai_jobs
    from app.tenant.strategy import export as export_mod

    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    did = _parse_uuid(doc_id)
    with get_tenant_session(company.db_identifier) as ts:
        doc = repo.get_document(ts, did)
        if doc is None:
            raise AppError(404, "not_found")
        related, _total, _threshold = _related_curated_info(ts, doc, company)
        context_md = export_mod.build_markdown(ts, doc, company, related)
    return ai_jobs.enqueue(account_id, company_id, task_type="iso_generate",
                           input={"context_md": context_md, "strategy_document_id": str(did)},
                           ref_strategy_document_id=did)


def latest_generation(company_id: uuid.UUID, doc_id: str) -> dict | None:
    """この経営資料の最新 iso_generate ジョブ（状態＋生成テキスト）。SC-81 の生成表示用。"""
    from app.tenant.ai_jobs import application as ai_jobs

    return ai_jobs.latest_generation(company_id, task_type="iso_generate",
                                     ref_strategy_document_id=_parse_uuid(doc_id))


def update_document(account_id: uuid.UUID, company_id: uuid.UUID, doc_id: str, *, body) -> dict:
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    did = _parse_uuid(doc_id)
    data = body.model_dump(exclude_unset=True)
    _validate(doc_kind=data.get("doc_kind"), status=data.get("status"),
              period_from=data.get("period_from"), period_to=data.get("period_to"))
    with get_tenant_session(company.db_identifier) as ts:
        doc = repo.get_document(ts, did)
        if doc is None:
            raise AppError(404, "not_found")
        for field, value in data.items():
            setattr(doc, field, value)
        doc.body_text = _compose_body_text(doc)
        doc.updated_at = datetime.now(timezone.utc)
        ts.flush()
        _persist_tokens(ts, doc)  # 本文変更でトークン再永続化（整合率へ反映）
        # 本文変更＝この資料を適用中の各クエストの配下アイデアの整合率を再計算（コインは維持・R.2）。
        from app.tenant.strategy import alignment as strat_align
        for qid in repo.quest_ids_for_doc(ts, did):
            strat_align.recompute_for_quest(ts, qid, company=company)
        payload = _detail(ts, doc)
        ts.commit()
    return payload


def recompute_all_for_company(company) -> int:
    """会社の整合方式/しきい値を変更した時＝資料が紐づく全クエストの配下公開アイデアを再計算し、

    上がってティアを越えた分だけ**差分コインを付与**（初回超えのみ・下げない・R.3・ユーザー合意 2026-09-29）。
    戻り値＝再計算したクエスト数（監査/ログ用）。埋め込み未生成のアイデアは keyword フォールバックで算出される。
    """
    from app.tenant.strategy import alignment as strat_align
    if company is None:
        return 0
    n = 0
    with get_tenant_session(company.db_identifier) as ts:
        for qid in repo.all_linked_quest_ids(ts):
            strat_align.recompute_for_quest(ts, qid, company=company, award=True)
            n += 1
        ts.commit()
    return n


def archive_document(account_id: uuid.UUID, company_id: uuid.UUID, doc_id: str) -> dict:
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    did = _parse_uuid(doc_id)
    with get_tenant_session(company.db_identifier) as ts:
        doc = repo.get_document(ts, did)
        if doc is None:
            raise AppError(404, "not_found")
        doc.status = "archived"
        doc.updated_at = datetime.now(timezone.utc)
        payload = _detail(ts, doc)
        ts.commit()
    return payload


def unarchive_document(account_id: uuid.UUID, company_id: uuid.UUID, doc_id: str) -> dict:
    """アーカイブ解除（archived→active・R.1）＝クエストの選択候補に戻す（誤アーカイブの復元）。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    did = _parse_uuid(doc_id)
    with get_tenant_session(company.db_identifier) as ts:
        doc = repo.get_document(ts, did)
        if doc is None:
            raise AppError(404, "not_found")
        doc.status = "active"
        doc.updated_at = datetime.now(timezone.utc)
        payload = _detail(ts, doc)
        ts.commit()
    return payload


# 物理削除は設けない（プロジェクト慣例＝基本は論理削除。経営資料は機微・監査保持のためアーカイブ＝§5.54/§R.1）。
# 使わなくする＝archive_document（status=archived）／戻す＝unarchive_document。


# ---- 選択用一覧（R.0・クエスト作成者） ----

def selection_list(account_id: uuid.UUID, company_id: uuid.UUID, *, q) -> dict:
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        rows = repo.selection_list(ts, q=q)
        return {"data": [
            {"id": str(d.id), "title": d.title, "doc_kind": d.doc_kind,
             "period_from": d.period_from, "period_to": d.period_to}
            for d in rows
        ]}


# ---- クエスト↔経営資料リンク（R.1b・§5.56・版履歴＝quest_revision） ----

def _quest_link_item(row) -> dict:
    # row=(id, title, status, deadline, owner_name, created_at, icon_image_path)
    from app.infra.storage import get_storage
    icon_path = row[6] if len(row) > 6 else None
    return {
        "id": str(row[0]), "title": row[1], "status": row[2],
        "deadline": row[3] if len(row) > 3 else None,
        "owner_name": row[4] if len(row) > 4 else None,
        "created_at": row[5] if len(row) > 5 else None,
        # クエストアイコン＝保存キー→短TTL 署名URL（ピッカー行頭表示・未設定は null＝頭文字タイル）。
        "icon_image_url": get_storage().presigned_get(icon_path) if icon_path else None,
    }


def quest_candidates(account_id: uuid.UUID, company_id: uuid.UUID, *, q, statuses=None,
                     deadline_from=None, deadline_to=None) -> dict:
    """紐づけ候補＝全社の有効クエスト（管理者・R.0）＝タイトル/ステータス/期限で絞り込み。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        rows = repo.quest_candidates(ts, q=q, statuses=statuses, deadline_from=deadline_from, deadline_to=deadline_to)
        return {"data": [_quest_link_item(r) for r in rows]}


def linked_quests(account_id: uuid.UUID, company_id: uuid.UUID, doc_id: str) -> dict:
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    did = _parse_uuid(doc_id)
    with get_tenant_session(company.db_identifier) as ts:
        if repo.get_document(ts, did) is None:
            raise AppError(404, "not_found")
        return {"data": [_quest_link_item(r) for r in repo.quests_for_doc(ts, did)]}


def add_quest_links(account_id: uuid.UUID, company_id: uuid.UUID, doc_id: str, *, quest_ids) -> dict:
    """経営資料にクエストを紐づける（複数可）。追加ごとに当該クエストの版を1件記録（版履歴・§3.1）。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    did = _parse_uuid(doc_id)
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        if repo.get_document(ts, did) is None:
            raise AppError(404, "not_found")
        from app.tenant.quests import application as quests_app
        from app.tenant.quests import repository as quests_repo
        from app.tenant.strategy import alignment as strat_align
        for raw in quest_ids:
            qid = _parse_uuid(raw)
            quest = quests_repo.get_quest(ts, qid)
            if quest is None or quest.deleted_at is not None:
                continue  # 無効クエストはスキップ（存在秘匿）
            if repo.add_quest_link(ts, did, qid):
                quests_app._record_quest_revision_if_changed(ts, quest, user.id)  # 適用資料の変更＝版履歴
                strat_align.recompute_for_quest(ts, qid)  # 配下アイデアの整合率を再計算（コインは維持・R.3）
        payload = {"data": [_quest_link_item(r) for r in repo.quests_for_doc(ts, did)]}
        ts.commit()
    return payload


def remove_quest_link(account_id: uuid.UUID, company_id: uuid.UUID, doc_id: str, quest_id: str) -> dict:
    """経営資料からクエストの紐づけを解除。解除で当該クエストの版を1件記録（版履歴）。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    did = _parse_uuid(doc_id)
    qid = _parse_uuid(quest_id)
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        if repo.get_document(ts, did) is None:
            raise AppError(404, "not_found")
        from app.tenant.quests import application as quests_app
        from app.tenant.quests import repository as quests_repo
        from app.tenant.strategy import alignment as strat_align
        quest = quests_repo.get_quest(ts, qid)
        repo.remove_quest_link(ts, did, qid)
        if quest is not None:
            quests_app._record_quest_revision_if_changed(ts, quest, user.id)  # 適用資料の変更＝版履歴
            strat_align.recompute_for_quest(ts, qid)  # 配下アイデアの整合率を再計算（母集合から外す・R.3）
        payload = {"data": [_quest_link_item(r) for r in repo.quests_for_doc(ts, did)]}
        ts.commit()
    return payload


def _parse_uuid(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError):
        raise AppError(404, "not_found")
