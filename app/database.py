"""数据库连接与会话管理（SQLite + SQLAlchemy 2.0）。

可用环境变量 FENDAN_DB 指定数据库文件路径（测试时会指向临时文件）。
"""

import os
from pathlib import Path

from sqlalchemy import create_engine, event, inspect, text
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


# 后加的列，格式：表名 -> [(列名, 建列语句)]
_ADDED_COLUMNS: dict[str, list[tuple[str, str]]] = {
    "chores": [
        (
            "created_by_id",
            "ALTER TABLE chores ADD COLUMN created_by_id INTEGER "
            "REFERENCES members(id) ON DELETE SET NULL",
        ),
    ],
}

_ADDED_INDEXES = [
    "CREATE INDEX IF NOT EXISTS ix_chores_created_by_id ON chores (created_by_id)",
]


def ensure_schema() -> None:
    """轻量迁移：给已经存在的库补上后加的列。

    create_all 只建缺失的表，不会改已有表，所以字段升级要自己来。
    SQLite 的 ALTER TABLE ADD COLUMN 只支持加列（新列带外键时默认值必须是
    NULL，我们正好如此），对当前阶段够用；真要改约束时再上 Alembic。
    """
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    statements: list[str] = []

    for table, columns in _ADDED_COLUMNS.items():
        if table not in tables:
            continue  # 还没建表，交给 create_all
        existing = {col["name"] for col in inspector.get_columns(table)}
        statements.extend(sql for name, sql in columns if name not in existing)

    statements.extend(_ADDED_INDEXES)

    with engine.begin() as conn:
        for sql in statements:
            conn.execute(text(sql))
