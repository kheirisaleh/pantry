import json
import math
import os
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from . import db, logic, names

DEFAULT_TZ = "Europe/Berlin"
UNITS = ("g", "ml", "pcs")


class ServiceError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def now():
    return datetime.now(zone())


def today():
    return now().date()


def iso_now():
    return now().strftime("%Y-%m-%d %H:%M:%S")


def parse_date(value):
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError as error:
        raise ServiceError("Invalid date: " + str(value)) from error


RECIPE_UNITS = ("g", "ml", "pcs", "jar", "can", "pack", "tbsp", "tsp")


SHOP_UNITS = ("g", "kg", "ml", "l", "pcs", "pack")
SOURCES = ("app", "alexa", "automation", "plan")


def check_shop_unit(unit):
    if unit not in SHOP_UNITS:
        raise ServiceError("Unit must be one of " + ", ".join(SHOP_UNITS))
    return unit


def check_recipe_unit(unit):
    if unit not in RECIPE_UNITS:
        raise ServiceError("Unknown unit")
    return unit


def check_unit(unit):
    if unit not in UNITS:
        raise ServiceError("Unit must be one of g, ml, pcs")
    return unit


def zone():
    name = (os.environ.get("TZ") or "").strip() or DEFAULT_TZ
    try:
        return ZoneInfo(name)
    except (ValueError, KeyError):
        return ZoneInfo(DEFAULT_TZ)


def ident(value, label):
    if isinstance(value, bool):
        raise ServiceError(label + " is not valid")
    try:
        return int(value)
    except (TypeError, ValueError) as error:
        raise ServiceError(label + " is not valid") from error


def amount_or_none(value, label):
    if value in (None, ""):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise ServiceError(label + " must be a number") from error
    if number < 0:
        raise ServiceError(label + " cannot be negative")
    return number


def clean_choices(value):
    if value in (None, ""):
        return {}
    if not isinstance(value, dict):
        raise ServiceError("Choices must map a slot to an ingredient line")
    return {str(ident(key, "Slot")): ident(item, "Choice") for key, item in value.items()}


def clean_optional(value):
    if value in (None, ""):
        return []
    if not isinstance(value, list):
        raise ServiceError("Optional items must be a list")
    return [ident(item, "Optional item") for item in value]


def positive(value, label):
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise ServiceError(label + " must be a number") from error
    if number <= 0:
        raise ServiceError(label + " must be greater than zero")
    return number


def enqueue(connection, kind, target_id, delay_seconds=0):
    connection.execute(
        "INSERT OR IGNORE INTO ai_jobs(kind, target_id, status, next_at) VALUES (?, ?, 'queued', datetime('now', ?))",
        (kind, target_id, "+" + str(int(delay_seconds)) + " seconds"),
    )


def users():
    return db.rows("SELECT id, name, color FROM users ORDER BY id")


def rename_user(user_id, name, color=None):
    name = (name or "").strip()
    if not name:
        raise ServiceError("Name is required")
    if not db.scalar("SELECT 1 FROM users WHERE id = ?", (user_id,)):
        raise ServiceError("Person not found", 404)
    if db.scalar("SELECT 1 FROM users WHERE name = ? AND id != ?", (name, user_id)):
        raise ServiceError("Someone else already has this name")
    with db.tx() as c:
        c.execute("UPDATE users SET name = ?, color = COALESCE(?, color) WHERE id = ?", (name, color, user_id))
    return users()


def ingredient_map(ids=None):
    if ids is None:
        found = db.rows("SELECT * FROM ingredients")
    else:
        ids = list(set(ids))
        if not ids:
            return {}
        placeholders = ",".join("?" * len(ids))
        found = db.rows("SELECT * FROM ingredients WHERE id IN (" + placeholders + ")", ids)
    return {entry["id"]: entry for entry in found}


def display_name(ingredient):
    return ingredient.get("name_en") or ingredient.get("raw_name")


def resolve_or_create(c, text, user_id=None, kind=None):
    text = (text or "").strip()
    if not text:
        raise ServiceError("Name is required")
    found = names.match_ingredient(text)
    if found:
        names.add_alias(c, found, text)
        return found
    cursor = c.execute(
        "INSERT INTO ingredients(raw_name, kind, created_by) VALUES (?, ?, ?)",
        (text, kind or "food", user_id),
    )
    ingredient_id = cursor.lastrowid
    names.add_alias(c, ingredient_id, text)
    enqueue(c, "ingredient", ingredient_id)
    return ingredient_id


def lock_unit(c, ingredient_id, unit):
    if unit not in UNITS:
        return
    ingredient = db.row("SELECT unit, unit_locked, status FROM ingredients WHERE id = ?", (ingredient_id,))
    if not ingredient or ingredient["unit_locked"]:
        return
    if ingredient["status"] == "ready":
        unit = ingredient["unit"]
    c.execute("UPDATE ingredients SET unit = ?, unit_locked = 1 WHERE id = ?", (unit, ingredient_id))


def stock_map(include_pending=False):
    found = db.rows(
        "SELECT ingredient_id, SUM(qty_remaining) AS qty FROM batches WHERE qty_remaining > 0 AND pending_unit IS NULL GROUP BY ingredient_id"
    )
    return {entry["ingredient_id"]: entry["qty"] for entry in found}


def pending_stock():
    return db.rows(
        "SELECT ingredient_id, pending_unit, SUM(qty_remaining) AS qty FROM batches WHERE qty_remaining > 0 AND pending_unit IS NOT NULL GROUP BY ingredient_id, pending_unit"
    )


def ingredient_view(ingredient, stock=None):
    view = dict(ingredient)
    view["display"] = display_name(ingredient)
    view["stock"] = (stock or {}).get(ingredient["id"], 0.0)
    return view


def list_ingredients(include_archived=False):
    stock = stock_map()
    pending = {}
    for entry in pending_stock():
        pending.setdefault(entry["ingredient_id"], []).append({"unit": entry["pending_unit"], "qty": entry["qty"]})
    sql = (
        "SELECT * FROM ingredients"
        + ("" if include_archived else " WHERE archived = 0")
        + " ORDER BY category, COALESCE(name_en, raw_name)"
    )
    result = []
    for ingredient in db.rows(sql):
        view = ingredient_view(ingredient, stock)
        view["pending_stock"] = pending.get(ingredient["id"], [])
        view["aliases"] = [entry["alias"] for entry in db.rows("SELECT alias FROM aliases WHERE ingredient_id = ?", (ingredient["id"],))]
        result.append(view)
    return result


def get_ingredient(ingredient_id):
    ingredient = db.row("SELECT * FROM ingredients WHERE id = ?", (ingredient_id,))
    if not ingredient:
        raise ServiceError("Ingredient not found", 404)
    view = ingredient_view(ingredient, stock_map())
    view["aliases"] = [entry["alias"] for entry in db.rows("SELECT alias FROM aliases WHERE ingredient_id = ?", (ingredient_id,))]
    view["batches"] = db.rows("SELECT * FROM batches WHERE ingredient_id = ? AND qty_remaining > 0 ORDER BY purchased_at", (ingredient_id,))
    view["prices"] = price_history(ingredient_id)
    return view


EDITABLE_INGREDIENT_FIELDS = (
    "name_en",
    "name_fa",
    "name_de",
    "category",
    "kind",
    "unit",
    "sold_by_piece",
    "piece_amount",
    "package_amount",
    "kcal",
    "protein",
    "fat",
    "carbs",
    "fiber",
    "tolerance_pct",
    "shelf_days",
    "icon",
)


NUMBER_INGREDIENT_FIELDS = ("piece_amount", "package_amount", "kcal", "protein", "fat", "carbs", "fiber", "tolerance_pct", "shelf_days")
KINDS = ("food", "snack", "staple", "household")


def update_ingredient(ingredient_id, data):
    current = db.row("SELECT * FROM ingredients WHERE id = ?", (ingredient_id,))
    if not current:
        raise ServiceError("Ingredient not found", 404)
    updates = {key: data[key] for key in EDITABLE_INGREDIENT_FIELDS if key in data}
    for key in NUMBER_INGREDIENT_FIELDS:
        if key in updates:
            updates[key] = amount_or_none(updates[key], key.replace("_", " ").capitalize())
    if updates.get("shelf_days") is not None:
        updates["shelf_days"] = int(updates["shelf_days"])
    if "sold_by_piece" in updates:
        updates["sold_by_piece"] = 1 if updates["sold_by_piece"] else 0
    for key in ("name_en", "name_fa", "name_de", "icon"):
        if key in updates:
            if updates[key] is not None and not isinstance(updates[key], str):
                raise ServiceError("Names must be text")
            updates[key] = (updates[key] or "").strip() or None
    if "category" in updates and updates["category"] not in CATEGORY_ORDER:
        raise ServiceError("Unknown category")
    if "kind" in updates and updates["kind"] not in KINDS:
        raise ServiceError("Kind must be one of " + ", ".join(KINDS))
    if "unit" in updates:
        check_unit(updates["unit"])
        if updates["unit"] != current["unit"]:
            has_data = db.scalar("SELECT COUNT(*) FROM batches WHERE ingredient_id = ? AND pending_unit IS NULL", (ingredient_id,))
            if has_data:
                raise ServiceError("The base unit cannot change once stock exists in it")
    with db.tx() as c:
        if updates:
            assignments = ", ".join(key + " = ?" for key in updates)
            c.execute(
                "UPDATE ingredients SET "
                + assignments
                + ", status = CASE WHEN status = 'pending' THEN 'ready' ELSE status END, updated_at = datetime('now') WHERE id = ?",
                list(updates.values()) + [ingredient_id],
            )
            if "unit" in updates:
                c.execute("UPDATE ingredients SET unit_locked = 1 WHERE id = ?", (ingredient_id,))
            c.execute("DELETE FROM ai_jobs WHERE kind = 'ingredient' AND target_id = ? AND status = 'queued'", (ingredient_id,))
        for alias in data.get("aliases") or []:
            names.add_alias(c, ingredient_id, alias)
        convert_pending_batches(c, ingredient_id)
        refresh_open_list(c)
    return get_ingredient(ingredient_id)


