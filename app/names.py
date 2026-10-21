import difflib
import re
import unicodedata

from . import db

_ARABIC_MAP = str.maketrans({"ي": "ی", "ك": "ک", "ة": "ه", "ۀ": "ه", "أ": "ا", "إ": "ا", "آ": "ا", "‌": " "})


def normalize(text):
    if not text:
        return ""
    value = unicodedata.normalize("NFKC", str(text)).translate(_ARABIC_MAP).lower()
    value = "".join(char for char in unicodedata.normalize("NFKD", value) if not unicodedata.combining(char))
    value = value.replace("ß", "ss")
    value = re.sub(r"[^\w\s]", " ", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value


def compact(text):
    return normalize(text).replace(" ", "")


def known_names():
    entries = []
    for alias in db.rows(
        "SELECT a.alias, a.ingredient_id FROM aliases a JOIN ingredients i ON i.id = a.ingredient_id WHERE i.archived = 0"
    ):
        entries.append((alias["alias"], alias["ingredient_id"]))
    return entries


def match_ingredient(text, threshold=0.88):
    key = normalize(text)
    if not key:
        return None
    exact = db.scalar(
        "SELECT a.ingredient_id FROM aliases a JOIN ingredients i ON i.id = a.ingredient_id WHERE a.alias = ? AND i.archived = 0",
        (key,),
    )
    if exact:
        return exact
    squeezed = key.replace(" ", "")
    best_id = None
    best_score = 0.0
    for alias, ingredient_id in known_names():
        if alias.replace(" ", "") == squeezed:
            return ingredient_id
        score = difflib.SequenceMatcher(None, squeezed, alias.replace(" ", "")).ratio()
        if score > best_score:
            best_score = score
            best_id = ingredient_id
    if best_score >= threshold and len(squeezed) >= 4:
        return best_id
    return None


def add_alias(connection, ingredient_id, text):
    key = normalize(text)
    if not key:
        return
    connection.execute(
        "INSERT INTO aliases(alias, ingredient_id) VALUES (?, ?) ON CONFLICT(alias) DO NOTHING",
        (key, ingredient_id),
    )


def match_recipe(text, threshold=0.82):
    key = compact(text)
    if not key:
        return None
    best_id = None
    best_score = 0.0
    for recipe in db.rows("SELECT id, raw_name, name_en, name_fa, name_de FROM recipes WHERE archived = 0"):
        for candidate in (recipe["raw_name"], recipe["name_en"], recipe["name_fa"], recipe["name_de"]):
            other = compact(candidate)
            if not other:
                continue
            if other == key:
                return recipe["id"]
            score = difflib.SequenceMatcher(None, key, other).ratio()
            if score > best_score:
                best_score = score
                best_id = recipe["id"]
    return best_id if best_score >= threshold else None


def search(text, limit=8):
    key = normalize(text)
    squeezed = key.replace(" ", "")
    if not squeezed:
        return []
    scores = {}
    for alias, ingredient_id in known_names():
        flat = alias.replace(" ", "")
        if flat.startswith(squeezed) or alias.startswith(key):
            score = 1.0 + len(squeezed) / max(len(flat), 1)
        elif squeezed in flat:
            score = 0.9
        else:
            score = difflib.SequenceMatcher(None, squeezed, flat).ratio()
        if score > scores.get(ingredient_id, 0):
            scores[ingredient_id] = score
    ranked = sorted((entry for entry in scores.items() if entry[1] >= 0.6), key=lambda entry: -entry[1])
    return [ingredient_id for ingredient_id, _ in ranked[:limit]]
