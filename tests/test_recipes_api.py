import json

from app import db
from helpers import LOOBIA_SLOTS


def test_create_and_enrich(client, kitchen):
    created = client.post("/api/recipes", json={"name": "loobia polo", "slots": LOOBIA_SLOTS}).json()
    assert created["status"] == "pending" and created["display"] == "loobia polo"
    assert [len(slot["items"]) for slot in created["slots"]] == [1, 1, 1, 1, 1]
    kitchen.drain()
    recipe = client.get("/api/recipes/" + str(created["id"])).json()
    assert recipe["name_en"] == "Loobia Polo" and recipe["name_fa"] == "لوبیا پلو"
    assert recipe["tags"] == ["persian", "rice"] and recipe["cook_minutes"] == 75
    assert recipe["image_status"] == "searching"
    assert round(recipe["nutrition_per_person"]["kcal"]) == 350 + 200 + 22
    assert round(recipe["nutrition_per_person"]["protein"], 1) == 7 + 16 + 1.4
    assert recipe["nutrition_complete"] is True
    assert recipe["last_cooked"] is None


def test_create_validation(client):
    assert client.post("/api/recipes", json={"name": "", "slots": LOOBIA_SLOTS}).status_code == 400
    assert client.post("/api/recipes", json={"name": "x", "slots": []}).status_code == 400
    assert client.post("/api/recipes", json={"name": "x", "slots": "rice"}).status_code == 400
    assert client.post("/api/recipes", json={"name": "x", "slots": [{"items": [{"name": "rice", "amount": 0}]}]}).status_code == 400
    assert (
        client.post("/api/recipes", json={"name": "x", "slots": [{"items": [{"name": "rice", "amount": 1, "unit": "cup"}]}]}).status_code
        == 400
    )
    assert client.post("/api/recipes", json={"name": "x", "slots": [{"items": [{"ingredient_id": 999, "amount": 1}]}]}).status_code == 400
    assert db.scalar("SELECT COUNT(*) FROM recipes") == 0


def test_bad_ingredient_id_is_400_not_500(client):
    response = client.post("/api/recipes", json={"name": "x", "slots": [{"items": [{"ingredient_id": "rice", "amount": 1}]}]})
    assert response.status_code == 400


def test_per_dish_amount_is_shared(client, kitchen):
    recipe = kitchen.recipe(
        "omelette",
        [
            {"items": [{"name": "tokhm morgh", "amount": 2, "unit": "pcs"}]},
            {"items": [{"name": "panir", "amount": 100, "unit": "g", "per_dish": True}]},
        ],
    )
    assert recipe["slots"][1]["items"][0]["per_dish"] == 1
    assert round(recipe["nutrition_per_person"]["kcal"]) == round(2 * 78 + 260 / 2)


def test_alternatives_and_optional(client, kitchen):
    recipe = kitchen.recipe(
        "polo",
        [
            {"items": [{"name": "berenj", "amount": 100, "unit": "g"}, {"name": "panir", "amount": 50, "unit": "g", "is_default": True}]},
            {"optional": True, "items": [{"name": "kahoo", "amount": 50, "unit": "g"}]},
        ],
    )
    first = recipe["slots"][0]["items"]
    assert [item["is_default"] for item in first] == [0, 1]
    assert recipe["slots"][1]["items"][0]["optional"] == 1
    assert round(recipe["nutrition_per_person"]["kcal"]) == 130


def test_list_and_404(client, kitchen):
    kitchen.recipe()
    assert [entry["display"] for entry in client.get("/api/recipes").json()] == ["Loobia Polo"]
    assert client.get("/api/recipes/99").status_code == 404
    assert client.put("/api/recipes/99", json={"name": "x"}).status_code == 404


def test_update_fields(client, kitchen):
    recipe = kitchen.recipe()
    updated = client.put("/api/recipes/" + str(recipe["id"]), json={"description": " New ", "tags": ["quick"], "cook_minutes": "40"}).json()
    assert updated["description"] == "New" and updated["tags"] == ["quick"] and updated["cook_minutes"] == 40
    assert updated["status"] == "ready"