def archive_ingredient(ingredient_id, archived=True):
    with db.tx() as c:
        c.execute("UPDATE ingredients SET archived = ? WHERE id = ?", (1 if archived else 0, ingredient_id))
        refresh_open_list(c)


def requeue_ingredient(ingredient_id):
    with db.tx() as c:
        c.execute("UPDATE ingredients SET status = 'pending', ai_error = NULL WHERE id = ?", (ingredient_id,))
        c.execute("DELETE FROM ai_jobs WHERE kind = 'ingredient' AND target_id = ?", (ingredient_id,))
        enqueue(c, "ingredient", ingredient_id)


def merge_ingredients(c, source_id, target_id):
    if source_id == target_id:
        return
    for table in ("recipe_items", "batches", "events", "shopping_items", "snacks"):
        c.execute("UPDATE " + table + " SET ingredient_id = ? WHERE ingredient_id = ?", (target_id, source_id))
    c.execute("UPDATE OR IGNORE aliases SET ingredient_id = ? WHERE ingredient_id = ?", (target_id, source_id))
    c.execute("DELETE FROM aliases WHERE ingredient_id = ?", (source_id,))
    c.execute("DELETE FROM ai_jobs WHERE kind = 'ingredient' AND target_id = ?", (source_id,))
    c.execute("DELETE FROM ingredients WHERE id = ?", (source_id,))
    duplicates = db.rows(
        "SELECT list_id, MIN(id) AS keep_id, COUNT(*) AS n FROM shopping_items WHERE ingredient_id = ? AND committed = 0 AND checked = 0 GROUP BY list_id HAVING n > 1",
        (target_id,),
    )
    for duplicate in duplicates:
        c.execute(
            "DELETE FROM shopping_items WHERE list_id = ? AND ingredient_id = ? AND committed = 0 AND checked = 0 AND id != ? AND auto = 1",
            (duplicate["list_id"], target_id, duplicate["keep_id"]),
        )
    convert_pending_batches(c, target_id)


def convert_pending_batches(c, ingredient_id):
    ingredient = db.row("SELECT * FROM ingredients WHERE id = ?", (ingredient_id,))
    if not ingredient:
        return
    for batch in db.rows("SELECT * FROM batches WHERE ingredient_id = ? AND pending_unit IS NOT NULL", (ingredient_id,)):
        factor = logic.to_base(ingredient, 1.0, batch["pending_unit"])
        if factor is None:
            continue
        c.execute(
            "UPDATE batches SET qty_initial = qty_initial * ?, qty_remaining = qty_remaining * ?, pending_unit = NULL WHERE id = ?",
            (factor, factor, batch["id"]),
        )


def recipe_items(recipe_id):
    return db.rows("SELECT * FROM recipe_items WHERE recipe_id = ? ORDER BY slot, position, id", (recipe_id,))


def recipe_view(recipe, ingredients=None, stock=None, last_cooked=None):
    view = dict(recipe)
    view["tags"] = json.loads(recipe.get("tags") or "[]")
    view["image_candidates"] = json.loads(recipe.get("image_candidates") or "[]")
    view["display"] = recipe.get("name_en") or recipe.get("raw_name")
    items = recipe_items(recipe["id"])
    ingredients = ingredients or ingredient_map([item["ingredient_id"] for item in items])
    per_person = {"kcal": 0.0, "protein": 0.0, "fat": 0.0, "carbs": 0.0, "fiber": 0.0}
    complete = True
    slots = {}
    for item in items:
        ingredient = ingredients.get(item["ingredient_id"]) or {}
        item_view = dict(item)
        item_view["ingredient"] = {
            key: ingredient.get(key)
            for key in (
                "id",
                "raw_name",
                "name_en",
                "name_fa",
                "name_de",
                "icon",
                "category",
                "kind",
                "unit",
                "status",
                "piece_amount",
                "package_amount",
            )
        }
        item_view["ingredient"]["display"] = display_name(ingredient) if ingredient else "?"
        slots.setdefault(item["slot"], []).append(item_view)
        if item["is_default"] and not item["optional"] and ingredient and ingredient.get("kind") == "food":
            qty = logic.to_base(ingredient, item["amount"], item["unit"])
            if qty is None:
                complete = False
                continue
            if item.get("per_dish"):
                qty = qty / default_servings()
            values = logic.nutrients(ingredient, qty)
            for key in per_person:
                if values[key] is None:
                    complete = False
                else:
                    per_person[key] += values[key]
    view["slots"] = [{"slot": slot, "items": entries} for slot, entries in sorted(slots.items())]
    view["nutrition_per_person"] = per_person
    view["nutrition_complete"] = complete
    view["last_cooked"] = last_cooked
    return view


def last_cooked_map():
    return {
        entry["recipe_id"]: entry["last"]
        for entry in db.rows("SELECT recipe_id, MAX(date) AS last FROM meals WHERE status = 'cooked' GROUP BY recipe_id")
    }


def list_recipes(include_archived=False):
    ingredients = ingredient_map()
    last = last_cooked_map()
    sql = "SELECT * FROM recipes" + ("" if include_archived else " WHERE archived = 0") + " ORDER BY COALESCE(name_en, raw_name)"
    return [recipe_view(recipe, ingredients, last_cooked=last.get(recipe["id"])) for recipe in db.rows(sql)]


def get_recipe(recipe_id):
    recipe = db.row("SELECT * FROM recipes WHERE id = ?", (recipe_id,))
    if not recipe:
        raise ServiceError("Recipe not found", 404)
    return recipe_view(recipe, last_cooked=last_cooked_map().get(recipe_id))


def _write_items(c, recipe_id, slots, user_id):
    if not slots or not isinstance(slots, list) or not all(isinstance(slot, dict) for slot in slots):
        raise ServiceError("A recipe needs at least one ingredient")
    c.execute("DELETE FROM recipe_items WHERE recipe_id = ?", (recipe_id,))
    for slot_index, slot in enumerate(slots):
        entries = slot.get("items") or []
        if not entries:
            continue
        default_index = next((index for index, entry in enumerate(entries) if entry.get("is_default")), 0)
        optional = 1 if slot.get("optional") else 0
        for position, entry in enumerate(entries):
            unit = check_recipe_unit(entry.get("unit") or "g")
            amount = positive(entry.get("amount"), "Amount")
            if entry.get("ingredient_id"):
                ingredient_id = ident(entry["ingredient_id"], "Ingredient")
                if not db.scalar("SELECT 1 FROM ingredients WHERE id = ?", (ingredient_id,)):
                    raise ServiceError("Unknown ingredient")
            else:
                ingredient_id = resolve_or_create(c, entry.get("name"), user_id)
            lock_unit(c, ingredient_id, unit)
            c.execute(
                "INSERT INTO recipe_items(recipe_id, slot, ingredient_id, amount, unit, optional, is_default, position, per_dish) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    recipe_id,
                    slot_index,
                    ingredient_id,
                    amount,
                    unit,
                    optional,
                    1 if position == default_index else 0,
                    position,
                    1 if entry.get("per_dish") else 0,
                ),
            )


def create_recipe(data, user_id=None):
    name = (data.get("name") or "").strip()
    if not name:
        raise ServiceError("Recipe name is required")
    with db.tx() as c:
        cursor = c.execute("INSERT INTO recipes(raw_name, created_by) VALUES (?, ?)", (name, user_id))
        recipe_id = cursor.lastrowid
        _write_items(c, recipe_id, data.get("slots"), user_id)
        enqueue(c, "recipe", recipe_id)
        refresh_open_list(c)
    return get_recipe(recipe_id)


