from app import db, services


def test_manual_add_and_inventory(client, kitchen):
    kitchen.ingredient("berenj")
    added = client.post("/api/inventory/add", json={"name": "berenj", "qty": 2, "unit": "kg", "price": "5.50", "store": "Lidl"}).json()
    assert added["stock"] == 2000.0
    assert added["batches"][0]["price_total"] == 5.5 and added["batches"][0]["store"] == "Lidl"
    assert added["batches"][0]["expires_at"] == kitchen.day(365)
    listing = client.get("/api/inventory").json()
    assert listing["last_count"] is None
    item = listing["items"][0]
    assert item["display"] == "Basmati rice" and item["stock"] == 2000.0 and item["expiring_estimate"] is None
    assert len(item["batches"]) == 1


def test_manual_add_validation(client, kitchen):
    assert client.post("/api/inventory/add", json={"name": "berenj", "qty": 1, "unit": "box"}).status_code == 400
    assert client.post("/api/inventory/add", json={"name": "berenj", "qty": 0}).status_code == 400
    assert client.post("/api/inventory/add", json={"ingredient_id": 99, "qty": 1}).status_code == 404


def test_text_price_is_400_not_500(client):
    response = client.post("/api/inventory/add", json={"name": "berenj", "qty": 1, "price": "cheap"})
    assert response.status_code == 400
    assert client.post("/api/inventory/add", json={"name": "berenj", "qty": 1, "price": -2}).status_code == 400


def test_expiring_estimate(client, kitchen):
    kitchen.ingredient("goosht charkh karde")
    client.post("/api/inventory/add", json={"name": "goosht charkh karde", "qty": 500, "unit": "g"})
    item = client.get("/api/inventory").json()["items"][0]
    assert item["expiring_estimate"] == kitchen.day(2)


def test_waste_used_up_and_count(client, kitchen):
    kitchen.ingredient("berenj")
    kitchen.stock("berenj", 1000, price=4.0)
    rice = kitchen.ingredient_id("Basmati rice")
    wasted = client.post("/api/inventory/" + str(rice) + "/waste", json={"qty": 100, "unit": "g"}).json()
    assert wasted["stock"] == 900.0
    assert db.scalar("SELECT ROUND(SUM(value), 2) FROM events WHERE kind = 'waste'") == 0.4
    client.post("/api/inventory/count", json={"entries": [{"ingredient_id": rice, "qty": 950}], "full": True})
    assert services.stock_map()[rice] == 950.0
    assert client.get("/api/inventory").json()["last_count"] == kitchen.day(0)
    client.post("/api/inventory/count", json={"entries": [{"ingredient_id": rice, "qty": "700"}]})
    assert services.stock_map()[rice] == 700.0
    used = client.post("/api/inventory/" + str(rice) + "/used-up").json()
    assert used["stock"] == 0.0
    assert db.scalar("SELECT COUNT(*) FROM events WHERE kind = 'used_up'") == 2
    everything = client.post("/api/inventory/" + str(rice) + "/waste", json={}).json()
    assert everything["stock"] == 0.0


def test_waste_validation(client, kitchen):
    kitchen.ingredient("berenj")
    rice = kitchen.ingredient_id("Basmati rice")
    assert client.post("/api/inventory/99/waste", json={}).status_code == 404
    assert client.post("/api/inventory/99/used-up").status_code == 404
    assert client.post("/api/inventory/" + str(rice) + "/waste", json={"qty": 1, "unit": "pcs"}).status_code == 400
    assert client.post("/api/inventory/" + str(rice) + "/waste", json={"qty": -1}).status_code == 400


def test_bad_count_entries_are_400_not_500(client, kitchen):
    kitchen.ingredient("berenj")
    rice = kitchen.ingredient_id("Basmati rice")
    assert client.post("/api/inventory/count", json={"entries": [{"qty": 1}]}).status_code == 400
    assert client.post("/api/inventory/count", json={"entries": [{"ingredient_id": rice, "qty": "lots"}]}).status_code == 400
    assert client.post("/api/inventory/count", json={"entries": [{"ingredient_id": rice}]}).status_code == 400
    assert client.post("/api/inventory/count", json={"entries": ["rice"]}).status_code == 400
    assert client.post("/api/inventory/count", json={"entries": [{"ingredient_id": 99, "qty": 1}]}).status_code == 404
    assert client.post("/api/inventory/count", json={"entries": [{"ingredient_id": rice, "qty": -1}]}).status_code == 400


def test_full_count_resolves_reminder(client, kitchen):
    with db.tx() as c:
        c.execute("INSERT INTO alerts(kind, dedupe_key, title) VALUES ('stock_count', 'k', 'Check')")
    client.post("/api/inventory/count", json={"entries": [], "full": True})
    assert db.scalar("SELECT status FROM alerts") == "resolved"
