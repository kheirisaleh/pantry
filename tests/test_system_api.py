from datetime import datetime, timedelta

from app import db, services


def test_healthz_and_bootstrap(client):
    assert client.get("/healthz").json() == {"ok": True}
    boot = client.get("/api/bootstrap").json()
    assert boot["users"] == [{"id": 1, "name": "User", "color": "#ff7a59"}]
    assert boot["today"] == services.today().isoformat()
    assert boot["default_servings"] == 2.0
    assert boot["alerts"] == 0
    assert boot["categories"][0] == "vegetables" and "other" in boot["categories"]
    assert "package" in boot["icons"]
    assert len(boot["vapid"]) > 80
    assert boot["ai"]["key_set"] is False
    assert boot["alexa_endpoint"].endswith("/alexa")


def test_rename_user(client):
    users = client.patch("/api/users/1", json={"name": "  Mina ", "color": "#00aa88"}).json()
    assert users == [{"id": 1, "name": "Mina", "color": "#00aa88"}]
    assert client.patch("/api/users/1", json={"name": ""}).status_code == 400


def test_rename_unknown_user_is_404(client):
    response = client.patch("/api/users/99", json={"name": "Ghost"})
    assert response.status_code == 404


def test_rename_to_taken_name_is_400_not_500(client):
    with db.tx() as c:
        c.execute("INSERT INTO users(name) VALUES ('Sam')")
    response = client.patch("/api/users/1", json={"name": "Sam"})
    assert response.status_code == 400
    assert "already" in response.json()["error"]


def test_settings(client):
    saved = client.patch("/api/settings", json={"default_servings": 3, "alexa_skill_id": " amzn1.ask.skill.x "}).json()
    assert saved == {"default_servings": 3.0, "alexa_skill_id": "amzn1.ask.skill.x"}
    assert client.patch("/api/settings", json={"default_servings": 0}).status_code == 400
    assert client.patch("/api/settings", json={"default_servings": "many"}).status_code == 400
    assert client.get("/api/bootstrap").json()["default_servings"] == 3.0


def test_time_zone_follows_tz_variable(monkeypatch):
    monkeypatch.setenv("TZ", "Pacific/Kiritimati")
    assert services.now().utcoffset() == timedelta(hours=14)
    monkeypatch.setenv("TZ", "America/Los_Angeles")
    assert services.now().utcoffset() in (timedelta(hours=-7), timedelta(hours=-8))
    monkeypatch.setenv("TZ", "Not/AZone")
    assert services.zone().key == "Europe/Berlin"
    monkeypatch.delenv("TZ")
    assert services.zone().key == "Europe/Berlin"


def test_iso_now_and_parse_date(client):
    assert len(services.iso_now()) == 19
    assert services.parse_date("2026-03-04T10:00:00").isoformat() == "2026-03-04"
    assert services.parse_date(datetime(2026, 1, 2).date()).isoformat() == "2026-01-02"


def test_invalid_date_is_400(client):
    response = client.get("/api/calendar", params={"start": "soon", "end": "later"})
    assert response.status_code == 400
    assert response.json() == {"error": "Invalid date: soon"}


def test_idempotent_replay(client):
    first = client.post("/api/shopping/items", headers={"x-op-id": "abc"}, json={"name": "milk"})
    second = client.post("/api/shopping/items", headers={"x-op-id": "abc"}, json={"name": "milk"})
    assert first.json() == second.json()
    assert second.headers["x-op-replayed"] == "1"
    assert "x-op-replayed" not in first.headers
    assert db.scalar("SELECT COUNT(*) FROM shopping_items") == 1


def test_idempotency_ignores_reads_and_non_api(client):
    response = client.get("/api/bootstrap", headers={"x-op-id": "read"})
    assert "x-op-replayed" not in response.headers
    assert db.scalar("SELECT COUNT(*) FROM processed_ops") == 0


def test_media_files(client):
    assert client.get("/media/recipes/missing.jpg").status_code == 404
    assert client.get("/media/recipes/..%2Fpantry.db").status_code == 404
    folder = db.DATA_DIR + "/media/recipes"
    with open(folder + "/1-1.jpg", "wb") as handle:
        handle.write(b"\xff\xd8\xff")
    response = client.get("/media/recipes/1-1.jpg")
    assert response.status_code == 200
    assert "immutable" in response.headers["cache-control"]


def test_user_header_ignores_unknown_ids(client, kitchen):
    recipe = kitchen.recipe()
    meal = client.post("/api/meals", headers={"x-user-id": "77"}, json={"date": kitchen.day(1), "recipe_id": recipe["id"]}).json()
    assert meal["created_by"] is None
    meal = client.post("/api/meals", headers={"x-user-id": "nope"}, json={"date": kitchen.day(1), "recipe_id": recipe["id"]}).json()
    assert meal["created_by"] is None
    meal = client.post("/api/meals", json={"date": kitchen.day(1), "recipe_id": recipe["id"]}).json()
    assert meal["created_by"] == 1


def test_week_summary(client, kitchen):
    recipe = kitchen.recipe()
    kitchen.meal(recipe["id"], 0, servings=2)
    week = client.get("/api/home/week", params={"start": kitchen.day(0)}).json()
    assert week["start"] == kitchen.day(0)
    assert len(week["days"]) == 7
    assert week["days"][0]["is_today"] is True
    assert week["days"][0]["planned_kcal"] == round(350 + 200 + 70 * 0.31)
    assert week["users"] == ["User"]
    default = client.get("/api/home/week").json()
    assert services.parse_date(default["start"]).weekday() == 0
