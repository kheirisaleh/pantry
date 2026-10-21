import json
import logging
import os
import re
import threading
import time
import urllib.error
import urllib.request

from . import db, names, services

log = logging.getLogger("pantry.ai")

GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"
CATEGORIES = list(services.CATEGORY_ORDER)
KINDS = ["food", "snack", "staple", "household"]
with open(os.path.join(os.path.dirname(__file__), "icon_names.json"), encoding="utf-8") as _handle:
    ICON_NAMES = json.load(_handle)
CATEGORY_ICONS = {
    "vegetables": "leafy-green",
    "fruits": "red-apple",
    "herbs": "herb",
    "meat": "cut-of-meat",
    "poultry": "poultry-leg",
    "fish": "fish",
    "dairy": "glass-of-milk",
    "eggs": "egg",
    "bakery": "bread",
    "grains": "sheaf-of-rice",
    "legumes": "beans",
    "canned": "canned-food",
    "frozen": "ice",
    "condiments": "jar",
    "snacks": "cookie",
    "beverages": "cup-with-straw",
    "household": "basket",
    "other": "package",
}
MAX_BACKOFF = 6 * 3600

_state = {"last_error": None, "last_ok": None, "cooldown_until": 0.0}
_wake = threading.Event()


class AIError(Exception):
    def __init__(self, message, retry_after=None, permanent=False):
        super().__init__(message)
        self.retry_after = retry_after
        self.permanent = permanent


def api_key():
    stored = (db.get_setting("gemini_api_key") or "").strip()
    return stored or (os.environ.get("GEMINI_API_KEY") or "").strip()


def key_source():
    if (db.get_setting("gemini_api_key") or "").strip():
        return "settings"
    return "server" if (os.environ.get("GEMINI_API_KEY") or "").strip() else None


def enabled():
    return db.get_setting("ai_enabled", "1") == "1"


def _usage_today():
    stamp = time.strftime("%Y-%m-%d")
    try:
        data = json.loads(db.get_setting("ai_usage", "{}"))
    except ValueError:
        data = {}
    if data.get("date") != stamp:
        data = {"date": stamp, "models": {}}
    return data


def _count(name, field):
    data = _usage_today()
    entry = data["models"].setdefault(name, {"ok": 0, "limited": 0, "failed": 0})
    entry[field] = entry.get(field, 0) + 1
    try:
        with db.tx() as c:
            db.set_setting("ai_usage", json.dumps(data), c)
    except Exception:
        log.exception("Could not store AI usage")


_model_errors = {}


def model():
    return (os.environ.get("GEMINI_MODEL") or "gemini-flash-latest").strip()


def _schema(node):
    if isinstance(node, dict):
        converted = {}
        for key, value in node.items():
            if key == "type" and isinstance(value, str):
                converted[key] = value.upper()
            elif key == "properties" and isinstance(value, dict):
                converted[key] = {name: _schema(child) for name, child in value.items()}
            else:
                converted[key] = _schema(value)
        if converted.get("type") == "OBJECT" and "properties" in converted:
            converted["propertyOrdering"] = list(converted["properties"].keys())
        return converted
    if isinstance(node, list):
        return [_schema(entry) for entry in node]
    return node


_model_blocked = {}
_model_unavailable = set()


def _all_blocked_error():
    now = time.time()
    wait = int(min(_model_blocked.values()) - now) + 1
    if all(name in _model_unavailable for name in models()):
        return AIError("None of the chosen Gemini models is available. Pick other models in the settings.", retry_after=max(wait, 60))
    return AIError("Gemini quota reached", retry_after=max(wait, 60))


def models():
    configured = (db.get_setting("gemini_models") or os.environ.get("GEMINI_MODELS") or "").strip()
    if configured:
        return [entry.strip() for entry in configured.split(",") if entry.strip()]
    return ["gemini-flash-lite-latest", model()]


def _retry_seconds(detail, fallback):
    match = re.search(r"retry in (?:(\d+)h)?(?:(\d+)m)?([\d.]+)s", detail)
    if not match:
        return fallback
    hours, minutes, seconds = match.groups()
    return int(hours or 0) * 3600 + int(minutes or 0) * 60 + int(float(seconds or 0)) + 5


