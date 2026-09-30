"""小程序端静态核对。

小程序路径不做编译验证（不装微信开发者工具），改用一组等价的结构性检查：

  1. 所有 .js 能过语法解析
  2. 所有 .json 能解析
  3. app.json 的 pages / tabBar 与实际文件一致
  4. WXML 里绑定的每个事件处理函数，在同页 .js 中确有定义
  5. 每个 require 的相对路径都存在
  6. lazyCodeLoading 必须是 requiredComponents（否则 iPhone 上可能白屏）

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

# node 只用来做语法解析，找不到就跳过这一项（不阻断其他检查）
NODE = shutil.which("node") or shutil.which("node.exe")

errors: list[str] = []
notes: list[str] = []


def rel(path: Path) -> str:
    return str(path.relative_to(ROOT))


js_files = sorted(ROOT.rglob("*.js"))
json_files = sorted(ROOT.rglob("*.json"))
wxml_files = sorted(ROOT.rglob("*.wxml"))

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
