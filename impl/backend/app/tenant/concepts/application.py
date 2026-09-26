"""ドメイン P（コンセプト）の application（imperative shell・P.1/P.2）。

門番＝当該クエストのパーティー所属（P.0＝`quests_repo.can_access_quest`）。draft は本人のみ可視。
作成＝パーティー員（既定 draft・作成時に総合ルーム `overall` を自動生成）。編集＝作成者＋owner/quest_admin。
活性化/保管・選定・総合判定＝owner/quest_admin。完了クエスト（completed）は書き込み凍結（409・C.5）。
本層は UoW 境界（commit）を持ち、認可・状態機械を強制する。
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from app.control_plane.auth.orm import Company
from app.core.errors import AppError
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.concepts import repository as repo
from app.tenant.gamification import ledger
from app.tenant.gamification import repository as gami_repo
from app.tenant.gamification.daily import jst_day_bounds_utc
from app.tenant.ideas import repository as ideas_repo
from app.tenant.profile import repository as profile_repo
from app.tenant.quests import repository as quests_repo
from app.tenant._shared import revisions as rev_shared

_XP_VOTE = 5
_VOTE_XP_DAILY_CAP = 5
_RECOMMENDATIONS = ("go", "pivot", "kill")


def _resolve_company(company_id: uuid.UUID) -> Company | None:
    with control_session() as s:
        return s.get(Company, company_id)


def _image_url(path: str | None) -> str | None:
    from app.infra.storage import get_storage

    return get_storage().presigned_get(path) if path else None


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
    # 素の当該クエスト権限（comment/vote/idea_create/quest_admin/evaluator 等）を土台に合成。
    # アイデア詳細と同型＝チャット投稿(comment)/ピン(owner/quest_admin) はこの素の権限で駆動する。
    perms: list[str] = list(_perms_of(ts, quest, user))
    if _is_owner(quest, user) and "owner" not in perms:
        perms.append("owner")  # ピン権限（owner/quest_admin）の素・チャット中核と共通
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
        _snapshot_revision(ts, concept, user.id, 1)  # 初版（変更履歴標準 §3.1）
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
        before = _content_snapshot(ts, concept)  # 変更検出（無変更は版を作らない・§3.1）
        for field in ("title", "problem", "value_proposition", "target", "differentiation", "solution_form", "viability"):
            if field in data and data[field] is not None:
                setattr(concept, field, data[field])
        ts.flush()
        after = _content_snapshot(ts, concept)
        if rev_shared.changed_fields(before, after, CONCEPT_REVISION_FIELDS):
            next_rev = concept.current_revision + 1
            _snapshot_revision(ts, concept, user.id, next_rev)
            concept.current_revision = next_rev
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
        # 公開（活性化）＝作成者＋owner/quest_admin（アイデアの publish と同型）。保管＝owner/quest_admin のみ。
        if target == "active":
            if not (concept.author_id == user.id or _is_manager(ts, quest, user)):
                raise AppError(403, "forbidden", detail="公開の権限がありません")
        else:
            _require_manager(ts, quest, user, action="保管")
        _guard_not_completed(quest)
        old_status = concept.status
        concept.status = target
        ts.flush()
        if old_status != target:  # ステータス遷移を意思決定ログに追記（§3.2）
            _record_decision_log(ts, concept, "status", old_status, target, user.id)
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
        old_decision = concept.decision
        concept.decision = decision
        concept.decision_rationale = decision_rationale
        ts.flush()
        if old_decision != decision:  # 総合判定の変遷を意思決定ログに追記（理由・判断材料も凍結・§3.2/§3.3）
            _record_decision_log(ts, concept, "decision", old_decision, decision, user.id, reason=decision_rationale)
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


# ---- 変更履歴（内容の版・意思決定ログ・§3.1/§3.2） ------------------------------

# 版で追跡する対象フィールド（成果物スキーマ・共通エンジン _shared.revisions へ渡す仕様）。
# テキスト系＝語句差分／viability（jsonb）＝{old,new}（JSON 文字列で表示）。
CONCEPT_REVISION_FIELDS = (
    rev_shared.FieldSpec("title", "text"),
    rev_shared.FieldSpec("problem", "text"),
    rev_shared.FieldSpec("value_proposition", "text"),
    rev_shared.FieldSpec("target", "text"),
    rev_shared.FieldSpec("differentiation", "text"),
    rev_shared.FieldSpec("solution_form", "text"),
    rev_shared.FieldSpec("viability", "scalar", scalar_fmt=lambda v: _json_compact(v)),
)


def _json_compact(value) -> str:
    import json
    if not value:
        return ""
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def _content_snapshot(ts, concept) -> dict:
    """版に保存する内容フィールドのスナップショット（§3.1）。"""
    return {
        "title": concept.title, "problem": concept.problem, "value_proposition": concept.value_proposition,
        "target": concept.target, "differentiation": concept.differentiation,
        "solution_form": concept.solution_form, "viability": concept.viability or {},
    }


def _context_snapshot(ts, concept) -> dict:
    """判断材料の数値サマリ（§3.3）＝投票集計・評価集計・前提の検証状況。その版/判断の当時の材料を凍結。"""
    vc = repo.count_votes(ts, concept.id)
    agg = repo.aggregate_scores(ts, concept.id)
    verdicts = repo.verdict_counts_for_concept(ts, concept.id)
    return {
        "votes": {"approve": vc.get("approve", 0), "oppose": vc.get("oppose", 0)},
        "eval": {"evaluator_count": agg.get("evaluator_count", 0), "overall_avg": agg.get("overall_avg")},
        "assumptions": {
            "supported": verdicts.get("supported", 0),
            "refuted": verdicts.get("refuted", 0),
            "inconclusive": verdicts.get("inconclusive", 0),
        },
    }


def _snapshot_revision(ts, concept, editor_id, revision, *, memo=None) -> None:
    """内容の版を1件記録（スナップショット＋判断材料・§3.1）。"""
    repo.add_revision(ts, concept.id, revision=revision, editor_id=editor_id,
                      changes=_content_snapshot(ts, concept), memo=memo,
                      context_snapshot=_context_snapshot(ts, concept))


def _record_decision_log(ts, concept, kind, from_value, to_value, actor_id, *, reason=None) -> None:
    """意思決定/ステータスの遷移を追記（判断材料も凍結・§3.2）。"""
    repo.add_decision_log(ts, concept.id, kind=kind, from_value=from_value, to_value=to_value,
                          actor_id=actor_id, reason=reason, context_snapshot=_context_snapshot(ts, concept))


def _editor_dto(user) -> dict:
    return {
        "user_id": str(user.id) if user else None,
        "display_name": user.display_name if user else None,
        "avatar_image_url": _image_url(user.avatar_image_path) if user else None,
    }


def get_revisions(account_id, company_id, concept_id, *, limit=50, cursor=None) -> dict:
    """版タイムライン（SC-61 更新履歴・§3.1）。門番＝コンセプト可視性。"""
    company = _ctx(account_id, company_id)
    cid = _parse_uuid(concept_id, field="concept_id")
    cur = rev_shared.decode_revision_cursor(cursor) if cursor else None
    with get_tenant_session(company.db_identifier) as ts:
        user = _get_user(ts, account_id)
        concept, _quest = _resolve_concept(ts, cid, user)
        rows = repo.list_revisions(ts, concept.id, cursor=cur, limit=limit + 1)
        has_next = len(rows) > limit
        rows = rows[:limit]
        editors = quests_repo.get_users_by_ids(ts, {r.editor_id for r in rows})
        data = []
        for r in rows:
            prev = repo.get_revision(ts, concept.id, r.revision - 1) if r.revision > 1 else None
            data.append({
                "revision": r.revision,
                "editor": _editor_dto(editors.get(r.editor_id)),
                "created_at": r.created_at,
                "changed_fields": rev_shared.changed_fields(prev.changes if prev else None, r.changes, CONCEPT_REVISION_FIELDS),
                "memo": r.memo,
                "context_snapshot": r.context_snapshot,
            })
        next_cursor = rev_shared.encode_revision_cursor(rows[-1].revision) if has_next and rows else None
    return {"data": data, "page_info": {"next_cursor": next_cursor, "has_next": has_next}}


def get_revision_diff(account_id, company_id, concept_id, revision, *, from_revision=None) -> dict:
    """版の差分（SC-61・§3.1）。既定＝前版（revision-1）と比較。範囲外 404/422。"""
    company = _ctx(account_id, company_id)
    cid = _parse_uuid(concept_id, field="concept_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = _get_user(ts, account_id)
        concept, _quest = _resolve_concept(ts, cid, user)
        to_rev = repo.get_revision(ts, concept.id, revision)
        if to_rev is None:
            raise AppError(404, "not_found")
        frm = from_revision if from_revision is not None else revision - 1
        if frm > revision:
            raise AppError(422, "validation_error", detail="from は revision 以下にしてください", errors=[{"field": "from"}])
        from_rev = repo.get_revision(ts, concept.id, frm) if frm >= 1 else None
        old = from_rev.changes if from_rev is not None else {}
        return {"from_revision": frm, "to_revision": revision, "fields": rev_shared.diff_fields(old, to_rev.changes, CONCEPT_REVISION_FIELDS)}


def get_decision_log(account_id, company_id, concept_id) -> dict:
    """意思決定/ステータスの遷移ログ（SC-61・§3.2）。門番＝コンセプト可視性。"""
    company = _ctx(account_id, company_id)
    cid = _parse_uuid(concept_id, field="concept_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = _get_user(ts, account_id)
        concept, _quest = _resolve_concept(ts, cid, user)
        rows = repo.list_decision_log(ts, concept.id)
        actors = quests_repo.get_users_by_ids(ts, {r.actor_id for r in rows})
        data = [{
            "kind": r.kind, "from_value": r.from_value, "to_value": r.to_value,
            "actor": _editor_dto(actors.get(r.actor_id)),
            "reason": r.reason, "context_snapshot": r.context_snapshot, "created_at": r.created_at,
        } for r in rows]
    return {"data": data}


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
    vc = repo.count_votes(ts, concept.id)
    my_vote = repo.get_vote(ts, concept.id, user.id)
    author_u = quests_repo.get_users_by_ids(ts, {concept.author_id}).get(concept.author_id)
    author = None
    if author_u is not None:
        author = {"user_id": str(author_u.id), "display_name": author_u.display_name,
                  "avatar_image_url": _image_url(author_u.avatar_image_path), "level": author_u.level}
    return {
        "id": str(concept.id), "quest_id": str(concept.quest_id), "author_id": str(concept.author_id), "author": author,
        "title": concept.title, "problem": concept.problem, "value_proposition": concept.value_proposition,
        "target": concept.target, "differentiation": concept.differentiation, "solution_form": concept.solution_form,
        "viability": concept.viability or {}, "decision": concept.decision,
        "decision_rationale": concept.decision_rationale, "status": concept.status,
        "is_selected": concept.is_selected, "current_revision": concept.current_revision,
        "source_ideas": source_ideas, "assumptions": assumptions,
        "evaluation": _eval_summary(ts, concept.id), "chat_scopes": chat_scopes,
        "related_info": [],
        "vote": {"summary": {"approve": vc.get("approve", 0), "oppose": vc.get("oppose", 0)},
                 "my_vote": my_vote.type if my_vote else None},
        "my_permissions": _my_permissions(ts, concept, quest, user),
        "updated_at": concept.updated_at,
    }


def get_related_info(account_id, company_id, concept_id, *, limit: int = 50) -> dict:
    """コンセプトの関連情報（SC-61・RelatedInfoPanel が叩く read EP・N.1 委譲の共通ビルダを流用）。"""
    from app.tenant.info import application as info_app

    company = _ctx(account_id, company_id)
    cid = _parse_uuid(concept_id, field="concept_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = _get_user(ts, account_id)
        concept, quest = _resolve_concept(ts, cid, user)
        can_dispose = concept.author_id == user.id or _is_manager(ts, quest, user)
        data = info_app.related_info_for_target(ts, "concepts", cid, limit=limit, can_dispose=can_dispose)
        return {"data": data}


# ---- 前提＝検証プール（P.3） -----------------------------------------------

def _resolve_assumption(ts, aid, user):
    """前提＋クエストを解決し門番（パーティー所属）を適用。無い/不可視は 404。"""
    assumption = repo.get_assumption(ts, aid)
    if assumption is None:
        raise AppError(404, "not_found")
    quest = quests_repo.get_quest(ts, assumption.quest_id)
    _require_quest_access(ts, quest, user)
    return assumption, quest


def _validation_dto(v) -> dict:
    return {
        "id": str(v.id), "method": v.method, "result": v.result, "verdict": v.verdict,
        "validated_on": v.validated_on, "scale": v.scale, "created_at": v.created_at,
    }


def _assumption_list_item(ts, a) -> dict:
    validations = repo.list_validations(ts, a.id)
    links = list(_links_for_assumption(ts, a.id))
    latest = validations[0].validated_on if validations else None
    return {
        "id": str(a.id), "statement": a.statement, "current_verdict": a.current_verdict,
        "validation_count": len(validations), "linked_concept_count": len(links), "latest_validated_on": latest,
    }


def _links_for_assumption(ts, assumption_id):
    from app.tenant.concepts.orm import ConceptAssumptionLink
    from sqlalchemy import select as _select
    return ts.execute(
        _select(ConceptAssumptionLink).where(ConceptAssumptionLink.assumption_id == assumption_id)
    ).scalars().all()


def _assumption_detail(ts, assumption, quest, user) -> dict:
    validations = [_validation_dto(v) for v in repo.list_validations(ts, assumption.id)]
    linked = []
    for link in _links_for_assumption(ts, assumption.id):
        c = repo.get_concept(ts, link.concept_id, include_deleted=True)
        if c is None:
            continue
        linked.append({"concept_id": str(c.id), "title": c.title,
                       "criticality": link.criticality, "is_stale": link.is_stale})
    perms = ["view"]
    if _is_manager(ts, quest, user):
        perms.append("curate")  # 前提の作成/検証/編集＝検証プール所有
    return {
        "id": str(assumption.id), "quest_id": str(assumption.quest_id), "statement": assumption.statement,
        "current_verdict": assumption.current_verdict, "validations": validations, "linked_concepts": linked,
        "related_info": [], "my_permissions": perms,
    }


def list_assumptions(account_id, company_id, quest_id) -> dict:
    company = _ctx(account_id, company_id)
    qid = _parse_uuid(quest_id, field="quest_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = _get_user(ts, account_id)
        quest = quests_repo.get_quest(ts, qid)
        _require_quest_access(ts, quest, user)
        items = [_assumption_list_item(ts, a) for a in repo.list_assumptions_for_quest(ts, qid)]
        return {"items": items, "cursor": None}


def create_assumption(account_id, company_id, quest_id, *, statement: str) -> dict:
    company = _ctx(account_id, company_id)
    qid = _parse_uuid(quest_id, field="quest_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = _get_user(ts, account_id)
        quest = quests_repo.get_quest(ts, qid)
        _require_quest_access(ts, quest, user)
        _require_manager(ts, quest, user, action="前提の作成")  # 検証プール所有
        _guard_not_completed(quest)
        a = repo.create_assumption(ts, quest_id=qid, statement=statement, created_by_id=user.id)
        payload = _assumption_detail(ts, a, quest, user)
        ts.commit()
        return payload


def get_assumption_detail(account_id, company_id, assumption_id) -> dict:
    company = _ctx(account_id, company_id)
    aid = _parse_uuid(assumption_id, field="assumption_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = _get_user(ts, account_id)
        assumption, quest = _resolve_assumption(ts, aid, user)
        return _assumption_detail(ts, assumption, quest, user)


def patch_assumption(account_id, company_id, assumption_id, *, statement: str) -> dict:
    company = _ctx(account_id, company_id)
    aid = _parse_uuid(assumption_id, field="assumption_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = _get_user(ts, account_id)
        assumption, quest = _resolve_assumption(ts, aid, user)
        _require_manager(ts, quest, user, action="前提の編集")
        _guard_not_completed(quest)
        assumption.statement = statement
        ts.flush()
        payload = _assumption_detail(ts, assumption, quest, user)
        ts.commit()
        return payload


def delete_assumption(account_id, company_id, assumption_id) -> None:
    company = _ctx(account_id, company_id)
    aid = _parse_uuid(assumption_id, field="assumption_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = _get_user(ts, account_id)
        assumption, quest = _resolve_assumption(ts, aid, user)
        _require_manager(ts, quest, user, action="前提の削除")
        _guard_not_completed(quest)
        if not repo.delete_assumption(ts, aid):
            raise AppError(409, "conflict", detail="リンク中の前提は削除できません（先に解除）",
                           extra={"errors": [{"reason": "linked"}]})
        ts.commit()


def add_validation(account_id, company_id, assumption_id, *, body) -> dict:
    """検証イベント追記（プール所有）。verdict=refuted は反証波及（リンク先を stale・P.7）。"""
    company = _ctx(account_id, company_id)
    aid = _parse_uuid(assumption_id, field="assumption_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = _get_user(ts, account_id)
        assumption, quest = _resolve_assumption(ts, aid, user)
        _require_manager(ts, quest, user, action="検証の記録")
        _guard_not_completed(quest)
        v = repo.add_validation(
            ts, assumption_id=aid, method=body.method, verdict=body.verdict,
            validated_on=body.validated_on, result=body.result, scale=body.scale, created_by_id=user.id,
        )
        affected: list[uuid.UUID] = []
        if body.verdict == "refuted":
            affected = repo.mark_links_stale_for_assumption(ts, aid)
            # 通知（H・作成者＋評価者へ「要再評価」）は後続スライスで結線（P.7・follow-up）。
        result = {
            "validation": _validation_dto(v),
            "current_verdict": repo.get_assumption(ts, aid).current_verdict,
            "stale_concept_ids": [str(c) for c in affected],
        }
        ts.commit()
        return result


def list_validations(account_id, company_id, assumption_id) -> dict:
    company = _ctx(account_id, company_id)
    aid = _parse_uuid(assumption_id, field="assumption_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = _get_user(ts, account_id)
        assumption, quest = _resolve_assumption(ts, aid, user)
        return {"items": [_validation_dto(v) for v in repo.list_validations(ts, aid)]}


# ---- コンセプト↔前提リンク（P.4） -----------------------------------------

def _require_concept_editor(ts, concept, quest, user) -> None:
    if not (concept.author_id == user.id or _is_manager(ts, quest, user)):
        raise AppError(403, "forbidden", detail="リンク操作の権限がありません")


def link_assumption(account_id, company_id, concept_id, *, assumption_id: str, criticality: str) -> dict:
    company = _ctx(account_id, company_id)
    cid = _parse_uuid(concept_id, field="concept_id")
    aid = _parse_uuid(assumption_id, field="assumption_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = _get_user(ts, account_id)
        concept, quest = _resolve_concept(ts, cid, user, for_write=True)
        _require_concept_editor(ts, concept, quest, user)
        _guard_not_completed(quest)
        assumption = repo.get_assumption(ts, aid)
        if assumption is None or assumption.quest_id != concept.quest_id:
            raise AppError(422, "validation_error", detail="同一クエストの前提のみリンク可",
                           errors=[{"field": "assumption_id"}])
        if repo.get_link(ts, cid, aid) is not None:
            raise AppError(409, "conflict", detail="既にリンク済み")
        link = repo.link_assumption(ts, concept_id=cid, assumption_id=aid, criticality=criticality, created_by_id=user.id)
        # 前提スレッド（assumption スコープ）を生成（重複は unique で防止・§3.7）。
        if repo.get_assumption_scope(ts, cid, aid) is None:
            repo.create_chat_scope(ts, concept_id=cid, kind="assumption", assumption_id=aid,
                                   position=repo.next_scope_position(ts, cid))
        result = {"concept_id": str(cid), "assumption_id": str(aid),
                  "criticality": link.criticality, "is_stale": link.is_stale}
        ts.commit()
        return result


def patch_link(account_id, company_id, concept_id, assumption_id, *, criticality, is_stale) -> dict:
    company = _ctx(account_id, company_id)
    cid = _parse_uuid(concept_id, field="concept_id")
    aid = _parse_uuid(assumption_id, field="assumption_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = _get_user(ts, account_id)
        concept, quest = _resolve_concept(ts, cid, user, for_write=True)
        _require_concept_editor(ts, concept, quest, user)
        _guard_not_completed(quest)
        link = repo.get_link(ts, cid, aid)
        if link is None:
            raise AppError(404, "not_found")
        repo.set_link_criticality_stale(ts, link, criticality=criticality, is_stale=is_stale)
        result = {"concept_id": str(cid), "assumption_id": str(aid),
                  "criticality": link.criticality, "is_stale": link.is_stale}
        ts.commit()
        return result


def unlink_assumption(account_id, company_id, concept_id, assumption_id) -> None:
    company = _ctx(account_id, company_id)
    cid = _parse_uuid(concept_id, field="concept_id")
    aid = _parse_uuid(assumption_id, field="assumption_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = _get_user(ts, account_id)
        concept, quest = _resolve_concept(ts, cid, user, for_write=True)
        _require_concept_editor(ts, concept, quest, user)
        _guard_not_completed(quest)
        if not repo.unlink_assumption(ts, cid, aid):
            raise AppError(404, "not_found")
        repo.remove_assumption_scope(ts, cid, aid)  # 前提本体・エビデンスは残す（単一ソース）
        ts.commit()


# ---- コンセプト評価（P.5） -------------------------------------------------

def _is_evaluator(ts, quest, user) -> bool:
    return _is_owner(quest, user) or "evaluator" in _perms_of(ts, quest, user)


def _require_evaluator(ts, quest, user) -> None:
    if not _is_evaluator(ts, quest, user):
        raise AppError(403, "forbidden", detail="評価の権限がありません")


# コンセプト評価の確定版で追跡するフィールド（§3.6）。scores/comments は JSON 化して差分。
CONCEPT_EVAL_REVISION_FIELDS = (
    rev_shared.FieldSpec("overall_comment", "text"),
    rev_shared.FieldSpec("scores", "scalar", scalar_fmt=lambda v: _json_compact(v)),
    rev_shared.FieldSpec("comments", "scalar", scalar_fmt=lambda v: _json_compact(v)),
    rev_shared.FieldSpec("recommendation", "scalar"),
    rev_shared.FieldSpec("visibility", "scalar"),
)


def _concept_eval_snapshot(body) -> dict:
    return {
        "overall_comment": body.overall_comment or None,
        "scores": {a: s for a, s in body.scores.items() if a in repo.ALL_ASPECTS},
        "comments": {a: c for a, c in (body.comments or {}).items() if c},
        "recommendation": body.recommendation,
        "visibility": body.visibility,
    }


def _record_concept_eval_revision(ts, ev, editor_id, snapshot) -> None:
    last = repo.latest_eval_revision(ts, ev.id)
    base = last.changes if last else {"overall_comment": None, "scores": {}, "comments": {}, "recommendation": None, "visibility": "party"}
    if rev_shared.changed_fields(base, snapshot, CONCEPT_EVAL_REVISION_FIELDS):
        repo.add_eval_revision(ts, ev.id, revision=(last.revision + 1) if last else 1, editor_id=editor_id, changes=snapshot)


def _me_eval_payload(ts, ev) -> dict:
    if ev is None:
        return {"status": None, "scores": {}, "comments": {}, "overall_comment": None,
                "recommendation": None, "visibility": "party", "submitted_at": None, "revisions": []}
    scores = repo.get_scores_for_evaluations(ts, [ev.id]).get(ev.id, [])
    revs = repo.list_eval_revisions(ts, ev.id)
    rev_by_num = {r.revision: r for r in revs}
    revisions = [{
        "revision": r.revision, "created_at": r.created_at,
        "changed_fields": rev_shared.changed_fields(rev_by_num.get(r.revision - 1).changes if rev_by_num.get(r.revision - 1) else None, r.changes, CONCEPT_EVAL_REVISION_FIELDS),
    } for r in revs]
    return {
        "status": ev.status, "scores": {s.aspect: s.score for s in scores},
        "comments": {s.aspect: s.comment for s in scores if s.comment is not None},
        "overall_comment": ev.overall_comment, "recommendation": ev.recommendation,
        "visibility": ev.visibility, "submitted_at": ev.submitted_at, "revisions": revisions,
    }


def get_concept_eval_revision_diff(account_id, company_id, concept_id, revision, *, from_revision=None) -> dict:
    """自分のコンセプト評価の確定版差分（§3.6）。既定＝前版比較。範囲外 404/422。"""
    company = _ctx(account_id, company_id)
    cid = _parse_uuid(concept_id, field="concept_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = _get_user(ts, account_id)
        concept, _quest = _resolve_concept(ts, cid, user)
        ev = repo.get_evaluation(ts, cid, user.id)
        if ev is None:
            raise AppError(404, "not_found")
        to_rev = repo.get_eval_revision(ts, ev.id, revision)
        if to_rev is None:
            raise AppError(404, "not_found")
        frm = from_revision if from_revision is not None else revision - 1
        if frm > revision:
            raise AppError(422, "validation_error", detail="from は revision 以下にしてください", errors=[{"field": "from"}])
        from_rev = repo.get_eval_revision(ts, ev.id, frm) if frm >= 1 else None
        old = from_rev.changes if from_rev is not None else {}
        return {"from_revision": frm, "to_revision": revision, "fields": rev_shared.diff_fields(old, to_rev.changes, CONCEPT_EVAL_REVISION_FIELDS)}


def _can_view_eval(concept, user, ev, is_manager: bool) -> bool:
    if ev.visibility == "party":
        return True
    if ev.evaluator_id == user.id or concept.author_id == user.id:
        return True
    return is_manager


def _validate_submitted_eval(body) -> None:
    errors = []
    for aspect in repo.CORE_ASPECTS:
        v = body.scores.get(aspect)
        if v is None or not (1 <= v <= 5):
            errors.append({"field": f"scores.{aspect}"})
    if not (body.overall_comment and body.overall_comment.strip()):
        errors.append({"field": "overall_comment"})
    if body.recommendation not in _RECOMMENDATIONS:
        errors.append({"field": "recommendation"})
    for aspect, v in body.scores.items():
        if not (1 <= v <= 5):
            errors.append({"field": f"scores.{aspect}"})
    if errors:
        raise AppError(422, "validation_error", detail="確定には中核5(1..5)＋総評＋推奨が必要", errors=errors)


def get_my_evaluation(account_id, company_id, concept_id) -> dict:
    company = _ctx(account_id, company_id)
    cid = _parse_uuid(concept_id, field="concept_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = _get_user(ts, account_id)
        concept, quest = _resolve_concept(ts, cid, user)
        _require_evaluator(ts, quest, user)
        return _me_eval_payload(ts, repo.get_evaluation(ts, cid, user.id))


def get_evaluation_aggregate(account_id, company_id, concept_id) -> dict:
    company = _ctx(account_id, company_id)
    cid = _parse_uuid(concept_id, field="concept_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = _get_user(ts, account_id)
        concept, quest = _resolve_concept(ts, cid, user)
        submitted = repo.list_evaluations_for_concept(ts, cid, status="submitted")
        is_manager = _is_manager(ts, quest, user)
        visible = [e for e in submitted if _can_view_eval(concept, user, e, is_manager)]
        scores_by_eval = repo.get_scores_for_evaluations(ts, [e.id for e in visible])
        users = quests_repo.get_users_by_ids(ts, {e.evaluator_id for e in visible}) if visible else {}
        by_aspect: dict[str, list[int]] = {}
        recommendations: dict[str, int] = {}
        evaluators = []
        for e in visible:
            rows = scores_by_eval.get(e.id, [])
            for s in rows:
                by_aspect.setdefault(s.aspect, []).append(s.score)
            if e.recommendation:
                recommendations[e.recommendation] = recommendations.get(e.recommendation, 0) + 1
            u = users.get(e.evaluator_id)
            evaluators.append({
                "evaluator_id": str(e.evaluator_id),
                "evaluator": {"user_id": str(e.evaluator_id), "display_name": u.display_name if u else "?",
                              "avatar_image_url": _image_url(u.avatar_image_path) if u else None,
                              "level": u.level if u else None},
                "recommendation": e.recommendation,
                "scores": {s.aspect: s.score for s in rows},
                "overall_comment": e.overall_comment,
                "comments": {s.aspect: s.comment for s in rows if s.comment is not None},
            })
        aspects = {a: (sum(v) / len(v)) for a, v in by_aspect.items() if v}
        core = [aspects[a] for a in repo.CORE_ASPECTS if a in aspects]
        my_eval = _me_eval_payload(ts, repo.get_evaluation(ts, cid, user.id)) if _is_evaluator(ts, quest, user) else None
        stale = any(link.is_stale for link in repo.list_links_for_concept(ts, cid))
        return {
            "aspects": aspects, "overall_avg": (sum(core) / len(core)) if core else None,
            "evaluator_count": len(visible), "recommendations": recommendations,
            "evaluators": evaluators, "my_evaluation": my_eval, "stale": stale,
            "my_permissions": _my_permissions(ts, concept, quest, user),
        }


def put_evaluation(account_id, company_id, concept_id, *, body) -> dict:
    company = _ctx(account_id, company_id)
    cid = _parse_uuid(concept_id, field="concept_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = _get_user(ts, account_id)
        concept, quest = _resolve_concept(ts, cid, user)
        _require_evaluator(ts, quest, user)
        _guard_not_completed(quest)
        submitted = body.status == "submitted"
        if submitted:
            _validate_submitted_eval(body)
        ev, _created = repo.upsert_evaluation(
            ts, cid, user.id, overall_comment=body.overall_comment, recommendation=body.recommendation,
            status=body.status, visibility=body.visibility,
        )
        entries = [(a, s, body.comments.get(a)) for a, s in body.scores.items() if a in repo.ALL_ASPECTS]
        repo.replace_scores(ts, ev.id, entries)
        if submitted:
            if ev.submitted_at is None:
                ev.submitted_at = datetime.now(timezone.utc)
            _record_concept_eval_revision(ts, ev, user.id, _concept_eval_snapshot(body))  # 確定ごとに版（§3.6）
        ts.flush()
        payload = _me_eval_payload(ts, ev)
        ts.commit()
        return payload


# ---- コンセプト投票（P.5b） ------------------------------------------------

def _guard_votable(ts, concept, quest, user) -> None:
    if concept.status != "active":
        raise AppError(409, "conflict", detail="投票できない状態です", extra={"errors": [{"reason": "invalid_state"}]})
    _guard_not_completed(quest)
    if not (_is_owner(quest, user) or "vote" in _perms_of(ts, quest, user)):
        raise AppError(403, "forbidden", detail="投票の権限がありません")


def _award_vote_xp(ts, concept, user) -> bool:
    """投票 XP+5（各コンセプト初回のみ・日次上限・切替/取消/再投票では追加なし）。冪等＝activities 存在。"""
    if gami_repo.exists_ref(ts, user.id, ledger.XP_GAIN, "concept_vote", "concepts", concept.id):
        return False
    start, end = jst_day_bounds_utc(datetime.now(timezone.utc))
    if gami_repo.count_reason_between(ts, user.id, "concept_vote", start, end) >= _VOTE_XP_DAILY_CAP:
        return False
    ledger.grant(ts, user, kind=ledger.XP_GAIN, amount=_XP_VOTE, reason="concept_vote",
                 ref_type="concepts", ref_id=concept.id, quest_id=concept.quest_id)
    return True


def vote(account_id, company_id, concept_id, *, vote_type: str) -> dict:
    company = _ctx(account_id, company_id)
    cid = _parse_uuid(concept_id, field="concept_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = _get_user(ts, account_id)
        concept, quest = _resolve_concept(ts, cid, user)
        _guard_votable(ts, concept, quest, user)
        _, created = repo.upsert_vote(ts, cid, user.id, type=vote_type)
        xp_awarded = _award_vote_xp(ts, concept, user)
        vc = repo.count_votes(ts, cid)
        ts.commit()
    return {"my_vote": vote_type, "summary": {"approve": vc.get("approve", 0), "oppose": vc.get("oppose", 0)},
            "xp_awarded": xp_awarded, "xp_delta": _XP_VOTE if xp_awarded else 0}


def remove_vote(account_id, company_id, concept_id) -> dict:
    company = _ctx(account_id, company_id)
    cid = _parse_uuid(concept_id, field="concept_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = _get_user(ts, account_id)
        concept, quest = _resolve_concept(ts, cid, user)
        _guard_not_completed(quest)
        repo.delete_vote(ts, cid, user.id)
        vc = repo.count_votes(ts, cid)
        ts.commit()
    return {"my_vote": None, "summary": {"approve": vc.get("approve", 0), "oppose": vc.get("oppose", 0)}}


# ---- コンセプト議論チャット（P.6・E 機構を共有） ----------------------------

def _resolve_scope(ts, sid, user):
    """スコープ＋コンセプト＋クエストを解決し門番（パーティー所属＋draft 可視性）を適用。"""
    scope = repo.get_chat_scope(ts, sid)
    if scope is None:
        raise AppError(404, "not_found")
    concept, quest = _resolve_concept(ts, scope.concept_id, user)
    return scope, concept, quest


def _message_dto(m, author=None) -> dict:
    a = None
    if author is not None:
        a = {"user_id": str(author.id), "display_name": author.display_name,
             "avatar_image_url": _image_url(author.avatar_image_path), "level": author.level}
    return {"id": str(m.id), "author_id": str(m.author_id), "author": a, "body": m.body, "created_at": m.created_at}


def list_chat_scopes(account_id, company_id, concept_id) -> dict:
    company = _ctx(account_id, company_id)
    cid = _parse_uuid(concept_id, field="concept_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = _get_user(ts, account_id)
        concept, quest = _resolve_concept(ts, cid, user)
        items = []
        for s in repo.list_chat_scopes(ts, cid):
            items.append({
                "scope_id": str(s.id), "kind": s.kind, "label": s.label,
                "assumption_id": str(s.assumption_id) if s.assumption_id else None,
                "position": s.position, "unread_count": repo.unread_count_for_scope(ts, s.id, user.id),
            })
        return {"items": items}


def create_group_scope(account_id, company_id, concept_id, *, label: str) -> dict:
    company = _ctx(account_id, company_id)
    cid = _parse_uuid(concept_id, field="concept_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = _get_user(ts, account_id)
        concept, quest = _resolve_concept(ts, cid, user, for_write=True)
        _require_manager(ts, quest, user, action="ルーム作成")
        _guard_not_completed(quest)
        s = repo.create_chat_scope(ts, concept_id=cid, kind="group", label=label,
                                   position=repo.next_scope_position(ts, cid))
        result = {"scope_id": str(s.id), "kind": s.kind, "label": s.label,
                  "assumption_id": None, "position": s.position, "unread_count": 0}
        ts.commit()
        return result


def list_messages(account_id, company_id, scope_id) -> dict:
    company = _ctx(account_id, company_id)
    sid = _parse_uuid(scope_id, field="scope_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = _get_user(ts, account_id)
        scope, concept, quest = _resolve_scope(ts, sid, user)
        msgs = repo.list_scope_messages(ts, sid)
        authors = quests_repo.get_users_by_ids(ts, {m.author_id for m in msgs})
        return {"items": [_message_dto(m, authors.get(m.author_id)) for m in msgs]}


def post_message(account_id, company_id, scope_id, *, body: str, message_id: str | None = None) -> dict:
    company = _ctx(account_id, company_id)
    sid = _parse_uuid(scope_id, field="scope_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = _get_user(ts, account_id)
        scope, concept, quest = _resolve_scope(ts, sid, user)  # 投稿＝パーティー員（コメント権限）
        _guard_not_completed(quest)
        mid = _parse_uuid(message_id, field="message_id") if message_id else None
        if mid is not None:
            existing = repo.get_scope_message(ts, mid)  # Idempotency-Key 再送＝既存を返す（二重投稿防止）
            if existing is not None:
                return _message_dto(existing, user if existing.author_id == user.id else quests_repo.get_users_by_ids(ts, {existing.author_id}).get(existing.author_id))
        m = repo.post_scope_message(ts, scope_id=sid, author_id=user.id, body=body, message_id=mid)
        payload = _message_dto(m, user)
        ts.commit()
        return payload


def read_scope(account_id, company_id, scope_id, *, last_read_message_id: str) -> None:
    company = _ctx(account_id, company_id)
    sid = _parse_uuid(scope_id, field="scope_id")
    mid = _parse_uuid(last_read_message_id, field="last_read_message_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = _get_user(ts, account_id)
        scope, concept, quest = _resolve_scope(ts, sid, user)
        repo.upsert_scope_read(ts, sid, user.id, mid)
        ts.commit()
