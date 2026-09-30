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


# ============================================================ 提出人 / 指派
def _new_household(client, name, owner, extra_names=()):
    """建一个干净的家庭，返回 (邀请码, [成员...])，避免和其他用例互相干扰。"""
    hh = client.post("/api/households", json={"name": name, "owner_name": owner}).json()
    code = hh["invite_code"]
    people = list(hh["members"])
    for extra in extra_names:
        people.append(
            client.post(f"/api/households/{code}/members", json={"name": extra}).json()
        )
    return code, people


def test_propose_task_and_assign_to_another_member(client):
    """一个人想到的任务，能指派给其他家庭成员完成，并且记下是谁提的。"""
    code, (dad, mom) = _new_household(client, "派单测试", "爸爸", ["妈妈"])

    res = client.post(
        f"/api/households/{code}/chores",
        json={
            "title": "买洗衣液",
            "category": "invisible",
            "freq": "once",
            "points": 2,
            "created_by_id": dad["id"],
            "assignee_id": mom["id"],
        },
    )
    assert res.status_code == 201, res.text
    data = res.json()
    assert data["created_by_id"] == dad["id"]
    assert data["assignee_id"] == mom["id"]
    assert data["proposer"]["name"] == "爸爸"
    assert data["assignee"]["name"] == "妈妈"


def test_chore_without_proposer_is_allowed(client):
    """没写提出人也能建任务（比如从模板批量导入的公共家务）。"""
    code, (dad,) = _new_household(client, "无提出人", "独行者")
    res = client.post(f"/api/households/{code}/chores", json={"title": "随手记一笔"})
    assert res.status_code == 201
    assert res.json()["created_by_id"] is None
    assert res.json()["proposer"] is None


def test_proposer_must_belong_to_household(client):
    code, (_a, _b) = _new_household(client, "跨家庭校验", "甲", ["乙"])
    outsider = client.post(
        "/api/households", json={"name": "别人家", "owner_name": "外人"}
    ).json()["members"][0]

    res = client.post(
        f"/api/households/{code}/chores",
        json={"title": "越界任务", "created_by_id": outsider["id"]},
    )
    assert res.status_code == 400
    assert "提出人" in res.json()["detail"]

    res2 = client.post(
        f"/api/households/{code}/chores",
        json={"title": "越界任务2", "assignee_id": outsider["id"]},
    )
    assert res2.status_code == 400
    assert "负责人" in res2.json()["detail"]


def test_reassign_chore_to_another_member(client):
    """改派：把任务从一个人名下转到另一个人名下。"""
    code, (dad, mom, kid) = _new_household(client, "改派测试", "爸爸", ["妈妈", "孩子"])
    chore = client.post(
        f"/api/households/{code}/chores",
        json={"title": "倒垃圾", "created_by_id": dad["id"], "assignee_id": mom["id"]},
    ).json()

    moved = client.patch(f"/api/chores/{chore['id']}", json={"assignee_id": kid["id"]})
    assert moved.status_code == 200
    assert moved.json()["assignee_id"] == kid["id"]
    assert moved.json()["assignee"]["name"] == "孩子"
    # 改派不动提出人 —— 谁想到的还是谁
    assert moved.json()["created_by_id"] == dad["id"]

    cleared = client.patch(f"/api/chores/{chore['id']}", json={"clear_assignee": True})
    assert cleared.json()["assignee_id"] is None


def test_today_puts_tasks_assigned_to_me_first(client):
    """别人派给我的任务，在今日里排最前面，并计入「派给我的」条数。"""
    code, (dad, mom) = _new_household(client, "今日排序", "爸爸", ["妈妈"])

    client.post(
        f"/api/households/{code}/chores",
        json={"title": "爸爸自己的活", "freq": "daily", "points": 5, "assignee_id": dad["id"]},
    )
    client.post(
        f"/api/households/{code}/chores",
        json={"title": "爸爸派给妈妈的活", "freq": "daily", "points": 1,
              "created_by_id": dad["id"], "assignee_id": mom["id"]},
    )
    client.post(
        f"/api/households/{code}/chores",
        json={"title": "妈妈自己做的小事", "freq": "daily", "points": 3,
              "created_by_id": mom["id"], "assignee_id": mom["id"]},
    )

    data = client.get(f"/api/households/{code}/today?member_id={mom['id']}").json()
    assert data["pending"], "今日应该有任务"
    assert data["pending"][0]["title"] == "爸爸派给妈妈的活"
    assert data["summary"]["assigned_to_me"] == 1

    # 换成爸爸视角，就没有「别人派给我的」了
    dad_view = client.get(f"/api/households/{code}/today?member_id={dad['id']}").json()
    assert dad_view["summary"]["assigned_to_me"] == 0


def test_stats_counts_proposals(client):
    """统计里能看出谁在「想事情」：提出数与其中派给别人的条数。"""
    code, (dad, mom) = _new_household(client, "提出统计", "爸爸", ["妈妈"])

    client.post(
        f"/api/households/{code}/chores",
        json={"title": "约空调维修", "category": "invisible", "freq": "once",
              "created_by_id": dad["id"]},
    )
    client.post(
        f"/api/households/{code}/chores",
        json={"title": "交物业费", "category": "invisible", "freq": "once",
              "created_by_id": dad["id"]},
    )
    client.post(
        f"/api/households/{code}/chores",
        json={"title": "给花浇水", "created_by_id": mom["id"], "assignee_id": mom["id"]},
    )
    # 没有提出人的任务：不该计入任何人的账，也不该拉高总数
    client.post(f"/api/households/{code}/chores", json={"title": "没人认领的公共事务"})

    data = client.get(f"/api/households/{code}/stats?scope=all").json()
    assert data["total_created"] == 3
    # 总数与每位成员提出数之和永远对得上
    assert data["total_created"] == sum(m["created_count"] for m in data["members"])

    by_id = {m["member_id"]: m for m in data["members"]}
    assert by_id[dad["id"]]["created_count"] == 2
    assert by_id[dad["id"]]["assigned_out"] == 0
    assert by_id[mom["id"]]["created_count"] == 1
    assert by_id[mom["id"]]["assigned_out"] == 0
    # 隐形家务的积分仍按「谁做完算谁的」计，提出数单独一列，两者不互相污染
    assert data["invisible_points"] == 0


def test_import_presets_records_proposer(client):
    code, (dad,) = _new_household(client, "导入记提出人", "爸爸")
    res = client.post(
        f"/api/households/{code}/chores/import",
        json={"category": "invisible", "created_by_id": dad["id"]},
    )
    assert res.status_code == 200, res.text

    chores = client.get(f"/api/households/{code}/chores").json()
    assert chores, "应该导入了模板任务"
    assert all(c["created_by_id"] == dad["id"] for c in chores)
    assert all(c["proposer"]["name"] == "爸爸" for c in chores)
