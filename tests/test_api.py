"""接口自测：覆盖家庭创建、成员、任务、打卡、模板导入、统计。

运行：  python -m pytest -q
"""

import os
import tempfile
from pathlib import Path

import pytest

# 让 app 使用临时数据库，避免污染开发数据
_TMP_DB = Path(tempfile.mkdtemp()) / "test_fendan.db"
os.environ["FENDAN_DB"] = _TMP_DB.as_posix()

from fastapi.testclient import TestClient  # noqa: E402

from app.database import Base, engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(scope="module")
def client():
    Base.metadata.create_all(bind=engine)
    with TestClient(app) as c:
        yield c
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def household(client):
    res = client.post(
        "/api/households",
        json={"name": "测试之家", "owner_name": "阿明", "owner_emoji": "👨"},
    )
    assert res.status_code == 201, res.text
    return res.json()


def test_health(client):
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json()["ok"] is True


def test_create_household(household):
    assert household["invite_code"]
    assert len(household["invite_code"]) == 6
    assert household["members"][0]["name"] == "阿明"
    assert household["members"][0]["is_admin"] is True


def test_invalid_invite_code(client):
    res = client.get("/api/households/ZZZZZZ")
    assert res.status_code == 404


def test_add_member_and_duplicate_blocked(client, household):
    code = household["invite_code"]
    res = client.post(f"/api/households/{code}/members", json={"name": "小美", "emoji": "👩"})
    assert res.status_code == 201, res.text
    assert res.json()["color"].startswith("#")

    dup = client.post(f"/api/households/{code}/members", json={"name": "小美"})
    assert dup.status_code == 409


def test_import_presets(client, household):
    code = household["invite_code"]
    res = client.post(f"/api/households/{code}/chores/import", json={"category": "invisible"})
    assert res.status_code == 200, res.text
    assert res.json()["added"] > 0

    # 重复导入不应产生重复任务
    again = client.post(f"/api/households/{code}/chores/import", json={"category": "invisible"})
    assert again.json()["added"] == 0


def test_create_chore_and_validation(client, household):
    code = household["invite_code"]
    bad = client.post(
        f"/api/households/{code}/chores",
        json={"title": "坏任务", "category": "wrong", "freq": "daily"},
    )
    assert bad.status_code == 400

    ok = client.post(
        f"/api/households/{code}/chores",
        json={
            "title": "洗碗",
            "category": "daily",
            "freq": "daily",
            "points": 2,
        },
    )
    assert ok.status_code == 201, ok.text
    assert ok.json()["freq_text"] == "每天"
    assert ok.json()["done"] is False


def test_weekly_chore_freq_text(client, household):
    code = household["invite_code"]
    res = client.post(
        f"/api/households/{code}/chores",
        json={"title": "换洗床单", "category": "cycle", "freq": "weekly", "weekday": 6, "points": 3},
    )
    assert res.json()["freq_text"] == "每周 · 周日"


def test_auto_assign_balances_load(client, household):
    code = household["invite_code"]
    res = client.post(f"/api/households/{code}/chores/auto-assign")
    assert res.status_code == 200
    assert res.json()["assigned"] > 0

    chores = client.get(f"/api/households/{code}/chores").json()
    assert all(c["assignee_id"] is not None for c in chores)


def test_complete_and_undo(client, household):
    code = household["invite_code"]
    chores = client.get(f"/api/households/{code}/chores").json()
    target = next(c for c in chores if c["title"] == "洗碗")

    done = client.post(f"/api/chores/{target['id']}/complete", json={})
    assert done.status_code == 200
    assert done.json()["done"] is True
    assert done.json()["done_at"] is not None

    # 同一天重复打卡不应报错（唯一约束保护）
    again = client.post(f"/api/chores/{target['id']}/complete", json={})
    assert again.status_code == 200

    undone = client.delete(f"/api/chores/{target['id']}/complete")
    assert undone.json()["done"] is False


def test_today_view_shape(client, household):
    code = household["invite_code"]
    res = client.get(f"/api/households/{code}/today")
    assert res.status_code == 200
    data = res.json()
    assert {"day", "weekday", "pending", "done", "summary"} <= set(data)
    assert data["summary"]["total"] == len(data["pending"]) + len(data["done"])


def test_week_view(client, household):
    code = household["invite_code"]
    res = client.get(f"/api/households/{code}/week")
    assert res.status_code == 200
    days = res.json()["days"]
    assert len(days) == 7
    assert sum(1 for d in days if d["is_today"]) == 1


def test_stats_after_completion(client, household):
    code = household["invite_code"]
    chores = client.get(f"/api/households/{code}/chores").json()
    for chore in chores[:3]:
        client.post(f"/api/chores/{chore['id']}/complete", json={})

    res = client.get(f"/api/households/{code}/stats?scope=week")
    assert res.status_code == 200
    data = res.json()
    assert data["total_done"] >= 3
    assert 0.0 <= data["fairness"] <= 1.0
    assert len(data["daily_series"]) == 7
    assert any(m["points"] > 0 for m in data["members"])


def test_delete_chore(client, household):
    code = household["invite_code"]
    created = client.post(
        f"/api/households/{code}/chores", json={"title": "临时任务", "freq": "once"}
    ).json()
    assert client.delete(f"/api/chores/{created['id']}").status_code == 204
    titles = [c["title"] for c in client.get(f"/api/households/{code}/chores").json()]
    assert "临时任务" not in titles


def test_cannot_remove_last_member(client):
    """用只含一位成员的新家庭，验证「至少保留一人」的保护。"""
    hh = client.post(
        "/api/households", json={"name": "独居测试", "owner_name": "独行者"}
    ).json()
    code = hh["invite_code"]
    members = client.get(f"/api/households/{code}").json()["members"]
    assert len(members) == 1
    res = client.delete(f"/api/members/{members[0]['id']}")
    assert res.status_code == 400
    assert "至少保留" in res.json()["detail"]


def test_removing_member_releases_their_chores(client, household):
    """移除成员后，他负责的任务应变成待认领，而不是被一起删掉。"""
    code = household["invite_code"]
    member = client.post(f"/api/households/{code}/members", json={"name": "临时成员"}).json()
    chore = client.post(
        f"/api/households/{code}/chores",
        json={"title": "临时成员的活", "freq": "daily", "assignee_id": member["id"]},
    ).json()

    assert client.delete(f"/api/members/{member['id']}").status_code == 204
    kept = next(
        c for c in client.get(f"/api/households/{code}/chores").json()
        if c["id"] == chore["id"]
    )
    assert kept["assignee_id"] is None


def test_static_index(client):
    res = client.get("/")
    assert res.status_code == 200
    assert "分担" in res.text
