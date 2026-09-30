# 分担 FenDan · 家庭家务分工助手

> 家务分工最大的敌人不是偷懒，而是「谁在记着这件事」。
> 分担把模糊的「家务」变成清晰的「任务」，让每个人清楚自己的责任 —— 从此不需要唠叨。

一个移动端优先的 Web App（PWA），后端纯 Python。参考 Duodo 的协作任务体验，但**完全围绕家庭分工场景设计**。

同仓库还有一版**微信小程序端**（`miniprogram/`），产品设计和数据模型一致，方便直接丢进家庭微信群分享：

| | 形态 | 后端 | 适合 |
| --- | --- | --- | --- |
| `app/` + `run.py` | 移动端 H5 / PWA | 自建 FastAPI + SQLite | 自己部署、想完全掌控数据 |
| `miniprogram/` | 微信小程序 | WorkBuddy 云服务（PostgreSQL + RLS） | 扫码就用，不用买服务器和备案域名 |

两端的家务分类、周期规则、责任整卡制、公平度算法完全一致，可以只用其中一个，也可以都留着。详见 [`miniprogram/README.md`](miniprogram/README.md)。

---

## 核心设计（对应三个步骤）

### 1️⃣ 三类清单，把「看不见的家务」显性化

| 分类 | 说明 | 例子 |
| --- | --- | --- |
| 🍳 日常家务 | 每天反复发生 | 做饭、洗碗、倒垃圾、洗衣、拖地、擦桌子、收衣服 |
| 🧽 周期性家务 | 每周 / 每月固定一次 | 每周大扫除、洗床单、刷厕所、采购、缴费 |
| 🧠 隐形家务 | 脑力活，最容易被无视 | 记着买日用品、约维修、安排孩子行程、人情往来 |

内置 **31 条家务模板**，一键导入到家里，再按实际情况改。隐形家务会被单独统计 —— 它的付出不该被当成「顺手就做了」。

### 2️⃣ 责任「整卡」制

每项任务只有一个 `assignee_id`。从「想到」到「执行」全归一个人负责，另一方不当监工。

分配不按性别，也不按「谁有空」：

- **按擅长与兴趣** 谁做饭好吃谁做饭，谁力气大谁倒垃圾拖地
- **按区域与频率** 一人负责厨房和垃圾，另一人负责浴室和洗衣
- **按工作强度** 一方忙可以多承担，但这是协商结果，不是单方面牺牲
- **⚖️ 自动均衡分配** 把没人认领的任务，按每位成员当前的积分负载派给最轻的人

### 3️⃣ 工具代替口头催促

- 今日视图 + 周条，一眼看清今天谁该干什么
- 一键打卡，自动累计积分
- 付出统计：谁做了多少、**公平度指数**、隐形家务占比、近 7 天趋势
- 邀请码邀请家人加入，数据在同一个家庭空间共享

---

## 技术栈

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 后端 | Python 3.11+ / FastAPI | 自动生成 `/docs` 交互式接口文档 |
| ORM | SQLAlchemy 2.0 | 类型化 `Mapped[...]` 声明 |
| 数据库 | SQLite | 零配置，单文件 `data/fendan.db` |
| 前端 | 原生 HTML/CSS/JS | **无构建步骤**，改完刷新即见效 |
| PWA | manifest + Service Worker | 可「添加到主屏幕」，像原生 App 一样用 |
| 测试 | pytest + httpx | 15 个接口用例 |

---

## 快速开始

```bash
# 1. 创建虚拟环境
python -m venv .venv
source .venv/Scripts/activate      # Windows (Git Bash)
# .venv\Scripts\activate.bat       # Windows (CMD)
# source .venv/bin/activate        # macOS / Linux

# 2. 安装依赖
pip install -r requirements.txt

# 国内网络慢的话，走清华镜像：
# pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple

# 3. 启动
python run.py
```

打开 <http://127.0.0.1:8000> 即可。

**想让手机也能用**（同一个 WiFi）：

```bash
python run.py --host 0.0.0.0
```

然后用手机浏览器访问 `http://<你电脑的局域网IP>:8000`，在浏览器菜单里选「添加到主屏幕」就能当 App 用了。

---

## 上手三步

1. **创建家庭** → 拿到 6 位邀请码（如 `K7M2QP`）
2. **导入清单** → 清单页点「导入模板」，先把三类家务写进家里
3. **分给谁做** → 每条任务点开指定负责人；剩下没人认领的，点「⚖️ 自动均衡分配」

