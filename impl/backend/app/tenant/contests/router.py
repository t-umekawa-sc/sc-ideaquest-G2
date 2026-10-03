"""アイデアコンテストルータ（`/api/v1/contests`・テナントプレーン・ドメイン T・FR-46）。

read（一覧/詳細）＝会社内 active ユーザー（require_me）。作成/編集＝②能力 `contest_create`（または管理者）を
application 層で検証（二重防御）。変更系は CSRF/Origin（A.0）。参加/評価/表彰は後続ステップ（T.2/T.3）。
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Request

from app.control_plane.me.deps import require_me
from app.core.deps import verify_csrf, verify_origin
from app.tenant.contests import application as service
from app.tenant.contests.schemas import (
    ContestCreateRequest,
    ContestDetail,
    ContestListResponse,
    ContestUpdateRequest,
    ContestFinalizeResponse,
    ParticipationDecideRequest,
    ParticipationResponse,
    ContestRankingResponse,
)

router = APIRouter(prefix="/api/v1", tags=["contests"])


@router.get("/contests", response_model=ContestListResponse)
def list_contests(request: Request, status: str | None = None, session: dict = Depends(require_me)):
    return service.list_contests(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), status=status)


@router.get("/contests/{contest_id}", response_model=ContestDetail)
def get_contest(contest_id: str, request: Request, session: dict = Depends(require_me)):
    return service.get_contest(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), contest_id)


@router.post("/contests", response_model=ContestDetail, status_code=201,
             dependencies=[Depends(verify_origin), Depends(verify_csrf)])
def create_contest(body: ContestCreateRequest, request: Request, session: dict = Depends(require_me)):
    return service.create_contest(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]),
        theme=body.theme, description=body.description, mode=body.mode, status=body.status,
        starts_at=body.starts_at, ends_at=body.ends_at, auto_archive_days=body.auto_archive_days,
        auto_approve=body.auto_approve, prize_config=body.prize_config)


@router.patch("/contests/{contest_id}", response_model=ContestDetail,
              dependencies=[Depends(verify_origin), Depends(verify_csrf)])
def update_contest(contest_id: str, body: ContestUpdateRequest, request: Request,
                   session: dict = Depends(require_me)):
    fields = body.model_dump(exclude_unset=True, exclude={"status"})
    return service.update_contest(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), contest_id,
        fields=fields, status=body.status)


@router.delete("/contests/{contest_id}", status_code=204,
               dependencies=[Depends(verify_origin), Depends(verify_csrf)])
def delete_contest(contest_id: str, request: Request, session: dict = Depends(require_me)):
    """コンテストを論理削除（管理者/contest_create）。backing quest も論理削除・子データは監査保持。"""
    service.delete_contest(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), contest_id)


# ---- 表彰・ランキング（T.3/T.1 finalize・§6） ----

@router.get("/contests/{contest_id}/ranking", response_model=ContestRankingResponse)
def contest_ranking(contest_id: str, request: Request, axis: str = "approve_votes",
                    session: dict = Depends(require_me)):
    return service.ranking(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]),
                           contest_id, axis=axis)


@router.post("/contests/{contest_id}/finalize", response_model=ContestFinalizeResponse,
             dependencies=[Depends(verify_origin), Depends(verify_csrf)])
def finalize_contest(contest_id: str, request: Request, session: dict = Depends(require_me)):
    """表彰確定（管理者・冪等＝Idempotency-Key 推奨・§1.9）。judging→closed・上位N へ付与。"""
    return service.finalize(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), contest_id)


# ---- 参加 2階層（T.2・§5.1） ----

@router.post("/contests/{contest_id}/participation", response_model=ParticipationResponse,
             dependencies=[Depends(verify_origin), Depends(verify_csrf)])
def request_contest_participation(contest_id: str, request: Request, session: dict = Depends(require_me)):
    return service.request_contest_participation(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), contest_id)


@router.patch("/contests/{contest_id}/participation/{uid}", response_model=ParticipationResponse,
              dependencies=[Depends(verify_origin), Depends(verify_csrf)])
def decide_contest_participation(contest_id: str, uid: str, body: ParticipationDecideRequest,
                                 request: Request, session: dict = Depends(require_me)):
    return service.decide_contest_participation(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), contest_id, uid, body.status)


@router.post("/ideas/{idea_id}/participation", response_model=ParticipationResponse,
             dependencies=[Depends(verify_origin), Depends(verify_csrf)])
def request_idea_participation(idea_id: str, request: Request, session: dict = Depends(require_me)):
    return service.request_idea_participation(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), idea_id)


@router.patch("/ideas/{idea_id}/participation/{uid}", response_model=ParticipationResponse,
              dependencies=[Depends(verify_origin), Depends(verify_csrf)])
def decide_idea_participation(idea_id: str, uid: str, body: ParticipationDecideRequest,
                              request: Request, session: dict = Depends(require_me)):
    return service.decide_idea_participation(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), idea_id, uid, body.status)