def _call(name, payload, timeout):
    request = urllib.request.Request(
        GEMINI_BASE + "/models/" + name + ":generateContent",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-goog-api-key": api_key()},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def generate(prompt, schema, timeout=90):
    if not api_key():
        raise AIError("GEMINI_API_KEY is not set", retry_after=3600)
    payload = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.2, "responseMimeType": "application/json", "responseSchema": _schema(schema)},
    }
    now = time.time()
    available = [name for name in models() if _model_blocked.get(name, 0) <= now]
    if not available:
        raise _all_blocked_error()
    last_error = None
    body = None
    for name in available:
        try:
            body = _call(name, payload, timeout)
            _count(name, "ok")
            _model_errors.pop(name, None)
            break
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", "replace")
            _count(name, "limited" if error.code == 429 else "failed")
            _model_errors[name] = str(error.code) + ": " + (re.sub(r"\s+", " ", detail)[:240])
            if error.code == 429:
                wait = _retry_seconds(detail, 600)
                _model_blocked[name] = time.time() + wait
                _model_unavailable.discard(name)
                log.warning("Gemini model %s quota reached, blocked for %s seconds", name, wait)
                last_error = AIError("Gemini quota reached", retry_after=min(wait, MAX_BACKOFF))
                continue
            if error.code == 404:
                _model_blocked[name] = time.time() + 86400
                _model_unavailable.add(name)
                last_error = AIError("Gemini model " + name + " not available", retry_after=60)
                continue
            if error.code >= 500:
                last_error = AIError("Gemini server error " + str(error.code), retry_after=300)
                continue
            raise AIError("Gemini answered " + str(error.code) + ": " + detail[:300], retry_after=1800) from error
        except (urllib.error.URLError, OSError, TimeoutError) as error:
            _count(name, "failed")
            _model_errors[name] = "unreachable: " + str(error)[:200]
            last_error = AIError("Gemini unreachable: " + str(error), retry_after=300)
            continue
    if body is None:
        if any(_model_blocked.get(name, 0) > time.time() for name in available) and all(
            _model_blocked.get(name, 0) > time.time() for name in models()
        ):
            raise _all_blocked_error()
        raise last_error or AIError("Gemini returned no answer", retry_after=600)
    candidates = body.get("candidates") or []
    if not candidates:
        raise AIError("Gemini returned no answer", retry_after=600)
    text = "".join(part.get("text", "") for part in candidates[0].get("content", {}).get("parts", []))
    try:
        return json.loads(text)
    except ValueError as error:
        raise AIError("Gemini returned invalid JSON", retry_after=120) from error


INGREDIENT_SCHEMA = {
    "type": "object",
    "properties": {
        "understood": {"type": "boolean"},
        "same_as_id": {"type": "integer"},
        "name_en": {"type": "string"},
        "name_fa": {"type": "string"},
        "name_de": {"type": "string"},
        "aliases": {"type": "array", "items": {"type": "string"}},
        "category": {"type": "string", "enum": CATEGORIES},
        "kind": {"type": "string", "enum": KINDS},
        "unit": {"type": "string", "enum": ["g", "ml", "pcs"]},
        "sold_by_piece": {"type": "boolean"},
        "piece_amount": {"type": "number"},
        "kcal": {"type": "number"},
        "protein": {"type": "number"},
        "fat": {"type": "number"},
        "carbs": {"type": "number"},
        "fiber": {"type": "number"},
        "tolerance_pct": {"type": "number"},
        "shelf_days": {"type": "integer"},
        "icon": {"type": "string"},
    },
    "required": [
        "understood",
        "same_as_id",
        "name_en",
        "name_fa",
        "name_de",
        "aliases",
        "category",
        "kind",
        "unit",
        "sold_by_piece",
        "piece_amount",
        "kcal",
        "protein",
        "fat",
        "carbs",
        "fiber",
        "tolerance_pct",
        "shelf_days",
        "icon",
    ],
}