家人各自打开同一个地址、输入邀请码、写上自己的名字，就能看到同一份清单。

### 想先看看长什么样？

```bash
python scripts/seed_demo.py       # 生成演示家庭（邀请码 DEMO01，含 32 项任务和一周打卡记录）
python run.py
```

然后用邀请码 `DEMO01` 加入，就能看到填满数据的样子。`--reset` 可清空重建。

---

## 项目结构

```
fendan/
├── run.py                    # 启动脚本
├── requirements.txt
├── pytest.ini
├── conftest.py               # 测试根配置（临时库隔离）
├── app/
│   ├── main.py               # FastAPI 入口 + 静态资源托管
│   ├── database.py           # 引擎 / 会话 / Base
│   ├── models.py             # Household · Member · Chore · Completion
│   ├── schemas.py            # Pydantic 校验模型
│   ├── periods.py            # 周期计算：每天/每周/每月/一次性
│   ├── presets.py            # 内置家务模板
│   ├── services.py           # 序列化、导入、自动分配等业务逻辑
│   ├── deps.py               # 邀请码 → 家庭 依赖
│   ├── routers/
│   │   ├── households.py     # 家庭与成员
│   │   ├── chores.py         # 任务、今日/本周视图、打卡
│   │   └── stats.py          # 付出统计与公平度
│   └── static/               # 移动端 H5（PWA）
│       ├── index.html
│       ├── style.css
│       ├── app.js
│       ├── sw.js
│       ├── manifest.webmanifest
│       └── icon.svg
└── tests/
    └── test_api.py           # 接口自测
```

### 小程序端目录

```
miniprogram/
├── app.json / app.js / app.wxss
├── project.config.json
├── pages/{login,today,chores,stats,family,chore-edit}/
└── utils/{config,cloud,db,views,periods,presets,store}.js
```

---

## 数据模型

```
Household (家庭)
  ├─ invite_code            6 位邀请码
  ├─ Member (成员)          name · emoji · color · is_admin
  └─ Chore (任务)
       ├─ category          daily / cycle / invisible
       ├─ freq              daily / weekly / monthly / once
       ├─ weekday           freq=weekly 时生效 (0=周一)
       ├─ monthday          freq=monthly 时生效 (1-31)
       ├─ points            工作量权重 1-10
       ├─ assignee_id       ⚠️ 责任整卡制：一项任务只挂一个人
       └─ Completion (打卡)
            ├─ period_key  每天 "2026-09-30" / 每周 "2026-W40" / 每月 "2026-09"
            └─ member_id
```

`period_key` 配合唯一约束 `(chore_id, period_key)`，保证同一周期内重复打卡不会重复计分。

---

## API 一览

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |
| POST | `/api/households` | 创建家庭 |
| GET | `/api/households/{code}` | 家庭详情（含成员） |
| PATCH | `/api/households/{code}` | 改家庭名 |
| POST | `/api/households/{code}/members` | 添加成员 |
| PATCH/DELETE | `/api/members/{id}` | 改 / 移除成员 |
| GET | `/api/presets` | 家务模板库 |
| GET | `/api/households/{code}/chores` | 家务清单 |
| POST | `/api/households/{code}/chores` | 新增任务 |
| PATCH/DELETE | `/api/chores/{id}` | 改 / 删任务 |
| POST | `/api/households/{code}/chores/import` | 导入模板 |
| POST | `/api/households/{code}/chores/auto-assign` | 自动均衡分配 |
| GET | `/api/households/{code}/today?day=` | 今日视图 |
| GET | `/api/households/{code}/week?start=` | 本周视图 |
| POST | `/api/chores/{id}/complete` | 打卡 |
| DELETE | `/api/chores/{id}/complete?day=` | 取消打卡 |
| GET | `/api/households/{code}/stats?scope=week\|month\|all` | 付出统计 |
| GET | `/api/meta/options` | 枚举选项 |

启动后访问 `/docs` 有完整的交互式文档。

---

## 测试

```bash
pytest -q
```

---

## Roadmap

- [ ] 账号体系与多家庭切换（目前用邀请码 + 本机 localStorage）
- [ ] 任务提醒 / 每日推送
- [ ] 家务轮值（同一任务多人轮流）
- [ ] 周报图片，一键分享到家庭群
- [x] 微信小程序端（见 `miniprogram/`）

---

## License

MIT
