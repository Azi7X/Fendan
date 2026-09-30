"""数据库连接与会话管理（SQLite + SQLAlchemy 2.0）。

可用环境变量 FENDAN_DB 指定数据库文件路径（测试时会指向临时文件）。
"""

import os
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

BASE_DIR = Path(__file__).resolve().parent.parent

_custom = os.getenv("FENDAN_DB")
if _custom:
    DB_PATH = Path(_custom)
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
else:
    DATA_DIR = BASE_DIR / "data"
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    DB_PATH = DATA_DIR / "fendan.db"

DATABASE_URL = f"sqlite:///{DB_PATH.as_posix()}"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
    future=True,
)


@event.listens_for(engine, "connect")
def _enable_sqlite_fk(dbapi_conn, _record):
    """SQLite 默认不开启外键约束，这里手动打开，保证级联删除生效。"""
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
