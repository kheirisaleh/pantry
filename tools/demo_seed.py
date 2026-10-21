"""Fill a fresh data folder with six weeks of made up household data.

Used for screenshots and for trying the app without typing everything in. Nothing here talks to the network: the
ingredient details that Gemini would normally fill in are written directly, and the clock of the app is moved
forward day by day so purchases, cooking, waste and reports look like real use.

    python tools/demo_seed.py /tmp/pantry-demo
    DATA_DIR=/tmp/pantry-demo PANTRY_WORKERS=0 uvicorn app.main:app
"""

import json
import os
import random
import sys
from datetime import datetime, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGET = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "data-demo"))
os.makedirs(TARGET, exist_ok=True)
os.environ["DATA_DIR"] = TARGET
os.environ["PANTRY_WORKERS"] = "0"
sys.path.insert(0, ROOT)

from app import db, integrations, names, scheduler, services  # noqa: E402

db.DATA_DIR = TARGET
db.set_path(os.path.join(TARGET, "pantry.db"))
if os.path.exists(db.DB_PATH):
    sys.exit("The target already has a database: " + db.DB_PATH)
db.init()
integrations.init()
integrations.install_hooks()

random.seed(7)

INGREDIENTS = [
    ("berenj", "Basmati rice", "برنج", "Basmatireis", "grains", "food", "g", 0, None, 350, 7, 1, 78, 1, 0, 365, "cooked-rice", 3.2),
    (
        "goosht charkh karde",
        "Ground beef",
        "گوشت چرخ کرده",
        "Rinderhack",
        "meat",
        "food",
        "g",
        0,
        None,
        250,
        20,
        18,
        0,
        0,
        0,
        2,
        "cut-of-meat",
        11.0,
    ),
    ("morgh", "Chicken breast", "سینه مرغ", "Hähnchenbrust", "poultry", "food", "g", 0, None, 120, 23, 2, 0, 0, 0, 3, "poultry-leg", 9.5),
    ("loobia sabz", "Green beans", "لوبیا سبز", "Grüne Bohnen", "vegetables", "food", "g", 0, None, 31, 2, 0, 7, 3, 10, 5, "pea-pod", 4.5),
    ("adas", "Red lentils", "عدس", "Rote Linsen", "legumes", "food", "g", 0, None, 340, 24, 1, 50, 11, 0, 365, "beans", 3.8),
    ("sabzi", "Mixed herbs", "سبزی", "Kräutermischung", "herbs", "food", "g", 0, None, 40, 3, 0, 6, 3, 20, 5, "herb", 14.0),
    ("piaz", "Onion", "پیاز", "Zwiebel", "vegetables", "food", "g", 1, 150, 40, 1, 0, 9, 2, 10, 30, "onion", 1.6),
    ("sir", "Garlic", "سیر", "Knoblauch", "vegetables", "food", "g", 1, 40, 150, 6, 0, 33, 2, 10, 30, "garlic", 8.0),
    ("goje farangi", "Tomatoes", "گوجه فرنگی", "Tomaten", "vegetables", "food", "g", 1, 120, 18, 1, 0, 4, 1, 15, 7, "tomato", 3.0),
    ("khiar", "Cucumber", "خیار", "Gurke", "vegetables", "food", "g", 1, 300, 15, 1, 0, 4, 1, 10, 7, "cucumber", 2.0),
    ("felfel dolme", "Bell pepper", "فلفل دلمه", "Paprika", "vegetables", "food", "g", 1, 160, 26, 1, 0, 6, 2, 10, 7, "bell-pepper", 4.0),
    ("sib zamini", "Potatoes", "سیب زمینی", "Kartoffeln", "vegetables", "food", "g", 0, None, 77, 2, 0, 17, 2, 5, 30, "potato", 1.4),
    ("tokhm morgh", "Eggs", "تخم مرغ", "Eier", "eggs", "food", "pcs", 1, 60, 78, 6.5, 5, 0.6, 0, 0, 21, "egg", 0.32),
    ("panir", "Feta cheese", "پنیر", "Feta", "dairy", "food", "g", 0, None, 260, 14, 21, 4, 0, 0, 14, "cheese-wedge", 12.0),
    ("mast", "Yogurt", "ماست", "Joghurt", "dairy", "food", "g", 0, None, 63, 4, 3, 5, 0, 0, 10, "custard", 2.2),
    ("shir", "Milk", "شیر", "Milch", "dairy", "food", "ml", 0, None, 64, 3.4, 3.5, 4.8, 0, 0, 7, "glass-of-milk", 1.1),
    ("pasta", "Spaghetti", "اسپاگتی", "Spaghetti", "grains", "food", "g", 0, None, 360, 13, 2, 72, 3, 0, 365, "spaghetti", 2.4),
    ("nan lavash", "Flatbread", "نان لواش", "Fladenbrot", "bakery", "food", "pcs", 1, 80, 220, 7, 1, 45, 2, 0, 4, "flatbread", 0.6),
    ("rob goje", "Tomato paste", "رب گوجه", "Tomatenmark", "canned", "food", "g", 0, None, 82, 4, 0, 16, 4, 0, 60, "canned-food", 6.0),
    ("limoo", "Lemon", "لیمو", "Zitrone", "fruits", "food", "g", 1, 100, 29, 1, 0, 9, 3, 0, 14, "lemon", 3.5),
    ("sib", "Apple", "سیب", "Apfel", "fruits", "snack", "pcs", 1, 180, 95, 0.5, 0.3, 25, 4, 0, 20, "red-apple", 0.45),
    ("moz", "Banana", "موز", "Banane", "fruits", "snack", "pcs", 1, 120, 105, 1.3, 0.4, 27, 3, 0, 6, "banana", 0.3),
    ("ajil", "Mixed nuts", "آجیل", "Nussmischung", "snacks", "snack", "g", 0, None, 600, 20, 52, 20, 7, 0, 90, "peanuts", 16.0),
    ("namak", "Salt", "نمک", "Salz", "condiments", "staple", "g", 0, None, 0, 0, 0, 0, 0, 0, None, "salt", 0.8),
    ("roghan", "Olive oil", "روغن زیتون", "Olivenöl", "condiments", "staple", "ml", 0, None, 884, 0, 100, 0, 0, 0, None, "olive", 9.0),
    (
        "dastmal kaghazi",
        "Kitchen paper",
        "دستمال کاغذی",
        "Küchenrolle",
        "household",
        "household",
        "pcs",
        1,
        None,
        0,
        0,
        0,
        0,
        0,
        0,
        None,
        "roll-of-paper",
        0.9,
    ),
]

