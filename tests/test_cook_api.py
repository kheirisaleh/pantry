from app import db, services


def stocked(kitchen):
    recipe = kitchen.recipe()
    kitchen.stock("berenj", 1000, price=4.0)
    kitchen.stock("goosht charkh karde", 500, price=6.0)
    kitchen.stock("loobia sabz", 500, price=2.0)
    return recipe


def test_preview_without_meal_or_dish_is_400(client):
    response = client.post("/api/cook/preview", json={})
    assert response.status_code == 400
    assert response.json()["error"] == "Choose a meal or a dish"


def test_preview(client, kitchen):
    recipe = stocked(kitchen)
    preview = client.post("/api/cook/preview", json={"recipe_id": recipe["id"], "servings": 3}).json()
    assert preview["servings"] == 3.0 and preview["recipe"]["id"] == recipe["id"]
    lines = {line["display"]: (line["qty"], line["stock"]) for line in preview["lines"]}
    assert lines == {"Basmati rice": (300.0, 1000.0), "Ground beef": (240.0, 500.0), "Green beans": (210.0, 500.0)}
    lettuce = recipe["slots"][3]["items"][0]["id"]
    with_side = client.post("/api/cook/preview", json={"recipe_id": recipe["id"], "optional_items": [lettuce]}).json()
    assert "Lettuce" in {line["display"] for line in with_side["lines"]}
    assert client.post("/api/cook/preview", json={"meal_id": 99}).status_code == 404
    assert client.post("/api/cook/preview", json={"recipe_id": 99}).status_code == 404
    assert client.post("/api/cook/preview", json={"recipe_id": recipe["id"], "servings": "two"}).status_code == 400


def test_cook_planned_meal_takes_stock_fifo_and_records_cost(client, kitchen):
    recipe = stocked(kitchen)
    meal = kitchen.meal(recipe["id"], 0, servings=2)
    cooked = client.post("/api/cook", json={"meal_id": meal["id"]}).json()
    assert cooked["status"] == "cooked" and cooked["cooked_by"] == 1 and cooked["shortfalls"] == []
    assert cooked["cost"] == round(200 * 4 / 1000 + 160 * 6 / 500 + 140 * 2 / 500, 2)
    assert cooked["kcal"] == round(2 * (350 + 200 + 70 * 0.31), 1)
    stock = services.stock_map()
    assert stock[kitchen.ingredient_id("Basmati rice")] == 800.0
    assert client.post("/api/cook", json={"meal_id": meal["id"]}).status_code == 400


def test_cook_without_plan_creates_meal(client, kitchen):
    recipe = stocked(kitchen)
    cooked = client.post("/api/cook", json={"recipe_id": recipe["id"], "servings": 1}).json()
    assert cooked["date"] == kitchen.day(0) and cooked["servings"] == 1.0
    assert db.scalar("SELECT COUNT(*) FROM meals") == 1


def test_cook_uses_the_next_planned_meal_of_the_same_dish(client, kitchen):
    recipe = stocked(kitchen)
    planned = kitchen.meal(recipe["id"], 3)
    cooked = client.post("/api/cook", json={"recipe_id": recipe["id"]}).json()
    assert cooked["id"] == planned["id"] and cooked["date"] == kitchen.day(0)


def test_cook_shortfall_and_overrides(client, kitchen):
    recipe = kitchen.recipe()
    kitchen.stock("berenj", 100)
    rice = kitchen.ingredient_id("Basmati rice")
    beef = kitchen.ingredient_id("Ground beef")
    cooked = client.post("/api/cook", json={"recipe_id": recipe["id"], "servings": 1, "overrides": {str(rice): 50, str(beef): 0}}).json()
    assert services.stock_map()[rice] == 50.0
    assert [entry["display"] for entry in cooked["shortfalls"]] == ["Green beans"]
    assert db.scalar("SELECT COUNT(*) FROM events WHERE kind = 'cook_shortfall'") == 1
    assert client.post("/api/cook", json={"recipe_id": recipe["id"], "overrides": {"x": 1}}).status_code == 400


def test_cook_validation(client, kitchen):
    kitchen.recipe()
    assert client.post("/api/cook", json={"recipe_id": 99}).status_code == 404
    assert client.post("/api/cook", json={"meal_id": 99}).status_code == 404
    assert client.post("/api/cook", json={"recipe_id": "soup"}).status_code == 400


def test_cooked_meal_is_locked_until_undone(client, kitchen):
    recipe = stocked(kitchen)
    cooked = client.post("/api/cook", json={"recipe_id": recipe["id"], "servings": 2}).json()
    path = "/api/meals/" + str(cooked["id"])
    assert client.patch(path, json={"servings": 1}).status_code == 400
    assert client.delete(path).status_code == 400
    assert client.post(path + "/move", json={"date": kitchen.day(1)}).status_code == 400
    undone = client.post(path + "/uncook").json()
    assert undone["status"] == "planned" and undone["cost"] is None and undone["kcal"] is None
    assert services.stock_map()[kitchen.ingredient_id("Basmati rice")] == 1000.0
    assert db.scalar("SELECT COUNT(*) FROM events WHERE meal_id = ?", (cooked["id"],)) == 0
    assert client.post(path + "/uncook").status_code == 400


def test_snacks(client, kitchen):
    kitchen.ingredient("sib")
    kitchen.stock("sib", 3, "pcs", price=1.5)
    assert client.post("/api/snacks", json={"name": "sib", "qty": 1, "unit": "pcs"}).json() == {"ok": True}
    snack = db.row("SELECT * FROM snacks")
    assert snack["kcal"] == 95 and snack["cost"] == 0.5 and snack["user_id"] == 1
    assert services.stock_map()[kitchen.ingredient_id("Apple")] == 2.0
    assert client.delete("/api/snacks/" + str(snack["id"])).json() == {"ok": True}
    assert db.scalar("SELECT COUNT(*) FROM snacks") == 0


def test_snack_validation(client, kitchen):
    assert client.post("/api/snacks", json={"name": "sib", "qty": 0}).status_code == 400
    assert client.post("/api/snacks", json={"name": "sib", "qty": 1, "unit": "kg"}).status_code == 400
    assert client.post("/api/snacks", json={"ingredient_id": 99, "qty": 1}).status_code == 404
    assert client.post("/api/snacks", json={"ingredient_id": "apple", "qty": 1}).status_code == 400
    assert client.post("/api/snacks", json={"name": "sib", "qty": 1, "date": "soon"}).status_code == 400


def test_new_snack_is_saved_before_its_unit_is_known(client, drain):
    client.post("/api/snacks", json={"name": "sib", "qty": 2, "unit": "pcs"})
    snack = db.row("SELECT * FROM snacks")
    assert snack["qty"] == 2 and snack["kcal"] is None