def update_recipe(recipe_id, data, user_id=None):
    recipe = db.row("SELECT * FROM recipes WHERE id = ?", (recipe_id,))
    if not recipe:
        raise ServiceError("Recipe not found", 404)
    with db.tx() as c:
        if data.get("name") is not None and not isinstance(data["name"], str):
            raise ServiceError("Recipe name must be text")
        if data.get("name") and data["name"].strip() != recipe["raw_name"]:
            c.execute(
                "UPDATE recipes SET raw_name = ?, status = 'pending', updated_at = datetime('now') WHERE id = ?",
                (data["name"].strip(), recipe_id),
            )
            c.execute("DELETE FROM ai_jobs WHERE kind = 'recipe' AND target_id = ?", (recipe_id,))
            enqueue(c, "recipe", recipe_id)
        for key in ("name_en", "name_fa", "name_de", "description"):
            if key in data:
                if data[key] is not None and not isinstance(data[key], str):
                    raise ServiceError("Names and description must be text")
                c.execute("UPDATE recipes SET " + key + " = ? WHERE id = ?", ((data[key] or "").strip() or None, recipe_id))
        if "cook_minutes" in data:
            minutes = amount_or_none(data["cook_minutes"], "Cooking time")
            c.execute("UPDATE recipes SET cook_minutes = ? WHERE id = ?", (None if minutes is None else int(minutes), recipe_id))
        if "tags" in data:
            if not isinstance(data["tags"], list):
                raise ServiceError("Tags must be a list")
            c.execute("UPDATE recipes SET tags = ? WHERE id = ?", (json.dumps([str(tag) for tag in data["tags"]]), recipe_id))
        if "slots" in data:
            planned = db.rows("SELECT id, choices, optional_items FROM meals WHERE recipe_id = ? AND status = 'planned'", (recipe_id,))
            old_items = {item["id"]: (item["ingredient_id"], item["slot"]) for item in recipe_items(recipe_id)}
            _write_items(c, recipe_id, data["slots"], user_id)
            new_items = {}
            for item in c.execute("SELECT id, ingredient_id, slot FROM recipe_items WHERE recipe_id = ?", (recipe_id,)).fetchall():
                new_items.setdefault(item["ingredient_id"], []).append((item["id"], item["slot"]))

            def remap(item_id):
                try:
                    found = old_items.get(int(item_id))
                except (TypeError, ValueError):
                    return None
                if not found or found[0] not in new_items:
                    return None
                same_slot = [entry for entry in new_items[found[0]] if entry[1] == found[1]]
                return (same_slot or new_items[found[0]])[0]

            for meal in planned:
                choices = {}
                for value in json.loads(meal["choices"] or "{}").values():
                    mapped = remap(value)
                    if mapped:
                        choices[str(mapped[1])] = mapped[0]
                optional = [mapped[0] for mapped in (remap(value) for value in json.loads(meal["optional_items"] or "[]")) if mapped]
                c.execute(
                    "UPDATE meals SET choices = ?, optional_items = ? WHERE id = ?", (json.dumps(choices), json.dumps(optional), meal["id"])
                )
        refresh_open_list(c)
    return get_recipe(recipe_id)


def archive_recipe(recipe_id, archived=True):
    with db.tx() as c:
        c.execute("UPDATE recipes SET archived = ? WHERE id = ?", (1 if archived else 0, recipe_id))
        if archived:
            c.execute("DELETE FROM meals WHERE recipe_id = ? AND status = 'planned' AND date >= ?", (recipe_id, today().isoformat()))
        refresh_open_list(c)


def choose_image(recipe_id, index):
    from . import images

    recipe = db.row("SELECT * FROM recipes WHERE id = ?", (recipe_id,))
    if not recipe:
        raise ServiceError("Recipe not found", 404)
    candidates = json.loads(recipe["image_candidates"] or "[]")
    if index < 0 or index >= len(candidates):
        raise ServiceError("No such image")
    path = images.download(recipe_id, candidates[index]["url"])
    with db.tx() as c:
        c.execute(
            "UPDATE recipes SET image_path = ?, image_source = ?, image_status = 'set', image_candidates = '[]' WHERE id = ?",
            (path, json.dumps(candidates[index]), recipe_id),
        )
    return get_recipe(recipe_id)


def refresh_images(recipe_id):
    with db.tx() as c:
        c.execute("UPDATE recipes SET image_status = 'searching' WHERE id = ?", (recipe_id,))
        c.execute("DELETE FROM ai_jobs WHERE kind = 'images' AND target_id = ?", (recipe_id,))
        enqueue(c, "images", recipe_id)


def meal_view(meal, recipes=None):
    view = dict(meal)
    view["choices"] = json.loads(meal.get("choices") or "{}")
    view["optional_items"] = json.loads(meal.get("optional_items") or "[]")
    recipe = (recipes or {}).get(meal["recipe_id"]) or db.row("SELECT * FROM recipes WHERE id = ?", (meal["recipe_id"],))
    view["recipe"] = (
        {
            "id": recipe["id"],
            "display": recipe.get("name_en") or recipe["raw_name"],
            "name_fa": recipe.get("name_fa"),
            "image_path": recipe.get("image_path"),
            "archived": recipe.get("archived"),
        }
        if recipe
        else None
    )
    return view


def meal_record(meal):
    record = dict(meal)
    record["choices"] = json.loads(meal.get("choices") or "{}")
    record["optional_items"] = json.loads(meal.get("optional_items") or "[]")
    return record


def requirements_for(meal_record_value, items_cache, ingredients):
    recipe_id = meal_record_value["recipe_id"]
    if recipe_id not in items_cache:
        items_cache[recipe_id] = recipe_items(recipe_id)
    return logic.meal_requirements(meal_record_value, items_cache[recipe_id], ingredients)


def roll_forward_meals():
    current = today().isoformat()
    overdue = db.rows("SELECT id FROM meals WHERE status = 'planned' AND date < ? ORDER BY date, position, id", (current,))
    if not overdue:
        return 0
    position = db.scalar("SELECT COALESCE(MAX(position), -1) + 1 FROM meals WHERE date = ?", (current,))
    with db.tx() as c:
        for meal in overdue:
            c.execute("UPDATE meals SET date = ?, position = ? WHERE id = ?", (current, position, meal["id"]))
            position += 1
        c.execute(
            "UPDATE alerts SET status = 'dismissed' WHERE status = 'open' AND kind IN ('tomorrow', 'missing') AND json_extract(payload, '$.date') < ?",
            (current,),
        )
    return len(overdue)


def pool_meal(recipe_id, exclude=None):
    meal = db.row(
        "SELECT * FROM meals WHERE status = 'planned' AND recipe_id = ? AND date >= ? AND id != ? ORDER BY date, position, id LIMIT 1",
        (recipe_id, today().isoformat(), exclude or 0),
    )
    return meal


def planned_sequence(start=None, end=None, exclude=None):
    start = start or today().isoformat()
    sql = "SELECT * FROM meals WHERE status = 'planned' AND date >= ?"
    params = [start]
    if end:
        sql += " AND date <= ?"
        params.append(end)
    sql += " ORDER BY date, position, id"
    meals = [meal_record(meal) for meal in db.rows(sql, params) if meal["id"] != exclude]
    ingredients = ingredient_map()
    cache = {}
    sequence = []
    for meal in meals:
        required, _ = requirements_for(meal, cache, ingredients)
        sequence.append((meal, required))
    return sequence, ingredients


def calendar(start, end):
    roll_forward_meals()
    start = parse_date(start)
    end = parse_date(end)
    recipes = {recipe["id"]: recipe for recipe in db.rows("SELECT * FROM recipes")}
    meals = db.rows("SELECT * FROM meals WHERE date BETWEEN ? AND ? ORDER BY date, position, id", (start.isoformat(), end.isoformat()))
    sequence, ingredients = planned_sequence(today().isoformat())
    outcome, _ = logic.simulate(stock_map(), [(meal["id"], required) for meal, required in sequence])
    feasibility = {entry["key"]: entry for entry in outcome}
    days = {}
    cursor = start
    while cursor <= end:
        days[cursor.isoformat()] = {"date": cursor.isoformat(), "meals": [], "snacks": []}
        cursor += timedelta(days=1)
    for meal in meals:
        view = meal_view(meal, recipes)
        state = feasibility.get(meal["id"])
        if state:
            view["feasible"] = state["feasible"]
            view["shortages"] = [
                {
                    "ingredient_id": key,
                    "display": display_name(ingredients[key]),
                    "icon": ingredients[key].get("icon"),
                    "missing": qty,
                    "unit": ingredients[key]["unit"],
                }
                for key, qty in state["shortages"].items()
            ]
        if meal["status"] == "planned" and meal["date"] < today().isoformat():
            view["overdue"] = True
        days[meal["date"]]["meals"].append(view)
    for snack in db.rows(
        "SELECT s.*, i.name_en, i.raw_name, i.icon, i.unit FROM snacks s JOIN ingredients i ON i.id = s.ingredient_id WHERE s.date BETWEEN ? AND ?",
        (start.isoformat(), end.isoformat()),
    ):
        days[snack["date"]]["snacks"].append(dict(snack, display=snack["name_en"] or snack["raw_name"]))
    return list(days.values())


def add_meal(data, user_id=None):
    meal_date = parse_date(data.get("date"))
    recipe_id = ident(data.get("recipe_id") or 0, "Recipe")
    recipe = db.row("SELECT id, archived FROM recipes WHERE id = ?", (recipe_id,))
    if not recipe or recipe["archived"]:
        raise ServiceError("Recipe not found", 404)
    servings = positive(data.get("servings") or default_servings(), "Servings")
    with db.tx() as c:
        position = db.scalar("SELECT COALESCE(MAX(position), -1) + 1 FROM meals WHERE date = ?", (meal_date.isoformat(),))
        cursor = c.execute(
            "INSERT INTO meals(date, position, recipe_id, servings, choices, optional_items, created_by, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                meal_date.isoformat(),
                position,
                recipe_id,
                servings,
                json.dumps(clean_choices(data.get("choices"))),
                json.dumps(clean_optional(data.get("optional_items"))),
                user_id,
                data.get("source") if data.get("source") in SOURCES else "app",
            ),
        )
        meal_id = cursor.lastrowid
        refresh_open_list(c)
    return meal_view(db.row("SELECT * FROM meals WHERE id = ?", (meal_id,)))