RECIPES = [
    (
        "Loobia Polo",
        "لوبیا پلو",
        "Rice layered with green beans, beef and tomato. A weeknight classic.",
        ["persian", "rice"],
        75,
        [
            ("berenj", 90, "g"),
            ("goosht charkh karde", 80, "g"),
            ("loobia sabz", 80, "g"),
            ("rob goje", 1, "tbsp"),
            ("piaz", 0.5, "pcs"),
            ("namak", 3, "g"),
        ],
    ),
    (
        "Ghormeh Sabzi",
        "قورمه سبزی",
        "Slow cooked herb stew with beef and beans, served with rice.",
        ["persian", "stew"],
        150,
        [("sabzi", 70, "g"), ("goosht charkh karde", 90, "g"), ("berenj", 80, "g"), ("limoo", 0.5, "pcs"), ("piaz", 0.5, "pcs")],
    ),
    (
        "Adas Polo",
        "عدس پلو",
        "Rice with lentils, onions and a little yogurt on the side.",
        ["persian", "vegetarian", "rice"],
        50,
        [("berenj", 80, "g"), ("adas", 50, "g"), ("piaz", 0.5, "pcs"), ("mast", 100, "g")],
    ),
    (
        "Kuku Sabzi",
        "کوکو سبزی",
        "Herb frittata with lots of fresh greens, eaten with bread.",
        ["persian", "vegetarian", "quick"],
        30,
        [("tokhm morgh", 2, "pcs"), ("sabzi", 60, "g"), ("nan lavash", 1, "pcs"), ("sir", 0.5, "pcs")],
    ),
    (
        "Shakshuka",
        "شکشوکا",
        "Eggs poached in a spiced tomato and pepper sauce.",
        ["vegetarian", "quick", "breakfast"],
        25,
        [
            ("tokhm morgh", 2, "pcs"),
            ("goje farangi", 2, "pcs"),
            ("felfel dolme", 0.5, "pcs"),
            ("piaz", 0.5, "pcs"),
            ("nan lavash", 1, "pcs"),
        ],
    ),
    (
        "Spaghetti Pomodoro",
        "اسپاگتی گوجه",
        "Spaghetti with a quick fresh tomato and garlic sauce.",
        ["italian", "quick"],
        20,
        [("pasta", 110, "g"), ("goje farangi", 2, "pcs"), ("sir", 0.5, "pcs"), ("panir", 30, "g")],
    ),
    (
        "Chicken Wrap",
        "رپ مرغ",
        "Grilled chicken, cucumber and yogurt sauce in flatbread.",
        ["quick", "high protein"],
        25,
        [("morgh", 150, "g"), ("nan lavash", 1, "pcs"), ("khiar", 0.3, "pcs"), ("mast", 50, "g")],
    ),
    (
        "Lentil Soup",
        "سوپ عدس",
        "Red lentil soup with onion, garlic and lemon.",
        ["soup", "vegetarian"],
        35,
        [("adas", 70, "g"), ("piaz", 0.5, "pcs"), ("sir", 0.5, "pcs"), ("limoo", 0.3, "pcs")],
    ),
]

