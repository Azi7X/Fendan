# 分担 · 微信小程序端

家庭家务分工助手的微信小程序客户端。和同仓库的 Web 版（`app/` + FastAPI）是**同一套产品设计、同一套数据模型**，但后端换成了 WorkBuddy 云服务 —— 因为小程序访问不了 localhost，也需要一个不用自己买服务器、备案域名的后端。

```
miniprogram/
├── project.config.json     # miniprogramRoot: "./"
├── app.json                # 页面清单 / tabBar / lazyCodeLoading
├── app.js                  # 启动
├── app.wxss                # 全局设计变量与公共样式
├── sitemap.json
├── package.json            # 依赖 @tencent-ai/workbuddy-cloud-sdk@dev（需「构建 npm」）
├── pages/
│   ├── login/              # 启动页：微信一键登录 → 创建家庭 / 邀请码加入
│   ├── today/              # 今日视图：周条 + 完成度 + 打卡
│   ├── chores/             # 家务清单：三类分组 + 模板一键导入
│   ├── stats/              # 付出统计：公平度 + 隐形家务占比 + 近 7 天趋势
│   ├── family/             # 家庭：成员、邀请码、自动均衡分配
│   └── chore-edit/         # 新增 / 编辑任务
└── utils/
    ├── config.js           # 云服务 publicConfig（endpoint + publishableKey）
    ├── cloud.js            # 客户端初始化（全项目唯一一次）
    ├── workbuddy-cloud-diagnostics.js  # 请求失败诊断，输出到 vConsole
    ├── db.js               # 所有云端读写都收在这里
    ├── views.js            # 今日 / 本周 / 统计的纯计算
    ├── periods.js          # 每天 / 每周 / 每月 / 一次性的周期规则
    ├── presets.js          # 31 条家务模板
    └── store.js            # 家庭上下文 + 内存缓存
```

## 数据表（云数据库 · PostgreSQL）

| 表 | 说明 |
| --- | --- |
| `households` | 家庭：名称 + 6 位邀请码，`owner_id` 为创建者 |
| `members` | 成员：`user_id` 指向登录身份，含名字 / emoji / 头像色 |
| `chores` | 家务任务：三类分类、四种周期、积分、**单一负责人（责任整卡制）** |
| `completions` | 打卡记录：`(chore_id, period_key)` 唯一，同周期不会重复计分 |

所有写入都发生在客户端，数据隔离靠数据库的 RLS（Row Level Security）：

- `members` 只能看到自己，或与自己在同一个家庭的人
- `chores` / `completions` 只能读写自己所在家庭的数据
- 客户端**从不发送** `owner_id` / `user_id`，由 `DEFAULT auth.uid()` 以及 RLS 的 `WITH CHECK` 决定
- 邀请码不公开可枚举：加入家庭走服务端函数 `join_household(code, name, emoji)`，校验通过才登记成员

## 周期规则

`period_key` 保证同一周期内重复打卡不重复计分：

| 周期 | period_key | 例 |
| --- | --- | --- |
| 每天 | `YYYY-MM-DD` | `2026-09-30` |
| 每周 | `YYYY-Www`（ISO 周） | `2026-W40` |
| 每月 | `YYYY-MM` | `2026-09` |
| 一次性 | `once` | `once` |

## 开发提示

- 依赖通过 `package.json` 声明，在开发者工具里执行一次「工具 → 构建 npm」生成 `miniprogram_npm`。
- 请求失败会在真机 vConsole 里输出 `[WorkBuddy Cloud] request failed`，带 HTTP 状态与错误码；成功请求不打印。
- 不要在 `utils/config.js` 之外硬编码 endpoint。小程序没有 Origin，靠微信的请求域名白名单鉴权，所有小程序共用同一个网关地址。
