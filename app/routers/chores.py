"""家务任务相关接口：清单、今日视图、打卡、模板导入、自动分配。"""

from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import periods
from ..database import get_db
from ..deps import get_household
from ..models import Chore, Completion, Household, Member
from ..periods import FREQ_LABELS, WEEKDAY_LABELS
from ..presets import CHORE_PRESETS, PRESET_GROUPS, PRESETS_BY_KEY
from ..schemas import (
    ChoreCreate,
    ChoreOut,
    ChoreUpdate,
    CompleteIn,
    PresetGroup,
    PresetImport,
    PresetItem,
)
from ..services import (
    chore_to_out,
    completion_map,
    fair_assignment,
    import_presets,
    members_index,
    parse_day,
    resolve_member,
    validate_chore_payload,
)

router = APIRouter(prefix="/api", tags=["chores"])


# ---------------------------------------------------------------- 模板
@router.get("/presets", response_model=list[PresetGroup])
def list_presets():
    groups = []
    for group in PRESET_GROUPS:
        items = []
        for key in group["items"]:
            preset = PRESETS_BY_KEY[key]
            items.append(
                PresetItem(
                    key=preset["key"],
                    title=preset["title"],
                    category=preset["category"],
                    freq=preset["freq"],
                    points=preset.get("points", 1),
                    note=preset.get("note", ""),
                    freq_text=periods.freq_text(type("C", (), preset)),
                )
            )
        groups.append(
            PresetGroup(
                category=group["category"],
                label=group["label"],
                desc=group["desc"],
                items=items,
            )
        )
    return groups


# ---------------------------------------------------------------- 清单
@router.get("/households/{code}/chores", response_model=list[ChoreOut])
def list_chores(
    category: str | None = Query(default=None),
    day: str | None = Query(default=None, description="按该日期计算完成状态，默认今天"),
    household: Household = Depends(get_household),
    db: Session = Depends(get_db),
):
    target = parse_day(day)
    query = db.query(Chore).filter(Chore.household_id == household.id)
    if category:
        query = query.filter(Chore.category == category)

    chores = query.order_by(Chore.is_active.desc(), Chore.id).all()
    members = members_index(db, household.id)

    # 每条任务用它自己周期对应的 key 查询完成状态
    done_map: dict[int, Completion] = {}
    for key in {
        periods.period_key(c.freq, target) for c in chores
    }:
        done_map.update(completion_map(db, [c.id for c in chores], key))

    return [chore_to_out(c, done_map, members) for c in chores]


@router.post("/households/{code}/chores", response_model=ChoreOut, status_code=201)
def create_chore(
    payload: ChoreCreate,
    household: Household = Depends(get_household),
    db: Session = Depends(get_db),
):
    """新增一件家务。

    提出人可以指派给家里任何一个人 —— 包括自己，也包括别人。
    这是「一个人想到的事派给别人做」的入口。
    """
    validate_chore_payload(payload.category, payload.freq, payload.weekday, payload.monthday)
    proposer_id = resolve_member(db, household.id, payload.created_by_id, "提出人")
    assignee_id = resolve_member(db, household.id, payload.assignee_id, "负责人")

    chore = Chore(
        household_id=household.id,
        title=payload.title.strip(),
        category=payload.category,
        freq=payload.freq,
        weekday=payload.weekday if payload.freq == "weekly" else None,
        monthday=payload.monthday if payload.freq == "monthly" else None,
        points=payload.points,
        note=payload.note or "",
        created_by_id=proposer_id,
        assignee_id=assignee_id,
    )
    db.add(chore)
    db.commit()
    db.refresh(chore)
    return chore_to_out(chore, {}, members_index(db, household.id))


