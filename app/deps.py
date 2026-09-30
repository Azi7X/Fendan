"""通用依赖：按邀请码取家庭。"""

from fastapi import Depends, HTTPException, Path
from sqlalchemy.orm import Session

from .database import get_db
from .models import Household


def get_household(
    code: str = Path(..., min_length=4, max_length=16),
    db: Session = Depends(get_db),
) -> Household:
    household = db.query(Household).filter(Household.invite_code == code.upper()).first()
    if household is None:
        raise HTTPException(status_code=404, detail="邀请码无效，或该家庭已不存在")
    return household