def update_meal(meal_id, data):
    meal = db.row("SELECT * FROM meals WHERE id = ?", (meal_id,))
    if not meal:
        raise ServiceError("Meal not found", 404)
    if meal["status"] == "cooked":
        raise ServiceError("A cooked meal cannot be changed, undo the cooking first")
    updates = {}
    if "date" in data:
        updates["date"] = parse_date(data["date"]).isoformat()
        if updates["date"] != meal["date"] and "position" not in data:
            updates["position"] = db.scalar("SELECT COALESCE(MAX(position), -1) + 1 FROM meals WHERE date = ?", (updates["date"],))
    if "servings" in data:
        updates["servings"] = positive(data["servings"], "Servings")
    if "recipe_id" in data:
        if not db.scalar("SELECT 1 FROM recipes WHERE id = ? AND archived = 0", (ident(data["recipe_id"], "Recipe"),)):
            raise ServiceError("Recipe not found", 404)
        updates["recipe_id"] = int(data["recipe_id"])
        updates["choices"] = "{}"
        updates["optional_items"] = "[]"
    if "choices" in data:
        updates["choices"] = json.dumps(clean_choices(data["choices"]))
    if "optional_items" in data:
        updates["optional_items"] = json.dumps(clean_optional(data["optional_items"]))
    if "position" in data:
        updates["position"] = ident(data["position"], "Position")
    with db.tx() as c:
        if updates:
            c.execute(
                "UPDATE meals SET " + ", ".join(key + " = ?" for key in updates) + " WHERE id = ?", list(updates.values()) + [meal_id]
            )
        refresh_open_list(c)
    return meal_view(db.row("SELECT * FROM meals WHERE id = ?", (meal_id,)))


def delete_meal(meal_id):
    meal = db.row("SELECT * FROM meals WHERE id = ?", (meal_id,))
    if not meal:
        return
    if meal["status"] == "cooked":
        raise ServiceError("A cooked meal cannot be removed, undo the cooking first")
    with db.tx() as c:
        c.execute("DELETE FROM meals WHERE id = ?", (meal_id,))
        refresh_open_list(c)


def move_meal(meal_id, data):
    meal = db.row("SELECT * FROM meals WHERE id = ?", (meal_id,))
    if not meal:
        raise ServiceError("Meal not found", 404)
    if meal["status"] == "cooked":
        raise ServiceError("A cooked meal cannot be moved, undo the cooking first")
    target_date = parse_date(data.get("date") or meal["date"]).isoformat()
    index = max(0, ident(data.get("index") or 0, "Position"))
    with db.tx() as c:
        source_date = meal["date"]
        others = [
            row["id"]
            for row in c.execute("SELECT id FROM meals WHERE date = ? AND id != ? ORDER BY position, id", (target_date, meal_id)).fetchall()
        ]
        index = min(index, len(others))
        others.insert(index, meal_id)
        c.execute("UPDATE meals SET date = ? WHERE id = ?", (target_date, meal_id))
        for position, entry_id in enumerate(others):
            c.execute("UPDATE meals SET position = ? WHERE id = ?", (position, entry_id))
        if source_date != target_date:
            remaining = [
                row["id"] for row in c.execute("SELECT id FROM meals WHERE date = ? ORDER BY position, id", (source_date,)).fetchall()
            ]
            for position, entry_id in enumerate(remaining):
                c.execute("UPDATE meals SET position = ? WHERE id = ?", (position, entry_id))
        refresh_open_list(c)
    return meal_view(db.row("SELECT * FROM meals WHERE id = ?", (meal_id,)))


def shortages_for(day, lang="en"):
    day = parse_date(day).isoformat()
    sequence, ingredients = planned_sequence(today().isoformat(), day)
    outcome, _ = logic.simulate(stock_map(), [(meal["id"], required) for meal, required in sequence])
    meals = {meal["id"]: meal for meal, _ in sequence}
    result = []
    for entry in outcome:
        meal = meals[entry["key"]]
        if meal["date"] != day:
            continue
        recipe = db.row("SELECT * FROM recipes WHERE id = ?", (meal["recipe_id"],))
        dish = (recipe.get("name_de") if lang == "de" else None) or recipe.get("name_en") or recipe["raw_name"]
        missing = []
        for ingredient_id, qty in entry["shortages"].items():
            ingredient = ingredients[ingredient_id]
            name = (ingredient.get("name_de") if lang == "de" else None) or display_name(ingredient)
            rounded = logic.round_purchase(ingredient, qty) or {}
            missing.append(
                {
                    "ingredient_id": ingredient_id,
                    "name": name,
                    "missing_qty": round(qty, 1),
                    "unit": ingredient["unit"],
                    "buy_qty": rounded.get("qty"),
                    "packages": rounded.get("packages"),
                    "pieces": rounded.get("pieces"),
                    "text": format_qty(qty, ingredient["unit"]),
                }
            )
        result.append(
            {"meal_id": meal["id"], "dish": dish, "servings": meal["servings"], "feasible": entry["feasible"], "missing": missing}
        )
    return result


def suggestions(day, meal_id=None, servings=None):
    roll_forward_meals()
    day = parse_date(day)
    target = db.row("SELECT * FROM meals WHERE id = ?", (meal_id,)) if meal_id else None
    servings = float(servings or (target["servings"] if target else default_servings()))
    sequence, ingredients = planned_sequence(today().isoformat(), exclude=meal_id)
    stock = stock_map()
    after = [(meal["id"], required) for meal, required in sequence if (meal["date"], meal["position"]) >= (day.isoformat(), -1)]
    before = [(meal["id"], required) for meal, required in sequence if (meal["date"], meal["position"]) < (day.isoformat(), -1)]
    _, stock_at_day = logic.simulate(stock, before)
    last = last_cooked_map()
    pool = {}
    for meal, _ in sequence:
        pool.setdefault(meal["recipe_id"], meal["id"])
    candidates = []
    for recipe in db.rows("SELECT * FROM recipes WHERE archived = 0"):
        record = {"recipe_id": recipe["id"], "servings": servings, "choices": {}, "optional_items": []}
        required, unconvertible = logic.meal_requirements(record, recipe_items(recipe["id"]), ingredients)
        candidates.append(
            {
                "recipe_id": recipe["id"],
                "name": recipe.get("name_en") or recipe["raw_name"],
                "name_fa": recipe.get("name_fa"),
                "image_path": recipe.get("image_path"),
                "required": required,
                "unconvertible": unconvertible,
                "last_cooked": last.get(recipe["id"]),
                "planned_here": bool(target and target["recipe_id"] == recipe["id"]) or recipe["id"] in pool,
                "skip_key": pool.get(recipe["id"]),
            }
        )
    ranked = logic.rank_suggestions(stock_at_day, after, candidates)
    result = []
    for entry in ranked:
        result.append(
            {
                "recipe_id": entry["recipe_id"],
                "name": entry["name"],
                "name_fa": entry["name_fa"],
                "image_path": entry["image_path"],
                "tier": entry["tier"],
                "breaks": entry["breaks"],
                "last_cooked": entry["last_cooked"],
                "planned_here": entry["planned_here"],
                "pool_meal_id": entry.get("skip_key"),
                "shortages": [
                    {
                        "ingredient_id": key,
                        "display": display_name(ingredients[key]),
                        "icon": ingredients[key].get("icon"),
                        "missing": qty,
                        "unit": ingredients[key]["unit"],
                    }
                    for key, qty in entry["shortages"].items()
                ],
            }
        )
    return {"servings": servings, "suggestions": result}


def default_servings():
    return float(db.get_setting("default_servings", "2"))


def _consume(c, ingredient_id, qty, kind, user_id, meal_id=None, snack_id=None):
    batches = db.rows("SELECT * FROM batches WHERE ingredient_id = ? AND qty_remaining > 0 AND pending_unit IS NULL", (ingredient_id,))
    taken, missing = logic.fifo_consume(batches, qty)
    value = 0.0
    for portion in taken:
        c.execute("UPDATE batches SET qty_remaining = MAX(0, qty_remaining - ?) WHERE id = ?", (portion["qty"], portion["batch_id"]))
        c.execute(
            "INSERT INTO events(ingredient_id, batch_id, kind, qty, value, meal_id, snack_id, user_id, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (ingredient_id, portion["batch_id"], kind, portion["qty"], portion["value"], meal_id, snack_id, user_id, iso_now()),
        )
        value += portion["value"]
    if missing > logic.EPSILON:
        c.execute(
            "INSERT INTO events(ingredient_id, batch_id, kind, qty, value, meal_id, snack_id, user_id, at) VALUES (?, NULL, ?, ?, 0, ?, ?, ?, ?)",
            (ingredient_id, kind + "_shortfall", missing, meal_id, snack_id, user_id, iso_now()),
        )
    return value, missing