@router.patch("/chores/{chore_id}", response_model=ChoreOut)
def update_chore(
    chore_id: int, payload: ChoreUpdate, db: Session = Depends(get_db)
):
    chore = db.get(Chore, chore_id)
    if chore is None:
        raise HTTPException(status_code=404, detail="任务不存在")

    if payload.title is not None:
        chore.title = payload.title.strip()
    if payload.category is not None:
        chore.category = payload.category
    if payload.freq is not None:
        chore.freq = payload.freq
        if payload.freq != "weekly":
            chore.weekday = None
        if payload.freq != "monthly":
            chore.monthday = None
    if payload.weekday is not None:
        chore.weekday = payload.weekday
    if payload.monthday is not None:
        chore.monthday = payload.monthday
    if payload.points is not None:
        chore.points = payload.points
    if payload.note is not None:
        chore.note = payload.note
    if payload.is_active is not None:
        chore.is_active = payload.is_active

    if payload.clear_created_by:
        chore.created_by_id = None
    elif payload.created_by_id is not None:
        chore.created_by_id = resolve_member(
            db, chore.household_id, payload.created_by_id, "提出人"
        )

    if payload.clear_assignee:
        chore.assignee_id = None
    elif payload.assignee_id is not None:
        # 改派：把任务从一个成员名下转到另一个成员名下
        chore.assignee_id = resolve_member(
            db, chore.household_id, payload.assignee_id, "负责人"
        )

    validate_chore_payload(chore.category, chore.freq, chore.weekday, chore.monthday)
    db.commit()
    db.refresh(chore)
    return chore_to_out(chore, {}, members_index(db, chore.household_id))


@router.delete("/chores/{chore_id}", status_code=204)
def delete_chore(chore_id: int, db: Session = Depends(get_db)):
    chore = db.get(Chore, chore_id)
    if chore is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    db.delete(chore)
    db.commit()
    return None


# ---------------------------------------------------------------- 导入 / 分配
@router.post("/households/{code}/chores/import")
def import_chore_presets(
    payload: PresetImport,
    household: Household = Depends(get_household),
    db: Session = Depends(get_db),
):
    keys = list(payload.keys)
    if not keys and not payload.category:
        raise HTTPException(status_code=400, detail="请至少选择一个模板，或指定导入分类")

    unknown = [k for k in keys if k not in PRESETS_BY_KEY]
    if unknown:
        raise HTTPException(status_code=400, detail=f"未知模板：{unknown}")

    created_by = resolve_member(db, household.id, payload.created_by_id, "提出人")
    added = import_presets(db, household, keys, payload.category, created_by=created_by)
    return {"added": added, "total_presets": len(CHORE_PRESETS)}


@router.post("/households/{code}/chores/auto-assign")
def auto_assign(
    household: Household = Depends(get_household),
    db: Session = Depends(get_db),
):
    """把还没人认领的任务，按「工作量均衡」原则自动分给当前负载最轻的成员。"""
    if not household.members:
        raise HTTPException(status_code=400, detail="请先添加家庭成员")
    result = fair_assignment(db, household)
    return {"assigned": result["assigned"], "load": {str(k): v for k, v in result["load"].items()}}


# ---------------------------------------------------------------- 今日 / 本周
@router.get("/households/{code}/today")
def today_view(
    day: str | None = Query(default=None),
    member_id: int | None = Query(
        default=None, description="当前查看者；传了就把他名下的任务排前面"
    ),
    household: Household = Depends(get_household),
    db: Session = Depends(get_db),
):
    target = parse_day(day)
    chores = (
        db.query(Chore)
        .filter(Chore.household_id == household.id, Chore.is_active.is_(True))
        .order_by(Chore.id)
        .all()
    )
    members = members_index(db, household.id)
    viewer = member_id if member_id in members else None

    done_map: dict[int, Completion] = {}
    for key in {periods.period_key(c.freq, target) for c in chores}:
        done_map.update(completion_map(db, [c.id for c in chores], key))

    pending, done = [], []
    for chore in chores:
        if not periods.is_due(chore, target):
            continue
        item = chore_to_out(chore, done_map, members)
        (done if item.done else pending).append(item)

    # 排序：先排「别人派给我的」——这类任务最需要被看见；
    # 再排没人认领的（提醒要认领）；最后其他任务按积分从高到低。
    def rank(item) -> tuple[int, int, int]:
        if viewer and item.assignee_id == viewer and item.created_by_id != viewer:
            return (0, -item.points, item.id)
        if item.assignee_id is None:
            return (1, -item.points, item.id)
        return (2, -item.points, item.id)

    pending.sort(key=rank)

    def from_others(item) -> bool:
        return bool(
            viewer
            and item.assignee_id == viewer
            and item.created_by_id is not None
            and item.created_by_id != viewer
        )

    return {
        "day": target.isoformat(),
        "weekday": WEEKDAY_LABELS[target.weekday()],
        "pending": pending,
        "done": done,
        "summary": {
            "total": len(pending) + len(done),
            "done": len(done),
            "points_total": sum(c.points for c in pending + done),
            "points_done": sum(c.points for c in done),
            "unassigned": sum(1 for c in pending + done if c.assignee_id is None),
            "assigned_to_me": sum(1 for c in pending if from_others(c)),
        },
    }


