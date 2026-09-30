"""数据模型：家庭 / 成员 / 家务任务 / 完成记录。"""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class Household(Base):
    """一个家庭（工作区），用 6 位邀请码邀请成员加入。"""

    __tablename__ = "households"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(64))
    invite_code: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)

    members: Mapped[list["Member"]] = relationship(
        back_populates="household", cascade="all, delete-orphan", order_by="Member.id"
    )
    chores: Mapped[list["Chore"]] = relationship(
        back_populates="household", cascade="all, delete-orphan", order_by="Chore.id"
    )


class Member(Base):
    """家庭成员。emoji + color 用于生成头像。"""

    __tablename__ = "members"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    household_id: Mapped[int] = mapped_column(
        ForeignKey("households.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(32))
    emoji: Mapped[str] = mapped_column(String(8), default="🙂")
    color: Mapped[str] = mapped_column(String(16), default="#7C5CFF")
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)

    household: Mapped["Household"] = relationship(back_populates="members")


class Chore(Base):
    """一条家务任务。

    category: daily(日常) / cycle(周期性) / invisible(隐形家务)
    freq:     daily(每天) / weekly(每周) / monthly(每月) / once(一次性)

    「想到」与「做完」是两个动作，分别记在两个人身上：
      created_by_id —— 谁提出这件事（脑力活，往往是隐形家务）
      assignee_id   —— 谁负责把它做完（执行活，责任整卡制，只归一个人）

    一个人想到的事可以派给任何家庭成员做；被派的人不再是「靠自觉」，
    而是有一条明确属于他的任务。提出人负责记录，不当监工。
    """

    __tablename__ = "chores"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    household_id: Mapped[int] = mapped_column(
        ForeignKey("households.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(80))
    category: Mapped[str] = mapped_column(String(16), default="daily", index=True)
    freq: Mapped[str] = mapped_column(String(16), default="daily")
    weekday: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 0=周一
    monthday: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 1-31
    points: Mapped[int] = mapped_column(Integer, default=1)
    note: Mapped[str] = mapped_column(Text, default="")
    created_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("members.id", ondelete="SET NULL"), nullable=True, index=True
    )
    assignee_id: Mapped[int | None] = mapped_column(
        ForeignKey("members.id", ondelete="SET NULL"), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)

    household: Mapped["Household"] = relationship(back_populates="chores")
    completions: Mapped[list["Completion"]] = relationship(
        back_populates="chore", cascade="all, delete-orphan"
    )


class Completion(Base):
    """一次打卡记录。period_key 保证同一周期内不会重复计入。"""

    __tablename__ = "completions"
    __table_args__ = (UniqueConstraint("chore_id", "period_key", name="uq_chore_period"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    chore_id: Mapped[int] = mapped_column(
        ForeignKey("chores.id", ondelete="CASCADE"), index=True
    )
    member_id: Mapped[int | None] = mapped_column(
        ForeignKey("members.id", ondelete="SET NULL"), nullable=True, index=True
    )
    period_key: Mapped[str] = mapped_column(String(16), index=True)
    done_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)

    chore: Mapped["Chore"] = relationship(back_populates="completions")
