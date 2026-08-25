"""ドメイン F（評価）の application（imperative shell・F.1〜F.4）。

門番＝当該アイデアのクエストのパーティー所属（C.0）＋入力/選定は各権限（evaluator／owner・quest_admin）。
XP/コインは `app.tenant.gamification.ledger` を同一 UoW で呼び、冪等は `activities` の存在チェック（exists_ref・§7）。
完了クエスト（completed）は書き込み凍結（409・C.5）。limited 評価は範囲外に完全非表示（F.1）。
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from app.control_plane.auth.orm import Company
from app.core.errors import AppError
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.evaluations import repository as repo
from app.tenant.evaluations.repository import ASPECTS
from app.tenant.gamification import ledger
from app.tenant.gamification import repository as gami_repo
from app.tenant.ideas import repository as ideas_repo
from app.tenant.notifications import service as notify_svc
from app.tenant.profile import repository as profile_repo
from app.tenant.quests import repository as quests_repo

_XP_EVALUATION = 30
_XP_SELECTION = 200
_COIN_MAX = 50


def _resolve_company(company_id: uuid.UUID) -> Company | None:
    with control_session() as s:
        return s.get(Company, company_id)


def _image_url(path: str | None) -> str | None:
    from app.infra.storage import get_storage

    return get_storage().presigned_get(path) if path else None


def _parse_uuid(value: str, *, field: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except (ValueError, AttributeError):
        raise AppError(422, "validation_error", detail=f"{field} が不正です", errors=[{"field": field}])


# ---- 公開（取得・F.1） ----


def get_my_evaluation(account_id, company_id, idea_id) -> dict:
    """自分の評価/下書き（SC-25 読み込み・F.1）。門番＋evaluator 権限。未作成は status=null。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    iid = _parse_uuid(idea_id, field="idea_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        idea, quest = _resolve_evaluable_idea(ts, iid, user)
        _require_evaluator(ts, quest, user)
        ev = repo.get_evaluation(ts, idea.id, user.id)
        return _me_payload(ts, ev)


def get_aggregate(account_id, company_id, idea_id) -> dict:
    """評価結果の集計（SC-22 §4.6・F.1）。門番＝パーティー所属。可視な評価のみで算定・coin は全 submitted で見込み。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    iid = _parse_uuid(idea_id, field="idea_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        idea, quest = _resolve_evaluable_idea(ts, iid, user)
        submitted = repo.list_evaluations_for_idea(ts, idea.id, status="submitted")
        scores_by_eval = repo.get_scores_for_evaluations(ts, [e.id for e in submitted])
        # 表示集計＝閲覧者に可視な評価のみ（limited は範囲外に完全非表示・分母にも入れない）。
        visible = [e for e in submitted if _can_view_evaluation(ts, idea, quest, user, e)]
        agg = _aggregate(visible, scores_by_eval, ts)
        # コイン見込み＝visibility 無視で全 submitted から算定。確定済みなら確定額。
        agg["coin"] = _coin_status(ts, idea, submitted, scores_by_eval)
        agg["my_evaluation"] = _me_payload(ts, repo.get_evaluation(ts, idea.id, user.id)) if _is_evaluator(ts, quest, user) else None
        agg["my_permissions"] = _my_permissions(ts, quest, user)
        return agg


# ---- 登録/更新（F.2） ----


def put_evaluation(account_id, company_id, idea_id, *, body) -> dict:
    """自分の評価を登録/更新（upsert・F.2）。submitted は全5観点＋総評検証→XP+30＋コイン確定判定(a)。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    iid = _parse_uuid(idea_id, field="idea_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        idea, quest = _resolve_evaluable_idea(ts, iid, user)
        _require_evaluator(ts, quest, user)
        _guard_not_completed(quest)
        _validate_evaluation(body)
        ev, _created = repo.upsert_evaluation(
            ts, idea.id, user.id,
            overall_comment=(body.overall_comment or None), status=body.status, visibility=body.visibility,
        )
        repo.replace_scores(ts, ev.id, [(a, body.scores[a], body.comments.get(a)) for a in ASPECTS if a in body.scores])
        if body.status == "submitted":
            if ev.submitted_at is None:
                ev.submitted_at = datetime.now(timezone.utc)
            # 評価者 XP+30（評価1件につき1回・exists_ref 冪等・日次上限対象外）。
            if not gami_repo.exists_ref(ts, user.id, ledger.XP_GAIN, "evaluation", "evaluations", ev.id):
                ledger.grant(ts, user, kind=ledger.XP_GAIN, amount=_XP_EVALUATION, reason="evaluation",
                             ref_type="evaluations", ref_id=ev.id, quest_id=idea.quest_id)
            _notify_follow_evaluation(ts, idea.id, user.id)
            # 投稿者コインの確定トリガ(a)＝evaluator 全員がこのアイデアを submitted 済みか判定。
            _maybe_finalize_idea_coin(ts, idea, quest)
        detail = _me_payload(ts, ev)
        ts.commit()
    return detail


# ---- 選定（F.3） ----


def select_idea(account_id, company_id, idea_id, *, selected: bool) -> dict:
    """アイデア選定/解除（F.3・owner/quest_admin）。選定は投稿者へ XP+200（初回・剥奪なし・冪等）。完了は 409。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    iid = _parse_uuid(idea_id, field="idea_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        idea, quest = _resolve_evaluable_idea(ts, iid, user)
        _require_owner_or_admin(ts, quest, user)
        _guard_not_completed(quest)
        idea.is_selected = selected
        if selected:
            author = quests_repo.get_users_by_ids(ts, {idea.author_id}).get(idea.author_id)
            if author is not None and not gami_repo.exists_ref(ts, author.id, ledger.XP_GAIN, "selection", "ideas", idea.id):
                ledger.grant(ts, author, kind=ledger.XP_GAIN, amount=_XP_SELECTION, reason="selection",
                             ref_type="ideas", ref_id=idea.id, quest_id=idea.quest_id)
            _notify_follow_selection(ts, idea.id, user.id)
        detail = {"id": str(idea.id), "is_selected": idea.is_selected}
        ts.commit()
    return detail


# ---- 投稿者コインの確定（F.4・(b) 完了遷移フックは C から呼ぶ） ----


def finalize_quest_author_coins(ts, quest) -> None:
    """(b) completed 遷移の副作用＝未確定の全 published アイデアの投稿者コインを一括確定（C の transition UoW 内）。"""
    for idea in ideas_repo.list_published_ideas_for_quest(ts, quest.id):
        _finalize_idea_coin(ts, idea, quest)


def _maybe_finalize_idea_coin(ts, idea, quest) -> None:
    """(a) evaluator 権限保持者全員がこのアイデアを submitted 済みなら確定。"""
    evaluator_ids = _evaluator_user_ids(ts, quest)
    if not evaluator_ids:
        return
    submitted_ids = {e.evaluator_id for e in repo.list_evaluations_for_idea(ts, idea.id, status="submitted")}
    if evaluator_ids <= submitted_ids:
        _finalize_idea_coin(ts, idea, quest)


def _finalize_idea_coin(ts, idea, quest) -> None:
    """投稿者コインをアイデア単位に1回だけ確定（冪等・visibility 無視で全 submitted から算定・§8-⑱）。"""
    author = quests_repo.get_users_by_ids(ts, {idea.author_id}).get(idea.author_id)
    if author is None:
        return
    if gami_repo.exists_ref(ts, author.id, ledger.COIN_GAIN, "evaluation_coin", "ideas", idea.id):
        return  # 既に確定済み＝再確定しない（不可逆・スナップショット）
    submitted = repo.list_evaluations_for_idea(ts, idea.id, status="submitted")
    if not submitted:
        return  # 提出済み評価が無ければ付与なし（0 コイン）
    scores_by_eval = repo.get_scores_for_evaluations(ts, [e.id for e in submitted])
    all_scores = [s.score for e in submitted for s in scores_by_eval.get(e.id, [])]
    if not all_scores:
        return
    avg = sum(all_scores) / len(all_scores)
    coin = min(_COIN_MAX, round(avg * 10))
    if coin <= 0:
        return
    ledger.grant(ts, author, kind=ledger.COIN_GAIN, amount=coin, reason="evaluation_coin",
                 ref_type="ideas", ref_id=idea.id, quest_id=idea.quest_id)


# ---- ドメイン関数（門番・認可・検証・集計） ----


def _resolve_evaluable_idea(ts, iid, user):
    """アイデア＋クエストを解決し評価対象の門番を適用。draft は評価対象外・非パーティーは秘匿（404）。"""
    idea = ideas_repo.get_idea(ts, iid)
    if idea is None or idea.status != "published":
        raise AppError(404, "not_found")  # 下書き/不在＝評価対象外（存在秘匿）
    if quests_repo.get_active_member(ts, idea.quest_id, user.id) is None:
        raise AppError(404, "not_found")  # 非パーティーは秘匿（C.0）
    quest = quests_repo.get_quest(ts, idea.quest_id)
    return idea, quest


def _perms_of(ts, quest, user) -> list[str]:
    member = quests_repo.get_active_member(ts, quest.id, user.id) if quest is not None else None
    return quests_repo.get_permissions(ts, member.id) if member is not None else []


def _is_owner(quest, user) -> bool:
    return quest is not None and quest.owner_id == user.id


def _is_evaluator(ts, quest, user) -> bool:
    """評価者＝クエスト作成者（owner）＋`evaluator` 権限保持者（F.0/§5.21）。"""
    return _is_owner(quest, user) or "evaluator" in _perms_of(ts, quest, user)


def _require_evaluator(ts, quest, user) -> None:
    if not _is_evaluator(ts, quest, user):
        raise AppError(403, "forbidden", detail="評価の権限がありません")


def _require_owner_or_admin(ts, quest, user) -> None:
    if _is_owner(quest, user):
        return
    if "quest_admin" not in _perms_of(ts, quest, user):
        raise AppError(403, "forbidden", detail="選定の権限がありません")


def _my_permissions(ts, quest, user) -> list[str]:
    """UX 出し分け用（サーバー算出・F.0）。evaluate／select を返す。"""
    perms: list[str] = []
    if _is_evaluator(ts, quest, user):
        perms.append("evaluate")
    if _is_owner(quest, user) or "quest_admin" in _perms_of(ts, quest, user):
        perms.append("select")
    return perms


def _evaluator_user_ids(ts, quest) -> set[uuid.UUID]:
    """当該クエストの evaluator 権限保持者（有効所属）の user_id 集合（owner を含む）。"""
    ids: set[uuid.UUID] = set()
    if quest is None:
        return ids
    for m in quests_repo.list_active_members(ts, quest.id):
        perms = quests_repo.get_permissions(ts, m.id)
        if "evaluator" in perms or "owner" in perms:
            ids.add(m.user_id)
    return ids


def _can_view_evaluation(ts, idea, quest, user, ev) -> bool:
    """評価の閲覧可否（visibility 適用・F.1）。party＝全員／limited＝投稿者＋当該評価者＋owner/quest_admin。"""
    if ev.visibility == "party":
        return True
    if ev.evaluator_id == user.id or idea.author_id == user.id:
        return True
    return _is_owner(quest, user) or "quest_admin" in _perms_of(ts, quest, user)


def _guard_not_completed(quest) -> None:
    if quest is not None and quest.status == "completed":
        raise AppError(409, "conflict", detail="完了後は変更できません", extra={"errors": [{"reason": "invalid_state"}]})


def _validate_evaluation(body) -> None:
    """スコア/観点の検証（F.2）。キーは aspect 限定・値 1..5。submitted は全5観点＋総評必須。"""
    for k, v in body.scores.items():
        if k not in ASPECTS:
            raise AppError(422, "validation_error", detail="観点が不正です", errors=[{"field": "scores"}])
        if not isinstance(v, int) or v < 1 or v > 5:
            raise AppError(422, "validation_error", detail="スコアは1〜5です", errors=[{"field": "scores"}])
    for k in body.comments:
        if k not in ASPECTS:
            raise AppError(422, "validation_error", detail="観点が不正です", errors=[{"field": "comments"}])
    if body.status == "submitted":
        errors = [{"field": "scores", "aspect": a} for a in ASPECTS if a not in body.scores]
        if not (body.overall_comment and body.overall_comment.strip()):
            errors.append({"field": "overall_comment"})
        if errors:
            raise AppError(422, "validation_error", detail="確定には全5観点＋総評が必要です", errors=errors)


def _aggregate(evaluations, scores_by_eval, ts) -> dict:
    """可視な submitted 評価から観点別平均・総合平均・評価者内訳を算出（5観点均等）。"""
    users = quests_repo.get_users_by_ids(ts, {e.evaluator_id for e in evaluations}) if evaluations else {}
    per_aspect: dict[str, list[int]] = {a: [] for a in ASPECTS}
    evaluators = []
    for e in evaluations:
        smap = {s.aspect: s.score for s in scores_by_eval.get(e.id, [])}
        cmap = {s.aspect: s.comment for s in scores_by_eval.get(e.id, []) if s.comment}
        for a, v in smap.items():
            if a in per_aspect:
                per_aspect[a].append(v)
        evaluators.append({
            "evaluator": _author_dto(users.get(e.evaluator_id), e.evaluator_id),
            "scores": smap,
            "comments": cmap,
            "overall_comment": e.overall_comment,
        })
    aspects = {a: round(sum(vs) / len(vs), 2) for a, vs in per_aspect.items() if vs}
    overall_avg = round(sum(aspects.values()) / len(aspects), 2) if aspects else None
    return {
        "aspects": aspects,
        "overall_avg": overall_avg,
        "evaluator_count": len(evaluations),
        "evaluators": evaluators,
    }


def _coin_status(ts, idea, submitted, scores_by_eval) -> dict:
    """投稿者コインの見込み/確定（F.4）。projected＝全 submitted からの見込み・確定済みなら確定額。"""
    all_scores = [s.score for e in submitted for s in scores_by_eval.get(e.id, [])]
    projected = min(_COIN_MAX, round((sum(all_scores) / len(all_scores)) * 10)) if all_scores else 0
    finalized = None
    finalized_at = None
    row = gami_repo.get_ref_activity(ts, idea.author_id, ledger.COIN_GAIN, "evaluation_coin", "ideas", idea.id)
    if row is not None:
        finalized = row.amount
        finalized_at = row.created_at
    return {"projected": projected, "finalized": finalized, "finalized_at": finalized_at}


def _me_payload(ts, ev) -> dict:
    if ev is None:
        return {"status": None, "scores": {}, "comments": {}, "overall_comment": None, "visibility": "party", "submitted_at": None}
    scores = repo.list_scores(ts, ev.id)
    return {
        "status": ev.status,
        "scores": {s.aspect: s.score for s in scores},
        "comments": {s.aspect: s.comment for s in scores if s.comment},
        "overall_comment": ev.overall_comment,
        "visibility": ev.visibility,
        "submitted_at": ev.submitted_at,
    }


def _author_dto(user, user_id) -> dict:
    return {
        "user_id": str(user_id),
        "display_name": user.display_name if user else "",
        "avatar_image_url": _image_url(user.avatar_image_path) if user else None,
        "level": user.level if user else None,
    }


def _notify_follow_evaluation(ts, idea_id, evaluator_id) -> None:
    """評価確定時の follow_evaluation 通知（フォロワー宛・評価者除く・H.0/§F.5）。確定と同一 UoW。

    本文にスコアは載せない（F.5＝「新しい評価がつきました」程度・権限外情報を出さない・H.4）。
    """
    recipients = ideas_repo.list_follower_ids(ts, idea_id) - {evaluator_id}
    if not recipients:
        return
    refs = {"ref_idea_id": idea_id}
    notify_svc.notify(ts, [notify_svc.entry(r, "follow_evaluation", refs=refs) for r in recipients])


def _notify_follow_selection(ts, idea_id, actor_id) -> None:
    """選定時の follow_selection 通知（フォロワー宛・操作者除く・H.0/§F.5）。選定と同一 UoW。"""
    recipients = ideas_repo.list_follower_ids(ts, idea_id) - {actor_id}
    if not recipients:
        return
    refs = {"ref_idea_id": idea_id}
    notify_svc.notify(ts, [notify_svc.entry(r, "follow_selection", refs=refs) for r in recipients])
