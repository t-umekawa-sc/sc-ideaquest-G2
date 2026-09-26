"""コンセプト・ルータ（`/api/v1`・テナントプレーン・ドメイン P・FR-42）。

認可＝Depends(require_me)。門番（パーティー所属）・権限（作成者／owner・quest_admin）・状態機械・draft 可視性は
application 層で強制。変更系は Origin/CSRF（A.0）。会社/アカウントはセッション由来（§1.5）。
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Request, Response

from app.control_plane.me.deps import require_me
from app.core.deps import verify_csrf, verify_origin
from app.tenant.concepts import application as service
from app.tenant.info.schemas import RelatedInfoResponse
from app.tenant.concepts.schemas import (
    AssumptionCreateRequest,
    AssumptionDetailDTO,
    AssumptionListResponse,
    AssumptionPatchRequest,
    ConceptCreateRequest,
    ConceptDecisionLogResponse,
    ConceptDecisionRequest,
    ConceptDetailDTO,
    ConceptEvalRevisionDiffResponse,
    ConceptRevisionDiffResponse,
    ConceptRevisionListResponse,
    ConceptEvaluationAggregateDTO,
    ConceptEvaluationMeDTO,
    ConceptEvaluationPutRequest,
    ConceptListResponse,
    ConceptPatchRequest,
    ConceptSelectResponse,
    ConceptVoteRequest,
    ConceptVoteResponse,
    ConceptChatMessageListResponse,
    ConceptChatScopeItemDTO,
    ConceptChatScopeListResponse,
    ConceptGroupScopeCreateRequest,
    ConceptChatMessageDTO,
    ConceptMessagePostRequest,
    ConceptReadRequest,
    LinkCreateRequest,
    LinkDTO,
    LinkPatchRequest,
    ValidationAddResponse,
    ValidationCreateRequest,
    ValidationListResponse,
)

router = APIRouter(prefix="/api/v1", tags=["concepts"])


@router.get("/quests/{quest_id}/concepts", response_model=ConceptListResponse)
def list_concepts(quest_id: str, request: Request, session: dict = Depends(require_me)) -> ConceptListResponse:
    """クエスト配下のコンセプト一覧（P.1）。自分の draft を含む。読取専用。"""
    result = service.list_for_quest(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), quest_id)
    return ConceptListResponse(**result)


@router.post("/quests/{quest_id}/concepts", response_model=ConceptDetailDTO, status_code=201)
def create_concept(
    quest_id: str, body: ConceptCreateRequest, request: Request, session: dict = Depends(require_me),
) -> ConceptDetailDTO:
    """コンセプト作成（P.2・既定 draft・総合ルーム自動生成）。門番＝パーティー員。"""
    verify_origin(request)
    verify_csrf(request)
    result = service.create(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), quest_id, body=body)
    return ConceptDetailDTO(**result)


@router.get("/concepts/{concept_id}", response_model=ConceptDetailDTO)
def get_concept(concept_id: str, request: Request, session: dict = Depends(require_me)) -> ConceptDetailDTO:
    """コンセプト詳細（合成・P.1）。draft は本人のみ。読取専用。"""
    result = service.get_detail(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), concept_id)
    return ConceptDetailDTO(**result)


@router.get("/concepts/{concept_id}/revisions", response_model=ConceptRevisionListResponse)
def get_concept_revisions(
    concept_id: str, request: Request, limit: int = Query(default=50, ge=1, le=100),
    cursor: str | None = None, session: dict = Depends(require_me),
) -> ConceptRevisionListResponse:
    """コンセプト内容の版タイムライン（SC-61 更新履歴・§3.1）。読取専用。"""
    result = service.get_revisions(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), concept_id, limit=limit, cursor=cursor,
    )
    return ConceptRevisionListResponse(**result)


@router.get("/concepts/{concept_id}/revisions/{revision}/diff", response_model=ConceptRevisionDiffResponse)
def get_concept_revision_diff(
    concept_id: str, revision: int, request: Request, from_revision: int | None = Query(default=None, alias="from"),
    session: dict = Depends(require_me),
) -> ConceptRevisionDiffResponse:
    """版差分（SC-61・§3.1）。既定＝前版比較。読取専用。"""
    result = service.get_revision_diff(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), concept_id, revision,
        from_revision=from_revision,
    )
    return ConceptRevisionDiffResponse(**result)


@router.get("/concepts/{concept_id}/decision-log", response_model=ConceptDecisionLogResponse)
def get_concept_decision_log(
    concept_id: str, request: Request, session: dict = Depends(require_me),
) -> ConceptDecisionLogResponse:
    """意思決定/ステータスの遷移ログ（SC-61・§3.2）。読取専用。"""
    result = service.get_decision_log(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), concept_id,
    )
    return ConceptDecisionLogResponse(**result)


@router.get("/concepts/{concept_id}/related-info", response_model=RelatedInfoResponse)
def get_concept_related_info(
    concept_id: str, request: Request, limit: int = Query(default=50, ge=1, le=100),
    session: dict = Depends(require_me),
) -> RelatedInfoResponse:
    """コンセプトの関連情報（SC-61・FR-41・RelatedInfoPanel 用）。門番＝詳細と同一。読取専用。"""
    result = service.get_related_info(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), concept_id, limit=limit,
    )
    return RelatedInfoResponse(**result)


@router.patch("/concepts/{concept_id}", response_model=ConceptDetailDTO)
def patch_concept(
    concept_id: str, body: ConceptPatchRequest, request: Request, session: dict = Depends(require_me),
) -> ConceptDetailDTO:
    """内容編集（P.2・作成者＋owner/quest_admin）。"""
    verify_origin(request)
    verify_csrf(request)
    result = service.patch(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), concept_id, body=body)
    return ConceptDetailDTO(**result)


@router.delete("/concepts/{concept_id}", status_code=204)
def delete_concept(concept_id: str, request: Request, session: dict = Depends(require_me)) -> Response:
    """論理削除（P.2・作成者＋owner/quest_admin）。"""
    verify_origin(request)
    verify_csrf(request)
    service.soft_delete(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), concept_id)
    return Response(status_code=204)


@router.post("/concepts/{concept_id}/activate", response_model=ConceptDetailDTO)
def activate_concept(concept_id: str, request: Request, session: dict = Depends(require_me)) -> ConceptDetailDTO:
    """draft→active（P.2・owner/quest_admin）。"""
    verify_origin(request)
    verify_csrf(request)
    result = service.set_status(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), concept_id, target="active")
    return ConceptDetailDTO(**result)


@router.post("/concepts/{concept_id}/archive", response_model=ConceptDetailDTO)
def archive_concept(concept_id: str, request: Request, session: dict = Depends(require_me)) -> ConceptDetailDTO:
    """active→archived（P.2・owner/quest_admin）。"""
    verify_origin(request)
    verify_csrf(request)
    result = service.set_status(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), concept_id, target="archived")
    return ConceptDetailDTO(**result)


@router.post("/concepts/{concept_id}/select", response_model=ConceptSelectResponse)
def select_concept(concept_id: str, request: Request, session: dict = Depends(require_me)) -> ConceptSelectResponse:
    """勝ち残り選定（P.2・owner/quest_admin・複数可）。"""
    verify_origin(request)
    verify_csrf(request)
    result = service.set_selected(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), concept_id, selected=True)
    return ConceptSelectResponse(**result)


@router.delete("/concepts/{concept_id}/select", response_model=ConceptSelectResponse)
def unselect_concept(concept_id: str, request: Request, session: dict = Depends(require_me)) -> ConceptSelectResponse:
    """選定解除（P.2・owner/quest_admin）。"""
    verify_origin(request)
    verify_csrf(request)
    result = service.set_selected(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), concept_id, selected=False)
    return ConceptSelectResponse(**result)


@router.put("/concepts/{concept_id}/decision", response_model=ConceptDetailDTO)
def put_decision(
    concept_id: str, body: ConceptDecisionRequest, request: Request, session: dict = Depends(require_me),
) -> ConceptDetailDTO:
    """総合判定 Go/Pivot/Kill（P.2・owner/quest_admin）。"""
    verify_origin(request)
    verify_csrf(request)
    result = service.set_decision(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), concept_id,
        decision=body.decision, decision_rationale=body.decision_rationale,
    )
    return ConceptDetailDTO(**result)


# ---- 前提＝検証プール（P.3） ----


@router.get("/quests/{quest_id}/assumptions", response_model=AssumptionListResponse)
def list_assumptions(quest_id: str, request: Request, session: dict = Depends(require_me)) -> AssumptionListResponse:
    """検証プール一覧（P.3）。門番＝パーティー員。読取専用。"""
    result = service.list_assumptions(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), quest_id)
    return AssumptionListResponse(**result)


@router.post("/quests/{quest_id}/assumptions", response_model=AssumptionDetailDTO, status_code=201)
def create_assumption(
    quest_id: str, body: AssumptionCreateRequest, request: Request, session: dict = Depends(require_me),
) -> AssumptionDetailDTO:
    """前提の作成（P.3・検証プール所有＝owner/quest_admin）。"""
    verify_origin(request)
    verify_csrf(request)
    result = service.create_assumption(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), quest_id, statement=body.statement,
    )
    return AssumptionDetailDTO(**result)


@router.get("/assumptions/{assumption_id}", response_model=AssumptionDetailDTO)
def get_assumption(assumption_id: str, request: Request, session: dict = Depends(require_me)) -> AssumptionDetailDTO:
    """前提詳細（検証履歴＋リンク先・P.3）。読取専用。"""
    result = service.get_assumption_detail(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), assumption_id)
    return AssumptionDetailDTO(**result)


@router.patch("/assumptions/{assumption_id}", response_model=AssumptionDetailDTO)
def patch_assumption(
    assumption_id: str, body: AssumptionPatchRequest, request: Request, session: dict = Depends(require_me),
) -> AssumptionDetailDTO:
    """前提の記述編集（P.3・プール所有）。"""
    verify_origin(request)
    verify_csrf(request)
    result = service.patch_assumption(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), assumption_id, statement=body.statement,
    )
    return AssumptionDetailDTO(**result)


@router.delete("/assumptions/{assumption_id}", status_code=204)
def delete_assumption(assumption_id: str, request: Request, session: dict = Depends(require_me)) -> Response:
    """前提の削除（P.3・プール所有）。リンク中は 409。"""
    verify_origin(request)
    verify_csrf(request)
    service.delete_assumption(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), assumption_id)
    return Response(status_code=204)


@router.post("/assumptions/{assumption_id}/validations", response_model=ValidationAddResponse, status_code=201)
def add_validation(
    assumption_id: str, body: ValidationCreateRequest, request: Request, session: dict = Depends(require_me),
) -> ValidationAddResponse:
    """検証イベント追記（P.3・プール所有）。refuted は反証波及（P.7）。"""
    verify_origin(request)
    verify_csrf(request)
    result = service.add_validation(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), assumption_id, body=body,
    )
    return ValidationAddResponse(**result)


@router.get("/assumptions/{assumption_id}/validations", response_model=ValidationListResponse)
def list_validations(assumption_id: str, request: Request, session: dict = Depends(require_me)) -> ValidationListResponse:
    """検証イベント履歴（実施日降順・P.3）。読取専用。"""
    result = service.list_validations(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), assumption_id)
    return ValidationListResponse(**result)


# ---- コンセプト↔前提リンク（P.4） ----


@router.post("/concepts/{concept_id}/assumptions", response_model=LinkDTO, status_code=201)
def link_assumption(
    concept_id: str, body: LinkCreateRequest, request: Request, session: dict = Depends(require_me),
) -> LinkDTO:
    """前提をコンセプトにリンク（P.4・重要度付き・前提スレッド生成）。"""
    verify_origin(request)
    verify_csrf(request)
    result = service.link_assumption(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), concept_id,
        assumption_id=body.assumption_id, criticality=body.criticality,
    )
    return LinkDTO(**result)


@router.patch("/concepts/{concept_id}/assumptions/{assumption_id}", response_model=LinkDTO)
def patch_link(
    concept_id: str, assumption_id: str, body: LinkPatchRequest, request: Request, session: dict = Depends(require_me),
) -> LinkDTO:
    """重要度変更／要再評価(stale)解除（P.4）。"""
    verify_origin(request)
    verify_csrf(request)
    result = service.patch_link(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), concept_id, assumption_id,
        criticality=body.criticality, is_stale=body.is_stale,
    )
    return LinkDTO(**result)


@router.delete("/concepts/{concept_id}/assumptions/{assumption_id}", status_code=204)
def unlink_assumption(
    concept_id: str, assumption_id: str, request: Request, session: dict = Depends(require_me),
) -> Response:
    """リンク解除（P.4・前提本体は残す）。"""
    verify_origin(request)
    verify_csrf(request)
    service.unlink_assumption(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), concept_id, assumption_id)
    return Response(status_code=204)


# ---- コンセプト評価（P.5） ----


@router.get("/concepts/{concept_id}/evaluation/me", response_model=ConceptEvaluationMeDTO)
def get_my_evaluation(concept_id: str, request: Request, session: dict = Depends(require_me)) -> ConceptEvaluationMeDTO:
    """自分の評価/下書き（P.5・evaluator）。読取専用。"""
    result = service.get_my_evaluation(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), concept_id)
    return ConceptEvaluationMeDTO(**result)


@router.get("/concepts/{concept_id}/evaluation/revisions/{revision}/diff", response_model=ConceptEvalRevisionDiffResponse)
def get_concept_eval_revision_diff(
    concept_id: str, revision: int, request: Request,
    from_revision: int | None = Query(default=None, alias="from"),
    session: dict = Depends(require_me),
) -> ConceptEvalRevisionDiffResponse:
    """自分のコンセプト評価の確定版差分（SC-62 折り畳みUI・§3.6）。既定＝前版比較。読取専用。"""
    result = service.get_concept_eval_revision_diff(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), concept_id, revision, from_revision=from_revision,
    )
    return ConceptEvalRevisionDiffResponse(**result)


@router.get("/concepts/{concept_id}/evaluation", response_model=ConceptEvaluationAggregateDTO)
def get_evaluation(concept_id: str, request: Request, session: dict = Depends(require_me)) -> ConceptEvaluationAggregateDTO:
    """評価集計（P.5・visibility 適用）。読取専用。"""
    result = service.get_evaluation_aggregate(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), concept_id)
    return ConceptEvaluationAggregateDTO(**result)


@router.put("/concepts/{concept_id}/evaluation", response_model=ConceptEvaluationMeDTO)
def put_evaluation(
    concept_id: str, body: ConceptEvaluationPutRequest, request: Request, session: dict = Depends(require_me),
) -> ConceptEvaluationMeDTO:
    """評価 upsert（P.5・下書き/確定）。submitted は中核5＋総評＋推奨検証。"""
    verify_origin(request)
    verify_csrf(request)
    result = service.put_evaluation(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), concept_id, body=body)
    return ConceptEvaluationMeDTO(**result)


# ---- コンセプト投票（P.5b） ----


@router.post("/concepts/{concept_id}/vote", response_model=ConceptVoteResponse)
def vote_concept(
    concept_id: str, body: ConceptVoteRequest, request: Request, session: dict = Depends(require_me),
) -> ConceptVoteResponse:
    """投票（P.5b・賛成/反対・1人1票 upsert）。各コンセプト初回のみ XP+5。"""
    verify_origin(request)
    verify_csrf(request)
    result = service.vote(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), concept_id, vote_type=body.type)
    return ConceptVoteResponse(**result)


@router.delete("/concepts/{concept_id}/vote", response_model=ConceptVoteResponse)
def unvote_concept(concept_id: str, request: Request, session: dict = Depends(require_me)) -> ConceptVoteResponse:
    """投票取消（P.5b）。"""
    verify_origin(request)
    verify_csrf(request)
    result = service.remove_vote(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), concept_id)
    return ConceptVoteResponse(**result)


# ---- コンセプト議論チャット（P.6・E 機構共有） ----


@router.get("/concepts/{concept_id}/chat-scopes", response_model=ConceptChatScopeListResponse)
def list_chat_scopes(concept_id: str, request: Request, session: dict = Depends(require_me)) -> ConceptChatScopeListResponse:
    """ルーム一覧（総合/グループ/前提スレッド＋未読・P.6）。読取専用。"""
    result = service.list_chat_scopes(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), concept_id)
    return ConceptChatScopeListResponse(**result)


@router.post("/concepts/{concept_id}/chat-scopes", response_model=ConceptChatScopeItemDTO, status_code=201)
def create_chat_scope(
    concept_id: str, body: ConceptGroupScopeCreateRequest, request: Request, session: dict = Depends(require_me),
) -> ConceptChatScopeItemDTO:
    """グループ・ルーム作成（P.6・owner/quest_admin）。"""
    verify_origin(request)
    verify_csrf(request)
    result = service.create_group_scope(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), concept_id, label=body.label,
    )
    return ConceptChatScopeItemDTO(**result)


@router.get("/concept-chat-scopes/{scope_id}/messages", response_model=ConceptChatMessageListResponse)
def list_scope_messages(scope_id: str, request: Request, session: dict = Depends(require_me)) -> ConceptChatMessageListResponse:
    """メッセージ取得（P.6・E.1 同形）。読取専用。"""
    result = service.list_messages(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), scope_id)
    return ConceptChatMessageListResponse(**result)


@router.post("/concept-chat-scopes/{scope_id}/messages", response_model=ConceptChatMessageDTO, status_code=201)
def post_scope_message(
    scope_id: str, body: ConceptMessagePostRequest, request: Request, session: dict = Depends(require_me),
) -> ConceptChatMessageDTO:
    """投稿（P.6・E.3 機構共有・Idempotency-Key で二重投稿防止）。"""
    verify_origin(request)
    verify_csrf(request)
    idem = request.headers.get("Idempotency-Key")
    result = service.post_message(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), scope_id, body=body.body, message_id=idem,
    )
    return ConceptChatMessageDTO(**result)


@router.post("/concept-chat-scopes/{scope_id}/read", status_code=204)
def read_scope(scope_id: str, body: ConceptReadRequest, request: Request, session: dict = Depends(require_me)) -> Response:
    """既読位置更新（P.6・E.7 同型）。"""
    verify_origin(request)
    verify_csrf(request)
    service.read_scope(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), scope_id,
        last_read_message_id=body.last_read_message_id,
    )
    return Response(status_code=204)