def _ingredient_prompt(ingredient, existing):
    lines = [
        "You maintain the ingredient catalogue of a household meal planner in Germany.",
        "The household speaks Persian, German and English and often types Persian words in Latin letters (Finglish), sometimes with typos.",
        "Identify what this user text means: " + json.dumps(ingredient["raw_name"], ensure_ascii=False),
        "",
        "Existing catalogue (id: English / Persian):",
    ]
    for entry in existing:
        lines.append(str(entry["id"]) + ": " + (entry["name_en"] or entry["raw_name"]) + " / " + (entry["name_fa"] or ""))
    if not existing:
        lines.append("(empty)")
    lines += [
        "",
        "Rules:",
        "1. If the text is clearly the same product as an existing entry (same type of product, colour or brand differences do not matter, but ground beef and stewing beef are different products), set same_as_id to that id. Otherwise set same_as_id to 0.",
        "2. If you cannot tell with confidence what product this is, set understood to false and fill the other fields with empty strings and zeros.",
        "3. name_en is a short common English shop name, name_fa is the Persian name in Persian script, name_de the German supermarket name.",
        "4. aliases: other spellings a person might type, including Finglish, German and English variants, at most 8.",
        "5. kind: food for cooking ingredients, snack for ready to eat items, staple for salt, pepper, spices, cooking oil, vinegar, sugar for seasoning and similar pantry basics that are never counted, household for non food items.",
        "6. unit is the natural base unit: g for solids, ml for liquids, pcs only for items that are always counted and never weighed (eggs, bread rolls, household items).",
    ]
    if ingredient.get("unit_locked"):
        lines.append("   The base unit is already fixed to " + ingredient["unit"] + ", return exactly that unit.")
    lines += [
        "7. sold_by_piece is true when supermarkets sell it per piece although recipes weigh it (lettuce, cucumber, tomato, onion, pepper, eggplant). piece_amount is the typical weight in grams or millilitres of one piece; for unit pcs give the weight of one piece in grams.",
        "8. Nutrition (kcal, protein, fat, carbs, fiber in grams) per 100 g or 100 ml for g/ml units, per piece for pcs. Use 0 for household items.",
        "9. tolerance_pct: extra percentage to buy because amounts are uncertain: fresh produce 10 to 20, herbs 20, meat, rice, pasta, dairy 0 to 5.",
        "10. shelf_days: typical days it keeps at home after buying in normal storage. 0 if unknown.",
        "11. icon: the best matching icon name from this allowed list, exactly as written: " + ", ".join(ICON_NAMES) + ".",
    ]
    return "\n".join(lines)


def _valid_number(value, low, high):
    return isinstance(value, (int, float)) and low <= value <= high


