from app import db, services


def planned(kitchen):
    recipe = kitchen.recipe()
    kitchen.meal(recipe["id"], 1, servings=2)
    kitchen.meal(recipe["id"], 2, servings=3)
    return recipe


def test_review_and_build(client, kitchen):
    planned(kitchen)
    kitchen.stock("berenj", 200)
    review = client.get("/api/shopping/review", params={"start": kitchen.day(0), "end": kitchen.day(2)}).json()
    assert {entry["display"]: (entry["needed"], entry["stock"]) for entry in review} == {
        "Green beans": (350.0, 0.0),
        "Ground beef": (400.0, 0.0),
        "Basmati rice": (500.0, 200.0),
    }
    built = client.post("/api/shopping/build", json={"start": kitchen.day(0), "end": kitchen.day(2)}).json()["list"]
    needs = {item["ingredient"]["display"]: item["needed_qty"] for item in built["items"]}
    assert needs == {"Basmati rice": 300.0, "Ground beef": 400.0, "Green beans": 385.0}
    assert [item["ingredient"]["category"] for item in built["items"]] == ["vegetables", "meat", "grains"]
    assert built["range_start"] == kitchen.day(0) and built["total"] == 0
    again = client.post("/api/shopping/build", json={"start": kitchen.day(0), "end": kitchen.day(1)}).json()["list"]
    assert again["id"] == built["id"]
    assert {item["ingredient"]["display"]: item["needed_qty"] for item in again["items"]} == {"Ground beef": 160.0, "Green beans": 154.0}
    assert client.post("/api/shopping/build", json={"start": kitchen.day(2), "end": kitchen.day(0)}).status_code == 400
    assert client.post("/api/shopping/build", json={}).status_code == 400


def test_list_follows_the_plan(client, kitchen):
    recipe = planned(kitchen)
    client.post("/api/shopping/build", json={"start": kitchen.day(0), "end": kitchen.day(2)})
    kitchen.meal(recipe["id"], 2, servings=1)
    items = client.get("/api/shopping").json()["list"]["items"]
    assert {item["ingredient"]["display"]: item["needed_qty"] for item in items}["Basmati rice"] == 600.0
    db_meal = db.scalar("SELECT id FROM meals ORDER BY id DESC LIMIT 1")
    client.delete("/api/meals/" + str(db_meal))
    items = client.get("/api/shopping").json()["list"]["items"]
    assert {item["ingredient"]["display"]: item["needed_qty"] for item in items}["Basmati rice"] == 500.0


def test_sessions_tick_off_and_finish(client, kitchen):
    planned(kitchen)
    client.post("/api/shopping/build", json={"start": kitchen.day(0), "end": kitchen.day(2)})
    session = client.post("/api/shopping/sessions", json={"store": "Rewe"}).json()
    assert session["list"]["active_session"]["store"] == "Rewe"
    items = {item["ingredient"]["display"]: item for item in session["list"]["items"]}
    rice = items["Basmati rice"]["id"]
    beef = items["Ground beef"]["id"]
    listing = client.patch(
        "/api/shopping/items/" + str(rice), json={"checked": True, "bought_qty": 1, "bought_unit": "kg", "price": 3.49}
    ).json()["list"]
    listing = client.patch("/api/shopping/items/" + str(beef), json={"checked": True, "price": "5.99"}).json()["list"]
    beef_item = next(item for item in listing["items"] if item["id"] == beef)
    assert beef_item["bought_qty"] == 400.0 and beef_item["bought_unit"] == "g"
    assert listing["active_session"]["total"] == 9.48 and listing["active_session"]["count"] == 2
    assert listing["total"] == 9.48
    client.post("/api/shopping/sessions/" + str(session["session_id"]) + "/pause")
    assert client.get("/api/shopping").json()["list"]["active_session"] is None
    client.post("/api/shopping/sessions/" + str(session["session_id"]) + "/resume")
    assert client.get("/api/shopping").json()["list"]["active_session"]["id"] == session["session_id"]
    finished = client.post("/api/shopping/sessions/" + str(session["session_id"]) + "/finish").json()["list"]
    assert finished["sessions"][0]["status"] == "finished"
    stock = services.stock_map()
    assert stock[kitchen.ingredient_id("Basmati rice")] == 1000.0 and stock[kitchen.ingredient_id("Ground beef")] == 400.0
    assert client.patch("/api/shopping/items/" + str(rice), json={"price": 1}).status_code == 400
    assert client.delete("/api/shopping/items/" + str(rice)).status_code == 400
    assert client.post("/api/shopping/sessions/" + str(session["session_id"]) + "/resume").status_code == 400
    assert client.post("/api/shopping/sessions/" + str(session["session_id"]) + "/finish").status_code == 200
    prices = client.get("/api/ingredients/" + str(kitchen.ingredient_id("Basmati rice"))).json()["prices"]
    assert prices == [{"date": kitchen.day(0), "store": "Rewe", "qty": 1000.0, "price": 3.49, "unit_price": 3.49}]
    assert client.get("/api/bootstrap").json()["stores"] == ["Rewe"]


