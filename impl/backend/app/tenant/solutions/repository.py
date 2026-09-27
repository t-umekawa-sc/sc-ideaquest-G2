"""会社DB ソリューション開発の read/write プリミティブ（ドメイン Q・FR-43）。commit は呼び出し側（application）。"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.tenant.solutions.orm import Project, ProjectMember, Task


# ---- projects ----
def create_project(session: Session, *, concept_id: uuid.UUID | None, quest_id: uuid.UUID | None,
                   title: str, description: str | None, owner_account_id: uuid.UUID,
                   deployment: dict | None = None, status: str = "planning") -> Project:
    p = Project(
        id=uuid.uuid4(), concept_id=concept_id, quest_id=quest_id, title=title, description=description,
        status=status, deployment=deployment or {}, owner_account_id=owner_account_id,
    )
    session.add(p)
    session.flush()
    return p


def get_project(session: Session, project_id: uuid.UUID) -> Project | None:
    p = session.get(Project, project_id)
    return p if p is not None and p.deleted_at is None else None


def get_project_by_concept(session: Session, concept_id: uuid.UUID) -> Project | None:
    return session.execute(
        select(Project).where(Project.concept_id == concept_id, Project.deleted_at.is_(None))
    ).scalars().first()


def list_projects(session: Session) -> list[Project]:
    return list(session.execute(
        select(Project).where(Project.deleted_at.is_(None)).order_by(Project.updated_at.desc(), Project.id)
    ).scalars().all())


def touch_project(session: Session, project: Project) -> None:
    project.updated_at = datetime.now(timezone.utc)
    session.flush()


def soft_delete_project(session: Session, project: Project) -> None:
    project.deleted_at = datetime.now(timezone.utc)
    session.flush()


# ---- members ----
def add_member(session: Session, *, project_id: uuid.UUID, user_id: uuid.UUID, role: str = "member") -> ProjectMember:
    m = ProjectMember(id=uuid.uuid4(), project_id=project_id, user_id=user_id, role=role)
    session.add(m)
    session.flush()
    return m


def get_member(session: Session, project_id: uuid.UUID, user_id: uuid.UUID) -> ProjectMember | None:
    return session.execute(
        select(ProjectMember).where(ProjectMember.project_id == project_id, ProjectMember.user_id == user_id)
    ).scalars().first()


def list_members(session: Session, project_id: uuid.UUID) -> list[ProjectMember]:
    return list(session.execute(
        select(ProjectMember).where(ProjectMember.project_id == project_id).order_by(ProjectMember.added_at, ProjectMember.id)
    ).scalars().all())


def remove_member(session: Session, member: ProjectMember) -> None:
    session.delete(member)
    session.flush()


# ---- tasks ----
def create_task(session: Session, *, project_id: uuid.UUID, parent_task_id: uuid.UUID | None, kind: str,
                title: str, description: str | None, assignee_account_id: uuid.UUID | None,
                status: str = "todo", sort_order: int = 0, due_date=None) -> Task:
    t = Task(
        id=uuid.uuid4(), project_id=project_id, parent_task_id=parent_task_id, kind=kind, title=title,
        description=description, assignee_account_id=assignee_account_id, status=status,
        sort_order=sort_order, due_date=due_date, done_at=(datetime.now(timezone.utc) if status == "done" else None),
    )
    session.add(t)
    session.flush()
    return t


def get_task(session: Session, task_id: uuid.UUID) -> Task | None:
    return session.get(Task, task_id)


def list_tasks(session: Session, project_id: uuid.UUID) -> list[Task]:
    """プロジェクト配下の全タスク（フラット・親→兄弟順で application がツリー化）。"""
    return list(session.execute(
        select(Task).where(Task.project_id == project_id).order_by(Task.sort_order, Task.created_at, Task.id)
    ).scalars().all())


def has_children(session: Session, task_id: uuid.UUID) -> bool:
    return session.execute(select(Task.id).where(Task.parent_task_id == task_id).limit(1)).first() is not None


def delete_task(session: Session, task: Task) -> None:
    session.delete(task)
    session.flush()


def touch_task(session: Session, task: Task) -> None:
    task.updated_at = datetime.now(timezone.utc)
    session.flush()
