from app import cycle, db


def test_empty_pantry(client):
    state = client.get("/api/cycle").json()
    assert state["empty_pantry"] is True and state["must_shop"] is False and state["cycle"] is None
    assert state["default_days"] == 14 and state["open_list"] is None


def test_cookable_and_must_shop(client, kitchen):
    kitchen.recipe("omelette", [{"items": [{"name": "tokhm morgh", "amount": 2, "unit": "pcs"}]}])
    kitchen.stock("tokhm morgh", 8, "pcs")
    simulation = cycle.cookable_meals()
    assert simulation["meals_left"] == 2 and len(simulation["now"]) == 1 and simulation["recipes_considered"] == 1
    kitchen.stock("berenj", 10)
    client.post("/api/inventory/count", json={"entries": [{"ingredient_id": kitchen.ingredient_id("Eggs"), "qty": 1}]})
    state = client.get("/api/cycle").json()
    assert state["must_shop"] is True and state["meals_left"] == 0
    assert "Time to go shopping" in [alert["title"] for alert in client.get("/api/alerts").json()]


def test_running_cycle_forecast(client, kitchen):
    kitchen.recipe("omelette", [{"items": [{"name": "tokhm morgh", "amount": 2, "unit": "pcs"}]}])
    with db.tx() as c:
        list_id = c.execute("INSERT INTO shopping_lists(range_start, range_end) VALUES (?, ?)", (kitchen.day(-2), kitchen.day(4))).lastrowid
        c.execute(
            "INSERT INTO shopping_sessions(list_id, store, status, started_at, finished_at) VALUES (?, 'Rewe', 'finished', ?, ?)",
            (list_id, kitchen.day(-2) + " 10:00:00", kitchen.day(-2) + " 11:00:00"),
        )
        c.execute(
            "INSERT INTO shopping_items(list_id, ingredient_id, checked, price) VALUES (?, ?, 1, 14.0)",
            (list_id, db.scalar("SELECT id FROM ingredients")),
        )
    kitchen.stock("tokhm morgh", 4, "pcs")
    state = client.get("/api/cycle").json()
    running = state["cycle"]
    assert running["start"] == kitchen.day(-2) and running["planned_days"] == 7 and running["elapsed_days"] == 2
    assert running["spend"] == 14.0 and running["daily_spend"] == 2.0 and running["rate_basis"] == "assumed"
    assert running["state"] == "early" and running["forecast_run_out"] == kitchen.day(1)
    assert "Food runs out early" in [alert["title"] for alert in client.get("/api/alerts").json()]
    assert state["history"][0]["list_id"] == list_id and state["history"][0]["actual_days"] is None


def test_history_compares_planned_and_actual(client, kitchen):
    with db.tx() as c:
        for start in (-20, -10):
            list_id = c.execute(
                "INSERT INTO shopping_lists(range_start, range_end) VALUES (?, ?)", (kitchen.day(start), kitchen.day(start + 6))
            ).lastrowid
            c.execute(
                "INSERT INTO shopping_sessions(list_id, store, started_at) VALUES (?, 'Lidl', ?)",
                (list_id, kitchen.day(start) + " 09:00:00"),
            )
    history = cycle.history()
    assert history[0]["planned_days"] == 7 and history[0]["actual_days"] == 10
    assert history[0]["difference_days"] == 3 and history[0]["saved"] == 0.0
    assert history[1]["actual_days"] is None
    assert cycle.default_days() == 7
