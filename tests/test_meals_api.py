from app import db, services


def test_add_meal(client, kitchen):
    recipe = kitchen.recipe()
    meal = kitchen.meal(recipe["id"], 1, servings=3)
    assert meal["date"] == kitchen.day(1) and meal["servings"] == 3.0 and meal["status"] == "planned"
    assert meal["recipe"]["display"] == "Loobia Polo" and meal["position"] == 0
    assert meal["source"] == "app" and meal["choices"] == {} and meal["optional_items"] == []
    second = kitchen.meal(recipe["id"], 1)
    assert second["position"] == 1


def test_add_meal_uses_default_servings(client, kitchen):
    client.patch("/api/settings", json={"default_servings": 4})
    recipe = kitchen.recipe()
    meal = client.post("/api/meals", json={"date": kitchen.day(1), "recipe_id": recipe["id"]}).json()
    assert meal["servings"] == 4.0


def test_add_meal_validation(client, kitchen):
    recipe = kitchen.recipe()
    assert client.post("/api/meals", json={"date": kitchen.day(1), "recipe_id": 99}).status_code == 404
    assert client.post("/api/meals", json={"date": "someday", "recipe_id": recipe["id"]}).status_code == 400
    assert client.post("/api/meals", json={"date": kitchen.day(1), "recipe_id": recipe["id"], "servings": -2}).status_code == 400


def test_text_recipe_id_is_400_not_500(client, kitchen):
    kitchen.recipe()
    assert client.post("/api/meals", json={"date": kitchen.day(1), "recipe_id": "abc"}).status_code == 400


def test_bad_choices_are_rejected_and_calendar_keeps_working(client, kitchen):
    recipe = kitchen.recipe()
    meal = kitchen.meal(recipe["id"], 1)
    assert client.patch("/api/meals/" + str(meal["id"]), json={"choices": "abc"}).status_code == 400
    assert client.patch("/api/meals/" + str(meal["id"]), json={"optional_items": ["x"]}).status_code == 400
    assert client.patch("/api/meals/" + str(meal["id"]), json={"choices": {"slot": 1}}).status_code == 400
    assert client.post("/api/meals", json={"date": kitchen.day(1), "recipe_id": recipe["id"], "optional_items": "x"}).status_code == 400
    calendar = client.get("/api/calendar", params={"start": kitchen.day(1), "end": kitchen.day(1)})
    assert calendar.status_code == 200
    assert len(calendar.json()[0]["meals"]) == 1


def test_update_meal(client, kitchen):
    recipe = kitchen.recipe()
    other = kitchen.recipe("adas polo", [{"items": [{"name": "berenj", "amount": 90, "unit": "g"}]}])
    meal = kitchen.meal(recipe["id"], 1)
    moved = client.patch("/api/meals/" + str(meal["id"]), json={"date": kitchen.day(3), "servings": 5}).json()
    assert moved["date"] == kitchen.day(3) and moved["servings"] == 5.0
    swapped = client.patch("/api/meals/" + str(meal["id"]), json={"recipe_id": other["id"]}).json()
    assert swapped["recipe_id"] == other["id"] and swapped["choices"] == {}
    assert client.patch("/api/meals/" + str(meal["id"]), json={"recipe_id": 99}).status_code == 404
    assert client.patch("/api/meals/" + str(meal["id"]), json={"position": "first"}).status_code == 400
    assert client.patch("/api/meals/99", json={"servings": 1}).status_code == 404


def test_move_meal_reorders_both_days(client, kitchen):
    recipe = kitchen.recipe()
    first = kitchen.meal(recipe["id"], 1)
    second = kitchen.meal(recipe["id"], 1)
    third = kitchen.meal(recipe["id"], 2)
    client.post("/api/meals/" + str(third["id"]) + "/move", json={"date": kitchen.day(1), "index": 0})
    order = db.rows("SELECT id, date, position FROM meals ORDER BY date, position")
    assert [(row["id"], row["position"]) for row in order] == [(third["id"], 0), (first["id"], 1), (second["id"], 2)]
    client.post("/api/meals/" + str(first["id"]) + "/move", json={"date": kitchen.day(2), "index": 9})
    order = db.rows("SELECT id, date, position FROM meals ORDER BY date, position")
    assert [(row["id"], row["date"], row["position"]) for row in order] == [
        (third["id"], kitchen.day(1), 0),
        (second["id"], kitchen.day(1), 1),
        (first["id"], kitchen.day(2), 0),
    ]
    assert client.post("/api/meals/" + str(first["id"]) + "/move", json={"index": "top"}).status_code == 400
    assert client.post("/api/meals/99/move", json={}).status_code == 404


