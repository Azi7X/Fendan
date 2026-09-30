"""请求 / 响应数据校验模型。"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

CATEGORIES = ("daily", "cycle", "invisible")
FREQS = ("daily", "weekly", "monthly", "once")


# ---------- 入参 ----------
class HouseholdCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    owner_name: str = Field(min_length=1, max_length=32)
    owner_emoji: str = Field(default="🙂", max_length=8)


class HouseholdUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=64)


class MemberCreate(BaseModel):
    name: str = Field(min_length=1, max_length=32)
    emoji: str = Field(default="🙂", max_length=8)


class MemberUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=32)
    emoji: str | None = Field(default=None, max_length=8)
    color: str | None = Field(default=None, max_length=16)


class ChoreCreate(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    category: str = Field(default="daily")
    freq: str = Field(default="daily")
    weekday: int | None = Field(default=None, ge=0, le=6)
    monthday: int | None = Field(default=None, ge=1, le=31)
    points: int = Field(default=1, ge=1, le=10)
    note: str = Field(default="", max_length=500)
    assignee_id: int | None = None


class ChoreUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=80)
    category: str | None = None
    freq: str | None = None
    weekday: int | None = Field(default=None, ge=0, le=6)
    monthday: int | None = Field(default=None, ge=1, le=31)
    points: int | None = Field(default=None, ge=1, le=10)
    note: str | None = Field(default=None, max_length=500)
    assignee_id: int | None = None
    is_active: bool | None = None
    clear_assignee: bool = False


class CompleteIn(BaseModel):
    member_id: int | None = None
    day: str | None = None  # YYYY-MM-DD，默认今天


class PresetImport(BaseModel):
    keys: list[str] = Field(default_factory=list)
    category: str | None = None  # 传分类则导入该分类全部模板


# ---------- 响应 ----------
class MemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    emoji: str
    color: str
    is_admin: bool


class HouseholdOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    invite_code: str
    created_at: datetime


class HouseholdDetail(HouseholdOut):
    members: list[MemberOut] = []


class ChoreOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    category: str
    freq: str
    weekday: int | None
    monthday: int | None
    points: int
    note: str
    assignee_id: int | None
    is_active: bool
    freq_text: str = ""
    assignee: MemberOut | None = None
    done: bool = False
    done_at: datetime | None = None


class PresetItem(BaseModel):
    key: str
    title: str
    category: str
    freq: str
    points: int
    note: str = ""
    freq_text: str = ""


class PresetGroup(BaseModel):
    category: str
    label: str
    desc: str
    items: list[PresetItem]


class MemberStat(BaseModel):
    member_id: int
    name: str
    emoji: str
    color: str
    done_count: int
    points: int
    invisible_done: int


class StatsOut(BaseModel):
    range: str
    period_key: str
    total_done: int
    total_points: int
    invisible_points: int
    fairness: float
    members: list[MemberStat]
    daily_series: list[dict] = []