def cook(data, user_id=None):
    roll_forward_meals()
    meal_id = data.get("meal_id")
    if not meal_id and data.get("recipe_id"):
        found = pool_meal(ident(data["recipe_id"], "Recipe"))
        if found:
            meal_id = found["id"]
            data = dict(data, date=data.get("date") or today().isoformat())
    with db.tx() as c:
        if meal_id:
            meal = db.row("SELECT * FROM meals WHERE id = ?", (ident(meal_id, "Meal"),))
            if not meal:
                raise ServiceError("Meal not found", 404)
            if meal["status"] == "cooked":
                raise ServiceError("This meal is already cooked")
            updates = {}
            if data.get("recipe_id") and ident(data["recipe_id"], "Recipe") != meal["recipe_id"]:
                updates["recipe_id"] = ident(data["recipe_id"], "Recipe")
                updates["choices"] = "{}"
                updates["optional_items"] = "[]"
            if data.get("servings"):
                updates["servings"] = positive(data["servings"], "Servings")
            if "choices" in data:
                updates["choices"] = json.dumps(clean_choices(data["choices"]))
            if "optional_items" in data:
                updates["optional_items"] = json.dumps(clean_optional(data["optional_items"]))
            if data.get("date"):
                updates["date"] = parse_date(data["date"]).isoformat()
            if updates:
                c.execute(
                    "UPDATE meals SET " + ", ".join(key + " = ?" for key in updates) + " WHERE id = ?",
                    list(updates.values()) + [meal["id"]],
                )
            meal = db.row("SELECT * FROM meals WHERE id = ?", (meal["id"],))
        else:
            recipe_id = ident(data.get("recipe_id") or 0, "Recipe")
            if not db.scalar("SELECT 1 FROM recipes WHERE id = ? AND archived = 0", (recipe_id,)):
                raise ServiceError("Recipe not found", 404)
            meal_date = parse_date(data.get("date") or today().isoformat()).isoformat()
            position = db.scalar("SELECT COALESCE(MAX(position), -1) + 1 FROM meals WHERE date = ?", (meal_date,))
            cursor = c.execute(
                "INSERT INTO meals(date, position, recipe_id, servings, choices, optional_items, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    meal_date,
                    position,
                    recipe_id,
                    positive(data.get("servings") or default_servings(), "Servings"),
                    json.dumps(clean_choices(data.get("choices"))),
                    json.dumps(clean_optional(data.get("optional_items"))),
                    user_id,
                ),
            )
            meal = db.row("SELECT * FROM meals WHERE id = ?", (cursor.lastrowid,))
        record = meal_record(meal)
        ingredients = ingredient_map()
        required, unconvertible = logic.meal_requirements(record, recipe_items(meal["recipe_id"]), ingredients)
        overrides = {
            ident(key, "Ingredient"): amount_or_none(value, "Amount") or 0.0 for key, value in (data.get("overrides") or {}).items()
        }
        for ingredient_id, qty in overrides.items():
            if ingredient_id not in ingredients:
                continue
            if qty <= 0:
                required.pop(ingredient_id, None)
            else:
                required[ingredient_id] = qty
        totals = {"kcal": 0.0, "protein": 0.0, "fat": 0.0, "carbs": 0.0, "fiber": 0.0}
        known = dict.fromkeys(totals, True)
        cost = 0.0
        shortfalls = []
        for ingredient_id, qty in required.items():
            value, missing = _consume(c, ingredient_id, qty, "cook", user_id, meal["id"])
            cost += value
            if missing > logic.EPSILON:
                shortfalls.append(
                    {
                        "ingredient_id": ingredient_id,
                        "display": display_name(ingredients[ingredient_id]),
                        "missing": missing,
                        "unit": ingredients[ingredient_id]["unit"],
                    }
                )
            values = logic.nutrients(ingredients[ingredient_id], qty)
            for key in totals:
                if values[key] is None:
                    known[key] = False
                else:
                    totals[key] += values[key]
        c.execute(
            "UPDATE meals SET status = 'cooked', cooked_by = ?, cooked_at = ?, cost = ?, kcal = ?, protein = ?, fat = ?, carbs = ?, fiber = ? WHERE id = ?",
            (
                user_id,
                iso_now(),
                round(cost, 2),
                *[round(totals[key], 1) if known[key] else None for key in ("kcal", "protein", "fat", "carbs", "fiber")],
                meal["id"],
            ),
        )
        refresh_open_list(c)
    view = meal_view(db.row("SELECT * FROM meals WHERE id = ?", (meal["id"],)))
    view["shortfalls"] = shortfalls
    view["unconvertible"] = unconvertible
    return view


def cook_preview(meal_id=None, recipe_id=None, servings=None, choices=None, optional_items=None):
    if not meal_id and not recipe_id:
        raise ServiceError("Choose a meal or a dish")
    if meal_id:
        meal = db.row("SELECT * FROM meals WHERE id = ?", (ident(meal_id, "Meal"),))
        if not meal:
            raise ServiceError("Meal not found", 404)
        record = meal_record(meal)
    else:
        record = {"recipe_id": ident(recipe_id, "Recipe"), "servings": default_servings(), "choices": {}, "optional_items": []}
    if recipe_id:
        record["recipe_id"] = ident(recipe_id, "Recipe")
    if servings:
        record["servings"] = positive(servings, "Servings")
    if choices is not None:
        record["choices"] = clean_choices(choices)
    if optional_items is not None:
        record["optional_items"] = clean_optional(optional_items)
    ingredients = ingredient_map()
    required, unconvertible = logic.meal_requirements(record, recipe_items(record["recipe_id"]), ingredients)
    stock = stock_map()
    return {
        "recipe": get_recipe(record["recipe_id"]),
        "servings": record["servings"],
        "choices": record["choices"],
        "optional_items": record["optional_items"],
        "lines": [
            {
                "ingredient_id": key,
                "display": display_name(ingredients[key]),
                "name_fa": ingredients[key].get("name_fa"),
                "icon": ingredients[key].get("icon"),
                "qty": qty,
                "unit": ingredients[key]["unit"],
                "stock": stock.get(key, 0.0),
            }
            for key, qty in required.items()
        ],
        "unconvertible": [display_name(ingredients[key]) for key in unconvertible],
    }


def uncook(meal_id):
    meal = db.row("SELECT * FROM meals WHERE id = ?", (meal_id,))
    if not meal or meal["status"] != "cooked":
        raise ServiceError("Meal is not cooked")
    with db.tx() as c:
        for event in db.rows("SELECT * FROM events WHERE meal_id = ? AND kind = 'cook'", (meal_id,)):
            if event["batch_id"]:
                c.execute("UPDATE batches SET qty_remaining = qty_remaining + ? WHERE id = ?", (event["qty"], event["batch_id"]))
        c.execute("DELETE FROM events WHERE meal_id = ?", (meal_id,))
        c.execute(
            "UPDATE meals SET status = 'planned', cooked_by = NULL, cooked_at = NULL, cost = NULL, kcal = NULL, protein = NULL, fat = NULL, carbs = NULL, fiber = NULL WHERE id = ?",
            (meal_id,),
        )
        refresh_open_list(c)
    return meal_view(db.row("SELECT * FROM meals WHERE id = ?", (meal_id,)))


def log_snack(data, user_id=None):
    unit = check_unit(data.get("unit") or "pcs")
    qty_input = positive(data.get("qty"), "Quantity")
    snack_date = parse_date(data.get("date") or today().isoformat()).isoformat()
    with db.tx() as c:
        if data.get("ingredient_id"):
            ingredient_id = ident(data["ingredient_id"], "Ingredient")
        else:
            ingredient_id = resolve_or_create(c, data.get("name"), user_id, kind="snack")
        ingredient = db.row("SELECT * FROM ingredients WHERE id = ?", (ingredient_id,))
        if not ingredient:
            raise ServiceError("Ingredient not found", 404)
        if ingredient["status"] == "ready" or ingredient["unit_locked"]:
            lock_unit(c, ingredient_id, unit)
            ingredient = db.row("SELECT * FROM ingredients WHERE id = ?", (ingredient_id,))
        qty = logic.to_base(ingredient, qty_input, unit)
        values = {"kcal": None, "protein": None, "fat": None, "carbs": None, "fiber": None}
        if qty is not None:
            values = logic.nutrients(ingredient, qty)
        snack_id = c.execute(
            "INSERT INTO snacks(ingredient_id, qty, date, user_id, kcal, protein, fat, carbs, fiber, cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)",
            (
                ingredient_id,
                qty if qty is not None else qty_input,
                snack_date,
                user_id,
                values["kcal"],
                values["protein"],
                values["fat"],
                values["carbs"],
                values["fiber"],
            ),
        ).lastrowid
        if qty is not None:
            cost, _ = _consume(c, ingredient_id, qty, "snack", user_id, snack_id=snack_id)
            c.execute("UPDATE snacks SET cost = ? WHERE id = ?", (round(cost, 2), snack_id))
    return {"ok": True}


def delete_snack(snack_id):
    with db.tx() as c:
        for event in db.rows("SELECT * FROM events WHERE snack_id = ? AND kind = 'snack'", (snack_id,)):
            if event["batch_id"]:
                c.execute("UPDATE batches SET qty_remaining = qty_remaining + ? WHERE id = ?", (event["qty"], event["batch_id"]))
        c.execute("DELETE FROM events WHERE snack_id = ?", (snack_id,))
        c.execute("DELETE FROM snacks WHERE id = ?", (snack_id,))
        refresh_open_list(c)


def add_stock(c, ingredient_id, qty_input, unit, price, store, user_id, source, session_id=None, purchased_at=None):
    ingredient = db.row("SELECT * FROM ingredients WHERE id = ?", (ingredient_id,))
    if not ingredient:
        raise ServiceError("Ingredient not found", 404)
    if ingredient["status"] == "ready" or ingredient["unit_locked"]:
        lock_unit(c, ingredient_id, unit)
        ingredient = db.row("SELECT * FROM ingredients WHERE id = ?", (ingredient_id,))
        qty = logic.to_base(ingredient, qty_input, unit)
    else:
        qty = None
    pending_unit = None
    if qty is None:
        qty = float(qty_input)
        pending_unit = unit
    purchased_at = purchased_at or iso_now()
    expires_at = None
    if ingredient.get("shelf_days"):
        expires_at = (parse_date(purchased_at) + timedelta(days=int(ingredient["shelf_days"]))).isoformat()
    cursor = c.execute(
        "INSERT INTO batches(ingredient_id, qty_initial, qty_remaining, price_total, store, purchased_at, expires_at, source, pending_unit, session_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (ingredient_id, qty, qty, price, store, purchased_at, expires_at, source, pending_unit, session_id, user_id),
    )
    c.execute(
        "INSERT INTO events(ingredient_id, batch_id, kind, qty, value, user_id, at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (ingredient_id, cursor.lastrowid, source, qty, price or 0, user_id, purchased_at),
    )
    return cursor.lastrowid


