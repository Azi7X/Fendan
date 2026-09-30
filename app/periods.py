"""周期计算：把「每天 / 每周 / 每月 / 一次性」翻译成可比较的 period_key。"""

from datetime import date

FREQ_LABELS = {
    "daily": "每天",
    "weekly": "每周",
    "monthly": "每月",
    "once": "一次性",
}

CATEGORY_LABELS = {
    "daily": "日常家务",
    "cycle": "周期性家务",
    "invisible": "隐形家务",
}

WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]


def period_key(freq: str, d: date) -> str:
    """返回当前日期所属周期的唯一标识。"""
    if freq == "daily":
        return d.isoformat()
    if freq == "weekly":
        iso_year, iso_week, _ = d.isocalendar()
        return f"{iso_year}-W{iso_week:02d}"
    if freq == "monthly":
        return f"{d.year}-{d.month:02d}"
    return "once"


def is_due(chore, d: date) -> bool:
    """判断某条任务在给定日期是否需要做（用于「今日」视图）。"""
    if not chore.is_active:
        return False

    if chore.freq == "daily":
        return True

    if chore.freq == "weekly":
        if chore.weekday is None:
            return True  # 未指定星期几 → 本周任意一天都可以做
        return d.weekday() == chore.weekday

    if chore.freq == "monthly":
        if chore.monthday is None:
            return True
        if chore.monthday > 28:
            # 29/30/31 号在小月不存在时，落到当月最后一天
            import calendar

            last_day = calendar.monthrange(d.year, d.month)[1]
            return d.day == min(chore.monthday, last_day)
        return d.day == chore.monthday

    return True  # once：一直待办，直到被完成


def freq_text(chore) -> str:
    """生成人类可读的周期描述，例如「每周 · 周三」。"""
    if chore.freq == "weekly" and chore.weekday is not None:
        return f"每周 · {WEEKDAY_LABELS[chore.weekday]}"
    if chore.freq == "monthly" and chore.monthday is not None:
        return f"每月 · {chore.monthday} 号"
    return FREQ_LABELS.get(chore.freq, chore.freq)