def test_update_rejects_bad_types(client, kitchen):
    recipe = kitchen.recipe()
    path = "/api/recipes/" + str(recipe["id"])
    assert client.put(path, json={"name": 5}).status_code == 400
    assert client.put(path, json={"tags": "abc"}).status_code == 400
    assert client.put(path, json={"cook_minutes": "soon"}).status_code == 400
    assert client.get(path).json()["tags"] == ["persian", "rice"]


def test_rename_requeues_ai(client, kitchen):
    recipe = kitchen.recipe()
    renamed = client.put("/api/recipes/" + str(recipe["id"]), json={"name": "adas polo"}).json()
    assert renamed["raw_name"] == "adas polo" and renamed["status"] == "pending"
    assert db.scalar("SELECT COUNT(*) FROM ai_jobs WHERE kind = 'recipe'") == 1


def test_changing_slots_keeps_choices_of_planned_meals(client, kitchen):
    recipe = kitchen.recipe(
        "polo",
        [
            {"items": [{"name": "berenj", "amount": 100, "unit": "g"}, {"name": "panir", "amount": 50, "unit": "g"}]},
            {"optional": True, "items": [{"name": "kahoo", "amount": 50, "unit": "g"}]},
        ],
    )
    feta_line = recipe["slots"][0]["items"][1]["id"]
    lettuce_line = recipe["slots"][1]["items"][0]["id"]
    meal = kitchen.meal(recipe["id"], 1, choices={"0": feta_line}, optional_items=[lettuce_line])
    slots = [
        {"optional": True, "items": [{"ingredient_id": kitchen.ingredient_id("Lettuce"), "amount": 60, "unit": "g"}]},
        {
            "items": [
                {"ingredient_id": kitchen.ingredient_id("Basmati rice"), "amount": 100, "unit": "g"},
                {"ingredient_id": kitchen.ingredient_id("Feta cheese"), "amount": 40, "unit": "g"},
            ]
        },
    ]
    client.put("/api/recipes/" + str(recipe["id"]), json={"slots": slots})
    stored = db.row("SELECT choices, optional_items FROM meals WHERE id = ?", (meal["id"],))
    fresh = client.get("/api/recipes/" + str(recipe["id"])).json()
    new_feta = fresh["slots"][1]["items"][1]["id"]
    new_lettuce = fresh["slots"][0]["items"][0]["id"]
    assert json.loads(stored["choices"]) == {"1": new_feta}
    assert json.loads(stored["optional_items"]) == [new_lettuce]


def test_archive_drops_future_planned_meals(client, kitchen):
    recipe = kitchen.recipe()
    kitchen.meal(recipe["id"], 2)
    assert client.post("/api/recipes/" + str(recipe["id"]) + "/archive", json={}).json() == {"ok": True}
    assert db.scalar("SELECT COUNT(*) FROM meals") == 0
    assert client.get("/api/recipes").json() == []
    assert len(client.get("/api/recipes", params={"archived": 1}).json()) == 1
    assert client.post("/api/meals", json={"date": kitchen.day(1), "recipe_id": recipe["id"]}).status_code == 404


def test_images(client, kitchen, monkeypatch):
    recipe = kitchen.recipe()
    refreshed = client.post("/api/recipes/" + str(recipe["id"]) + "/images/refresh").json()
    assert refreshed["image_status"] == "searching"
    assert client.post("/api/recipes/" + str(recipe["id"]) + "/images/choose", json={"index": 0}).status_code == 400
    assert client.post("/api/recipes/" + str(recipe["id"]) + "/images/choose", json={"index": "first"}).status_code == 400
    with db.tx() as c:
        c.execute(
            "UPDATE recipes SET image_candidates = ? WHERE id = ?",
            (json.dumps([{"url": "https://img.example/a.jpg", "thumb": "t"}]), recipe["id"]),
        )
    from app import images

    monkeypatch.setattr(images, "download", lambda recipe_id, url: "/media/recipes/" + str(recipe_id) + "-1.jpg")
    chosen = client.post("/api/recipes/" + str(recipe["id"]) + "/images/choose", json={"index": 0}).json()
    assert chosen["image_path"] == "/media/recipes/" + str(recipe["id"]) + "-1.jpg"
    assert chosen["image_status"] == "set" and chosen["image_candidates"] == []
    assert client.post("/api/recipes/99/images/choose", json={"index": 0}).status_code == 404