def inventory():
    items = list_ingredients()
    soon = (today() + timedelta(days=2)).isoformat()
    for item in items:
        batches = db.rows(
            "SELECT id, qty_remaining, expires_at, purchased_at, pending_unit FROM batches WHERE ingredient_id = ? AND qty_remaining > 0 ORDER BY purchased_at",
            (item["id"],),
        )
        item["batches"] = batches
        expiring = [
            batch["expires_at"] for batch in batches if batch["expires_at"] and batch["expires_at"] <= soon and not batch["pending_unit"]
        ]
        item["expiring_estimate"] = min(expiring) if expiring else None
    return {
        "items": items,
        "last_count": db.get_setting("last_stock_count"),
    }


def manual_add(data, user_id=None):
    unit = check_shop_unit(data.get("unit") or "g")
    qty = positive(data.get("qty"), "Quantity")
    price = amount_or_none(data.get("price"), "Price")
    with db.tx() as c:
        if data.get("ingredient_id"):
            ingredient_id = ident(data["ingredient_id"], "Ingredient")
        else:
            ingredient_id = resolve_or_create(c, data.get("name"), user_id, kind=data.get("kind"))
        add_stock(c, ingredient_id, qty, unit, price, data.get("store"), user_id, "manual")
        refresh_open_list(c)
    return get_ingredient(ingredient_id)


def used_up(ingredient_id, user_id=None):
    with db.tx() as c:
        for batch in db.rows("SELECT * FROM batches WHERE ingredient_id = ? AND qty_remaining > 0", (ingredient_id,)):
            value = 0.0
            if batch["price_total"] and batch["qty_initial"]:
                value = batch["price_total"] * batch["qty_remaining"] / batch["qty_initial"]
            c.execute(
                "INSERT INTO events(ingredient_id, batch_id, kind, qty, value, user_id, at) VALUES (?, ?, 'used_up', ?, ?, ?, ?)",
                (ingredient_id, batch["id"], batch["qty_remaining"], value, user_id, iso_now()),
            )
            c.execute("UPDATE batches SET qty_remaining = 0 WHERE id = ?", (batch["id"],))
        refresh_open_list(c)
    return get_ingredient(ingredient_id)


def waste(ingredient_id, qty=None, unit=None, user_id=None):
    ingredient = db.row("SELECT * FROM ingredients WHERE id = ?", (ingredient_id,))
    if not ingredient:
        raise ServiceError("Ingredient not found", 404)
    with db.tx() as c:
        if qty in (None, ""):
            amount = stock_map().get(ingredient_id, 0.0)
        else:
            amount = logic.to_base(ingredient, positive(qty, "Quantity"), check_shop_unit(unit or ingredient["unit"]))
            if amount is None:
                raise ServiceError("This unit cannot be converted for this ingredient yet")
        if amount > 0:
            _consume(c, ingredient_id, amount, "waste", user_id)
        refresh_open_list(c)
    return get_ingredient(ingredient_id)


def set_actual(c, ingredient_id, qty, user_id):
    ingredient = db.row("SELECT unit, status, unit_locked FROM ingredients WHERE id = ?", (ingredient_id,))
    if ingredient["status"] != "ready" and not ingredient["unit_locked"]:
        for batch in db.rows(
            "SELECT id FROM batches WHERE ingredient_id = ? AND pending_unit = ? AND qty_remaining > 0", (ingredient_id, ingredient["unit"])
        ):
            c.execute("UPDATE batches SET qty_remaining = 0 WHERE id = ?", (batch["id"],))
        if float(qty) > logic.EPSILON:
            add_stock(c, ingredient_id, float(qty), ingredient["unit"], None, None, user_id, "adjust_up")
        return
    current = stock_map().get(ingredient_id, 0.0)
    difference = float(qty) - current
    if difference < -logic.EPSILON:
        _consume(c, ingredient_id, -difference, "adjust_down", user_id)
    elif difference > logic.EPSILON:
        add_stock(
            c,
            ingredient_id,
            difference,
            db.scalar("SELECT unit FROM ingredients WHERE id = ?", (ingredient_id,)),
            None,
            None,
            user_id,
            "adjust_up",
        )


def stock_count(entries, user_id=None, full=False):
    with db.tx() as c:
        for entry in entries:
            if not isinstance(entry, dict):
                raise ServiceError("Each count needs an ingredient and a quantity")
            ingredient_id = ident(entry.get("ingredient_id"), "Ingredient")
            if not db.scalar("SELECT 1 FROM ingredients WHERE id = ?", (ingredient_id,)):
                raise ServiceError("Ingredient not found", 404)
            qty = amount_or_none(entry.get("qty"), "Quantity")
            if qty is None:
                raise ServiceError("Quantity is required")
            set_actual(c, ingredient_id, qty, user_id)
        if full:
            db.set_setting("last_stock_count", today().isoformat(), c)
            c.execute("UPDATE alerts SET status = 'resolved' WHERE kind = 'stock_count' AND status = 'open'")
        refresh_open_list(c)
    return {"ok": True}


def open_list():
    return db.row("SELECT * FROM shopping_lists WHERE status = 'open' ORDER BY id DESC LIMIT 1")


def review(start, end):
    start = parse_date(start)
    end = parse_date(end)
    sequence, ingredients = planned_sequence(max(start, today()).isoformat(), end.isoformat())
    stock = stock_map()
    needed = {}
    for _meal, required in sequence:
        for ingredient_id in required:
            needed[ingredient_id] = needed.get(ingredient_id, 0.0) + required[ingredient_id]
    return [
        {
            "ingredient_id": key,
            "display": display_name(ingredients[key]),
            "name_fa": ingredients[key].get("name_fa"),
            "icon": ingredients[key].get("icon"),
            "category": ingredients[key]["category"],
            "unit": ingredients[key]["unit"],
            "piece_amount": ingredients[key].get("piece_amount"),
            "stock": stock.get(key, 0.0),
            "needed": qty,
        }
        for key, qty in sorted(needed.items(), key=lambda pair: (ingredients[pair[0]]["category"], display_name(ingredients[pair[0]])))
    ]


def build_list(start, end, user_id=None):
    start = parse_date(start)
    end = parse_date(end)
    if end < start:
        raise ServiceError("The end date is before the start date")
    with db.tx() as c:
        current = open_list()
        if current:
            c.execute(
                "UPDATE shopping_lists SET range_start = ?, range_end = ? WHERE id = ?", (start.isoformat(), end.isoformat(), current["id"])
            )
            list_id = current["id"]
        else:
            cursor = c.execute(
                "INSERT INTO shopping_lists(range_start, range_end, created_by) VALUES (?, ?, ?)",
                (start.isoformat(), end.isoformat(), user_id),
            )
            list_id = cursor.lastrowid
        recompute_auto(c, list_id)
    return get_list(list_id)


def ensure_open_list(c, user_id=None):
    current = open_list()
    if current:
        return current["id"]
    cursor = c.execute("INSERT INTO shopping_lists(created_by) VALUES (?)", (user_id,))
    return cursor.lastrowid


def refresh_open_list(c):
    current = open_list()
    if current and current["range_start"] and current["range_end"]:
        recompute_auto(c, current["id"])


def bought_base(ingredient, qty, unit, pack_size=None):
    if not qty or not ingredient:
        return None
    unit = unit or ingredient.get("unit")
    if pack_size and (unit == "pack" or (unit == "pcs" and ingredient.get("unit") != "pcs")):
        return float(qty) * float(pack_size)
    return logic.to_base(ingredient, qty, unit)


def line_price(unit_price, qty, unit):
    if unit_price is None:
        return None
    count = float(qty) if qty else 1.0
    if unit in logic.MASS_UNITS:
        count = count / 1000.0
    return round(float(unit_price) * count, 2)


