"""统计接口：谁做了多少、公平度、隐形家务占比、近 7 天趋势。"""

from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_household
from ..models import Chore, Completion, Household, Member
from ..schemas import MemberStat, StatsOut

router = APIRouter(prefix="/api", tags=["stats"])


def _gini(values: list[int]) -> float:
    """基尼系数：0 表示完全平均，越接近 1 越不均。"""
    data = sorted(v for v in values if v >= 0)
    n = len(data)
    total = sum(data)
    if n == 0 or total == 0:
        return 0.0
    weighted = sum((i + 1) * v for i, v in enumerate(data))
    return (2 * weighted) / (n * total) - (n + 1) / n


def _range_start(scope: str) -> datetime | None:
    today = date.today()
    if scope == "week":
        monday = today - timedelta(days=today.weekday())
        return datetime.combine(monday, time.min)
    if scope == "month":
        return datetime.combine(today.replace(day=1), time.min)
    return None


def _scope_label(scope: str) -> str:
    today = date.today()
    if scope == "week":
        monday = today - timedelta(days=today.weekday())
        return f"本周 {monday.month}/{monday.day} - {(monday + timedelta(days=6)).month}/{(monday + timedelta(days=6)).day}"
    if scope == "month":
        return f"本月 {today.month} 月"
    return "全部时间"


@router.get("/households/{code}/stats", response_model=StatsOut)
def household_stats(
    scope: str = Query(default="week", pattern="^(week|month|all)$"),
    household: Household = Depends(get_household),
    db: Session = Depends(get_db),
):
    since = _range_start(scope)

    member_rows = (
        db.query(Member).filter(Member.household_id == household.id).order_by(Member.id).all()
    )
    chores = db.query(Chore).filter(Chore.household_id == household.id).all()
    chore_map = {c.id: c for c in chores}
    chore_ids = list(chore_map)

    query = db.query(Completion)
    if chore_ids:
        query = query.filter(Completion.chore_id.in_(chore_ids))
    else:
        query = query.filter(Completion.chore_id == -1)
    if since is not None:
        query = query.filter(Completion.done_at >= since)
    completions = query.all()

    stats: dict[int, MemberStat] = {
        m.id: MemberStat(
            member_id=m.id, name=m.name, emoji=m.emoji, color=m.color,
            done_count=0, points=0, invisible_done=0,
        )
        for m in member_rows
    }
    unassigned = MemberStat(
        member_id=0, name="未分配", emoji="❓", color="#B9B4CC",
        done_count=0, points=0, invisible_done=0,
    )

    total_points = 0
    invisible_points = 0
    for record in completions:
        chore = chore_map.get(record.chore_id)
        if chore is None:
            continue
        bucket = stats.get(record.member_id) or stats.get(chore.assignee_id) or unassigned
        weight = chore.points or 1
        bucket.done_count += 1
        bucket.points += weight
        total_points += weight
        if chore.category == "invisible":
            bucket.invisible_done += 1
            invisible_points += weight

    payload = list(stats.values())
    if unassigned.done_count:
        payload.append(unassigned)

    gini = _gini([s.points for s in payload if s.member_id != 0] or [0])

    # 近 7 天完成趋势
    today = date.today()
    daily_series = []
    for offset in range(6, -1, -1):
        d = today - timedelta(days=offset)
        same_day = [
            r for r in completions
            if r.done_at and r.done_at.date() == d
        ]
        points = sum((chore_map.get(r.chore_id).points or 1) for r in same_day if chore_map.get(r.chore_id))
        daily_series.append(
            {
                "day": d.isoformat(),
                "label": f"{d.month}/{d.day}",
                "weekday": ["一", "二", "三", "四", "五", "六", "日"][d.weekday()],
                "count": len(same_day),
                "points": points,
            }
        )

    return StatsOut(
        range=scope,
        period_key=_scope_label(scope),
        total_done=sum(s.done_count for s in payload),
        total_points=total_points,
        invisible_points=invisible_points,
        fairness=round(max(0.0, 1 - gini), 3),
        members=sorted(payload, key=lambda s: (-s.points, s.member_id)),
        daily_series=daily_series,
    )
