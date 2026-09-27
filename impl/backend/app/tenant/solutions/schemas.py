"""ソリューション開発（ドメイン Q・FR-43）の Pydantic DTO（request＝extra forbid／response）。"""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class UserRefDTO(BaseModel):
    user_id: str
    display_name: str
    avatar_image_url: str | None = None


class RefDTO(BaseModel):
    id: str
    title: str


class ProgressDTO(BaseModel):
    done: int
    total: int


class MemberInputDTO(BaseModel):
    model_config = ConfigDict(extra="forbid")
    user_id: str
    role: str = "member"


# ---- requests ----
class ProjectCreateFromConceptRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str | None = None
    description: str | None = None
    deployment: dict | None = None
    members: list[MemberInputDTO] = Field(default_factory=list)


class ProjectCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1)
    description: str | None = None
    deployment: dict | None = None
    members: list[MemberInputDTO] = Field(default_factory=list)


class ProjectPatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str | None = None
    description: str | None = None
    status: str | None = None
    deployment: dict | None = None
    external_link: dict | None = None


class MemberAddRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    user_id: str
    role: str = "member"


class MemberPatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: str


class TaskCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    parent_task_id: str | None = None
    kind: str = "task"
    title: str = Field(min_length=1)
    description: str | None = None
    assignee_account_id: str | None = None
    status: str = "todo"
    sort_order: int = 0
    due_date: str | None = None


class TaskPatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    parent_task_id: str | None = None
    kind: str | None = None
    title: str | None = None
    description: str | None = None
    assignee_account_id: str | None = None
    status: str | None = None
    due_date: str | None = None


# ---- responses ----
class MyProjectPermsDTO(BaseModel):
    can_edit: bool
    can_manage_members: bool
    can_manage_tasks: bool


class ProjectListItemDTO(BaseModel):
    id: str
    title: str
    status: str
    concept: RefDTO | None = None
    quest: RefDTO | None = None
    progress: ProgressDTO
    task_count: int
    owner: UserRefDTO | None = None
    updated_at: str


class ProjectListResponse(BaseModel):
    items: list[ProjectListItemDTO]


class ProjectDetailDTO(BaseModel):
    id: str
    title: str
    description: str | None = None
    status: str
    deployment: dict
    external_link: dict | None = None
    concept: RefDTO | None = None
    quest: RefDTO | None = None
    owner: UserRefDTO | None = None
    progress: ProgressDTO
    viewer_domain: str
    viewer_user_id: str
    my_permissions: MyProjectPermsDTO


class ProjectMemberDTO(BaseModel):
    user: UserRefDTO | None = None
    role: str
    added_at: str


class MembersResponse(BaseModel):
    members: list[ProjectMemberDTO]
    innovation_members: list[UserRefDTO]


class TaskDTO(BaseModel):
    id: str
    project_id: str
    parent_task_id: str | None = None
    kind: str
    title: str
    description: str | None = None
    assignee: UserRefDTO | None = None
    status: str
    sort_order: int
    due_date: str | None = None
    done_at: str | None = None
    children: list["TaskDTO"] = Field(default_factory=list)


class TaskTreeResponse(BaseModel):
    tree: list[TaskDTO]


class RecentTaskChatDTO(BaseModel):
    task_id: str
    title: str
    unread_chat_count: int
    last_chat_at: str | None = None


class RecentTaskChatsResponse(BaseModel):
    items: list[RecentTaskChatDTO]