STORES = ["Rewe", "Aldi", "Persian Market", "Rewe", "Lidl", "Aldi", "Rewe"]
PRICE_DRIFT = [1.0, 1.02, 0.97, 1.05, 1.03, 1.06, 1.08]
TRIPS = [(0, 7), (7, 7), (14, 8), (22, 6), (28, 7), (35, 5), (40, 7)]


class Clock:
    def __init__(self, start):
        self.current = start

    def __call__(self):
        return self.current

    def at(self, day, hour, minute=0):
        self.current = day.replace(hour=hour, minute=minute, second=0, microsecond=0)


real_now = services.now()
clock = Clock(real_now)
services.now = clock
today = real_now.replace(hour=12, minute=0, second=0, microsecond=0)
start = today - timedelta(days=42)

with db.tx() as c:
    c.execute("UPDATE users SET name = 'Leila', color = '#f2a93b' WHERE id = 1")
    c.execute("INSERT INTO users(name, color) VALUES ('Jonas', '#8fb8ea')")
    db.set_setting("default_servings", 2, c)

ids = {}
prices = {}
with db.tx() as c:
    for (
        raw,
        en,
        fa,
        de,
        category,
        kind,
        unit,
        by_piece,
        piece,
        kcal,
        protein,
        fat,
        carbs,
        fiber,
        tolerance,
        shelf,
        icon,
        price,
    ) in INGREDIENTS:
        cursor = c.execute(
            "INSERT INTO ingredients(raw_name, name_en, name_fa, name_de, category, kind, unit, sold_by_piece, piece_amount, kcal, protein, fat, carbs, fiber, "
            "tolerance_pct, shelf_days, icon, status, unit_locked) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', 1)",
            (raw, en, fa, de, category, kind, unit, by_piece, piece, kcal, protein, fat, carbs, fiber, tolerance, shelf, icon),
        )
        ids[raw] = cursor.lastrowid
        prices[ids[raw]] = price
        for alias in (raw, en, fa, de):
            names.add_alias(c, ids[raw], alias)

recipe_ids = []
for name_en, name_fa, description, tags, minutes, items in RECIPES:
    slots = [{"items": [{"ingredient_id": ids[raw], "amount": amount, "unit": unit}]} for raw, amount, unit in items]
    recipe = services.create_recipe({"name": name_en.lower(), "slots": slots}, 1)
    recipe_ids.append(recipe["id"])
    with db.tx() as c:
        c.execute(
            "UPDATE recipes SET name_en = ?, name_fa = ?, description = ?, tags = ?, cook_minutes = ?, status = 'ready', image_status = 'none' WHERE id = ?",
            (name_en, name_fa, description, json.dumps(tags), minutes, recipe["id"]),
        )
with db.tx() as c:
    c.execute("DELETE FROM ai_jobs")
    c.execute("UPDATE recipe_items SET is_default = 1")


def price_for(item, trip):
    ingredient = db.row("SELECT unit FROM ingredients WHERE id = ?", (item["ingredient"]["id"],))
    qty = item["needed_qty"] or 1
    base = prices[item["ingredient"]["id"]] * PRICE_DRIFT[trip] * random.uniform(0.95, 1.05)
    if ingredient["unit"] == "pcs":
        return round(base * qty, 2)
    return round(base * qty / 1000.0, 2)


def plan_days(first_day, offset, days):
    for index in range(days):
        day = (first_day + timedelta(days=index)).date().isoformat()
        services.add_meal({"recipe_id": recipe_ids[(index + offset) % len(recipe_ids)], "date": day, "servings": 2}, 1)
        if index % 3 == 1:
            services.add_meal({"recipe_id": recipe_ids[(index + offset + 4) % len(recipe_ids)], "date": day, "servings": 2}, 2)


