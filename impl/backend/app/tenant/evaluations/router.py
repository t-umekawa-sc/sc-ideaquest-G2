"""評価ルータ（`/api/v1`・テナントプレーン・ドメイン F）。

認可＝Depends(require_me)。門番（パーティー所属）・権限（evaluator／owner・quest_admin）・状態機械は application 層で強制。
変更系は Origin/CSRF（A.0）。会社/アカウントはセッション由来（§1.5）。
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Request

from app.control_plane.me.deps import require_me
from app.core.deps import verify_csrf, verify_origin
from app.tenant.evaluations import application as eval_service
from app.tenant.evaluations.schemas import (
    EvaluationAggregateDTO,
    EvaluationMeDTO,
    EvaluationPutRequest,
    IdeaSelectResponse,
)

router = APIRouter(prefix="/api/v1", tags=["evaluations"])


@router.get("/ideas/{idea_id}/evaluation/me", response_model=EvaluationMeDTO)
def get_my_evaluation(
    idea_id: str,
    request: Request,
    session: dict = Depends(require_me),
) -> EvaluationMeDTO:
    """自分の評価/下書き（SC-25・F.1）。門番＋evaluator 権限はサーバー強制。読取専用。"""
    result = eval_service.get_my_evaluation(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), idea_id,
    )
    return EvaluationMeDTO(**result)


@router.get("/ideas/{idea_id}/evaluation", response_model=EvaluationAggregateDTO)
def get_aggregate(
    idea_id: str,
    request: Request,
    session: dict = Depends(require_me),
) -> EvaluationAggregateDTO:
    """評価結果の集計（SC-22 §4.6・F.1）。可視な評価のみで算定・limited は範囲外非表示。読取専用。"""
    result = eval_service.get_aggregate(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), idea_id,
    )
    return EvaluationAggregateDTO(**result)


@router.put("/ideas/{idea_id}/evaluation", response_model=EvaluationMeDTO)
def put_evaluation(
    idea_id: str,
    body: EvaluationPutRequest,
    request: Request,
    session: dict = Depends(require_me),
) -> EvaluationMeDTO:
    """自分の評価を登録/更新（SC-25・F.2）。submitted は全5観点＋総評検証＋XP+30＋コイン確定判定(a)。"""
    verify_origin(request)
    verify_csrf(request)
    result = eval_service.put_evaluation(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), idea_id, body=body,
    )
    return EvaluationMeDTO(**result)


@router.post("/ideas/{idea_id}/select", response_model=IdeaSelectResponse)
def select_idea(
    idea_id: str,
    request: Request,
    session: dict = Depends(require_me),
) -> IdeaSelectResponse:
    """アイデアを選定（F.3・owner/quest_admin）。投稿者へ XP+200（初回・剥奪なし）。完了は 409。"""
    verify_origin(request)
    verify_csrf(request)
    result = eval_service.select_idea(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), idea_id, selected=True,
    )
    return IdeaSelectResponse(**result)


@router.delete("/ideas/{idea_id}/select", response_model=IdeaSelectResponse)
def unselect_idea(
    idea_id: str,
    request: Request,
    session: dict = Depends(require_me),
) -> IdeaSelectResponse:
    """選定を解除（F.3・owner/quest_admin）。XP は剥奪しない。完了は 409。"""
    verify_origin(request)
    verify_csrf(request)
    result = eval_service.select_idea(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), idea_id, selected=False,
    )
    return IdeaSelectResponse(**result)
