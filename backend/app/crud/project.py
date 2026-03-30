from uuid import UUID
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.project import Project, ProjectMember
from app.models.dataset import Dataset
from app.schemas.project import ProjectCreate, ProjectUpdate


async def get_project(db: AsyncSession, project_id: UUID) -> Project | None:
    result = await db.execute(
        select(Project)
        .options(selectinload(Project.members).selectinload(ProjectMember.user))
        .where(Project.id == project_id)
    )
    return result.scalar_one_or_none()


async def get_projects(
    db: AsyncSession,
    user_id: UUID | None = None,
    is_admin: bool = False,
    skip: int = 0,
    limit: int = 100,
) -> tuple[list[Project], int]:
    """Get projects. Admins see all; regular users see only their projects."""
    query = select(Project)
    count_query = select(func.count(Project.id))

    if not is_admin and user_id:
        member_subquery = select(ProjectMember.project_id).where(
            ProjectMember.user_id == user_id
        )
        query = query.where(Project.id.in_(member_subquery))
        count_query = count_query.where(Project.id.in_(member_subquery))

    query = query.order_by(Project.created_at.desc()).offset(skip).limit(limit)

    result = await db.execute(query)
    projects = list(result.scalars().all())

    count_result = await db.execute(count_query)
    total = count_result.scalar()

    return projects, total


async def create_project(
    db: AsyncSession, project_in: ProjectCreate, created_by_id: UUID
) -> Project:
    project = Project(
        name=project_in.name,
        description=project_in.description,
        created_by_id=created_by_id,
    )
    db.add(project)
    await db.flush()

    # Add creator as owner
    member = ProjectMember(
        project_id=project.id,
        user_id=created_by_id,
        role="owner",
    )
    db.add(member)
    await db.commit()
    await db.refresh(project)
    return project


async def update_project(
    db: AsyncSession, project: Project, project_in: ProjectUpdate
) -> Project:
    update_data = project_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(project, field, value)
    await db.commit()
    await db.refresh(project)
    return project


async def delete_project(db: AsyncSession, project: Project) -> None:
    # Unlink datasets from this project (don't delete them)
    datasets = await db.execute(select(Dataset).where(Dataset.project_id == project.id))
    for dataset in datasets.scalars():
        dataset.project_id = None
        dataset.category = "reference"
    await db.delete(project)
    await db.commit()


async def get_member_count(db: AsyncSession, project_id: UUID) -> int:
    result = await db.execute(
        select(func.count(ProjectMember.id)).where(
            ProjectMember.project_id == project_id
        )
    )
    return result.scalar() or 0


async def get_dataset_count(db: AsyncSession, project_id: UUID) -> int:
    result = await db.execute(
        select(func.count(Dataset.id)).where(Dataset.project_id == project_id)
    )
    return result.scalar() or 0


async def get_bulk_counts(
    db: AsyncSession, project_ids: list[UUID]
) -> dict[UUID, tuple[int, int]]:
    """Get member and dataset counts for multiple projects in 2 queries."""
    if not project_ids:
        return {}

    # Member counts
    member_q = await db.execute(
        select(ProjectMember.project_id, func.count(ProjectMember.id))
        .where(ProjectMember.project_id.in_(project_ids))
        .group_by(ProjectMember.project_id)
    )
    member_counts = {row[0]: row[1] for row in member_q.fetchall()}

    # Dataset counts
    dataset_q = await db.execute(
        select(Dataset.project_id, func.count(Dataset.id))
        .where(Dataset.project_id.in_(project_ids))
        .group_by(Dataset.project_id)
    )
    dataset_counts = {row[0]: row[1] for row in dataset_q.fetchall()}

    return {
        pid: (member_counts.get(pid, 0), dataset_counts.get(pid, 0))
        for pid in project_ids
    }


async def get_project_member(
    db: AsyncSession, project_id: UUID, user_id: UUID
) -> ProjectMember | None:
    result = await db.execute(
        select(ProjectMember)
        .options(selectinload(ProjectMember.user))
        .where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user_id,
        )
    )
    return result.scalar_one_or_none()


async def add_member(
    db: AsyncSession, project_id: UUID, user_id: UUID, role: str = "viewer"
) -> ProjectMember:
    member = ProjectMember(
        project_id=project_id,
        user_id=user_id,
        role=role,
    )
    db.add(member)
    await db.commit()
    await db.refresh(member)
    return member


async def update_member_role(
    db: AsyncSession, member: ProjectMember, role: str
) -> ProjectMember:
    member.role = role
    await db.commit()
    await db.refresh(member, attribute_names=["user"])
    return member


async def remove_member(db: AsyncSession, member: ProjectMember) -> None:
    await db.delete(member)
    await db.commit()
