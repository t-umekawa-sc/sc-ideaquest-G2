"""ソリューション開発（ドメイン Q・FR-43・ISO④⑤）のテナント API。認可＝Depends(require_me)。

門番（二層メンバーシップ）・権限・状態機械は application 層（solutions.application）が最終権威。
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Request, Response

from app.control_plane.me.deps import require_me
from app.core.deps import verify_csrf, verify_origin
from app.tenant.solutions import application as service
from app.tenant.solutions.schemas import (
    MemberAddRequest,
    MemberPatchRequest,
    MembersResponse,
    ProjectCreateFromConceptRequest,
    ProjectCreateRequest,
    ProjectDetailDTO,
    ProjectListResponse,
    ProjectMemberDTO,
    ProjectPatchRequest,
    RecentTaskChatsResponse,
    TaskCreateRequest,
    TaskDTO,
    TaskPatchRequest,
    TaskTreeResponse,
)

router = APIRouter(prefix="/api/v1", tags=["solutions"])


def _ids(session: dict) -> tuple[uuid.UUID, uuid.UUID]:
    return uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"])


# ---- projects ----
@router.get("/projects", response_model=ProjectListResponse)
def list_projects(request: Request, session: dict = Depends(require_me)) -> ProjectListResponse:
    acc, comp = _ids(session)
    return ProjectListResponse(items=service.list_projects(acc, comp))


@router.post("/concepts/{concept_id}/project", response_model=ProjectDetailDTO, status_code=201)
def create_from_concept(concept_id: str, body: ProjectCreateFromConceptRequest, request: Request, session: dict = Depends(require_me)) -> ProjectDetailDTO:
    verify_origin(request)
    verify_csrf(request)
    acc, comp = _ids(session)
    return ProjectDetailDTO(**service.create_from_concept(
        acc, comp, concept_id, title=body.title, description=body.description,
        deployment=body.deployment, members=[m.model_dump() for m in body.members]))


@router.post("/projects", response_model=ProjectDetailDTO, status_code=201)
def create_project(body: ProjectCreateRequest, request: Request, session: dict = Depends(require_me)) -> ProjectDetailDTO:
    verify_origin(request)
    verify_csrf(request)
    acc, comp = _ids(session)
    return ProjectDetailDTO(**service.create_standalone(
        acc, comp, title=body.title, description=body.description,
        deployment=body.deployment, members=[m.model_dump() for m in body.members]))


@router.get("/projects/{project_id}", response_model=ProjectDetailDTO)
def get_project(project_id: str, request: Request, session: dict = Depends(require_me)) -> ProjectDetailDTO:
    acc, comp = _ids(session)
    return ProjectDetailDTO(**service.get_detail(acc, comp, project_id))


@router.patch("/projects/{project_id}", response_model=ProjectDetailDTO)
def patch_project(project_id: str, body: ProjectPatchRequest, request: Request, session: dict = Depends(require_me)) -> ProjectDetailDTO:
    verify_origin(request)
    verify_csrf(request)
    acc, comp = _ids(session)
    return ProjectDetailDTO(**service.update_project(acc, comp, project_id, patch=body.model_dump(exclude_unset=True)))


@router.delete("/projects/{project_id}", status_code=204)
def delete_project(project_id: str, request: Request, session: dict = Depends(require_me)) -> Response:
    verify_origin(request)
    verify_csrf(request)
    acc, comp = _ids(session)
    service.delete_project(acc, comp, project_id)
    return Response(status_code=204)


# ---- members ----
@router.get("/projects/{project_id}/members", response_model=MembersResponse)
def list_members(project_id: str, request: Request, session: dict = Depends(require_me)) -> MembersResponse:
    acc, comp = _ids(session)
    return MembersResponse(**service.list_members(acc, comp, project_id))


@router.post("/projects/{project_id}/members", response_model=ProjectMemberDTO, status_code=201)
def add_member(project_id: str, body: MemberAddRequest, request: Request, session: dict = Depends(require_me)) -> ProjectMemberDTO:
    verify_origin(request)
    verify_csrf(request)
    acc, comp = _ids(session)
    return ProjectMemberDTO(**service.add_member(acc, comp, project_id, user_id=body.user_id, role=body.role))


@router.patch("/projects/{project_id}/members/{user_id}", response_model=ProjectMemberDTO)
def patch_member(project_id: str, user_id: str, body: MemberPatchRequest, request: Request, session: dict = Depends(require_me)) -> ProjectMemberDTO:
    verify_origin(request)
    verify_csrf(request)
    acc, comp = _ids(session)
    return ProjectMemberDTO(**service.update_member(acc, comp, project_id, user_id, role=body.role))


@router.delete("/projects/{project_id}/members/{user_id}", status_code=204)
def delete_member(project_id: str, user_id: str, request: Request, session: dict = Depends(require_me)) -> Response:
    verify_origin(request)
    verify_csrf(request)
    acc, comp = _ids(session)
    service.remove_member(acc, comp, project_id, user_id)
    return Response(status_code=204)


# ---- tasks ----
@router.get("/projects/{project_id}/tasks", response_model=TaskTreeResponse)
def list_tasks(project_id: str, request: Request, session: dict = Depends(require_me)) -> TaskTreeResponse:
    acc, comp = _ids(session)
    return TaskTreeResponse(tree=service.list_tasks(acc, comp, project_id))


@router.get("/projects/{project_id}/recent-chats", response_model=RecentTaskChatsResponse)
def recent_task_chats(project_id: str, request: Request, session: dict = Depends(require_me)) -> RecentTaskChatsResponse:
    acc, comp = _ids(session)
    return RecentTaskChatsResponse(**service.recent_task_chats(acc, comp, project_id))


@router.post("/projects/{project_id}/tasks", response_model=TaskDTO, status_code=201)
def create_task(project_id: str, body: TaskCreateRequest, request: Request, session: dict = Depends(require_me)) -> TaskDTO:
    verify_origin(request)
    verify_csrf(request)
    acc, comp = _ids(session)
    return TaskDTO(**service.create_task(acc, comp, project_id, body=body.model_dump()))


@router.patch("/tasks/{task_id}", response_model=TaskDTO)
def patch_task(task_id: str, body: TaskPatchRequest, request: Request, session: dict = Depends(require_me)) -> TaskDTO:
    verify_origin(request)
    verify_csrf(request)
    acc, comp = _ids(session)
    return TaskDTO(**service.update_task(acc, comp, task_id, body=body.model_dump(exclude_unset=True)))


@router.delete("/tasks/{task_id}", status_code=204)
def delete_task(task_id: str, request: Request, session: dict = Depends(require_me)) -> Response:
    verify_origin(request)
    verify_csrf(request)
    acc, comp = _ids(session)
    service.delete_task(acc, comp, task_id)
    return Response(status_code=204)
