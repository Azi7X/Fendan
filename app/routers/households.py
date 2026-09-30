"""家庭与成员相关接口。"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_household
from ..models import Household, Member
from ..schemas import (
    HouseholdCreate,
    HouseholdDetail,
    HouseholdUpdate,
    MemberCreate,
    MemberOut,
    MemberUpdate,
)
from ..services import generate_invite_code, pick_color

router = APIRouter(prefix="/api", tags=["households"])


@router.post("/households", response_model=HouseholdDetail, status_code=201)
def create_household(payload: HouseholdCreate, db: Session = Depends(get_db)):
    household = Household(
        name=payload.name.strip(),
        invite_code=generate_invite_code(db),
    )
    db.add(household)
    db.flush()

    owner = Member(
        household_id=household.id,
        name=payload.owner_name.strip(),
        emoji=payload.owner_emoji or "🙂",
        color=pick_color(db, household.id),
        is_admin=True,
    )
    db.add(owner)
    db.commit()
    db.refresh(household)
    return household


@router.get("/households/{code}", response_model=HouseholdDetail)
def read_household(household: Household = Depends(get_household)):
    return household


@router.patch("/households/{code}", response_model=HouseholdDetail)
def update_household(
    payload: HouseholdUpdate,
    household: Household = Depends(get_household),
    db: Session = Depends(get_db),
):
    household.name = payload.name.strip()
    db.commit()
    db.refresh(household)
    return household


@router.post("/households/{code}/members", response_model=MemberOut, status_code=201)
def add_member(
    payload: MemberCreate,
    household: Household = Depends(get_household),
    db: Session = Depends(get_db),
):
    name = payload.name.strip()
    duplicated = (
        db.query(Member)
        .filter(Member.household_id == household.id, Member.name == name)
        .first()
    )
    if duplicated:
        raise HTTPException(status_code=409, detail=f"家里已经有一个「{name}」了")

    member = Member(
        household_id=household.id,
        name=name,
        emoji=payload.emoji or "🙂",
        color=pick_color(db, household.id),
    )
    db.add(member)
    db.commit()
    db.refresh(member)
    return member


@router.patch("/members/{member_id}", response_model=MemberOut)
def update_member(
    member_id: int, payload: MemberUpdate, db: Session = Depends(get_db)
):
    member = db.get(Member, member_id)
    if member is None:
        raise HTTPException(status_code=404, detail="成员不存在")

    if payload.name is not None:
        member.name = payload.name.strip()
    if payload.emoji is not None:
        member.emoji = payload.emoji
    if payload.color is not None:
        member.color = payload.color
    db.commit()
    db.refresh(member)
    return member


@router.delete("/members/{member_id}", status_code=204)
def delete_member(member_id: int, db: Session = Depends(get_db)):
    member = db.get(Member, member_id)
    if member is None:
        raise HTTPException(status_code=404, detail="成员不存在")

    remaining = (
        db.query(Member).filter(Member.household_id == member.household_id).count()
    )
    if remaining <= 1:
        raise HTTPException(status_code=400, detail="至少保留一位家庭成员")

    db.delete(member)
    db.commit()
    return None
