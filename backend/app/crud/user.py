from datetime import datetime
from uuid import UUID
from sqlalchemy import select, update, or_, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User, RefreshToken
from app.schemas.user import AdminUserUpdate, UserCreate, UserUpdate
from app.core.security import get_password_hash


async def get_user(db: AsyncSession, user_id: UUID) -> User | None:
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def get_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(select(User).where(User.email == email))
    return result.scalar_one_or_none()


async def get_users(
    db: AsyncSession,
    skip: int = 0,
    limit: int = 100,
    role: str | None = None,
    is_active: bool | None = None,
    search: str | None = None,
) -> list[User]:
    query = select(User)
    if role is not None:
        query = query.where(User.role == role)
    if is_active is not None:
        query = query.where(User.is_active == is_active)
    if search:
        pattern = f"%{search}%"
        query = query.where(
            or_(
                func.lower(User.email).contains(search.lower()),
                func.lower(User.full_name).contains(search.lower()),
            )
        )
    query = query.order_by(User.created_at.desc()).offset(skip).limit(limit)
    result = await db.execute(query)
    return list(result.scalars().all())


async def create_user(
    db: AsyncSession, user_in: UserCreate, is_admin: bool = False, role: str = "viewer"
) -> User:
    # Sync role and is_admin
    if is_admin:
        role = "admin"
    user = User(
        email=user_in.email,
        hashed_password=get_password_hash(user_in.password),
        full_name=user_in.full_name,
        is_admin=is_admin,
        role=role,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def update_user(db: AsyncSession, user: User, user_in: UserUpdate) -> User:
    update_data = user_in.model_dump(exclude_unset=True)
    if "password" in update_data:
        update_data["hashed_password"] = get_password_hash(update_data.pop("password"))

    for field, value in update_data.items():
        setattr(user, field, value)

    await db.commit()
    await db.refresh(user)
    return user


async def admin_update_user(
    db: AsyncSession, user: User, user_in: AdminUserUpdate
) -> User:
    update_data = user_in.model_dump(exclude_unset=True)
    if "role" in update_data:
        role_value = update_data["role"]
        # Handle enum value
        if hasattr(role_value, "value"):
            role_value = role_value.value
        update_data["role"] = role_value
        update_data["is_admin"] = role_value == "admin"

    for field, value in update_data.items():
        setattr(user, field, value)

    await db.commit()
    await db.refresh(user)
    return user


async def delete_user(db: AsyncSession, user: User) -> None:
    # Nullify created_by_id on datasets owned by this user
    from app.models.dataset import Dataset

    await db.execute(
        update(Dataset)
        .where(Dataset.created_by_id == user.id)
        .values(created_by_id=None)
    )
    # Revoke all refresh tokens
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user.id)
        .values(revoked=True)
    )
    await db.delete(user)
    await db.commit()


async def create_refresh_token(
    db: AsyncSession, user_id: UUID, token: str, expires_at: datetime
) -> RefreshToken:
    refresh_token = RefreshToken(
        user_id=user_id,
        token=token,
        expires_at=expires_at,
    )
    db.add(refresh_token)
    await db.commit()
    return refresh_token


async def get_refresh_token(db: AsyncSession, token: str) -> RefreshToken | None:
    result = await db.execute(
        select(RefreshToken).where(
            RefreshToken.token == token,
            RefreshToken.revoked == False,
        )
    )
    return result.scalar_one_or_none()


async def revoke_refresh_token(db: AsyncSession, token: str) -> None:
    result = await db.execute(
        select(RefreshToken).where(RefreshToken.token == token)
    )
    refresh_token = result.scalar_one_or_none()
    if refresh_token:
        refresh_token.revoked = True
        await db.commit()
