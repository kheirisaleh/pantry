from app import db


def test_create_resolves_in_background(client, drain):
    created = client.post("/api/ingredients", json={"name": "berenj"}).json()
    assert created["status"] == "pending" and created["display"] == "berenj"
    assert drain() == 1
    ready = client.get("/api/ingredients/" + str(created["id"])).json()
    assert ready["status"] == "ready"
    assert ready["name_en"] == "Basmati rice" and ready["name_fa"] == "برنج" and ready["name_de"] == "Basmatireis"
    assert ready["unit"] == "g" and ready["kcal"] == 350 and ready["shelf_days"] == 365
    assert "basmati rice" in ready["aliases"] and "berenj" in ready["aliases"]
    assert ready["batches"] == [] and ready["prices"] == []


def test_same_name_resolves_to_the_same_ingredient(client, drain):
    first = client.post("/api/ingredients", json={"name": "Berenj"}).json()
    second = client.post("/api/ingredients", json={"name": "berenj!"}).json()
    assert first["id"] == second["id"]


def test_name_is_required(client):
    assert client.post("/api/ingredients", json={"name": "  "}).status_code == 400


def test_unknown_ingredient_is_404(client):
    assert client.get("/api/ingredients/42").status_code == 404
    assert client.patch("/api/ingredients/42", json={"kcal": 1}).status_code == 404


def test_list_search_and_archive(client, kitchen):
    rice = kitchen.ingredient("berenj")
    kitchen.ingredient("panir")
    listing = client.get("/api/ingredients").json()
    assert [entry["display"] for entry in listing] == ["Feta cheese", "Basmati rice"]
    assert listing[1]["stock"] == 0.0 and listing[1]["pending_stock"] == []
    assert client.get("/api/ingredients/search", params={"q": "basm"}).json()[0]["id"] == rice["id"]
    assert client.get("/api/ingredients/search", params={"q": "برنج"}).json()[0]["id"] == rice["id"]
    assert client.get("/api/ingredients/search", params={"q": ""}).json() == []
    assert client.post("/api/ingredients/" + str(rice["id"]) + "/archive", json={}).json() == {"ok": True}
    assert [entry["display"] for entry in client.get("/api/ingredients").json()] == ["Feta cheese"]
    assert len(client.get("/api/ingredients", params={"archived": 1}).json()) == 2
    assert client.get("/api/ingredients/search", params={"q": "basm"}).json() == []
    client.post("/api/ingredients/" + str(rice["id"]) + "/archive", json={"archived": False})
    assert len(client.get("/api/ingredients").json()) == 2


def test_edit_details(client, kitchen):
    rice = kitchen.ingredient("berenj")
    updated = client.patch(
        "/api/ingredients/" + str(rice["id"]),
        json={
            "name_en": " Rice ",
            "kcal": "360",
            "sold_by_piece": True,
            "shelf_days": 200.0,
            "aliases": ["reis"],
            "category": "grains",
            "kind": "food",
        },
    ).json()
    assert updated["name_en"] == "Rice" and updated["display"] == "Rice"
    assert updated["kcal"] == 360.0 and updated["sold_by_piece"] == 1 and updated["shelf_days"] == 200
    assert "reis" in updated["aliases"]


def test_edit_rejects_text_in_number_fields(client, kitchen):
    rice = kitchen.ingredient("berenj")
    response = client.patch("/api/ingredients/" + str(rice["id"]), json={"kcal": "lots"})
    assert response.status_code == 400
    assert client.patch("/api/ingredients/" + str(rice["id"]), json={"protein": -1}).status_code == 400
    assert client.get("/api/ingredients/" + str(rice["id"])).json()["kcal"] == 350


def test_edit_rejects_unknown_category_and_kind(client, kitchen):
    rice = kitchen.ingredient("berenj")
    assert client.patch("/api/ingredients/" + str(rice["id"]), json={"category": "spaceship"}).status_code == 400
    assert client.patch("/api/ingredients/" + str(rice["id"]), json={"kind": "toy"}).status_code == 400
    assert client.patch("/api/ingredients/" + str(rice["id"]), json={"name_en": 5}).status_code == 400


def test_manual_edit_finishes_a_pending_ingredient(client):
    created = client.post("/api/ingredients", json={"name": "zereshk"}).json()
    assert db.scalar("SELECT COUNT(*) FROM ai_jobs") == 1
    updated = client.patch("/api/ingredients/" + str(created["id"]), json={"name_en": "Barberries", "unit": "g"}).json()
    assert updated["status"] == "ready" and updated["unit_locked"] == 1
    assert db.scalar("SELECT COUNT(*) FROM ai_jobs") == 0


def test_base_unit_is_locked_once_stock_exists(client, kitchen):
    kitchen.stock("berenj", 1000)
    rice_id = kitchen.ingredient_id("Basmati rice")
    response = client.patch("/api/ingredients/" + str(rice_id), json={"unit": "pcs"})
    assert response.status_code == 400
    assert client.patch("/api/ingredients/" + str(rice_id), json={"unit": "kg"}).status_code == 400


def test_unresolved_and_retry(client, drain):
    weird = client.post("/api/ingredients", json={"name": "xyzzy"}).json()
    drain()
    unresolved = client.get("/api/ingredients/" + str(weird["id"])).json()
    assert unresolved["status"] == "unresolved" and "Edit it by hand" in unresolved["ai_error"]
    retried = client.post("/api/ingredients/" + str(weird["id"]) + "/retry").json()
    assert retried["status"] == "pending" and retried["ai_error"] is None
    assert db.scalar("SELECT COUNT(*) FROM ai_jobs WHERE kind = 'ingredient' AND target_id = ?", (weird["id"],)) == 1


def test_pending_purchase_converts_after_ai(client, drain):
    client.post("/api/inventory/add", json={"name": "kahoo", "qty": 2, "unit": "pcs"})
    listing = client.get("/api/ingredients").json()
    assert listing[0]["pending_stock"] == [{"unit": "pcs", "qty": 2.0}]
    drain()
    lettuce = client.get("/api/ingredients").json()[0]
    assert lettuce["stock"] == 600.0 and lettuce["pending_stock"] == []
