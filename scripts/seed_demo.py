"""生成一份演示家庭数据，方便第一次打开就能看到完整效果。

用法：
    python scripts/seed_demo.py            # 创建/复用演示家庭
    python scripts/seed_demo.py --reset    # 清空后重建

演示家庭邀请码固定为 DEMO01，成员：爸爸 / 妈妈 / 大宝。
"""

import argparse
import random
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app import periods  # noqa: E402
from app.database import Base, SessionLocal, engine  # noqa: E402
from app.models import Chore, Completion, Household, Member  # noqa: E402
from app.services import import_presets  # noqa: E402

DEMO_CODE = "DEMO01"
DEMO_MEMBERS = [
    ("爸爸", "👨", "#7C5CFF"),
    ("妈妈", "👩", "#FF7A9C"),
    ("大宝", "👦", "#2AC7A5"),
]


def build(reset: bool) -> None:
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        existing = (
            db.query(Household).filter(Household.invite_code == DEMO_CODE).first()
        )
        if existing is not None:
            if not reset:
                print(f"演示家庭已存在，邀请码 {DEMO_CODE}（加 --reset 重建）")
                return
            db.delete(existing)
            db.commit()

        household = Household(name="演示之家", invite_code=DEMO_CODE)
        db.add(household)
        db.flush()

        members = []
        for i, (name, emoji, color) in enumerate(DEMO_MEMBERS):
            member = Member(
                household_id=household.id,
                name=name,
                emoji=emoji,
                color=color,
                is_admin=(i == 0),
            )
            db.add(member)
            members.append(member)
        db.commit()

        # 导入全部模板
        import_presets(db, household, keys=[], category=None)

        chores = db.query(Chore).filter(Chore.household_id == household.id).all()
        # 按积分负载轮流指派，保持均衡
        load = {m.id: 0 for m in members}
        for chore in chores:
            target = min(load, key=lambda mid: (load[mid], mid))
            chore.assignee_id = target
            load[target] += chore.points or 1
        db.commit()

        # 造最近 6 天的打卡记录，让统计页有内容
        rng = random.Random(20260930)
        now = datetime.now()
        seen: set[tuple[int, str]] = set()   # (chore_id, period_key) 唯一约束保护
        for offset in range(6, 0, -1):
            day = now - timedelta(days=offset)
            for chore in chores:
                if not periods.is_due(chore, day.date()):
                    continue
                key = periods.period_key(chore.freq, day.date())
                if (chore.id, key) in seen:
                    continue
                if rng.random() > 0.72:
                    continue
                seen.add((chore.id, key))
                db.add(
                    Completion(
                        chore_id=chore.id,
                        member_id=chore.assignee_id,
                        period_key=key,
                        done_at=day,
                    )
                )
        db.commit()

        print("演示家庭已就绪 ✅")
        print(f"  邀请码: {DEMO_CODE}")
        print(f"  成员  : {' / '.join(f'{e} {n}' for n, e, _ in DEMO_MEMBERS)}")
        print(f"  任务  : {len(chores)} 项")
        print("\n  启动服务后打开 http://127.0.0.1:8000 ，用邀请码 DEMO01 加入即可")
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="生成演示数据")
    parser.add_argument("--reset", action="store_true", help="清空演示家庭后重建")
    args = parser.parse_args()
    build(args.reset)