def recompute_auto(c, list_id):
    shopping = db.row("SELECT * FROM shopping_lists WHERE id = ?", (list_id,))
    if not shopping or not shopping["range_start"]:
        return
    first = today().isoformat()
    start = max(first, shopping["range_start"])
    sequence, ingredients = planned_sequence(first, shopping["range_end"])
    before = [(meal["id"], required) for meal, required in sequence if meal["date"] < start]
    within = [(meal["id"], required) for meal, required in sequence if meal["date"] >= start]
    stock = stock_map()
    pending_bought = db.rows(
        "SELECT ingredient_id, bought_qty, bought_unit, pack_size FROM shopping_items WHERE list_id = ? AND checked = 1 AND committed = 0",
        (list_id,),
    )
    for entry in pending_bought:
        qty = bought_base(ingredients.get(entry["ingredient_id"]), entry["bought_qty"], entry["bought_unit"], entry["pack_size"])
        if qty:
            stock[entry["ingredient_id"]] = stock.get(entry["ingredient_id"], 0.0) + qty
    needs = logic.shopping_needs(stock, before, within, ingredients)
    for entry in pending_bought:
        needs.pop(entry["ingredient_id"], None)
    covered = {
        row["ingredient_id"] for row in db.rows("SELECT ingredient_id FROM shopping_items WHERE list_id = ? AND checked = 1", (list_id,))
    }
    for row in db.rows("SELECT DISTINCT ingredient_id FROM batches WHERE pending_unit IS NOT NULL AND qty_remaining > 0"):
        covered.add(row["ingredient_id"])
    unknown = set()
    for ingredient_id in covered:
        if ingredient_id not in needs:
            continue
        bought = db.rows(
            "SELECT bought_qty, bought_unit, pack_size FROM shopping_items WHERE list_id = ? AND ingredient_id = ? AND checked = 1",
            (list_id, ingredient_id),
        )
        pending = db.scalar(
            "SELECT COUNT(*) FROM batches WHERE ingredient_id = ? AND pending_unit IS NOT NULL AND qty_remaining > 0", (ingredient_id,)
        )
        ingredient = ingredients.get(ingredient_id) or {}
        if pending or any(
            entry["bought_qty"] and bought_base(ingredient, entry["bought_qty"], entry["bought_unit"], entry["pack_size"]) is None
            for entry in bought
        ):
            unknown.add(ingredient_id)
    for ingredient_id in unknown:
        needs.pop(ingredient_id, None)
    existing = {}
    for entry in db.rows("SELECT * FROM shopping_items WHERE list_id = ? AND auto = 1 AND checked = 0 AND committed = 0 ORDER BY id", (list_id,)):
        if entry["ingredient_id"] in existing:
            c.execute("DELETE FROM shopping_items WHERE id = ?", (entry["id"],))
        else:
            existing[entry["ingredient_id"]] = entry
    for ingredient_id, need in needs.items():
        if ingredient_id in existing:
            c.execute("UPDATE shopping_items SET needed_qty = ? WHERE id = ?", (need["qty"], existing[ingredient_id]["id"]))
        else:
            c.execute(
                "INSERT INTO shopping_items(list_id, ingredient_id, auto, needed_qty) VALUES (?, ?, 1, ?)",
                (list_id, ingredient_id, need["qty"]),
            )
    for ingredient_id, entry in existing.items():
        if ingredient_id not in needs:
            c.execute("DELETE FROM shopping_items WHERE id = ?", (entry["id"],))


def item_view(item, ingredient, session_lookup=None):
    view = dict(item)
    view["ingredient"] = {
        key: ingredient.get(key)
        for key in (
            "id",
            "raw_name",
            "name_en",
            "name_fa",
            "name_de",
            "icon",
            "category",
            "kind",
            "unit",
            "sold_by_piece",
            "piece_amount",
            "package_amount",
            "status",
        )
    }
    view["ingredient"]["display"] = display_name(ingredient)
    view["pieces"] = None
    if item.get("needed_qty") and ingredient.get("package_amount"):
        view["packages"] = math.ceil(item["needed_qty"] / ingredient["package_amount"] - 1e-6)
    if item.get("needed_qty") and ingredient.get("unit") != "pcs" and ingredient.get("sold_by_piece") and ingredient.get("piece_amount"):
        view["pieces"] = max(1, math.ceil(item["needed_qty"] / ingredient["piece_amount"] - 1e-6))
    return view


CATEGORY_ORDER = [
    "vegetables",
    "fruits",
    "herbs",
    "meat",
    "poultry",
    "fish",
    "dairy",
    "eggs",
    "bakery",
    "grains",
    "legumes",
    "canned",
    "frozen",
    "condiments",
    "snacks",
    "beverages",
    "household",
    "other",
]


def get_list(list_id=None):
    shopping = db.row("SELECT * FROM shopping_lists WHERE id = ?", (list_id,)) if list_id else open_list()
    if not shopping:
        return None
    items = db.rows("SELECT * FROM shopping_items WHERE list_id = ? ORDER BY id", (shopping["id"],))
    ingredients = ingredient_map([item["ingredient_id"] for item in items])
    views = [item_view(item, ingredients[item["ingredient_id"]]) for item in items]
    views.sort(
        key=lambda view: (
            CATEGORY_ORDER.index(view["ingredient"]["category"])
            if view["ingredient"]["category"] in CATEGORY_ORDER
            else len(CATEGORY_ORDER),
            (view["ingredient"]["display"] or "").lower(),
        )
    )
    sessions = db.rows("SELECT * FROM shopping_sessions WHERE list_id = ? ORDER BY id", (shopping["id"],))
    for session in sessions:
        session["total"] = round(sum(view["price"] or 0 for view in views if view["session_id"] == session["id"] and view["checked"]), 2)
        session["count"] = sum(1 for view in views if view["session_id"] == session["id"] and view["checked"])
    result = dict(shopping)
    result["items"] = views
    result["sessions"] = sessions
    result["active_session"] = next((session for session in sessions if session["status"] == "active"), None)
    result["total"] = round(sum(view["price"] or 0 for view in views if view["checked"]), 2)
    return result


def add_list_item(data, user_id=None):
    with db.tx() as c:
        list_id = ensure_open_list(c, user_id)
        if data.get("ingredient_id"):
            ingredient_id = ident(data["ingredient_id"], "Ingredient")
            if not db.scalar("SELECT 1 FROM ingredients WHERE id = ?", (ingredient_id,)):
                raise ServiceError("Ingredient not found", 404)
        else:
            ingredient_id = resolve_or_create(c, data.get("name"), user_id, kind=data.get("kind"))
        needed = data.get("qty")
        unit = data.get("unit")
        needed_qty = None
        if needed not in (None, ""):
            ingredient = db.row("SELECT * FROM ingredients WHERE id = ?", (ingredient_id,))
            needed_qty = logic.to_base(ingredient, positive(needed, "Quantity"), check_shop_unit(unit or ingredient["unit"]))
        session_id = data.get("session_id")
        cursor = c.execute(
            "INSERT INTO shopping_items(list_id, ingredient_id, auto, needed_qty, note, added_by, session_id, source) VALUES (?, ?, 0, ?, ?, ?, ?, ?)",
            (
                list_id,
                ingredient_id,
                needed_qty,
                data.get("note"),
                user_id,
                session_id,
                data.get("source") if data.get("source") in SOURCES else "app",
            ),
        )
        item_id = cursor.lastrowid
        if data.get("checked"):
            _check_item(c, item_id, data, user_id)
    return {"item_id": item_id, "list": get_list(list_id)}


def remember_size(c, ingredient, unit, size):
    if unit == "pack" and not ingredient.get("package_amount"):
        c.execute("UPDATE ingredients SET package_amount = ? WHERE id = ?", (round(float(size), 3), ingredient["id"]))
    elif unit == "pcs" and ingredient.get("unit") in logic.MASS_UNITS and not ingredient.get("piece_amount"):
        c.execute("UPDATE ingredients SET piece_amount = ? WHERE id = ?", (round(float(size), 3), ingredient["id"]))
    else:
        return
    convert_pending_batches(c, ingredient["id"])


def _check_item(c, item_id, data, user_id):
    item = db.row("SELECT * FROM shopping_items WHERE id = ?", (item_id,))
    session_id = data.get("session_id") or item["session_id"]
    if not session_id:
        active = db.row(
            "SELECT id FROM shopping_sessions WHERE list_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1", (item["list_id"],)
        )
        if active:
            session_id = active["id"]
        else:
            session_id = c.execute(
                "INSERT INTO shopping_sessions(list_id, store, user_id, started_at) VALUES (?, ?, ?, ?)",
                (item["list_id"], "Store", user_id, iso_now()),
            ).lastrowid
    c.execute("UPDATE shopping_items SET checked = 1, session_id = ? WHERE id = ?", (session_id, item_id))
    if item["bought_qty"] is None and "bought_qty" not in data and item["needed_qty"]:
        unit = db.scalar("SELECT unit FROM ingredients WHERE id = ?", (item["ingredient_id"],))
        c.execute("UPDATE shopping_items SET bought_qty = ?, bought_unit = ? WHERE id = ?", (item["needed_qty"], unit, item_id))


def update_list_item(item_id, data, user_id=None):
    item = db.row("SELECT * FROM shopping_items WHERE id = ?", (item_id,))
    if not item:
        raise ServiceError("Item not found", 404)
    if item["committed"]:
        raise ServiceError("This item is already in the pantry")
    with db.tx() as c:
        if "bought_qty" in data:
            value = data["bought_qty"]
            c.execute(
                "UPDATE shopping_items SET bought_qty = ? WHERE id = ?",
                (None if value in (None, "") else positive(value, "Quantity"), item_id),
            )
        if "bought_unit" in data:
            c.execute("UPDATE shopping_items SET bought_unit = ? WHERE id = ?", (check_shop_unit(data["bought_unit"]), item_id))
        if "pack_size" in data:
            value = data["pack_size"]
            c.execute(
                "UPDATE shopping_items SET pack_size = ? WHERE id = ?",
                (None if value in (None, "") else positive(value, "Pack size"), item_id),
            )
        unit_price = amount_or_none(data["unit_price"], "Price") if "unit_price" in data else None
        if unit_price is not None:
            c.execute("UPDATE shopping_items SET unit_price = ? WHERE id = ?", (round(unit_price, 2), item_id))
        elif "price" in data:
            value = amount_or_none(data["price"], "Price")
            c.execute(
                "UPDATE shopping_items SET price = ?, unit_price = NULL WHERE id = ?", (None if value is None else round(value, 2), item_id)
            )
        elif "unit_price" in data:
            c.execute("UPDATE shopping_items SET unit_price = NULL, price = NULL WHERE id = ?", (item_id,))
        if "note" in data:
            c.execute("UPDATE shopping_items SET note = ? WHERE id = ?", (data["note"], item_id))
        if "checked" in data:
            if data["checked"]:
                _check_item(c, item_id, data, user_id)
            else:
                c.execute("UPDATE shopping_items SET checked = 0, session_id = NULL WHERE id = ?", (item_id,))
        current = db.row("SELECT * FROM shopping_items WHERE id = ?", (item_id,))
        if current["unit_price"] is not None:
            price = line_price(current["unit_price"], current["bought_qty"], current["bought_unit"])
            c.execute("UPDATE shopping_items SET price = ? WHERE id = ?", (price, item_id))
        recompute_auto(c, item["list_id"])
    return get_list(item["list_id"])


