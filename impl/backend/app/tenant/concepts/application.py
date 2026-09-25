"""ドメイン P（コンセプト）の application（imperative shell・P.1/P.2）。

門番＝当該クエストのパーティー所属（P.0＝`quests_repo.can_access_quest`）。draft は本人のみ可視。
作成＝パーティー員（既定 draft・作成時に総合ルーム `overall` を自動生成）。編集＝作成者＋owner/quest_admin。
活性化/保管・選定・総合判定＝owner/quest_admin。完了クエスト（completed）は書き込み凍結（409・C.5）。
本層は UoW 境界（commit）を持ち、認可・状態機械を強制する。
"""
from __future__ import annotations

import uuid

from app.control_plane.auth.orm import Company
from app.core.errors import AppError
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.concepts import repository as repo
from app.tenant.ideas import repository as ideas_repo
from app.tenant.profile import repository as profile_repo
from app.tenant.quests import repository as quests_repo


def _resolve_company(company_id: uuid.UUID) -> Company | None:
    with control_session() as s:
        return s.get(Company, company_id)


def _parse_uuid(value: str, *, field: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except (ValueError, AttributeError, TypeError):
        raise AppError(422, "validation_error", detail=f"{field} が不正です", errors=[{"field": field}])


def _ctx(account_id, company_id):
    """会社解決＋テナントセッション用の db_identifier とユーザーを返す薄いヘルパ。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    return company


def _get_user(ts, account_id):
    user = profile_repo.get_user_by_account(ts, account_id)
    if user is None:
        raise AppError(401, "unauthenticated")
    return user


# ---- 認可ヘルパ -----------------------------------------------------------

def _require_quest_access(ts, quest, user) -> None:
    if quest is None or not quests_repo.can_access_quest(ts, quest, user.id):
        raise AppError(404, "not_found")  # アクセス条件外は秘匿（P.0）


def _perms_of(ts, quest, user) -> list[str]:
    member = quests_repo.get_active_member(ts, quest.id, user.id) if quest is not None else None
    return quests_repo.get_permissions(ts, member.id) if member is not None else []


def _is_owner(quest, user) -> bool:
    return quest is not None and quest.owner_id == user.id


def _is_manager(ts, quest, user) -> bool:
    return _is_owner(quest, user) or "quest_admin" in _perms_of(ts, quest, user)


def _require_manager(ts, quest, user, *, action: str) -> None:
    if not _is_manager(ts, quest, user):
        raise AppError(403, "forbidden", detail=f"{action}の権限がありません")


def _guard_not_completed(quest) -> None:
    if quest is not None and quest.status == "completed":
        raise AppError(409, "conflict", detail="完了後は変更できません", extra={"errors": [{"reason": "invalid_state"}]})


def _resolve_concept(ts, cid, user, *, for_write: bool = False):
    """コンセプト＋クエストを解決し門番＋draft 可視性を適用。無い/不可視は 404（存在秘匿）。"""
    concept = repo.get_concept(ts, cid)
    if concept is None:
        raise AppError(404, "not_found")
    quest = quests_repo.get_quest(ts, concept.quest_id)
    _require_quest_access(ts, quest, user)
    # draft は本人のみ可視（他者には存在秘匿）。
    if concept.status == "draft" and concept.author_id != user.id:
        raise AppError(404, "not_found")
    return concept, quest


def _my_permissions(ts, concept, quest, user) -> list[str]:
    perms: list[str] = []
    if concept.author_id == user.id or _is_manager(ts, quest, user):
        perms.append("edit")
    if _is_manager(ts, quest, user):
        perms.append("manage")  # 活性化/保管・選定・総合判定
    if _is_owner(quest, user) or "evaluator" in _perms_of(ts, quest, user):
        perms.append("evaluate")
    return perms


def _validate_source_ideas(ts, quest_id: uuid.UUID, source_idea_ids: list[str]) -> list[uuid.UUID]:
    """由来アイデア＝同一クエストの公開アイデアのみ許可（スコープ境界・§1.1）。不正は 422。"""
    resolved: list[uuid.UUID] = []
    for raw in source_idea_ids:
        iid = _parse_uuid(raw, field="source_idea_ids")
        idea = ideas_repo.get_idea(ts, iid)
        if idea is None or idea.quest_id != quest_id or idea.status != "published":
            raise AppError(422, "validation_error", detail="由来アイデアは同一クエストの公開アイデアのみ",
                           errors=[{"field": "source_idea_ids"}])
        resolved.append(iid)
    return resolved


# ---- 取得（P.1） ----------------------------------------------------------

def get_detail(account_id, company_id, concept_id) -> dict:
    company = _ctx(account_id, company_id)
    cid = _parse_uuid(concept_id, field="concept_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = _get_user(ts, account_id)
        concept, quest = _resolve_concept(ts, cid, user)
        return _detail_payload(ts, concept, quest, user)


def list_for_quest(account_id, company_id, quest_id) -> dict:
    company = _ctx(account_id, company_id)
    qid = _parse_uuid(quest_id, field="quest_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = _get_user(ts, account_id)
        quest = quests_repo.get_quest(ts, qid)
        _require_quest_access(ts, quest, user)
        items = []
        for c in repo.list_concepts_for_quest(ts, qid):
            # 可視性＝active/archived は全員／draft は本人のみ。
            if c.status == "draft" and c.author_id != user.id:
                continue
            items.append(_list_item(ts, c))
        return {"items": items, "cursor": None}


# ---- 登録・編集・遷移・選定・判定（P.2） ----------------------------------

def create(account_id, company_id, quest_id, *, body) -> dict:
    company = _ctx(account_id, company_id)
    qid = _parse_uuid(quest_id, field="quest_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = _get_user(ts, account_id)
        quest = quests_repo.get_quest(ts, qid)
        _require_quest_access(ts, quest, user)  # 作成＝パーティー員
        _guard_not_completed(quest)
        source_ids = _validate_source_ideas(ts, qid, body.source_idea_ids)
        concept = repo.create_concept(
            ts, quest_id=qid, author_id=user.id, title=body.title,
            problem=body.problem, value_proposition=body.value_proposition, target=body.target,
            differentiation=body.differentiation, solution_form=body.solution_form, viability=body.viability,
        )
        if source_ids:
            repo.set_source_ideas(ts, concept.id, source_ids)
        # 作成時に総合ルーム（overall）を自動生成（§3.7・P.2）。
        repo.create_chat_scope(ts, concept_id=concept.id, kind="overall", position=0)
        quest_obj, user_obj = quest, user
        payload = _detail_payload(ts, concept, quest_obj, user_obj)
        ts.commit()
        return payload


def patch(account_id, company_id, concept_id, *, body) -> dict:
    company = _ctx(account_id, company_id)
    cid = _parse_uuid(concept_id, field="concept_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = _get_user(ts, account_id)
        concept, quest = _resolve_concept(ts, cid, user, for_write=True)
        if not (concept.author_id == user.id or _is_manager(ts, quest, user)):
            raise AppError(403, "forbidden", detail="編集の権限がありません")
        _guard_not_completed(quest)
        data = body.model_dump(exclude_unset=True)
        if "source_idea_ids" in data and data["source_idea_ids"] is not None:
            source_ids = _validate_source_ideas(ts, concept.quest_id, data.pop("source_idea_ids"))
            repo.set_source_ideas(ts, concept.id, source_ids)
        else:
            data.pop("source_idea_ids", None)
        for field in ("title", "problem", "value_proposition", "target", "differentiation", "solution_form", "viability"):
            if field in data and data[field] is not None:
                setattr(concept, field, data[field])
        ts.flush()
        payload = _detail_payload(ts, concept, quest, user)
        ts.commit()
        return payload


def set_status(account_id, company_id, concept_id, *, target: str) -> dict:
    """activate（draft→active）／archive（active→archived）。owner/quest_admin のみ。"""
    company = _ctx(account_id, company_id)
    cid = _parse_uuid(concept_id, field="concept_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = _get_user(ts, account_id)
        # activate は draft を対象にするため、可視性は author/manager 双方に開ける必要がある。
        concept = repo.get_concept(ts, cid)
        if concept is None:
            raise AppError(404, "not_found")
        quest = quests_repo.get_quest(ts, concept.quest_id)
        _require_quest_access(ts, quest, user)
        _require_manager(ts, quest, user, action="状態変更")
        _guard_not_completed(quest)
        concept.status = target
        ts.flush()
        payload = _detail_payload(ts, concept, quest, user)
        ts.commit()
        return payload


def set_selected(account_id, company_id, concept_id, *, selected: bool) -> dict:
    company = _ctx(account_id, company_id)
    cid = _parse_uuid(concept_id, field="concept_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = _get_user(ts, account_id)
        concept, quest = _resolve_concept(ts, cid, user, for_write=True)
        _require_manager(ts, quest, user, action="選定")
        _guard_not_completed(quest)
        concept.is_selected = selected
        ts.flush()
        result = {"id": str(concept.id), "is_selected": concept.is_selected}
        ts.commit()
        return result


def set_decision(account_id, company_id, concept_id, *, decision: str, decision_rationale: str | None) -> dict:
    company = _ctx(account_id, company_id)
    cid = _parse_uuid(concept_id, field="concept_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = _get_user(ts, account_id)
        concept, quest = _resolve_concept(ts, cid, user, for_write=True)
        _require_manager(ts, quest, user, action="総合判定")
        _guard_not_completed(quest)
        concept.decision = decision
        concept.decision_rationale = decision_rationale
        ts.flush()
        payload = _detail_payload(ts, concept, quest, user)
        ts.commit()
        return payload


def soft_delete(account_id, company_id, concept_id) -> None:
    company = _ctx(account_id, company_id)
    cid = _parse_uuid(concept_id, field="concept_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = _get_user(ts, account_id)
        concept, quest = _resolve_concept(ts, cid, user, for_write=True)
        if not (concept.author_id == user.id or _is_manager(ts, quest, user)):
            raise AppError(403, "forbidden", detail="削除の権限がありません")
        _guard_not_completed(quest)
        repo.soft_delete_concept(ts, concept, deleted_by_id=user.id)
        ts.commit()


# ---- payload 構築 ---------------------------------------------------------

def _eval_summary(ts, concept_id) -> dict:
    agg = repo.aggregate_scores(ts, concept_id)
    return {
        "aspects": agg["aspects"], "overall_avg": agg["overall_avg"],
        "evaluator_count": agg["evaluator_count"], "recommendations": agg["recommendations"],
    }


def _list_item(ts, c) -> dict:
    return {
        "id": str(c.id), "title": c.title, "status": c.status, "decision": c.decision,
        "is_selected": c.is_selected,
        "source_idea_count": len(repo.list_source_idea_ids(ts, c.id)),
        "assumption_count": len(repo.list_links_for_concept(ts, c.id)),
        "eval_summary": _eval_summary(ts, c.id),
        "author_id": str(c.author_id), "updated_at": c.updated_at,
    }


def _detail_payload(ts, concept, quest, user) -> dict:
    source_ideas = []
    for iid in repo.list_source_idea_ids(ts, concept.id):
        idea = ideas_repo.get_idea(ts, iid)
        source_ideas.append({"idea_id": str(iid), "title": idea.title if idea else None})
    assumptions = []
    for link in repo.list_links_for_concept(ts, concept.id):
        a = repo.get_assumption(ts, link.assumption_id)
        if a is None:
            continue
        assumptions.append({
            "assumption_id": str(a.id), "statement": a.statement, "criticality": link.criticality,
            "is_stale": link.is_stale, "current_verdict": a.current_verdict,
        })
    chat_scopes = [
        {"scope_id": str(s.id), "kind": s.kind, "label": s.label,
         "assumption_id": str(s.assumption_id) if s.assumption_id else None, "position": s.position}
        for s in repo.list_chat_scopes(ts, concept.id)
    ]
    return {
        "id": str(concept.id), "quest_id": str(concept.quest_id), "author_id": str(concept.author_id),
        "title": concept.title, "problem": concept.problem, "value_proposition": concept.value_proposition,
        "target": concept.target, "differentiation": concept.differentiation, "solution_form": concept.solution_form,
        "viability": concept.viability or {}, "decision": concept.decision,
        "decision_rationale": concept.decision_rationale, "status": concept.status,
        "is_selected": concept.is_selected, "current_revision": concept.current_revision,
        "source_ideas": source_ideas, "assumptions": assumptions,
        "evaluation": _eval_summary(ts, concept.id), "chat_scopes": chat_scopes,
        "related_info": [], "my_permissions": _my_permissions(ts, concept, quest, user),
        "updated_at": concept.updated_at,
    }
