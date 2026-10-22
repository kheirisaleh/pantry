"""Contract with kheirisaleh/homegym (app/nutrition.py).

Home Gym pulls GET /api/export/nutrition?start=&end= with a bearer API key and receives webhooks on
POST /api/integrations/pantry signed with X-Pantry-Timestamp and X-Pantry-Signature. The helpers below copy the
parts of Home Gym that read this data, so a change here that would break Home Gym fails the test suite.
"""

import hashlib
import hmac
import json
import time
import urllib.request

from app import db, integrations

HOMEGYM_KEYS = ("kcal", "protein", "fat", "carbs", "fiber")
HOMEGYM_ENTRY_KEYS = ("type", "name", "name_fa", "qty", "unit", "kcal", "protein")
HOMEGYM_EVENTS = ("nutrition.daily", "meal.cooked", "meal.uncooked", "test", "ping")


def homegym_verify(secret, raw, stamp, signature):
    if not secret:
        return True
    try:
        if not stamp or not signature or abs(time.time() - int(stamp)) > 600:
            return False
    except ValueError:
        return False
    expected = "sha256=" + hmac.new(secret.encode("utf-8"), (stamp + ".").encode("utf-8") + raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def homegym_rows(data, users):
    stored = []
    for report in data.get("days", []):
        user_id = users.get(str((report.get("user") or {}).get("name") or "").strip().lower())
        if not user_id or not report.get("date"):
            continue
        totals = report.get("totals") or {}
        entries = [
            {key: entry.get(key) for key in HOMEGYM_ENTRY_KEYS if entry.get(key) is not None} for entry in report.get("entries") or []
        ]
        stored.append(
            (user_id, report["date"], *[totals.get(key) for key in HOMEGYM_KEYS], 1 if report.get("complete", True) else 0, entries)
        )
    return stored


class Captured:
    def __init__(self, monkeypatch):
        self.requests = []
        outer = self

        class Response:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

        def urlopen(request, timeout=None):
            outer.requests.append(request)
            return Response()

        monkeypatch.setattr(urllib.request, "urlopen", urlopen)


def cooked_day(client, kitchen):
    recipe = kitchen.recipe()
    kitchen.stock("berenj", 1000)
    kitchen.stock("goosht charkh karde", 500)
    kitchen.stock("loobia sabz", 500)
    kitchen.ingredient("sib")
    meal = kitchen.meal(recipe["id"], 0, servings=2)
    client.post("/api/cook", json={"meal_id": meal["id"]})
    client.post("/api/snacks", json={"name": "sib", "qty": 1, "unit": "pcs"})
    return meal


def test_export_shape_matches_what_homegym_reads(client, kitchen):
    cooked_day(client, kitchen)
    client.patch("/api/users/1", json={"name": "Mina"})
    auth = {"Authorization": "Bearer " + kitchen.token("Home Gym")["token"], "User-Agent": "HomeGym/1.0"}
    response = client.get("/api/export/nutrition", headers=auth, params={"start": kitchen.day(-1), "end": kitchen.day(0)})
    assert response.status_code == 200
    data = response.json()
    assert set(data) == {"days"}
    assert [day["date"] for day in data["days"]] == [kitchen.day(-1), kitchen.day(0)]
    report = data["days"][1]
    assert set(report) == {"date", "user", "totals", "complete", "entries", "note"}
    assert report["user"] == {"id": 1, "name": "Mina"}
    assert set(report["totals"]) == set(HOMEGYM_KEYS)
    assert report["complete"] is True
    meal_entry, snack_entry = report["entries"]
    assert meal_entry["type"] == "meal" and meal_entry["name"] == "Loobia Polo" and meal_entry["name_fa"] == "لوبیا پلو"
    assert snack_entry == {
        "type": "snack",
        "name": "Apple",
        "qty": 1.0,
        "unit": "pcs",
        "kcal": 95.0,
        "protein": 0.5,
        "fat": 0.3,
        "carbs": 25.0,
        "fiber": 4.0,
    }
    per_person = 350 + 200 + 70 * 0.31
    assert report["totals"]["kcal"] == round(per_person + 95, 1)
    assert report["totals"]["protein"] == round(7 + 16 + 1.4 + 0.5, 1)
    rows = homegym_rows(data, {"mina": 7})
    assert rows[1][:4] == (7, kitchen.day(0), report["totals"]["kcal"], report["totals"]["protein"])
    assert rows[1][-2] == 1
    assert rows[1][-1][1] == {"type": "snack", "name": "Apple", "qty": 1.0, "unit": "pcs", "kcal": 95.0, "protein": 0.5}
    assert rows[0][2:4] == (0.0, 0.0) and rows[0][-1] == []
    assert homegym_rows(data, {"someone else": 1}) == []


def test_single_day_and_user_filter(client, kitchen):
    cooked_day(client, kitchen)
    with db.tx() as c:
        c.execute("INSERT INTO users(name) VALUES ('Sam')")
    auth = {"Authorization": "Bearer " + kitchen.token()["token"]}
    both = client.get("/api/export/nutrition", headers=auth, params={"date": kitchen.day(0)}).json()["days"]
    assert [report["user"]["name"] for report in both] == ["User", "Sam"]
    assert round(both[0]["totals"]["kcal"] - both[1]["totals"]["kcal"], 1) == 95.0
    only = client.get("/api/export/nutrition", headers=auth, params={"date": kitchen.day(0), "user": 2}).json()["days"]
    assert [report["user"]["name"] for report in only] == ["Sam"]
    default = client.get("/api/export/nutrition", headers=auth).json()["days"]
    assert [report["date"] for report in default if report["user"]["id"] == 1] == [kitchen.day(offset) for offset in range(-6, 1)]


def test_missing_nutrition_marks_the_day_incomplete(client, kitchen):
    client.post("/api/snacks", json={"name": "mystery bar", "qty": 1, "unit": "pcs"})
    auth = {"Authorization": "Bearer " + kitchen.token()["token"]}
    report = client.get("/api/export/nutrition", headers=auth, params={"date": kitchen.day(0)}).json()["days"][0]
    assert report["complete"] is False
    assert homegym_rows({"days": [report]}, {"user": 1})[0][-2] == 0


def test_webhooks_homegym_accepts(client, kitchen, monkeypatch):
    hook = client.post(
        "/api/integrations/webhooks",
        json={
            "name": "Home Gym",
            "url": "http://gym.local:8090/api/integrations/pantry",
            "events": ["nutrition.daily", "meal.cooked", "meal.uncooked"],
        },
    ).json()
    captured = Captured(monkeypatch)
    while not integrations._deliveries.empty():
        integrations._deliveries.get_nowait()
    meal = cooked_day(client, kitchen)
    client.post("/api/meals/" + str(meal["id"]) + "/uncook")
    integrations.export_day(kitchen.day(-1), final=True)
    bodies = []
    while not integrations._deliveries.empty():
        hook_id, body, attempt = integrations._deliveries.get_nowait()
        assert integrations._deliver(hook_id, body) is True
    for request in captured.requests:
        assert request.full_url == "http://gym.local:8090/api/integrations/pantry"
        assert request.get_method() == "POST"
        headers = {key.lower(): value for key, value in request.header_items()}
        assert headers["content-type"] == "application/json"
        assert homegym_verify(hook["secret"], request.data, headers["x-pantry-timestamp"], headers["x-pantry-signature"])
        assert not homegym_verify(hook["secret"], request.data + b" ", headers["x-pantry-timestamp"], headers["x-pantry-signature"])
        body = json.loads(request.data.decode("utf-8"))
        assert body["type"] in HOMEGYM_EVENTS and headers["x-pantry-event"] == body["type"]
        assert set(body) == {"type", "at", "data", "id"}
        bodies.append(body)
    assert [body["type"] for body in bodies] == ["meal.cooked", "meal.uncooked", "nutrition.daily"]
    cooked, uncooked, daily = bodies
    assert cooked["data"]["date"] == kitchen.day(0) and cooked["data"]["meal_id"] == meal["id"]
    assert cooked["data"]["kcal"] is not None and cooked["data"]["protein"] is not None
    assert uncooked["data"] == {"meal_id": meal["id"]}
    assert daily["data"]["date"] == kitchen.day(-1)
    assert daily["data"]["people"] == [{"user": {"id": 1, "name": "User"}, "totals": dict.fromkeys(HOMEGYM_KEYS, 0.0), "complete": True}]


def test_secret_less_and_stale_signatures(client):
    assert homegym_verify("", b"{}", None, None)
    stale = str(int(time.time()) - 3600)
    signature = "sha256=" + hmac.new(b"s", (stale + ".").encode() + b"{}", hashlib.sha256).hexdigest()
    assert not homegym_verify("s", b"{}", stale, signature)
