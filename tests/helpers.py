from datetime import date, timedelta

from app import db

CATALOG = {
    "berenj": dict(
        name_en="Basmati rice",
        name_fa="برنج",
        name_de="Basmatireis",
        category="grains",
        kind="food",
        unit="g",
        sold_by_piece=False,
        piece_amount=0,
        kcal=350,
        protein=7,
        fat=1,
        carbs=78,
        fiber=1,
        tolerance_pct=0,
        shelf_days=365,
        icon="cooked-rice",
    ),
    "goosht charkh karde": dict(
        name_en="Ground beef",
        name_fa="گوشت چرخ کرده",
        name_de="Rinderhack",
        category="meat",
        kind="food",
        unit="g",
        sold_by_piece=False,
        piece_amount=0,
        kcal=250,
        protein=20,
        fat=18,
        carbs=0,
        fiber=0,
        tolerance_pct=0,
        shelf_days=2,
        icon="cut-of-meat",
    ),
    "loobia sabz": dict(
        name_en="Green beans",
        name_fa="لوبیا سبز",
        name_de="Gruene Bohnen",
        category="vegetables",
        kind="food",
        unit="g",
        sold_by_piece=False,
        piece_amount=0,
        kcal=31,
        protein=2,
        fat=0,
        carbs=7,
        fiber=3,
        tolerance_pct=10,
        shelf_days=5,
        icon="pea-pod",
    ),
    "kahoo": dict(
        name_en="Lettuce",
        name_fa="کاهو",
        name_de="Salat",
        category="vegetables",
        kind="food",
        unit="g",
        sold_by_piece=True,
        piece_amount=300,
        kcal=15,
        protein=1,
        fat=0,
        carbs=3,
        fiber=1,
        tolerance_pct=20,
        shelf_days=5,
        icon="leafy-green",
    ),
    "namak": dict(
        name_en="Salt",
        name_fa="نمک",
        name_de="Salz",
        category="condiments",
        kind="staple",
        unit="g",
        sold_by_piece=False,
        piece_amount=0,
        kcal=0,
        protein=0,
        fat=0,
        carbs=0,
        fiber=0,
        tolerance_pct=0,
        shelf_days=0,
        icon="salt",
    ),
    "panir": dict(
        name_en="Feta cheese",
        name_fa="پنیر",
        name_de="Feta",
        category="dairy",
        kind="food",
        unit="g",
        sold_by_piece=False,
        piece_amount=0,
        kcal=260,
        protein=14,
        fat=21,
        carbs=4,
        fiber=0,
        tolerance_pct=0,
        shelf_days=14,
        icon="cheese-wedge",
    ),
    "tokhm morgh": dict(
        name_en="Eggs",
        name_fa="تخم مرغ",
        name_de="Eier",
        category="eggs",
        kind="food",
        unit="pcs",
        sold_by_piece=True,
        piece_amount=60,
        kcal=78,
        protein=6.5,
        fat=5,
        carbs=0.6,
        fiber=0,
        tolerance_pct=0,
        shelf_days=21,
        icon="egg",
    ),
    "sib": dict(
        name_en="Apple",
        name_fa="سیب",
        name_de="Apfel",
        category="fruits",
        kind="snack",
        unit="pcs",
        sold_by_piece=True,
        piece_amount=180,
        kcal=95,
        protein=0.5,
        fat=0.3,
        carbs=25,
        fiber=4,
        tolerance_pct=0,
        shelf_days=20,
        icon="red-apple",
    ),
}

H = {"x-user-id": "1"}


def fake_generate(prompt, schema, timeout=60):
    if "properties" in schema and "same_as_id" in schema["properties"]:
        lowered = prompt.lower()
        for key, value in CATALOG.items():
            if '"' + key + '"' in lowered:
                return dict(value, understood=True, same_as_id=0, aliases=[])
        if '"rice"' in lowered:
            rice_id = db.scalar("SELECT id FROM ingredients WHERE name_en = 'Basmati rice'")
            return dict(CATALOG["berenj"], understood=True, same_as_id=rice_id, aliases=["reis"])
        return dict(CATALOG["namak"], understood=False, same_as_id=0, aliases=[])
    return {
        "understood": True,
        "name_en": "Loobia Polo",
        "name_fa": "لوبیا پلو",
        "description": "Rice layered with beans and beef.",
        "tags": ["persian", "rice"],
        "cook_minutes": 75,
        "image_query": "loobia polo",
    }


LOOBIA_SLOTS = [
    {"items": [{"name": "berenj", "amount": 100, "unit": "g"}]},
    {"items": [{"name": "goosht charkh karde", "amount": 80, "unit": "g"}]},
    {"items": [{"name": "loobia sabz", "amount": 70, "unit": "g"}]},
    {"optional": True, "items": [{"name": "kahoo", "amount": 50, "unit": "g"}]},
    {"items": [{"name": "namak", "amount": 3, "unit": "g"}]},
]


class Kitchen:
    def __init__(self, client, drain):
        self.client = client
        self.drain = drain
        self.today = date.fromisoformat(client.get("/api/bootstrap").json()["today"])

    def day(self, offset=0):
        return (self.today + timedelta(days=offset)).isoformat()

    def recipe(self, name="loobia polo", slots=None):
        created = self.client.post("/api/recipes", json={"name": name, "slots": slots or LOOBIA_SLOTS})
        assert created.status_code == 200, created.text
        self.drain()
        return self.client.get("/api/recipes/" + str(created.json()["id"])).json()

    def ingredient(self, name):
        created = self.client.post("/api/ingredients", json={"name": name}).json()
        self.drain()
        return self.client.get("/api/ingredients/" + str(created["id"])).json()

    def ingredient_id(self, english):
        return db.scalar("SELECT id FROM ingredients WHERE name_en = ?", (english,))

    def stock(self, name, qty, unit="g", price=None):
        response = self.client.post("/api/inventory/add", json={"name": name, "qty": qty, "unit": unit, "price": price})
        assert response.status_code == 200, response.text
        self.drain()
        return response.json()

    def meal(self, recipe_id, offset=0, servings=2, **extra):
        response = self.client.post("/api/meals", json={"date": self.day(offset), "recipe_id": recipe_id, "servings": servings, **extra})
        assert response.status_code == 200, response.text
        return response.json()

    def token(self, name="gym"):
        return self.client.post("/api/integrations/tokens", json={"name": name}).json()