def test_delete_meal(client, kitchen):
    recipe = kitchen.recipe()
    meal = kitchen.meal(recipe["id"], 1)
    assert client.delete("/api/meals/" + str(meal["id"])).json() == {"ok": True}
    assert client.delete("/api/meals/" + str(meal["id"])).json() == {"ok": True}
    assert db.scalar("SELECT COUNT(*) FROM meals") == 0


def test_calendar_marks_shortages_in_plan_order(client, kitchen):
    recipe = kitchen.recipe()
    kitchen.stock("berenj", 300)
    kitchen.stock("goosht charkh karde", 500)
    kitchen.stock("loobia sabz", 500)
    first = kitchen.meal(recipe["id"], 1, servings=2)
    second = kitchen.meal(recipe["id"], 2, servings=2)
    days = client.get("/api/calendar", params={"start": kitchen.day(0), "end": kitchen.day(2)}).json()
    assert [day["date"] for day in days] == [kitchen.day(0), kitchen.day(1), kitchen.day(2)]
    planned_first = days[1]["meals"][0]
    planned_second = days[2]["meals"][0]
    assert planned_first["id"] == first["id"] and planned_first["feasible"] is True
    assert planned_second["id"] == second["id"] and planned_second["feasible"] is False
    assert planned_second["shortages"][0]["display"] == "Basmati rice"
    assert planned_second["shortages"][0]["missing"] == 100.0


def test_overdue_meals_roll_forward_to_today(client, kitchen):
    recipe = kitchen.recipe()
    with db.tx() as c:
        c.execute("INSERT INTO meals(date, position, recipe_id, servings) VALUES (?, 0, ?, 2)", (kitchen.day(-3), recipe["id"]))
        c.execute("INSERT INTO meals(date, position, recipe_id, servings) VALUES (?, 0, ?, 2)", (kitchen.day(0), recipe["id"]))
    assert services.roll_forward_meals() == 1
    rows = db.rows("SELECT date, position FROM meals ORDER BY id")
    assert rows == [{"date": kitchen.day(0), "position": 1}, {"date": kitchen.day(0), "position": 0}]
    assert services.roll_forward_meals() == 0


def test_calendar_lists_snacks(client, kitchen):
    kitchen.ingredient("sib")
    client.post("/api/snacks", json={"name": "sib", "qty": 1, "unit": "pcs"})
    day = client.get("/api/calendar", params={"start": kitchen.day(0), "end": kitchen.day(0)}).json()[0]
    assert day["snacks"][0]["display"] == "Apple"


def test_suggestions_rank_by_what_is_at_home(client, kitchen):
    loobia = kitchen.recipe()
    omelette = kitchen.recipe("omelette", [{"items": [{"name": "tokhm morgh", "amount": 2, "unit": "pcs"}]}])
    kitchen.stock("tokhm morgh", 10, "pcs")
    data = client.get("/api/suggestions", params={"date": kitchen.day(0), "servings": 2}).json()
    assert data["servings"] == 2.0
    ranked = [(entry["recipe_id"], entry["tier"]) for entry in data["suggestions"]]
    assert ranked == [(omelette["id"], 0), (loobia["id"], 2)]
    assert {short["display"] for short in data["suggestions"][1]["shortages"]} == {"Basmati rice", "Ground beef", "Green beans"}


def test_suggestions_flag_dishes_that_break_the_plan(client, kitchen):
    omelette = kitchen.recipe("omelette", [{"items": [{"name": "tokhm morgh", "amount": 2, "unit": "pcs"}]}])
    kitchen.stock("tokhm morgh", 4, "pcs")
    planned = kitchen.meal(omelette["id"], 2, servings=1)
    data = client.get("/api/suggestions", params={"date": kitchen.day(0), "servings": 1}).json()
    entry = data["suggestions"][0]
    assert entry["tier"] == 0 and entry["pool_meal_id"] == planned["id"] and entry["planned_here"] is True
    data = client.get("/api/suggestions", params={"date": kitchen.day(0), "servings": 3}).json()
    assert data["suggestions"][0]["tier"] == 2
    data = client.get("/api/suggestions", params={"date": kitchen.day(0), "meal_id": planned["id"]}).json()
    assert data["servings"] == 1.0
