"""内置家务模板库。

按用户需求拆成三类：
  - daily     日常家务   每天反复发生
  - cycle     周期性家务 每周 / 每月固定一次
  - invisible 隐形家务   脑力活 —— 记着、安排、对接，最容易被无视
"""

CHORE_PRESETS: list[dict] = [
    # ---------- 日常家务 ----------
    {"key": "cook", "title": "做饭", "category": "daily", "freq": "daily", "points": 3,
     "note": "含备菜与出锅"},
    {"key": "wash_dishes", "title": "洗碗", "category": "daily", "freq": "daily", "points": 2},
    {"key": "trash", "title": "倒垃圾", "category": "daily", "freq": "daily", "points": 1},
    {"key": "laundry", "title": "洗衣服", "category": "daily", "freq": "daily", "points": 2},
    {"key": "hang_clothes", "title": "晾衣服", "category": "daily", "freq": "daily", "points": 1},
    {"key": "fold_clothes", "title": "收衣服、叠衣服", "category": "daily", "freq": "daily", "points": 2},
    {"key": "mop", "title": "拖地", "category": "daily", "freq": "daily", "points": 2},
    {"key": "wipe_table", "title": "擦桌子", "category": "daily", "freq": "daily", "points": 1},
    {"key": "tidy_living", "title": "收拾客厅", "category": "daily", "freq": "daily", "points": 2},
    {"key": "clean_kitchen", "title": "清理厨房台面与灶台", "category": "daily", "freq": "daily", "points": 2},
    {"key": "walk_dog", "title": "遛狗 / 喂宠物", "category": "daily", "freq": "daily", "points": 2},
    {"key": "water_plants", "title": "浇花", "category": "daily", "freq": "daily", "points": 1},

    # ---------- 周期性家务 ----------
    {"key": "deep_clean", "title": "每周大扫除", "category": "cycle", "freq": "weekly",
     "weekday": 5, "points": 5, "note": "拖地 + 吸尘 + 整理杂物"},
    {"key": "bed_sheets", "title": "换洗床单被套", "category": "cycle", "freq": "weekly",
     "weekday": 6, "points": 3},
    {"key": "clean_bathroom", "title": "刷马桶 / 清洁浴室", "category": "cycle", "freq": "weekly",
     "weekday": 6, "points": 4},
    {"key": "windows", "title": "擦窗户", "category": "cycle", "freq": "monthly",
     "monthday": 1, "points": 4},
    {"key": "fridge", "title": "清理冰箱过期食品", "category": "cycle", "freq": "monthly",
     "monthday": 1, "points": 3},
    {"key": "trash_bin", "title": "消毒垃圾桶", "category": "cycle", "freq": "monthly",
     "monthday": 15, "points": 2},
    {"key": "wardrobe", "title": "整理衣柜、换季衣物", "category": "cycle", "freq": "monthly",
     "monthday": 20, "points": 4},
    {"key": "wash_car", "title": "洗车", "category": "cycle", "freq": "monthly",
     "points": 3},

    # ---------- 隐形家务（脑力活） ----------
    {"key": "restock", "title": "记着补日用品的库存", "category": "invisible", "freq": "weekly",
     "weekday": 4, "points": 3, "note": "纸巾、洗衣液、牙膏…没了要补"},
    {"key": "grocery", "title": "采购生活用品 / 粮油生鲜", "category": "invisible", "freq": "weekly",
     "weekday": 4, "points": 3},
    {"key": "bills", "title": "缴纳水电燃气物业费", "category": "invisible", "freq": "monthly",
     "monthday": 10, "points": 3},
    {"key": "repair", "title": "预约家电维修 / 上门服务", "category": "invisible", "freq": "once",
     "points": 4},
    {"key": "kid_schedule", "title": "安排孩子课外班与行程", "category": "invisible", "freq": "weekly",
     "weekday": 6, "points": 4},
    {"key": "kid_health", "title": "预约孩子疫苗 / 体检", "category": "invisible", "freq": "once",
     "points": 4},
    {"key": "school_notice", "title": "盯学校 / 班级通知群", "category": "invisible", "freq": "daily",
     "points": 2},
    {"key": "bookkeeping", "title": "记录家庭开销并做月度复盘", "category": "invisible", "freq": "monthly",
     "monthday": 28, "points": 3},
    {"key": "social", "title": "人情往来（送礼 / 问候 / 随礼）", "category": "invisible", "freq": "once",
     "points": 3},
    {"key": "medicine", "title": "管理家庭药箱与常备药", "category": "invisible", "freq": "monthly",
     "monthday": 15, "points": 2},
    {"key": "subscriptions", "title": "续费会员 / 订阅 / 保险", "category": "invisible", "freq": "monthly",
     "monthday": 5, "points": 2},
    {"key": "weekend_plan", "title": "规划周末家庭活动", "category": "invisible", "freq": "weekly",
     "weekday": 4, "points": 3},
]

PRESETS_BY_KEY = {item["key"]: item for item in CHORE_PRESETS}

# 前端「一键导入」用的分组视图
PRESET_GROUPS = [
    {
        "category": "daily",
        "label": "日常家务",
        "desc": "每天都在发生的、看得见的活",
        "items": [i["key"] for i in CHORE_PRESETS if i["category"] == "daily"],
    },
    {
        "category": "cycle",
        "label": "周期性家务",
        "desc": "每周 / 每月固定一次的大块活",
        "items": [i["key"] for i in CHORE_PRESETS if i["category"] == "cycle"],
    },
    {
        "category": "invisible",
        "label": "隐形家务",
        "desc": "记着、安排、对接——耗神但不被看见",
        "items": [i["key"] for i in CHORE_PRESETS if i["category"] == "invisible"],
    },
]