def run_ingredient(ingredient_id):
    ingredient = db.row("SELECT * FROM ingredients WHERE id = ?", (ingredient_id,))
    if not ingredient or ingredient["status"] == "ready":
        return
    existing = db.rows(
        "SELECT id, raw_name, name_en, name_fa FROM ingredients WHERE id != ? AND status = 'ready' AND archived = 0 ORDER BY id",
        (ingredient_id,),
    )
    answer = generate(_ingredient_prompt(ingredient, existing), INGREDIENT_SCHEMA)
    if not answer.get("understood"):
        with db.tx() as c:
            c.execute(
                "UPDATE ingredients SET status = 'unresolved', ai_error = ? WHERE id = ?",
                ("The assistant could not tell what this is. Edit it by hand.", ingredient_id),
            )
        return
    target = answer.get("same_as_id") or 0
    if target and db.scalar("SELECT 1 FROM ingredients WHERE id = ? AND archived = 0", (target,)):
        with db.tx() as c:
            names.add_alias(c, target, ingredient["raw_name"])
            for alias in answer.get("aliases") or []:
                names.add_alias(c, target, alias)
            services.merge_ingredients(c, ingredient_id, target)
            services.refresh_open_list(c)
        return
    unit = answer.get("unit")
    if ingredient["unit_locked"]:
        unit = ingredient["unit"]
    if unit not in ("g", "ml", "pcs") or answer.get("category") not in CATEGORIES or answer.get("kind") not in KINDS:
        raise AIError("Invalid classification", retry_after=600)
    if not (answer.get("name_en") or "").strip():
        raise AIError("Missing English name", retry_after=600)
    piece = answer.get("piece_amount")
    piece = piece if _valid_number(piece, 0.5, 20000) else None
    nutrition_limit = 2000 if unit == "pcs" else 900
    nutrition = {}
    valid = True
    for key, limit in (
        ("kcal", nutrition_limit),
        ("protein", 100 if unit != "pcs" else 500),
        ("fat", 100 if unit != "pcs" else 500),
        ("carbs", 100 if unit != "pcs" else 500),
        ("fiber", 100 if unit != "pcs" else 200),
    ):
        value = answer.get(key)
        if not _valid_number(value, 0, limit):
            valid = False
        nutrition[key] = value
    if unit != "pcs" and valid and nutrition["protein"] + nutrition["fat"] + nutrition["carbs"] > 101:
        valid = False
    if not valid:
        nutrition = dict.fromkeys(nutrition)
    tolerance = answer.get("tolerance_pct")
    tolerance = tolerance if _valid_number(tolerance, 0, 50) else 0
    shelf = answer.get("shelf_days")
    shelf = shelf if isinstance(shelf, int) and 0 < shelf <= 3650 else None
    icon = answer.get("icon") if answer.get("icon") in ICON_NAMES else CATEGORY_ICONS.get(answer["category"], "package")
    with db.tx() as c:
        c.execute(
            """UPDATE ingredients SET name_en = ?, name_fa = ?, name_de = ?, category = ?, kind = ?, unit = ?, sold_by_piece = ?,
               piece_amount = ?, kcal = ?, protein = ?, fat = ?, carbs = ?, fiber = ?, tolerance_pct = ?, shelf_days = ?, icon = ?,
               status = 'ready', ai_error = NULL, updated_at = datetime('now') WHERE id = ?""",
            (
                answer["name_en"].strip(),
                (answer.get("name_fa") or "").strip() or None,
                (answer.get("name_de") or "").strip() or None,
                answer["category"],
                answer["kind"],
                unit,
                1 if answer.get("sold_by_piece") else 0,
                piece,
                nutrition["kcal"],
                nutrition["protein"],
                nutrition["fat"],
                nutrition["carbs"],
                nutrition["fiber"],
                tolerance,
                shelf,
                icon,
                ingredient_id,
            ),
        )
        for alias in [answer["name_en"], answer.get("name_fa"), answer.get("name_de")] + list(answer.get("aliases") or [])[:8]:
            if alias:
                names.add_alias(c, ingredient_id, alias)
        services.convert_pending_batches(c, ingredient_id)
        if shelf:
            c.execute(
                "UPDATE batches SET expires_at = date(purchased_at, ?) WHERE ingredient_id = ? AND expires_at IS NULL",
                ("+" + str(shelf) + " days", ingredient_id),
            )
        services.refresh_open_list(c)


RECIPE_SCHEMA = {
    "type": "object",
    "properties": {
        "understood": {"type": "boolean"},
        "name_en": {"type": "string"},
        "name_fa": {"type": "string"},
        "name_de": {"type": "string"},
        "description": {"type": "string"},
        "tags": {"type": "array", "items": {"type": "string"}},
        "cook_minutes": {"type": "integer"},
        "image_query": {"type": "string"},
    },
    "required": ["understood", "name_en", "name_fa", "name_de", "description", "tags", "cook_minutes", "image_query"],
}