def delete_list_item(item_id):
    item = db.row("SELECT * FROM shopping_items WHERE id = ?", (item_id,))
    if not item:
        return get_list()
    if item["committed"]:
        raise ServiceError("This item is already in the pantry")
    with db.tx() as c:
        c.execute("DELETE FROM shopping_items WHERE id = ?", (item_id,))
    return get_list(item["list_id"])


def start_session(store, user_id=None):
    store = (store or "").strip() or "Store"
    with db.tx() as c:
        list_id = ensure_open_list(c, user_id)
        c.execute("UPDATE shopping_sessions SET status = 'paused' WHERE list_id = ? AND status = 'active'", (list_id,))
        session_id = c.execute(
            "INSERT INTO shopping_sessions(list_id, store, user_id, started_at) VALUES (?, ?, ?, ?)", (list_id, store, user_id, iso_now())
        ).lastrowid
    return {"session_id": session_id, "list": get_list(list_id)}


def _commit_session(c, session, user_id):
    items = db.rows("SELECT * FROM shopping_items WHERE session_id = ? AND checked = 1 AND committed = 0", (session["id"],))
    for item in items:
        ingredient = db.row("SELECT * FROM ingredients WHERE id = ?", (item["ingredient_id"],))
        qty = item["bought_qty"]
        unit = item["bought_unit"] or ingredient["unit"]
        if not qty:
            if item["needed_qty"]:
                qty = item["needed_qty"]
                unit = ingredient["unit"]
            else:
                qty = 1
                unit = item["bought_unit"] or (
                    "pcs"
                    if ingredient["kind"] != "food" or ingredient["sold_by_piece"] or ingredient["unit"] == "pcs"
                    else ingredient["unit"]
                )
        stock_qty, stock_unit = qty, unit
        size = item["pack_size"]
        if size and (unit == "pack" or (unit == "pcs" and ingredient["unit"] != "pcs")):
            remember_size(c, ingredient, unit, size)
            stock_qty, stock_unit = float(qty) * float(size), ingredient["unit"]
        add_stock(
            c,
            item["ingredient_id"],
            stock_qty,
            stock_unit,
            item["price"],
            session["store"],
            user_id,
            "purchase",
            session["id"],
            session["started_at"],
        )
        c.execute("UPDATE shopping_items SET committed = 1, bought_qty = ?, bought_unit = ? WHERE id = ?", (qty, unit, item["id"]))
    c.execute("UPDATE shopping_sessions SET status = 'finished', finished_at = ? WHERE id = ?", (iso_now(), session["id"]))


def finish_session(session_id, user_id=None):
    session = db.row("SELECT * FROM shopping_sessions WHERE id = ?", (session_id,))
    if not session:
        raise ServiceError("Session not found", 404)
    if session["status"] == "finished":
        return get_list(session["list_id"])
    with db.tx() as c:
        _commit_session(c, session, user_id)
        recompute_auto(c, session["list_id"])
    return get_list(session["list_id"])


def resume_session(session_id):
    session = db.row("SELECT * FROM shopping_sessions WHERE id = ?", (session_id,))
    if not session or session["status"] == "finished":
        raise ServiceError("This session cannot be resumed")
    with db.tx() as c:
        c.execute("UPDATE shopping_sessions SET status = 'paused' WHERE list_id = ? AND status = 'active'", (session["list_id"],))
        c.execute("UPDATE shopping_sessions SET status = 'active' WHERE id = ?", (session_id,))
    return get_list(session["list_id"])


def pause_session(session_id):
    session = db.row("SELECT * FROM shopping_sessions WHERE id = ?", (session_id,))
    if not session:
        raise ServiceError("Session not found", 404)
    with db.tx() as c:
        c.execute("UPDATE shopping_sessions SET status = 'paused' WHERE id = ? AND status = 'active'", (session_id,))
    return get_list(session["list_id"])


def close_list(list_id, user_id=None):
    shopping = db.row("SELECT * FROM shopping_lists WHERE id = ?", (list_id,))
    if not shopping or shopping["status"] != "open":
        raise ServiceError("This list is not open")
    with db.tx() as c:
        for session in db.rows("SELECT * FROM shopping_sessions WHERE list_id = ? AND status != 'finished'", (list_id,)):
            _commit_session(c, session, user_id)
        skipped = db.rows("SELECT * FROM shopping_items WHERE list_id = ? AND committed = 0", (list_id,))
        skipped_ids = {item["ingredient_id"] for item in skipped}
        c.execute("DELETE FROM shopping_items WHERE list_id = ? AND committed = 0", (list_id,))
        c.execute("UPDATE shopping_lists SET status = 'closed', closed_at = ? WHERE id = ?", (iso_now(), list_id))
        if shopping["range_start"] and shopping["range_end"]:
            span = (parse_date(shopping["range_end"]) - parse_date(shopping["range_start"])).days + 1
            db.set_setting("default_cycle_days", max(1, span), c)
        _missing_alerts(c, skipped_ids)
    return {"closed": list_id, "skipped": len(skipped)}


def _missing_alerts(c, only_ingredients=None):
    sequence, ingredients = planned_sequence(today().isoformat())
    outcome, _ = logic.simulate(stock_map(), [(meal["id"], required) for meal, required in sequence])
    meals = {meal["id"]: meal for meal, _ in sequence}
    created = 0
    for entry in outcome:
        for ingredient_id, missing in entry["shortages"].items():
            if only_ingredients is not None and ingredient_id not in only_ingredients:
                continue
            meal = meals[entry["key"]]
            recipe = db.row("SELECT raw_name, name_en FROM recipes WHERE id = ?", (meal["recipe_id"],))
            ingredient = ingredients[ingredient_id]
            title = "Not enough " + display_name(ingredient) + " for " + (recipe["name_en"] or recipe["raw_name"])
            body = "Planned for " + meal["date"] + ". Missing about " + format_qty(missing, ingredient["unit"]) + "."
            payload = {"meal_id": meal["id"], "ingredient_id": ingredient_id, "missing": missing, "date": meal["date"]}
            cursor = c.execute(
                "INSERT OR IGNORE INTO alerts(kind, dedupe_key, title, body, payload) VALUES ('missing', ?, ?, ?, ?)",
                ("missing:" + str(meal["id"]) + ":" + str(ingredient_id), title, body, json.dumps(payload)),
            )
            created += cursor.rowcount
    return created


def format_qty(qty, unit):
    if unit == "pcs":
        return ("{:g}".format(round(qty, 1))) + " pcs"
    if qty >= 1000:
        return ("{:g}".format(round(qty / 1000.0, 2))) + (" kg" if unit == "g" else " l")
    return ("{:g}".format(round(qty))) + " " + unit


def alerts(status="open"):
    found = db.rows("SELECT * FROM alerts WHERE status = ? ORDER BY created_at DESC, id DESC", (status,))
    for alert in found:
        alert["payload"] = json.loads(alert["payload"] or "{}")
    return found


def dismiss_alert(alert_id):
    with db.tx() as c:
        c.execute("UPDATE alerts SET status = 'dismissed' WHERE id = ?", (alert_id,))


def act_on_alert(alert_id, user_id=None):
    alert = db.row("SELECT * FROM alerts WHERE id = ?", (alert_id,))
    if not alert:
        raise ServiceError("Alert not found", 404)
    payload = json.loads(alert["payload"] or "{}")
    with db.tx() as c:
        if alert["kind"] == "missing" and payload.get("ingredient_id"):
            list_id = ensure_open_list(c, user_id)
            exists = db.scalar(
                "SELECT id FROM shopping_items WHERE list_id = ? AND ingredient_id = ? AND committed = 0",
                (list_id, payload["ingredient_id"]),
            )
            if not exists:
                c.execute(
                    "INSERT INTO shopping_items(list_id, ingredient_id, auto, needed_qty, added_by) VALUES (?, ?, 0, ?, ?)",
                    (list_id, payload["ingredient_id"], payload.get("missing"), user_id),
                )
        c.execute("UPDATE alerts SET status = 'resolved' WHERE id = ?", (alert_id,))
    return {"ok": True}


def price_history(ingredient_id):
    ingredient = db.row("SELECT unit FROM ingredients WHERE id = ?", (ingredient_id,))
    found = db.rows(
        "SELECT purchased_at, store, qty_initial, price_total FROM batches WHERE ingredient_id = ? AND price_total IS NOT NULL AND qty_initial > 0 AND pending_unit IS NULL AND source = 'purchase' ORDER BY purchased_at",
        (ingredient_id,),
    )
    scale = 1.0 if (ingredient or {}).get("unit") == "pcs" else 1000.0
    return [
        {
            "date": entry["purchased_at"][:10],
            "store": entry["store"],
            "qty": entry["qty_initial"],
            "price": entry["price_total"],
            "unit_price": round(entry["price_total"] / entry["qty_initial"] * scale, 2),
        }
        for entry in found
    ]
