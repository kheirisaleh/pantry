import hashlib
import hmac
import json
import os
import urllib.request

from app import db, integrations


class FakeResponse:
    def __init__(self, status=200):
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def capture(monkeypatch, status=200):
    sent = []

    def urlopen(request, timeout=None):
        sent.append(request)
        return FakeResponse(status)

    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    return sent


def test_tokens(client):
    created = client.post("/api/integrations/tokens", json={"name": "  Gym "}).json()
    assert created["name"] == "Gym" and created["token"].startswith("pk_")
    stored = db.row("SELECT * FROM api_tokens")
    assert stored["token_hash"] == hashlib.sha256(created["token"].encode()).hexdigest()
    assert stored["hint"] == created["token"][-4:]
    assert created["token"] not in json.dumps(client.get("/api/integrations").json())
    assert client.post("/api/integrations/tokens", json={}).json()["name"] == "Automation"
    assert client.delete("/api/integrations/tokens/" + str(created["id"])).json() == {"ok": True}
    assert [token["name"] for token in client.get("/api/integrations").json()["tokens"]] == ["Automation"]


def test_token_auth(client, kitchen):
    token = kitchen.token()["token"]
    assert client.get("/api/export/nutrition").status_code == 401
    assert client.get("/api/export/nutrition", headers={"authorization": "Bearer wrong"}).status_code == 401
    assert client.get("/api/export/nutrition", headers={"authorization": "Bearer " + token}).status_code == 200
    assert client.get("/api/export/nutrition", params={"token": token}).status_code == 200
    assert db.scalar("SELECT last_used FROM api_tokens") is not None
    for path in ("/api/automation/events", "/api/automation/state", "/api/automation/tomorrow", "/api/export/nutrition/daily"):
        assert client.get(path).status_code == 401
    assert client.post("/api/automation/shopping", json={"name": "milk"}).status_code == 401
    assert client.post("/api/automation/meals", json={"dish": "x"}).status_code == 401


def test_webhook_crud_and_validation(client):
    created = client.post(
        "/api/integrations/webhooks", json={"url": " https://gym.local/api/integrations/pantry ", "events": ["nutrition.daily"]}
    ).json()
    assert created["secret"].startswith("whsec_") and created["events"] == ["nutrition.daily"] and created["active"] == 1
    assert created["name"] == "https://gym.local/api/integrations/pantry"
    assert "secret" not in client.get("/api/integrations").json()["webhooks"][0]
    updated = client.patch(
        "/api/integrations/webhooks/" + str(created["id"]), json={"url": "http://gym/x", "name": "Gym", "active": False}
    ).json()
    assert updated["name"] == "Gym" and updated["active"] == 0 and updated["events"] == ["*"] and "secret" not in updated
    assert client.post("/api/integrations/webhooks", json={"url": "ftp://x"}).status_code == 400
    assert client.post("/api/integrations/webhooks", json={"url": "http://x", "events": ["nope"]}).status_code == 400
    assert client.post("/api/integrations/webhooks", json={"url": "http://x", "events": [1]}).status_code == 400
    assert client.delete("/api/integrations/webhooks/" + str(created["id"])).json() == {"ok": True}
    assert client.get("/api/integrations").json()["webhooks"] == []


def test_webhook_events_as_text_are_split_not_spelled_out(client):
    created = client.post("/api/integrations/webhooks", json={"url": "http://x", "events": "meal.cooked, nutrition.daily"})
    assert created.status_code == 200
    assert created.json()["events"] == ["meal.cooked", "nutrition.daily"]


def test_editing_unknown_webhook_is_404_not_500(client):
    assert client.patch("/api/integrations/webhooks/9", json={"url": "http://x"}).status_code == 404


def test_testing_unknown_webhook_is_404_not_ok(client):
    assert client.post("/api/integrations/webhooks/9/test").status_code == 404


def test_test_delivery_is_signed_even_when_paused(client, monkeypatch):
    created = client.post("/api/integrations/webhooks", json={"url": "http://gym.local/hook"}).json()
    client.patch("/api/integrations/webhooks/" + str(created["id"]), json={"url": "http://gym.local/hook", "active": False})
    sent = capture(monkeypatch)
    result = client.post("/api/integrations/webhooks/" + str(created["id"]) + "/test").json()
    assert result == {"ok": True, "status": "200"}
    request = sent[0]
    headers = {key.lower(): value for key, value in request.header_items()}
    expected = hmac.new(
        created["secret"].encode(), (headers["x-pantry-timestamp"] + ".").encode() + request.data, hashlib.sha256
    ).hexdigest()
    assert headers["x-pantry-signature"] == "sha256=" + expected
    assert headers["x-pantry-event"] == "test"
    assert json.loads(request.data)["data"] == {"message": "Hello from Pantry"}


