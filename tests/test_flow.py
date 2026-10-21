from datetime import date, timedelta

from app import ai, db, services

H = {"x-user-id": "1"}

CATALOG = {
    "berenj": dict(name_en="Basmati rice", name_fa="برنج", name_de="Basmatireis", category="grains", kind="food", unit="g", sold_by_piece=False, piece_amount=0, kcal=350, protein=7, fat=1, carbs=78, fiber=1, tolerance_pct=0, shelf_days=365, icon="cooked-rice"),
    "goosht charkh karde": dict(name_en="Ground beef", name_fa="گوشت چرخ کرده", name_de="Rinderhack", category="meat", kind="food", unit="g", sold_by_piece=False, piece_amount=0, kcal=250, protein=20, fat=18, carbs=0, fiber=0, tolerance_pct=0, shelf_days=2, icon="cut-of-meat"),
    "loobia sabz": dict(name_en="Green beans", name_fa="لوبیا سبز", name_de="Gruene Bohnen", category="vegetables", kind="food", unit="g", sold_by_piece=False, piece_amount=0, kcal=31, protein=2, fat=0, carbs=7, fiber=3, tolerance_pct=10, shelf_days=5, icon="pea-pod"),
    "kahoo": dict(name_en="Lettuce", name_fa="کاهو", name_de="Salat", category="vegetables", kind="food", unit="g", sold_by_piece=True, piece_amount=300, kcal=15, protein=1, fat=0, carbs=3, fiber=1, tolerance_pct=20, shelf_days=5, icon="leafy-green"),
    "namak": dict(name_en="Salt", name_fa="نمک", name_de="Salz", category="condiments", kind="staple", unit="g", sold_by_piece=False, piece_amount=0, kcal=0, protein=0, fat=0, carbs=0, fiber=0, tolerance_pct=0, shelf_days=0, icon="salt"),
    "panir": dict(name_en="Feta cheese", name_fa="پنیر", name_de="Feta", category="dairy", kind="food", unit="g", sold_by_piece=False, piece_amount=0, kcal=260, protein=14, fat=21, carbs=4, fiber=0, tolerance_pct=0, shelf_days=14, icon="cheese-wedge"),
}


def fake_generate(prompt, schema, timeout=60):
    if "properties" in schema and "same_as_id" in schema["properties"]:
        for key, value in CATALOG.items():
            if '"' + key + '"' in prompt.lower():
                answer = dict(value, understood=True, same_as_id=0, aliases=[])
                return answer
        if '"rice"' in prompt.lower():
            rice_id = db.scalar("SELECT id FROM ingredients WHERE name_en = 'Basmati rice'")
            return dict(CATALOG["berenj"], understood=True, same_as_id=rice_id, aliases=["reis"])
        return dict(CATALOG["namak"], understood=False, same_as_id=0, aliases=[])
    return {"understood": True, "name_en": "Loobia Polo", "name_fa": "لوبیا پلو", "description": "Rice layered with beans and beef.", "tags": ["persian", "rice"], "cook_minutes": 75, "image_query": "loobia polo"}


def drain(monkeypatch):
    monkeypatch.setattr(ai, "generate", fake_generate)
    monkeypatch.setattr(ai, "run_images", lambda recipe_id: None)
    while ai.process_one():
        pass


