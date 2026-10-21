from app import logic

RICE = {"id": 1, "unit": "g", "kind": "food", "tolerance_pct": 0}
LETTUCE = {"id": 2, "unit": "g", "kind": "food", "tolerance_pct": 20, "sold_by_piece": 1, "piece_amount": 300}
EGG = {"id": 3, "unit": "pcs", "kind": "food", "piece_amount": 60, "tolerance_pct": 0}
SALT = {"id": 4, "unit": "g", "kind": "staple"}
INGREDIENTS = {1: RICE, 2: LETTUCE, 3: EGG, 4: SALT}


def items():
    return [
        {"id": 10, "slot": 0, "ingredient_id": 1, "amount": 100, "unit": "g", "optional": 0, "is_default": 1},
        {"id": 11, "slot": 1, "ingredient_id": 2, "amount": 50, "unit": "g", "optional": 0, "is_default": 1},
        {"id": 12, "slot": 2, "ingredient_id": 3, "amount": 1, "unit": "pcs", "optional": 1, "is_default": 1},
        {"id": 13, "slot": 3, "ingredient_id": 4, "amount": 5, "unit": "g", "optional": 0, "is_default": 1},
        {"id": 14, "slot": 0, "ingredient_id": 3, "amount": 2, "unit": "pcs", "optional": 0, "is_default": 0},
    ]


def test_scaling_and_staples_and_optional():
    required, unconvertible = logic.meal_requirements({"servings": 3, "choices": {}, "optional_items": []}, items(), INGREDIENTS)
    assert required == {1: 300.0, 2: 150.0}
    assert unconvertible == []


def test_optional_selected_and_alternative_choice():
    meal = {"servings": 2, "choices": {"0": 14}, "optional_items": [12]}
    required, _ = logic.meal_requirements(meal, items(), INGREDIENTS)
    assert required == {3: 6.0, 2: 100.0}


def test_unit_conversion():
    assert logic.to_base(EGG, 120, "g") == 2.0
    assert logic.to_base(LETTUCE, 2, "pcs") == 600.0
    assert logic.to_base(RICE, 1, "pcs") is None
    assert logic.to_base(RICE, 200, "ml") == 200.0


def test_shopping_needs_rounding_and_tolerance():
    needs = logic.shopping_needs({1: 100.0}, [], [("a", {1: 300.0, 2: 350.0})], INGREDIENTS)
    assert needs[1]["qty"] == 200.0
    assert needs[2]["pieces"] == 2
    assert needs[2]["qty"] == 600.0


def test_reservation_before_range():
    needs = logic.shopping_needs({1: 500.0}, [("early", {1: 400.0})], [("later", {1: 300.0})], INGREDIENTS)
    assert needs[1]["qty"] == 200.0


def test_simulate_sequence():
    outcome, left = logic.simulate({1: 500.0}, [("a", {1: 300.0}), ("b", {1: 300.0})])
    assert outcome[0]["feasible"] and not outcome[1]["feasible"]
    assert round(outcome[1]["shortages"][1]) == 100
    assert left[1] == 0.0


def test_rank_prefers_dishes_that_keep_plan_feasible():
    stock = {1: 500.0, 2: 300.0}
    planned = [("tomorrow", {1: 400.0})]
    candidates = [
        {"recipe_id": 1, "name": "Rice heavy", "required": {1: 300.0}},
        {"recipe_id": 2, "name": "Salad", "required": {2: 200.0}},
        {"recipe_id": 3, "name": "Eggs", "required": {3: 2.0}},
    ]
    ranked = logic.rank_suggestions(stock, planned, candidates)
    assert [entry["recipe_id"] for entry in ranked] == [2, 1, 3]
    assert ranked[1]["breaks"] == 1 and ranked[2]["tier"] == 2


def test_fifo():
    batches = [
        {"id": 2, "purchased_at": "2026-10-02", "qty_remaining": 500, "qty_initial": 500, "price_total": 5.0},
        {"id": 1, "purchased_at": "2026-10-01", "qty_remaining": 200, "qty_initial": 1000, "price_total": 10.0},
    ]
    taken, missing = logic.fifo_consume(batches, 400)
    assert taken[0]["batch_id"] == 1 and taken[0]["qty"] == 200
    assert taken[1]["batch_id"] == 2 and taken[1]["qty"] == 200
    assert round(sum(entry["value"] for entry in taken), 2) == 4.0
    assert missing == 0
