"""业务辅助逻辑：序列化、今日视图、校验。"""

import secrets
from datetime import date, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy.orm import Session

from . import periods
from .models import Chore, Completion, Household, Member
from .presets import CHORE_PRESETS, PRESETS_BY_KEY
from .schemas import ChoreOut, MemberOut

# 成员头像配色池
COLOR_POOL = [
    "#7C5CFF", "#FF7A9C", "#2AC7A5", "#FFA53D",
    "#4FA8FF", "#B06BFF", "#FF6B6B", "#22B8A0",
]

CATEGORIES = {"daily", "cycle", "invisible"}
FREQS = {"daily", "weekly", "monthly", "once"}

CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # 去掉易混字符


def generate_invite_code(db: Session) -> str:
    for _ in range(30):
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(6))
        if not db.query(Household).filter(Household.invite_code == code).first():
            return code
    raise HTTPException(status_code=500, detail="邀请码生成失败，请重试")


def pick_color(db: Session, household_id: int) -> str:
    used = {
        m.color
        for m in db.query(Member).filter(Member.household_id == household_id).all()
    }
    for color in COLOR_POOL:
        if color not in used:
            return color
    return COLOR_POOL[len(used) % len(COLOR_POOL)]


def parse_day(day: str | None) -> date:
    if not day:
        return date.today()
    try:
        return datetime.strptime(day, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="日期格式应为 YYYY-MM-DD")


def validate_chore_payload(category: str, freq: str, weekday, monthday) -> None:
    if category not in CATEGORIES:
        raise HTTPException(status_code=400, detail=f"category 必须是 {sorted(CATEGORIES)} 之一")
    if freq not in FREQS:
        raise HTTPException(status_code=400, detail=f"freq 必须是 {sorted(FREQS)} 之一")
    if freq == "weekly" and weekday is not None and not 0 <= weekday <= 6:
        raise HTTPException(status_code=400, detail="weekday 必须是 0(周一) ~ 6(周日)")
    if freq == "monthly" and monthday is not None and not 1 <= monthday <= 31:
        raise HTTPException(status_code=400, detail="monthday 必须是 1 ~ 31")


def member_out(member: Member | None) -> MemberOut | None:
    if member is None:
        return None
    return MemberOut.model_validate(member)


def completion_map(db: Session, chore_ids: list[int], key: str) -> dict[int, Completion]:
    """取这批任务在指定周期内的完成记录。"""
    if not chore_ids:
        return {}
    rows = (
        db.query(Completion)
        .filter(Completion.chore_id.in_(chore_ids), Completion.period_key == key)
        .all()
    )
    return {row.chore_id: row for row in rows}


def chore_to_out(chore: Chore, done_map: dict[int, Completion] | None = None,
                 members: dict[int, Member] | None = None) -> ChoreOut:
    done_map = done_map or {}
    members = members or {}
    record = done_map.get(chore.id)
    assignee = members.get(chore.assignee_id) if chore.assignee_id else None
    return ChoreOut(
        id=chore.id,
        title=chore.title,
        category=chore.category,
        freq=chore.freq,
        weekday=chore.weekday,
        monthday=chore.monthday,
        points=chore.points,
        note=chore.note or "",
        assignee_id=chore.assignee_id,
        is_active=chore.is_active,
        freq_text=periods.freq_text(chore),
        assignee=member_out(assignee),
        done=record is not None,
        done_at=record.done_at if record else None,
    )


def members_index(db: Session, household_id: int) -> dict[int, Member]:
    rows = db.query(Member).filter(Member.household_id == household_id).all()
    return {m.id: m for m in rows}


def import_presets(db: Session, household: Household, keys: list[str],
                   category: str | None, default_assignee: int | None = None) -> int:
    """导入模板任务，跳过已存在的同名任务，返回新增条数。

    keys 与 category 都不传时，导入全部模板。
    """
    if category:
        keys = [i["key"] for i in CHORE_PRESETS if i["category"] == category] + list(keys)
    elif not keys:
        keys = [i["key"] for i in CHORE_PRESETS]

    existing_titles = {
        c.title for c in db.query(Chore).filter(Chore.household_id == household.id).all()
    }
    added = 0
    for key in dict.fromkeys(keys):  # 去重且保序
        preset = PRESETS_BY_KEY.get(key)
        if preset is None or preset["title"] in existing_titles:
            continue
        db.add(
            Chore(
                household_id=household.id,
                title=preset["title"],
                category=preset["category"],
                freq=preset["freq"],
                weekday=preset.get("weekday"),
                monthday=preset.get("monthday"),
                points=preset.get("points", 1),
                note=preset.get("note", ""),
                assignee_id=default_assignee,
            )
        )
        existing_titles.add(preset["title"])
        added += 1
    db.commit()
    return added


def fair_assignment(db: Session, household: Household) -> dict[int, int]:
    """按当前成员的「已分配积分负载」把新任务平均分配，返回 member_id -> 任务数。"""
    chores = db.query(Chore).filter(
        Chore.household_id == household.id, Chore.is_active.is_(True)
    ).all()
    load: dict[int, int] = {m.id: 0 for m in household.members}
    for chore in chores:
        if chore.assignee_id in load:
            load[chore.assignee_id] += chore.points or 1
    changed = 0
    for chore in chores:
        if chore.assignee_id is None and load:
            target = min(load, key=lambda mid: (load[mid], mid))
            chore.assignee_id = target
            load[target] += chore.points or 1
            changed += 1
    db.commit()
    return {"assigned": changed, "load": load}


def week_range(d: date) -> list[date]:
    start = d - timedelta(days=d.weekday())
    return [start + timedelta(days=i) for i in range(7)]