def run_recipe(recipe_id):
    recipe = db.row("SELECT * FROM recipes WHERE id = ?", (recipe_id,))
    if not recipe:
        return
    items = db.rows(
        "SELECT ri.amount, ri.unit, i.raw_name, i.name_en FROM recipe_items ri JOIN ingredients i ON i.id = ri.ingredient_id WHERE ri.recipe_id = ? AND ri.is_default = 1",
        (recipe_id,),
    )
    ingredient_text = ", ".join(
        str(item["name_en"] or item["raw_name"]) + " " + ("{:g}".format(item["amount"])) + " " + item["unit"] for item in items
    )
    prompt = "\n".join(
        [
            "You describe dishes for a household meal planner. The household is Persian, living in Germany, and types dish names in Persian, Finglish, German or English.",
            "Dish name as typed: " + json.dumps(recipe["raw_name"], ensure_ascii=False),
            "Ingredients per person: " + ingredient_text,
            "Return:",
            "name_en: the well known English or international name of the dish (keep established Persian dish names in Latin transliteration, for example Loobia Polo, Ghormeh Sabzi).",
            "name_fa: the dish name in Persian script.",
            "name_de: the name a German speaker would use for this dish; keep established Persian names in Latin letters, translate generic dishes (for example Hähnchen Pita Sandwich).",
            "description: two short sentences in English on how it is cooked.",
            "tags: 2 to 5 lowercase tags from cuisine, meal type and character, for example persian, quick, high protein, vegetarian, rice, stew.",
            "cook_minutes: realistic total cooking time.",
            "image_query: a short English description of the dish in two to four plain words, for example 'green bean rice' for loobia polo. name_en must be the commonly used name of the dish, for example 'Loobia Polo'.",
            "If you cannot identify the dish, set understood to false and still return a neutral English name built from the typed name.",
        ]
    )
    answer = generate(prompt, RECIPE_SCHEMA)
    tags = [str(tag).strip().lower() for tag in (answer.get("tags") or []) if str(tag).strip()][:6]
    minutes = answer.get("cook_minutes")
    minutes = minutes if isinstance(minutes, int) and 1 <= minutes <= 1440 else None
    with db.tx() as c:
        if answer.get("understood"):
            c.execute(
                "UPDATE recipes SET name_en = ?, name_fa = ?, name_de = ?, description = ?, tags = ?, cook_minutes = ?, image_query = ?, status = 'ready', ai_error = NULL WHERE id = ?",
                (
                    (answer.get("name_en") or "").strip() or None,
                    (answer.get("name_fa") or "").strip() or None,
                    (answer.get("name_de") or "").strip() or None,
                    (answer.get("description") or "").strip() or None,
                    json.dumps(tags),
                    minutes,
                    (answer.get("image_query") or "").strip() or recipe["raw_name"],
                    recipe_id,
                ),
            )
        else:
            c.execute(
                "UPDATE recipes SET status = 'unresolved', image_query = ?, ai_error = ? WHERE id = ?",
                ((answer.get("image_query") or recipe["raw_name"]).strip(), "The assistant did not recognise this dish.", recipe_id),
            )
        if recipe["image_status"] in ("none", "searching"):
            c.execute("UPDATE recipes SET image_status = 'searching' WHERE id = ?", (recipe_id,))
            services.enqueue(c, "images", recipe_id)


def run_images(recipe_id):
    from . import images

    recipe = db.row("SELECT * FROM recipes WHERE id = ?", (recipe_id,))
    if not recipe:
        return
    candidates = images.search_recipe(recipe)
    with db.tx() as c:
        c.execute(
            "UPDATE recipes SET image_candidates = ?, image_status = ? WHERE id = ?",
            (json.dumps(candidates), "choosing" if candidates else "none_found", recipe_id),
        )
    if candidates and not recipe.get("image_path"):
        for candidate in candidates[:4]:
            try:
                path = images.download(recipe_id, candidate["url"])
            except Exception as error:
                log.warning("Automatic photo for recipe %s failed: %s", recipe_id, error)
                continue
            with db.tx() as c:
                c.execute(
                    "UPDATE recipes SET image_path = ?, image_source = ?, image_status = 'set' WHERE id = ?",
                    (path, json.dumps(candidate), recipe_id),
                )
            break


HANDLERS = {"ingredient": run_ingredient, "recipe": run_recipe, "images": run_images}


def model_status():
    usage = _usage_today()["models"]
    now = time.time()
    result = []
    for name in models():
        entry = usage.get(name, {})
        result.append(
            {
                "name": name,
                "blocked_seconds": max(0, int(_model_blocked.get(name, 0) - now)),
                "ok_today": entry.get("ok", 0),
                "limited_today": entry.get("limited", 0),
                "failed_today": entry.get("failed", 0),
                "last_error": _model_errors.get(name),
            }
        )
    return result


def available_models():
    request = urllib.request.Request(GEMINI_BASE + "/models?pageSize=200", headers={"x-goog-api-key": api_key()})
    with urllib.request.urlopen(request, timeout=30) as response:
        body = json.loads(response.read().decode("utf-8"))
    names_found = []
    for entry in body.get("models", []):
        name = entry.get("name", "").split("/")[-1]
        if "generateContent" in entry.get("supportedGenerationMethods", []) and name.startswith("gemini"):
            names_found.append({"name": name, "label": entry.get("displayName") or name})
    return names_found