def shop(trip_day, trip, days):
    clock.at(trip_day, 10)
    current = services.open_list()
    if current:
        services.close_list(current["id"], 1)
    plan_days(trip_day, trip, days)
    built = services.build_list(trip_day.date().isoformat(), (trip_day + timedelta(days=days - 1)).date().isoformat(), 1)
    session = services.start_session(STORES[trip], 1 if trip % 2 == 0 else 2)
    for index, item in enumerate(built["items"]):
        clock.at(trip_day, 10, 5 + index)
        services.update_list_item(item["id"], {"checked": True, "price": price_for(item, trip)}, 1)
    if trip % 2 == 0:
        added = services.add_list_item(
            {"name": "Kitchen paper", "qty": 2, "unit": "pcs", "checked": True, "session_id": session["session_id"]}, 1
        )
        services.update_list_item(added["item_id"], {"price": 1.79}, 1)
    clock.at(trip_day, 11)
    services.finish_session(session["session_id"], 1)


def live(trip_day, days):
    for offset in range(days):
        day = trip_day + timedelta(days=offset)
        if day.date() >= today.date():
            break
        clock.at(day, 8)
        services.log_snack({"ingredient_id": ids["sib"] if offset % 2 else ids["moz"], "qty": 1, "unit": "pcs"}, 1 + offset % 2)
        if offset % 3 == 0:
            services.log_snack({"ingredient_id": ids["ajil"], "qty": 40, "unit": "g"}, 2)
        clock.at(day, 19)
        for meal in db.rows("SELECT id FROM meals WHERE date = ? AND status = 'planned' ORDER BY position", (day.date().isoformat(),)):
            services.cook({"meal_id": meal["id"]}, 1 + meal["id"] % 2)
        if offset == 5 and days > 5:
            services.waste(ids["sabzi"], 40, "g", 1)


clock.at(start - timedelta(days=1), 11)
for raw, amount, unit, price in (
    ("berenj", 5, "kg", 13.99),
    ("pasta", 2, "kg", 3.98),
    ("adas", 1, "kg", 3.49),
    ("tokhm morgh", 10, "pcs", 3.29),
    ("roghan", 1, "l", 8.99),
):
    services.manual_add({"ingredient_id": ids[raw], "qty": amount, "unit": unit, "price": price, "store": "Persian Market"}, 1)

for trip, (offset, days) in enumerate(TRIPS):
    trip_day = start + timedelta(days=offset)
    shop(trip_day, trip, days)
    live(trip_day, days)

clock.at(today, 9)
services.log_snack({"ingredient_id": ids["sib"], "qty": 1, "unit": "pcs"}, 1)
services.add_list_item({"name": "Tomatoes", "qty": 4, "unit": "pcs", "source": "alexa"}, None)
services.add_list_item({"name": "Milk", "qty": 1, "unit": "l", "source": "automation"}, None)
for raw, qty, unit in (("ajil", 200, "g"), ("moz", 6, "pcs"), ("mast", 500, "g"), ("dastmal kaghazi", 2, "pcs")):
    services.add_list_item({"ingredient_id": ids[raw], "qty": qty, "unit": unit}, 1)
clock.at(today, 17, 40)
session = services.start_session("Rewe", 1)
for item, price in zip([item for item in services.get_list()["items"] if not item["committed"]][:3], (2.49, 1.29, 0.99)):
    services.update_list_item(item["id"], {"checked": True, "price": price}, 1)
with db.tx() as c:
    c.execute("UPDATE meals SET source = 'alexa' WHERE id = (SELECT MAX(id) FROM meals WHERE status = 'planned')")

clock.at(today, 18, 30)
scheduler.tomorrow_shortages()
scheduler.expiry_estimates()
integrations.daily_export()
token = integrations.create_token("Home Gym")
integrations.save_webhook(
    {
        "name": "Home Gym",
        "url": "http://homegym.local:8090/api/integrations/pantry",
        "events": ["nutrition.daily", "meal.cooked", "meal.uncooked"],
    }
)
with db.tx() as c:
    c.execute("UPDATE webhooks SET last_status = '200', last_at = ?", (services.iso_now(),))
    c.execute("UPDATE api_tokens SET last_used = ?", (services.iso_now(),))
    c.execute("UPDATE alerts SET pushed = 1")
services.now = lambda: datetime.now(services.zone())
print("Demo data written to", db.DB_PATH)
