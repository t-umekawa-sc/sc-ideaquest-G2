"""コンセプト・ルータ（`/api/v1`・テナントプレーン・ドメイン P・FR-42）。

認可＝Depends(require_me)。門番（パーティー所属）・権限（作成者／owner・quest_admin）・状態機械・draft 可視性は
application 層で強制。変更系は Origin/CSRF（A.0）。会社/アカウントはセッション由来（§1.5）。
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Request, Response

from app.control_plane.me.deps import require_me
from app.core.deps import verify_csrf, verify_origin
from app.tenant.concepts import application as service
from app.tenant.concepts.schemas import (
    ConceptCreateRequest,
    ConceptDecisionRequest,
    ConceptDetailDTO,
    ConceptListResponse,
    ConceptPatchRequest,
    ConceptSelectResponse,
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
