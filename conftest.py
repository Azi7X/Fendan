"""pytest 根配置：确保项目根目录在 sys.path 上，可直接 `from app... import`。

同时把数据库指向临时文件，测试不会碰到开发数据。
"""

import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ.setdefault("FENDAN_DB", (Path(tempfile.mkdtemp()) / "fendan_test.db").as_posix())