def test_full_cycle(client, monkeypatch):
    today = date.fromisoformat(client.get("/api/bootstrap").json()["today"])
    recipe = client.post("/api/recipes", headers=H, json={"name": "loobia polo", "slots": [
        {"items": [{"name": "berenj", "amount": 100, "unit": "g"}]},
        {"items": [{"name": "goosht charkh karde", "amount": 80, "unit": "g"}]},
        {"items": [{"name": "loobia sabz", "amount": 70, "unit": "g"}]},
        {"optional": True, "items": [{"name": "kahoo", "amount": 50, "unit": "g"}]},
        {"items": [{"name": "namak", "amount": 3, "unit": "g"}]},
    ]}).json()
    assert recipe["status"] == "pending"
    drain(monkeypatch)
    recipe = client.get("/api/recipes/" + str(recipe["id"])).json()
    assert recipe["name_en"] == "Loobia Polo" and recipe["name_fa"] == "لوبیا پلو"
    assert round(recipe["nutrition_per_person"]["kcal"]) == 350 + 200 + 22

    d1 = (today + timedelta(days=1)).isoformat()
    d2 = (today + timedelta(days=2)).isoformat()
    client.post("/api/meals", headers=H, json={"date": d1, "recipe_id": recipe["id"], "servings": 2})
    meal2 = client.post("/api/meals", headers=H, json={"date": d2, "recipe_id": recipe["id"], "servings": 3, "optional_items": []}).json()

    built = client.post("/api/shopping/build", headers=H, json={"start": today.isoformat(), "end": d2}).json()["list"]
    needs = {item["ingredient"]["display"]: item["needed_qty"] for item in built["items"]}
    assert needs == {"Basmati rice": 500.0, "Ground beef": 400.0, "Green beans": 385.0}

    client.patch("/api/meals/" + str(meal2["id"]), headers=H, json={"optional_items": [recipe["slots"][3]["items"][0]["id"]]})
    shopping = client.get("/api/shopping").json()["list"]
    lettuce = next(item for item in shopping["items"] if item["ingredient"]["display"] == "Lettuce")
    assert lettuce["needed_qty"] == 300.0 and lettuce["pieces"] == 1

    session = client.post("/api/shopping/sessions", headers=H, json={"store": "Rewe"}).json()
    items = {item["ingredient"]["display"]: item for item in session["list"]["items"]}
    client.patch("/api/shopping/items/" + str(items["Basmati rice"]["id"]), headers=H, json={"checked": True, "bought_qty": 1000, "bought_unit": "g", "price": 3.49})
    client.patch("/api/shopping/items/" + str(items["Ground beef"]["id"]), headers=H, json={"checked": True, "bought_qty": 500, "bought_unit": "g", "price": 5.99})
    client.patch("/api/shopping/items/" + str(items["Lettuce"]["id"]), headers=H, json={"checked": True, "bought_qty": 1, "bought_unit": "pcs", "price": 0.99})
    extra = client.post("/api/shopping/items", headers={**H, "x-op-id": "op-1"}, json={"name": "panir", "checked": True, "session_id": session["session_id"]}).json()
    replay = client.post("/api/shopping/items", headers={**H, "x-op-id": "op-1"}, json={"name": "panir", "checked": True, "session_id": session["session_id"]}).json()
    assert extra["item_id"] == replay["item_id"]
    client.patch("/api/shopping/items/" + str(extra["item_id"]), headers=H, json={"price": 2.29, "bought_qty": 200, "bought_unit": "g"})
    current = client.get("/api/shopping").json()["list"]
    assert current["active_session"]["total"] == round(3.49 + 5.99 + 0.99 + 2.29, 2)

    client.post("/api/shopping/sessions/" + str(session["session_id"]) + "/finish", headers=H)
    drain(monkeypatch)
    stock = services.stock_map()
    names_by_id = {entry["id"]: entry["display"] for entry in client.get("/api/ingredients").json()}
    by_name = {names_by_id[key]: value for key, value in stock.items()}
    assert by_name["Basmati rice"] == 1000 and by_name["Lettuce"] == 300 and by_name["Feta cheese"] == 200

    closed = client.post("/api/shopping/" + str(current["id"]) + "/close", headers=H).json()
    assert closed["skipped"] == 1
    alerts = client.get("/api/alerts").json()
    assert any("Green beans" in alert["title"] for alert in alerts)

    suggestions = client.get("/api/suggestions", params={"date": d1, "servings": 2}).json()
    assert suggestions["suggestions"][0]["tier"] == 2

    cooked = client.post("/api/cook", headers=H, json={"recipe_id": recipe["id"], "date": today.isoformat(), "servings": 1}).json()
    assert cooked["status"] == "cooked" and cooked["cooked_by"] == 1
    assert round(cooked["cost"], 2) == round(100 * 3.49 / 1000 + 80 * 5.99 / 500, 2)
    assert cooked["shortfalls"][0]["display"] == "Green beans"
    assert services.stock_map()[[key for key, value in names_by_id.items() if value == "Basmati rice"][0]] == 900

    client.post("/api/meals/" + str(cooked["id"]) + "/uncook", headers=H)
    assert services.stock_map()[[key for key, value in names_by_id.items() if value == "Basmati rice"][0]] == 1000

    rice_id = [key for key, value in names_by_id.items() if value == "Basmati rice"][0]
    client.post("/api/inventory/" + str(rice_id) + "/waste", headers=H, json={"qty": 100, "unit": "g"})
    client.post("/api/inventory/count", headers=H, json={"entries": [{"ingredient_id": rice_id, "qty": 850}], "full": True})
    assert services.stock_map()[rice_id] == 850
    finance = client.get("/api/reports/finance").json()
    assert finance["summary"]["spent"] == round(3.49 + 5.99 + 0.99 + 2.29, 2)
    assert finance["summary"]["waste"] == 0.35
    assert client.get("/api/export.xlsx").status_code == 200
    assert "Basmati rice" in client.get("/api/export/inventory.csv").text


def test_unresolved_and_merge(client, monkeypatch):
    first = client.post("/api/ingredients", headers=H, json={"name": "berenj"}).json()
    drain(monkeypatch)
    second = client.post("/api/ingredients", headers=H, json={"name": "rice"}).json()
    assert second["id"] != first["id"]
    drain(monkeypatch)
    ids = [entry["id"] for entry in client.get("/api/ingredients").json()]
    assert ids == [first["id"]]
    assert client.get("/api/ingredients/search", params={"q": "reis"}).json()[0]["id"] == first["id"]
    weird = client.post("/api/ingredients", headers=H, json={"name": "xyzzy"}).json()
    drain(monkeypatch)
    assert client.get("/api/ingredients/" + str(weird["id"])).json()["status"] == "unresolved"


def test_pending_unit_purchase_converts_later(client, monkeypatch):
    client.post("/api/shopping/sessions", headers=H, json={"store": "Aldi"})
    added = client.post("/api/shopping/items", headers=H, json={"name": "kahoo", "checked": True}).json()
    client.patch("/api/shopping/items/" + str(added["item_id"]), headers=H, json={"bought_qty": 2, "bought_unit": "pcs", "price": 1.5})
    session_id = added["list"]["active_session"]["id"]
    client.post("/api/shopping/sessions/" + str(session_id) + "/finish", headers=H)
    assert services.stock_map() == {}
    drain(monkeypatch)
    assert list(services.stock_map().values()) == [600.0]
