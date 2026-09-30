# 分担 · 微信小程序端

家庭家务分工助手的微信小程序客户端。和同仓库的 Web 版（`app/` + FastAPI）是**同一套产品设计、同一套数据模型**，但后端换成了 WorkBuddy 云服务 —— 因为小程序访问不了 localhost，也需要一个不用自己买服务器、备案域名的后端。

```
miniprogram/
├── project.config.json     # miniprogramRoot: "./"
├── app.json                # 页面清单 / tabBar / lazyCodeLoading
├── app.js                  # 启动
├── app.wxss                # 全局设计变量与公共样式
├── sitemap.json
├── package.json            # 依赖 @tencent-ai/workbuddy-cloud-sdk（确切版本，需「构建 npm」）
├── miniprogram_npm/        # 「构建 npm」产物，入库，发布时直接读取
├── pages/
│   ├── login/              # 启动页：微信一键登录 → 创建家庭 / 邀请码加入
│   ├── today/              # 今日视图：周条 + 完成度 + 打卡
│   ├── chores/             # 家务清单：三类分组 + 「我派的 / 派给我的」视角 + 模板导入
│   ├── stats/              # 付出统计：公平度 + 谁在操心 + 隐形家务占比 + 近 7 天趋势
│   ├── family/             # 家庭：成员、邀请码、自动均衡分配
│   └── chore-edit/         # 新增 / 编辑任务（提出人 + 负责人）
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
| `chores` | 家务任务：三类分类、四种周期、积分、`created_by_id`（提出人）、`assignee_id`（负责人） |
| `completions` | 打卡记录：`(chore_id, period_key)` 唯一，同周期不会重复计分 |

所有写入都发生在客户端，数据隔离靠数据库的 RLS（Row Level Security）：

- `members` 只能看到自己，或与自己在同一个家庭的人
- `chores` / `completions` 只能读写自己所在家庭的数据
- 客户端**从不发送** `owner_id` / `user_id`，由 `DEFAULT auth.uid()` 以及 RLS 的 `WITH CHECK` 决定
- 邀请码不公开可枚举：加入家庭走服务端函数 `join_household(code, name, emoji)`，校验通过才登记成员

`created_by_id` 和 `assignee_id` 都只是普通的 `bigint` 外键（指向 `members`，`ON DELETE SET NULL`），
权限判断仍然只看 `household_id` —— **谁提出、谁负责都不影响谁能看到这条数据**，
家庭内部本来就不该有可见性差异。约束靠客户端表单保证（只能从本家庭成员里选）。

## 提出人与负责人

一项任务有两个角色，可以不是同一个人：

| 角色 | 字段 | 谁填 | 说明 |
| --- | --- | --- | --- |
| 提出人 | `created_by_id` | 新建时默认「我」 | 谁想到这件事的。批量导入模板时，记导的人 |
| 负责人 | `assignee_id` | 表单里选，可以是任何成员 | 谁去做。责任整卡制，只挂一个人 |

`views.decorateChore(chore, ctx, day, myId)` 会据此算出 `whoType`，页面直接按它渲染：

| whoType | 什么时候 | 显示 |
| --- | --- | --- |
| `toMe` | 别人提出、派给我做 | `📌 XX 派给我的`，整张卡描蓝边，在「今日」排最前 |
| `byMe` | 我提出、派给别人做 | `我提的 · XX 负责` |
| `assignee` | 其他有负责人的情况 | 头像 + 名字 |
| `nobody` | 还没人认领 | `待认领` |

改派（改 `assignee_id`）不影响 `created_by_id` —— 谁想到的还是谁。

## 周期规则

`period_key` 保证同一周期内重复打卡不重复计分：

| 周期 | period_key | 例 |
| --- | --- | --- |
| 每天 | `YYYY-MM-DD` | `2026-09-30` |
| 每周 | `YYYY-Www`（ISO 周） | `2026-W40` |
| 每月 | `YYYY-MM` | `2026-09` |
| 一次性 | `once` | `once` |

## 开发提示

- **依赖必须真正安装，不能只写 `package.json`**。两步缺一不可：

  ```bash
  npm install          # 生成 node_modules
  ```

  然后是「工具 → 构建 npm」，产出 `miniprogram_npm/@tencent-ai/workbuddy-cloud-sdk/miniprogram.js`。

  ⚠️ **只写 `package.json` 而不执行 `npm install`，发布时会报「小程序依赖构建失败」**——
  微信的「构建 npm」是从 `node_modules` 读取依赖再产出 `miniprogram_npm` 的，
  没有 `node_modules` 就没有东西可构建。SDK 升级后也需要重新构建 npm。
- **不要把 `package-lock.json` 提交进来**。发布流程里有一个「源码修复」步骤会读取并解析它，
  实测会读到损坏内容并抛 `package-lock.json: Unexpected token … is not valid JSON`，让发布直接失败。
  源文件本身是合法的、磁盘与 git 里都能正常解析，问题出在发布器对它的处理上，删除即可绕过。
  依赖已在 `package.json` 里写死确切版本，不靠 lock 保证可复现。
- **依赖版本写确切版本号，不要写 `dev` 这类 dist-tag**。dist-tag 需要被解析成具体版本，
  正是「源码修复」容易出错的环节；写死 `0.1.2-dev.1b37f73.202609222026` 后它就无事可做。
- SDK 通过 `package.json#miniprogram` 字段提供微信专用的 CommonJS 产物（`miniprogram_dist/miniprogram.js`，自包含、无运行时依赖），
  所以 `require('@tencent-ai/workbuddy-cloud-sdk/miniprogram')` 是唯一正确的入口写法。
- 请求失败会在真机 vConsole 里输出 `[WorkBuddy Cloud] request failed`，带 HTTP 状态与错误码；成功请求不打印。
- 不要在 `utils/config.js` 之外硬编码 endpoint。小程序没有 Origin，靠微信的请求域名白名单鉴权，所有小程序共用同一个网关地址。

## 依赖与构建产物说明

| 路径 | 是否入库 | 说明 |
| --- | --- | --- |
| `package.json` | ✅ 入库 | 声明依赖，版本写**确切版本号** |
| `package-lock.json` | ❌ **不提交** | 发布器的「源码修复」解析它会失败，删除可绕过 |
| `node_modules/` | ❌ 忽略 | `npm install` 生成，本地保留即可 |
| `miniprogram_npm/` | ✅ **入库** | 微信要求的分发形态，发布时直接读取，必须留在包里 |

`miniprogram_npm/` 是唯一需要入库的构建产物：发布打包直接读磁盘上这个目录，
把它交给忽略规则只会让「产物在不在包里」变得不可控。
`node_modules/` 则可放心忽略（5 MB 级体积，且微信打包本就不含它）。

## 改完怎么验证

小程序路径**不做编译验证**（不依赖微信开发者工具），所以用两个等价的结构性检查代替：

```bash
python scripts/check_miniprogram.py   # JS 语法 / JSON / 页面清单 / tabBar / 事件绑定 / require 路径
node   scripts/test_views.js          # 今日排序、派单标记、统计口径
```

`utils/views.js` 和 `utils/periods.js` 是纯计算、不碰 `wx.*`，所以能直接在 Node 里跑测试 ——
新增或调整视图逻辑时，往 `scripts/test_views.js` 里补一条断言即可。