def test_failed_delivery_is_recorded(client, monkeypatch):
    created = client.post("/api/integrations/webhooks", json={"url": "http://gym.local/hook"}).json()
    capture(monkeypatch, status=500)
    assert integrations._deliver(created["id"], {"type": "test"}) is False
    assert db.scalar("SELECT last_status FROM webhooks") == "500"


def test_events_are_logged_and_queued(client, kitchen):
    recipe = kitchen.recipe()
    hook = client.post("/api/integrations/webhooks", json={"url": "http://gym/x", "events": ["meal.planned"]}).json()
    while not integrations._deliveries.empty():
        integrations._deliveries.get_nowait()
    meal = kitchen.meal(recipe["id"], 1)
    queued = integrations._deliveries.get_nowait()
    assert queued[0] == hook["id"] and queued[1]["type"] == "meal.planned" and queued[2] == 0
    assert queued[1]["data"]["meal_id"] == meal["id"] and queued[1]["data"]["dish"] == "Loobia Polo"
    assert integrations._deliveries.empty()
    token = kitchen.token()["token"]
    auth = {"authorization": "Bearer " + token}
    events = client.get("/api/automation/events", headers=auth).json()
    types = [event["type"] for event in events["events"]]
    assert types == ["recipe.created", "meal.planned"]
    assert events["last_id"] == events["events"][-1]["id"]
    after = client.get("/api/automation/events", headers=auth, params={"after": events["events"][0]["id"]}).json()
    assert [event["type"] for event in after["events"]] == ["meal.planned"]
    only = client.get("/api/automation/events", headers=auth, params={"types": "recipe.created"}).json()
    assert [event["type"] for event in only["events"]] == ["recipe.created"]


def test_negative_event_limit_is_not_unlimited(client, kitchen):
    for name in ("a", "b", "c"):
        client.post("/api/shopping/items", json={"name": name})
    token = kitchen.token()["token"]
    events = client.get("/api/automation/events", headers={"authorization": "Bearer " + token}, params={"limit": -1}).json()
    assert len(events["events"]) == 1


def test_automation_endpoints(client, kitchen):
    recipe = kitchen.recipe()
    auth = {"authorization": "Bearer " + kitchen.token()["token"]}
    added = client.post("/api/automation/shopping", headers=auth, json={"name": "milk", "qty": 1, "unit": "l"}).json()
    assert added["list"]["items"][0]["source"] == "automation"
    planned = client.post("/api/automation/meals", headers=auth, json={"dish": "Loobia Polo", "date": kitchen.day(1)}).json()
    assert planned["recipe_id"] == recipe["id"] and planned["source"] == "automation" and planned["servings"] == 2.0
    assert client.post("/api/automation/meals", headers=auth, json={"dish": "pizza"}).status_code == 404
    state = client.get("/api/automation/state", headers=auth).json()
    assert state["today"] == kitchen.day(0) and len(state["calendar"]) == 7
    assert state["shopping"] == [{"name": "milk", "needed_qty": 1000.0, "unit": "g", "checked": False}]
    tomorrow = client.get("/api/automation/tomorrow", headers=auth).json()
    assert tomorrow["date"] == kitchen.day(1) and tomorrow["has_meals"] and tomorrow["has_shortages"]
    assert {entry["name"] for entry in tomorrow["missing"]} == {"Basmati rice", "Ground beef", "Green beans"}
    assert tomorrow["speech"].startswith("For Loobia Polo tomorrow you are missing")
    german = client.get("/api/automation/tomorrow", headers=auth, params={"lang": "de-DE", "date": kitchen.day(1)}).json()
    assert german["speech"] is None and german["missing"][0]["name"] in ("Basmatireis", "Rinderhack", "Gruene Bohnen")


def test_export_now_writes_files(client, kitchen):
    assert client.post("/api/integrations/export-now").json() == {"ok": True}
    folder = os.path.join(db.DATA_DIR, "exports", "nutrition")
    assert sorted(os.listdir(folder)) == sorted([kitchen.day(-1) + ".json", kitchen.day(0) + ".json"])
    with open(os.path.join(folder, kitchen.day(-1) + ".json")) as handle:
        stored = json.load(handle)
    assert stored["final"] is True and stored["people"][0]["user"]["name"] == "User"
    auth = {"authorization": "Bearer " + kitchen.token()["token"]}
    daily = client.get("/api/export/nutrition/daily", headers=auth).json()["days"]
    assert [(entry["date"], entry["final"]) for entry in daily] == [(kitchen.day(-1), True), (kitchen.day(0), False)]
    assert client.get("/api/integrations").json()["last_export"] is not None


def test_nutrition_range_limit(client, kitchen):
    auth = {"authorization": "Bearer " + kitchen.token()["token"]}
    response = client.get("/api/export/nutrition", headers=auth, params={"start": "2026-01-01", "end": "2026-12-31"})
    assert response.status_code == 400