def update_settings(data):
    with db.tx() as c:
        if "api_key" in data:
            db.set_setting("gemini_api_key", (data.get("api_key") or "").strip(), c)
            _model_blocked.clear()
            _model_unavailable.clear()
            _model_errors.clear()
        if "models" in data:
            models_value = data.get("models") or []
            if not isinstance(models_value, list) or not all(isinstance(entry, str) for entry in models_value):
                raise services.ServiceError("Models must be a list of model names")
            chosen = [entry.strip() for entry in models_value if entry.strip()]
            db.set_setting("gemini_models", ",".join(chosen), c)
            _model_blocked.clear()
            _model_unavailable.clear()
        if "enabled" in data:
            db.set_setting("ai_enabled", "1" if data.get("enabled") else "0", c)
    _state["cooldown_until"] = 0
    wake()
    return status()


def test_model(name):
    started = time.time()
    payload = {"contents": [{"role": "user", "parts": [{"text": "Answer with the word ok."}]}]}
    try:
        _call(name, payload, 60)
        _count(name, "ok")
        _model_blocked.pop(name, None)
        _model_unavailable.discard(name)
        _model_errors.pop(name, None)
        return {"ok": True, "seconds": round(time.time() - started, 1)}
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")
        _count(name, "limited" if error.code == 429 else "failed")
        message = str(error.code) + ": " + re.sub(r"\s+", " ", detail)[:240]
        _model_errors[name] = message
        if error.code == 429:
            _model_blocked[name] = time.time() + _retry_seconds(detail, 600)
        return {"ok": False, "error": message}
    except Exception as error:
        _model_errors[name] = str(error)[:200]
        return {"ok": False, "error": str(error)[:200]}


def status():
    key = api_key()
    return {
        "enabled": enabled(),
        "key_source": key_source(),
        "key_hint": ("..." + key[-4:]) if len(key) > 8 else None,
        "models": model_status(),
        "key_set": bool(key),
        "model": model(),
        "queued": db.scalar("SELECT COUNT(*) FROM ai_jobs WHERE status = 'queued'"),
        "last_error": _state["last_error"],
        "last_ok": _state["last_ok"],
        "cooldown_seconds": max(0, int(_state["cooldown_until"] - time.time())),
    }


def wake():
    _wake.set()


def process_one():
    if not enabled():
        return False
    if time.time() < _state["cooldown_until"]:
        return False
    job = db.row("SELECT * FROM ai_jobs WHERE status = 'queued' AND next_at <= datetime('now') ORDER BY next_at, id LIMIT 1")
    if not job:
        return False
    handler = HANDLERS.get(job["kind"])
    try:
        if handler is None:
            raise AIError("Unknown job", permanent=True)
        handler(job["target_id"])
    except AIError as error:
        attempts = job["attempts"] + 1
        delay = min(MAX_BACKOFF, (error.retry_after or 300) * (2 ** min(attempts - 1, 5)))
        _state["last_error"] = str(error)
        if job["kind"] in ("ingredient",) and db.scalar("SELECT status FROM ingredients WHERE id = ?", (job["target_id"],)) == "pending":
            with db.tx() as c:
                c.execute("UPDATE ingredients SET ai_error = ? WHERE id = ?", (str(error), job["target_id"]))
        with db.tx() as c:
            if error.permanent:
                c.execute("DELETE FROM ai_jobs WHERE id = ?", (job["id"],))
            else:
                c.execute(
                    "UPDATE ai_jobs SET attempts = ?, error = ?, next_at = datetime('now', ?) WHERE id = ?",
                    (attempts, str(error), "+" + str(int(delay)) + " seconds", job["id"]),
                )
        if error.retry_after and "quota" in str(error).lower():
            _state["cooldown_until"] = time.time() + error.retry_after
        log.warning("AI job %s %s failed: %s", job["kind"], job["target_id"], error)
        return False
    except Exception as error:
        log.exception("AI job %s %s crashed", job["kind"], job["target_id"])
        with db.tx() as c:
            c.execute(
                "UPDATE ai_jobs SET attempts = attempts + 1, error = ?, next_at = datetime('now', '+1800 seconds') WHERE id = ?",
                (str(error)[:300], job["id"]),
            )
        return False
    with db.tx() as c:
        c.execute("DELETE FROM ai_jobs WHERE id = ?", (job["id"],))
    _state["last_ok"] = services.iso_now()
    _state["last_error"] = None
    return True


def worker(stop_event):
    while not stop_event.is_set():
        try:
            worked = process_one()
        except Exception:
            log.exception("AI worker loop error")
            worked = False
        if worked:
            time.sleep(4)
        else:
            _wake.wait(15)
            _wake.clear()