@router.get("/households/{code}/week")
def week_view(
    start: str | None = Query(default=None, description="周起始日，默认本周一"),
    household: Household = Depends(get_household),
    db: Session = Depends(get_db),
):
    today = date.today()
    anchor = parse_day(start) if start else today
    monday = anchor - timedelta(days=anchor.weekday())

    chores = (
        db.query(Chore)
        .filter(Chore.household_id == household.id, Chore.is_active.is_(True))
        .all()
    )

    # 一次性拉取整周需要的完成记录
    keys = {periods.period_key(c.freq, monday + timedelta(days=i))
            for i in range(7) for c in chores}
    rows = (
        db.query(Completion).filter(Completion.period_key.in_(keys)).all()
        if keys else []
    )
    keyed = {(r.chore_id, r.period_key) for r in rows}

    days = []
    for i in range(7):
        d = monday + timedelta(days=i)
        due = [c for c in chores if periods.is_due(c, d)]
        done_count = sum(
            1 for c in due if (c.id, periods.period_key(c.freq, d)) in keyed
        )
        days.append(
            {
                "day": d.isoformat(),
                "weekday": WEEKDAY_LABELS[d.weekday()],
                "day_num": d.day,
                "is_today": d == today,
                "total": len(due),
                "done": done_count,
                "points": sum(c.points for c in due),
            }
        )

    return {"start": monday.isoformat(), "today": today.isoformat(), "days": days}


# ---------------------------------------------------------------- 打卡
@router.post("/chores/{chore_id}/complete", response_model=ChoreOut)
def complete_chore(
    chore_id: int, payload: CompleteIn, db: Session = Depends(get_db)
):
    chore = db.get(Chore, chore_id)
    if chore is None:
        raise HTTPException(status_code=404, detail="任务不存在")

    target = parse_day(payload.day)
    key = periods.period_key(chore.freq, target)

    member_id = payload.member_id or chore.assignee_id
    if member_id is not None:
        member = db.get(Member, member_id)
        if member is None or member.household_id != chore.household_id:
            raise HTTPException(status_code=400, detail="打卡成员不属于这个家庭")

    existing = (
        db.query(Completion)
        .filter(Completion.chore_id == chore.id, Completion.period_key == key)
        .first()
    )
    if existing is None:
        db.add(Completion(chore_id=chore.id, member_id=member_id, period_key=key))
        db.commit()
        existing = (
            db.query(Completion)
            .filter(Completion.chore_id == chore.id, Completion.period_key == key)
            .first()
        )
    elif member_id is not None:
        existing.member_id = member_id
        db.commit()

    return chore_to_out(chore, {chore.id: existing}, members_index(db, chore.household_id))


@router.delete("/chores/{chore_id}/complete", response_model=ChoreOut)
def undo_complete(
    chore_id: int,
    day: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    chore = db.get(Chore, chore_id)
    if chore is None:
        raise HTTPException(status_code=404, detail="任务不存在")

    key = periods.period_key(chore.freq, parse_day(day))
    record = (
        db.query(Completion)
        .filter(Completion.chore_id == chore.id, Completion.period_key == key)
        .first()
    )
    if record is not None:
        db.delete(record)
        db.commit()

    return chore_to_out(chore, {}, members_index(db, chore.household_id))


@router.get("/meta/options")
def meta_options():
    """给前端下拉框用的枚举。"""
    return {
        "categories": [
            {"value": "daily", "label": "日常家务"},
            {"value": "cycle", "label": "周期性家务"},
            {"value": "invisible", "label": "隐形家务"},
        ],
        "freqs": [{"value": k, "label": v} for k, v in FREQ_LABELS.items()],
        "weekdays": [{"value": i, "label": v} for i, v in enumerate(WEEKDAY_LABELS)],
    }
