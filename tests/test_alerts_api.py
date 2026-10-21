import json

from app import db


def make_alert(kind="missing", payload=None, key="k1"):
    with db.tx() as c:
        cursor = c.execute(
            "INSERT INTO alerts(kind, dedupe_key, title, body, payload) VALUES (?, ?, 'Title', 'Body', ?)",
            (kind, key, json.dumps(payload or {})),
        )
    return cursor.lastrowid


def test_list_and_dismiss(client):
    alert_id = make_alert(payload={"date": "2026-01-01"})
    listing = client.get("/api/alerts").json()
    assert listing[0]["payload"] == {"date": "2026-01-01"} and listing[0]["status"] == "open"
    assert client.get("/api/bootstrap").json()["alerts"] == 1
    assert client.post("/api/alerts/" + str(alert_id) + "/dismiss").json() == {"ok": True}
    assert client.get("/api/alerts").json() == []
    assert len(client.get("/api/alerts", params={"status": "dismissed"}).json()) == 1


def test_act_on_missing_adds_to_list_once(client, kitchen):
    kitchen.ingredient("berenj")
    rice = kitchen.ingredient_id("Basmati rice")
    first = make_alert(payload={"ingredient_id": rice, "missing": 150}, key="a")
    second = make_alert(payload={"ingredient_id": rice, "missing": 150}, key="b")
    assert client.post("/api/alerts/" + str(first) + "/act").json() == {"ok": True}
    client.post("/api/alerts/" + str(second) + "/act")
    items = client.get("/api/shopping").json()["list"]["items"]
    assert len(items) == 1 and items[0]["needed_qty"] == 150
    assert db.scalar("SELECT status FROM alerts WHERE id = ?", (first,)) == "resolved"


def test_act_on_unknown_alert(client):
    assert client.post("/api/alerts/9/act").status_code == 404
