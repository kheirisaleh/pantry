import os
from datetime import datetime, timedelta

from app import db, push, scheduler, services


def at(monkeypatch, hour):
    fixed = services.now().replace(hour=hour, minute=5)
    monkeypatch.setattr(services, "now", lambda: fixed)
    return fixed


def test_due_and_mark(client, monkeypatch):
    at(monkeypatch, 7)
    assert scheduler._due("backup", 3) is True
    assert scheduler._due("tomorrow", 18) is False
    scheduler._mark("backup")
    assert scheduler._due("backup", 3) is False


def test_tick_runs_every_due_task_once(client, monkeypatch, tmp_path):
    at(monkeypatch, 23)
    monkeypatch.setattr(scheduler, "BACKUP_DIR", str(tmp_path / "backups"))
    sent = []
    monkeypatch.setattr(push, "broadcast", lambda title, body, url="/m": sent.append((title, body, url)) or 0)
    scheduler.tick()
    for name, _hour, _task in scheduler.TASKS:
        assert db.get_setting("ran_" + name) == services.today().isoformat()
    assert os.listdir(tmp_path / "backups") == ["pantry-" + services.today().strftime("%Y%m%d") + ".db"]
    assert sent == [("Nothing planned for the next days", "Pick a few meals so the shopping list can be built.", "/m/alerts")]
    scheduler.tick()
    assert len(sent) == 1


def test_failing_task_does_not_stop_the_others(client, monkeypatch):
    at(monkeypatch, 23)
    monkeypatch.setattr(scheduler, "TASKS", [("first", 0, lambda: 1 / 0), ("second", 0, lambda: None)])
    scheduler.tick()
    assert db.get_setting("ran_first") and db.get_setting("ran_second")


def test_tomorrow_shortages(client, kitchen):
    recipe = kitchen.recipe()
    meal = kitchen.meal(recipe["id"], 1)
    scheduler.tomorrow_shortages()
    scheduler.tomorrow_shortages()
    alert = client.get("/api/alerts").json()
    assert len(alert) == 1
    assert alert[0]["title"] == "Tomorrow: Loobia Polo is missing ingredients"
    assert alert[0]["payload"]["meal_id"] == meal["id"] and alert[0]["kind"] == "tomorrow"


def test_expiry_estimates(client, kitchen):
    kitchen.ingredient("goosht charkh karde")
    client.post("/api/inventory/add", json={"name": "goosht charkh karde", "qty": 500, "unit": "g"})
    scheduler.expiry_estimates()
    scheduler.expiry_estimates()
    alerts = client.get("/api/alerts").json()
    assert [alert["title"] for alert in alerts] == ["Ground beef may need using soon"]
    assert alerts[0]["payload"]["estimate"] == kitchen.day(2)


def test_stock_count_reminder(client, kitchen):
    scheduler.stock_count_reminder()
    assert client.get("/api/alerts").json() == []
    kitchen.stock("berenj", 100)
    scheduler.stock_count_reminder()
    assert [alert["kind"] for alert in client.get("/api/alerts").json()] == ["stock_count"]
    client.post("/api/inventory/count", json={"entries": [], "full": True})
    scheduler.stock_count_reminder()
    assert client.get("/api/alerts").json() == []


def test_planning_reminder_and_period_reports(client, kitchen):
    scheduler.planning_reminder()
    scheduler.planning_reminder()
    assert [alert["kind"] for alert in client.get("/api/alerts").json()] == ["plan"]
    with db.tx() as c:
        c.execute("INSERT INTO shopping_lists(range_start, range_end) VALUES (?, ?)", (kitchen.day(-9), kitchen.day(-2)))
    scheduler.period_reports()
    scheduler.period_reports()
    kinds = sorted(alert["kind"] for alert in client.get("/api/alerts").json())
    assert kinds == ["period", "plan"]


def test_planning_reminder_is_quiet_when_meals_are_planned(client, kitchen):
    recipe = kitchen.recipe()
    kitchen.meal(recipe["id"], 2)
    scheduler.planning_reminder()
    assert client.get("/api/alerts").json() == []


def test_push_summary_for_several_alerts(client, monkeypatch):
    sent = []
    monkeypatch.setattr(push, "broadcast", lambda title, body, url="/m": sent.append((title, body, url)) or 0)
    with db.tx() as c:
        for key in ("a", "b"):
            c.execute("INSERT INTO alerts(kind, dedupe_key, title) VALUES ('plan', ?, ?)", (key, "Note " + key))
    scheduler.push_new_alerts()
    assert sent == [("2 new pantry notes", "Note a; Note b", "/m/alerts")]
    scheduler.push_new_alerts()
    assert len(sent) == 1


def test_backups_are_rotated(client, monkeypatch, tmp_path):
    folder = tmp_path / "b"
    folder.mkdir()
    for day in range(5):
        (folder / ("pantry-2020010" + str(day) + ".db")).write_bytes(b"")
    monkeypatch.setattr(scheduler, "BACKUP_DIR", str(folder))
    monkeypatch.setattr(scheduler, "BACKUP_KEEP", 3)
    scheduler.backup()
    names = sorted(os.listdir(folder))
    assert len(names) == 3 and names[-1] == "pantry-" + services.today().strftime("%Y%m%d") + ".db"


def test_worker_stops(client, monkeypatch):
    calls = []

    class Stop:
        def __init__(self):
            self.count = 0

        def is_set(self):
            self.count += 1
            return self.count > 1

        def wait(self, seconds):
            calls.append(seconds)

    monkeypatch.setattr(scheduler, "tick", lambda: calls.append("tick"))
    scheduler.worker(Stop())
    assert calls == ["tick", 120]


def test_now_is_timezone_aware():
    assert isinstance(services.now(), datetime) and services.now().utcoffset() is not None
    assert services.today() - timedelta(days=1) < services.today()
