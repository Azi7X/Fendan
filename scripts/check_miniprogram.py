"""小程序端静态核对。

小程序路径不做编译验证（不装微信开发者工具），改用一组等价的结构性检查：

  1. 所有 .js 能过语法解析
  2. 所有 .json 能解析
  3. app.json 的 pages / tabBar 与实际文件一致
  4. WXML 里绑定的每个事件处理函数，在同页 .js 中确有定义
  5. 每个 require 的相对路径都存在
  6. lazyCodeLoading 必须是 requiredComponents（否则 iPhone 上可能白屏）
  7. npm 依赖是否真的装上了、构建产物是否到位

第 7 项是被真实事故逼出来的：只往 package.json 里写依赖、不执行 npm install，
发布时会报「小程序依赖构建失败，请检查依赖是否支持微信小程序后重试」。
微信的「构建 npm」是读 node_modules 再产出 miniprogram_npm，没装就无从构建。

用法：
    python scripts/check_miniprogram.py
"""

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "miniprogram"

# 这两目录是 npm 依赖与构建产物，不是项目源码，扫描时必须排除
SKIP_DIRS = {"node_modules", "miniprogram_npm"}

# node 只用来做语法解析，找不到就跳过这一项（不阻断其他检查）
NODE = shutil.which("node") or shutil.which("node.exe")

errors: list[str] = []
notes: list[str] = []


def rel(path: Path) -> str:
    return str(path.relative_to(ROOT))


def walk(suffix: str) -> list[Path]:
    """收集项目源码文件，跳过依赖与构建产物目录。"""
    return sorted(
        p
        for p in ROOT.rglob(f"*{suffix}")
        if not SKIP_DIRS & {part for part in p.relative_to(ROOT).parts}
    )


js_files = walk(".js")
json_files = walk(".json")
wxml_files = walk(".wxml")

# ---- 1. JS 语法 ----
if NODE:
    for path in js_files:
        res = subprocess.run(
            [NODE, "--check", str(path)], capture_output=True, text=True
        )
        if res.returncode != 0:
            head = " / ".join(res.stderr.strip().splitlines()[:2])
            errors.append(f"[语法] {rel(path)}: {head}")
    notes.append(f"JS 语法: {len(js_files)} 个文件")
else:
    notes.append("JS 语法: 跳过（未找到 node）")

# ---- 2. JSON 可解析 ----
for path in json_files:
    try:
        json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        errors.append(f"[JSON] {rel(path)}: {exc}")
notes.append(f"JSON: {len(json_files)} 个文件")

# ---- 3. app.json ----
app_json = json.loads((ROOT / "app.json").read_text(encoding="utf-8"))
pages = app_json.get("pages", [])
for page in pages:
    for ext in (".js", ".wxml", ".json"):
        if not (ROOT / f"{page}{ext}").exists():
            errors.append(f"[页面缺失] {page}{ext}")

tab_items = app_json.get("tabBar", {}).get("list", [])
if tab_items and not (2 <= len(tab_items) <= 5):
    errors.append(f"[tabBar] 条目数必须 2-5，实际 {len(tab_items)}")
for item in tab_items:
    if item["pagePath"] not in pages:
        errors.append(f"[tabBar] {item['pagePath']} 不在 pages 中")
    for key in ("iconPath", "selectedIconPath"):
        if key in item and not (ROOT / item[key]).exists():
            errors.append(f"[tabBar] 图标不存在: {item[key]}")

if app_json.get("lazyCodeLoading") != "requiredComponents":
    errors.append("[配置] lazyCodeLoading 必须为 requiredComponents")

notes.append(f"页面: {len(pages)} 个，tabBar: {len(tab_items)} 项")

# ---- 4. WXML 事件处理函数 ----
HANDLER_RE = re.compile(
    r'(?:bind|catch|capture-bind|capture-catch)[a-zA-Z:]*\s*=\s*"([^"{}]+)"'
)
for wxml in wxml_files:
    js_path = wxml.with_suffix(".js")
    if not js_path.exists():
        continue  # 自定义组件另有归属，这里只查页面
    source = js_path.read_text(encoding="utf-8")
    for name in sorted(set(HANDLER_RE.findall(wxml.read_text(encoding="utf-8")))):
        if not re.search(rf"\b{re.escape(name)}\s*[:(=]", source):
            errors.append(
                f"[事件未定义] {rel(wxml)} 绑定了 {name}，但 {js_path.name} 中没有定义"
            )

# ---- 5. require 路径 ----
REQUIRE_RE = re.compile(r"""require\(\s*['"](.+?)['"]\s*\)""")
for path in js_files:
    for target in REQUIRE_RE.findall(path.read_text(encoding="utf-8")):
        if not target.startswith("."):
            continue  # npm 包交给构建
        base = (path.parent / target).resolve()
        if not (base.exists() or base.with_suffix(".js").exists()):
            errors.append(f"[require 缺失] {rel(path)} -> {target}")

# ---- 6. npm 依赖是否真的装上并构建 ----
npm_targets = sorted(
    {
        target
        for path in js_files
        for target in REQUIRE_RE.findall(path.read_text(encoding="utf-8"))
        if not target.startswith(".")
    }
)

if npm_targets:
    declared = set(
        json.loads((ROOT / "package.json").read_text(encoding="utf-8")).get(
            "dependencies", {}
        )
    )
    npm_errors_before = len(errors)

    if not (ROOT / "node_modules").is_dir():
        errors.append(
            "[依赖未安装] package.json 声明了依赖，但 node_modules 不存在。"
            "只写 package.json 不会安装依赖，发布时会报「小程序依赖构建失败」。"
            "请先在 miniprogram 目录执行 npm install"
        )

    for target in npm_targets:
        parts = target.split("/")
        pkg = "/".join(parts[:2]) if target.startswith("@") else parts[0]
        sub = target[len(pkg):].lstrip("/")

        if pkg not in declared:
            errors.append(
                f"[依赖未声明] require('{target}') 用到 {pkg}，但它不在 package.json 的 dependencies 里"
            )
            continue

        pkg_dir = ROOT / "node_modules" / pkg
        if not (pkg_dir / "package.json").exists():
            errors.append(f"[依赖未安装] {pkg} 不在 node_modules，请执行 npm install")
            continue

        mp_entry = json.loads(
            (pkg_dir / "package.json").read_text(encoding="utf-8")
        ).get("miniprogram")

        if not mp_entry:
            notes.append(f"npm 依赖 {pkg}: 无 miniprogram 字段，交给构建流程处理")
            continue

        if sub:
            built = ROOT / "miniprogram_npm" / pkg / f"{sub}.js"
            if not built.exists():
                errors.append(
                    f"[构建产物缺失] 缺少 {rel(built)} —— 请在开发者工具执行「工具 → 构建 npm」"
                )
        else:
            notes.append(f"npm 依赖 {pkg}: 包根入口，跳过产物路径核对")

    if len(errors) == npm_errors_before:
        notes.append(f"npm 依赖: {len(npm_targets)} 处 require 已核对安装与构建产物")

# ---- 输出 ----
print("检查项：")
for note in notes:
    print(f"  · {note}")
print()

if errors:
    print(f"发现 {len(errors)} 个问题：")
    for err in errors:
        print(f"  ✗ {err}")
    sys.exit(1)

print("全部通过 ✅")
