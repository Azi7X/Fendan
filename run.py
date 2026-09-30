"""本地启动脚本。

用法：
    python run.py                  # http://127.0.0.1:8000
    python run.py --host 0.0.0.0   # 同一 WiFi 下手机可访问 http://<你的电脑IP>:8000
    python run.py --port 9000
"""

import argparse
import os
import sys
from pathlib import Path

import uvicorn

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))


def main() -> None:
    parser = argparse.ArgumentParser(description="启动「分担」服务")
    parser.add_argument("--host", default=os.getenv("FENDAN_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("FENDAN_PORT", "8000")))
    parser.add_argument("--reload", action="store_true", help="开发模式：改动自动重启")
    args = parser.parse_args()

    print("\n  分担 FenDan  ·  家庭家务分工助手")
    print(f"  服务地址: http://{args.host}:{args.port}")
    if args.host == "0.0.0.0":
        print("  手机访问: 用同一 WiFi 连接后打开 http://<本机IP>:8000")
    print("  接口文档: /docs\n")

    uvicorn.run(
        "app.main:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
    )


if __name__ == "__main__":
    main()