def test_unchecking_clears_the_session(client, kitchen):
    added = client.post("/api/shopping/items", json={"name": "milk", "checked": True}).json()
    item = added["list"]["items"][0]
    assert item["checked"] == 1 and item["session_id"] is not None
    assert added["list"]["sessions"][0]["store"] == "Store"
    unchecked = client.patch("/api/shopping/items/" + str(added["item_id"]), json={"checked": False}).json()["list"]
    assert unchecked["items"][0]["checked"] == 0 and unchecked["items"][0]["session_id"] is None


def test_manual_items(client, kitchen):
    kitchen.ingredient("tokhm morgh")
    added = client.post("/api/shopping/items", json={"name": "tokhm morgh", "qty": 6, "unit": "pcs", "note": "free range"}).json()
    item = added["list"]["items"][0]
    assert item["auto"] == 0 and item["needed_qty"] == 6.0 and item["note"] == "free range" and item["source"] == "app"
    client.patch("/api/shopping/items/" + str(added["item_id"]), json={"note": "large"})
    assert client.delete("/api/shopping/items/" + str(added["item_id"])).json()["list"]["items"] == []
    assert client.delete("/api/shopping/items/999").json()["list"]["items"] == []
    assert client.post("/api/shopping/items", json={"name": "milk", "qty": "lots"}).status_code == 400
    assert client.post("/api/shopping/items", json={"name": "milk", "qty": 1, "unit": "box"}).status_code == 400


def test_unknown_ingredient_on_list_is_404_not_500(client):
    assert client.post("/api/shopping/items", json={"ingredient_id": 999}).status_code == 404
    assert client.post("/api/shopping/items", json={"ingredient_id": "milk"}).status_code == 400


def test_update_validation(client):
    added = client.post("/api/shopping/items", json={"name": "milk"}).json()
    path = "/api/shopping/items/" + str(added["item_id"])
    assert client.patch(path, json={"price": "cheap"}).status_code == 400
    assert client.patch(path, json={"price": -1}).status_code == 400
    assert client.patch(path, json={"bought_unit": "box"}).status_code == 400
    assert client.patch(path, json={"bought_qty": 0}).status_code == 400
    assert client.patch(path, json={"price": ""}).status_code == 200
    assert client.patch("/api/shopping/items/999", json={"price": 1}).status_code == 404


def test_buying_a_pack_learns_its_size(client, kitchen):
    recipe = kitchen.recipe("pasta", [{"items": [{"name": "panir", "amount": 250, "unit": "g"}]}])
    kitchen.meal(recipe["id"], 1, servings=2)
    built = client.post("/api/shopping/build", json={"start": kitchen.day(0), "end": kitchen.day(1)}).json()["list"]
    item = built["items"][0]
    client.patch("/api/shopping/items/" + str(item["id"]), json={"checked": True, "bought_qty": 2, "bought_unit": "pack"})
    assert db.scalar("SELECT package_amount FROM ingredients WHERE name_en = 'Feta cheese'") == 250.0


def test_close_list_commits_and_warns_about_skipped_items(client, kitchen):
    planned(kitchen)
    built = client.post("/api/shopping/build", json={"start": kitchen.day(0), "end": kitchen.day(2)}).json()["list"]
    rice = next(item for item in built["items"] if item["ingredient"]["display"] == "Basmati rice")
    client.post("/api/shopping/sessions", json={"store": "Aldi"})
    client.patch("/api/shopping/items/" + str(rice["id"]), json={"checked": True})
    closed = client.post("/api/shopping/" + str(built["id"]) + "/close").json()
    assert closed == {"closed": built["id"], "skipped": 2}
    assert services.stock_map()[kitchen.ingredient_id("Basmati rice")] == 500.0
    titles = [alert["title"] for alert in client.get("/api/alerts").json()]
    assert "Not enough Ground beef for Loobia Polo" in titles and "Not enough Green beans for Loobia Polo" in titles
    assert db.get_setting("default_cycle_days") == "3"
    assert client.get("/api/shopping").json()["list"] is None
    assert client.post("/api/shopping/" + str(built["id"]) + "/close").status_code == 400


def test_session_errors(client):
    assert client.post("/api/shopping/sessions/9/finish").status_code == 404
    assert client.post("/api/shopping/sessions/9/pause").status_code == 404
    assert client.post("/api/shopping/sessions/9/resume").status_code == 400
    started = client.post("/api/shopping/sessions", json={}).json()
    assert started["list"]["sessions"][0]["store"] == "Store"
    second = client.post("/api/shopping/sessions", json={"store": "Edeka"}).json()
    statuses = [session["status"] for session in second["list"]["sessions"]]
    assert statuses == ["paused", "active"]
