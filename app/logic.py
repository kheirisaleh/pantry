import math

EPSILON = 1e-6
MASS_UNITS = ("g", "ml")
CALC_KINDS = ("food",)
SPOON_UNITS = {"tbsp": 15.0, "tsp": 5.0}
PACKAGE_UNITS = ("jar", "can", "pack")
SCALED_UNITS = {"kg": ("g", 1000.0), "l": ("ml", 1000.0)}


def to_base(ingredient, amount, unit):
    base = ingredient.get("unit") or "g"
    if amount is None:
        return None
    if unit in SCALED_UNITS:
        unit, factor = SCALED_UNITS[unit]
        amount = float(amount) * factor
    if unit in SPOON_UNITS:
        amount = float(amount) * SPOON_UNITS[unit]
        unit = "ml" if base == "ml" else "g"
    if unit in PACKAGE_UNITS:
        package = ingredient.get("package_amount")
        return float(amount) * float(package) if package else None
    if unit == base:
        return float(amount)
    if unit in MASS_UNITS and base in MASS_UNITS:
        return float(amount)
    piece = ingredient.get("piece_amount")
    if unit == "pcs" and base in MASS_UNITS:
        return float(amount) * float(piece) if piece else None
    if unit in MASS_UNITS and base == "pcs":
        return float(amount) / float(piece) if piece else None
    return None


def nutrients(ingredient, qty_base):
    factor = qty_base if ingredient.get("unit") == "pcs" else qty_base / 100.0
    result = {}
    for key in ("kcal", "protein", "fat", "carbs", "fiber"):
        value = ingredient.get(key)
        result[key] = None if value is None else value * factor
    return result


def counts_in_planning(ingredient):
    return ingredient.get("kind") in CALC_KINDS and not ingredient.get("archived")


def meal_requirements(meal, items, ingredients):
    choices = meal.get("choices") or {}
    optional_selected = {int(value) for value in (meal.get("optional_items") or [])}
    servings = float(meal.get("servings") or 0)
    by_slot = {}
    for item in items:
        by_slot.setdefault(item["slot"], []).append(item)
    required = {}
    unconvertible = []
    for slot, slot_items in by_slot.items():
        chosen_id = choices.get(str(slot)) or choices.get(slot)
        chosen = None
        if chosen_id is not None:
            chosen = next((item for item in slot_items if item["id"] == int(chosen_id)), None)
        if chosen is None:
            chosen = next((item for item in slot_items if item["is_default"]), slot_items[0])
        if chosen["optional"] and chosen["id"] not in optional_selected:
            continue
        ingredient = ingredients.get(chosen["ingredient_id"])
        if ingredient is None or not counts_in_planning(ingredient):
            continue
        factor = 1.0 if chosen.get("per_dish") else servings
        qty = to_base(ingredient, chosen["amount"] * factor, chosen["unit"])
        if qty is None:
            unconvertible.append(chosen["ingredient_id"])
            continue
        required[chosen["ingredient_id"]] = required.get(chosen["ingredient_id"], 0.0) + qty
    return required, unconvertible


def simulate(stock, sequence):
    running = dict(stock)
    outcome = []
    for key, required in sequence:
        shortages = {}
        for ingredient_id, qty in required.items():
            have = running.get(ingredient_id, 0.0)
            if qty > have + EPSILON:
                shortages[ingredient_id] = qty - have
            running[ingredient_id] = max(0.0, have - qty)
        outcome.append({"key": key, "shortages": shortages, "feasible": not shortages})
    return outcome, running


def round_purchase(ingredient, need):
    if need <= EPSILON:
        return None
    base = ingredient.get("unit") or "g"
    piece = ingredient.get("piece_amount")
    package = ingredient.get("package_amount")
    if package:
        packages = math.ceil(need / float(package) - EPSILON)
        return {"qty": packages * float(package), "pieces": None, "approx": None, "packages": packages}
    if base == "pcs":
        pieces = math.ceil(need - EPSILON)
        return {"qty": float(pieces), "pieces": pieces, "approx": None}
    if ingredient.get("sold_by_piece") and piece:
        pieces = math.ceil(need / float(piece) - EPSILON)
        return {"qty": pieces * float(piece), "pieces": pieces, "approx": pieces * float(piece)}
    return {"qty": float(math.ceil(need - EPSILON)), "pieces": None, "approx": None}


def shopping_needs(stock, before_range, in_range, ingredients):
    reserved = {}
    for _, required in before_range:
        for ingredient_id, qty in required.items():
            reserved[ingredient_id] = reserved.get(ingredient_id, 0.0) + qty
    demand = {}
    for _, required in in_range:
        for ingredient_id, qty in required.items():
            demand[ingredient_id] = demand.get(ingredient_id, 0.0) + qty
    result = {}
    for ingredient_id, qty in demand.items():
        ingredient = ingredients[ingredient_id]
        tolerance = float(ingredient.get("tolerance_pct") or 0) / 100.0
        free = max(0.0, stock.get(ingredient_id, 0.0) - reserved.get(ingredient_id, 0.0))
        need = qty * (1.0 + tolerance) - free
        rounded = round_purchase(ingredient, need)
        if rounded:
            result[ingredient_id] = dict(rounded, demand=qty, free=free)
    for ingredient_id, qty in reserved.items():
        if ingredient_id in result or ingredient_id in demand:
            continue
        need = qty - stock.get(ingredient_id, 0.0)
        rounded = round_purchase(ingredients[ingredient_id], need)
        if rounded:
            result[ingredient_id] = dict(rounded, demand=0.0, free=0.0)
    return result


def rank_suggestions(stock, planned_after, candidates):
    baseline, _ = simulate(stock, planned_after)
    baseline_broken = sum(1 for entry in baseline if not entry["feasible"])
    ranked = []
    for candidate in candidates:
        required = candidate["required"]
        shortages = {}
        after = dict(stock)
        for ingredient_id, qty in required.items():
            have = after.get(ingredient_id, 0.0)
            if qty > have + EPSILON:
                shortages[ingredient_id] = qty - have
            after[ingredient_id] = max(0.0, have - qty)
        remaining = [entry for entry in planned_after if entry[0] != candidate.get("skip_key")]
        outcome, _ = simulate(after, remaining)
        broken = sum(1 for entry in outcome if not entry["feasible"])
        newly_broken = max(0, broken - baseline_broken)
        if shortages:
            tier = 2
        elif newly_broken:
            tier = 1
        else:
            tier = 0
        ranked.append(
            dict(
                candidate,
                shortages=shortages,
                breaks=newly_broken,
                tier=tier,
                unconvertible=candidate.get("unconvertible", []),
            )
        )
    ranked.sort(
        key=lambda entry: (
            entry["tier"],
            len(entry["shortages"]),
            entry["breaks"],
            0 if entry.get("planned_here") else 1,
            entry.get("last_cooked") or "",
            entry.get("name") or "",
        )
    )
    return ranked


def fifo_consume(batches, qty):
    remaining = float(qty)
    taken = []
    for batch in sorted(batches, key=lambda entry: (entry["purchased_at"], entry["id"])):
        if remaining <= EPSILON:
            break
        available = float(batch["qty_remaining"])
        if available <= EPSILON:
            continue
        portion = min(available, remaining)
        unit_cost = 0.0
        if batch.get("price_total") is not None and batch["qty_initial"] > EPSILON:
            unit_cost = float(batch["price_total"]) / float(batch["qty_initial"])
        taken.append({"batch_id": batch["id"], "qty": portion, "value": portion * unit_cost})
        remaining -= portion
    return taken, max(0.0, remaining)
