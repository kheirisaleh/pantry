import base64
import os
import threading
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

from cryptography import x509
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding

from . import db, names, services

_cert_cache = {}
_cache_lock = threading.Lock()
MAX_SKEW_SECONDS = 150


class AlexaRejected(Exception):
    pass


def _skill_id():
    return (db.get_setting("alexa_skill_id") or os.environ.get("ALEXA_SKILL_ID") or "").strip()


def _valid_cert_url(url):
    parsed = urllib.parse.urlparse(url or "")
    if parsed.scheme.lower() != "https" or (parsed.hostname or "").lower() != "s3.amazonaws.com":
        return False
    if parsed.port not in (None, 443):
        return False
    path = os.path.normpath(parsed.path)
    return path.startswith("/echo.api/")


def _roots():
    import certifi

    with open(certifi.where(), "rb") as handle:
        return x509.load_pem_x509_certificates(handle.read())


def _load_chain(url):
    with _cache_lock:
        cached = _cert_cache.get(url)
        if cached and cached[0] > time.time():
            return cached[1]
    with urllib.request.urlopen(url, timeout=10) as response:
        pem = response.read()
    chain = x509.load_pem_x509_certificates(pem)
    if not chain:
        raise AlexaRejected("empty certificate chain")
    from cryptography.x509.verification import PolicyBuilder, Store
    from cryptography.x509 import DNSName

    verifier = PolicyBuilder().store(Store(_roots())).time(datetime.now(timezone.utc)).build_server_verifier(DNSName("echo-api.amazon.com"))
    verifier.verify(chain[0], chain[1:])
    leaf = chain[0]
    with _cache_lock:
        _cert_cache[url] = (time.time() + 3600, leaf)
    return leaf


def verify(headers, body, payload):
    if not _skill_id():
        raise AlexaRejected("ALEXA_SKILL_ID is not configured")
    url = headers.get("signaturecertchainurl")
    signature = headers.get("signature-256")
    if not url or not signature or not _valid_cert_url(url):
        raise AlexaRejected("missing or invalid signature headers")
    try:
        leaf = _load_chain(url)
    except AlexaRejected:
        raise
    except Exception as error:
        raise AlexaRejected("certificate check failed: " + str(error)) from error
    try:
        leaf.public_key().verify(base64.b64decode(signature), body, padding.PKCS1v15(), hashes.SHA256())
    except Exception as error:
        raise AlexaRejected("signature mismatch") from error
    stamp = (payload.get("request") or {}).get("timestamp") or ""
    try:
        moment = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    except ValueError as error:
        raise AlexaRejected("bad timestamp") from error
    if abs((datetime.now(timezone.utc) - moment).total_seconds()) > MAX_SKEW_SECONDS:
        raise AlexaRejected("stale request")
    application = (((payload.get("context") or {}).get("System") or {}).get("application") or {}).get("applicationId") \
        or ((payload.get("session") or {}).get("application") or {}).get("applicationId")
    if application != _skill_id():
        raise AlexaRejected("unknown skill")



from datetime import date as date_type, timedelta

from . import logic

TEXT = {
    "en": {
        "welcome": "Pantry here. You can read or add to the shopping list, plan a dish, or ask what is planned.",
        "help": "Try: what is on the shopping list. Add rice to the shopping list. Plan ghormeh sabzi for tomorrow. What is planned on Friday. Do we have eggs. I cooked adas polo. Which dishes do we have.",
        "reprompt": "What would you like to do?",
        "bye": "Bye.",
        "fallback": "Sorry, I did not get that. Say help to hear what I can do.",
        "what_item": "Which item should I add?",
        "what_dish": "Which dish?",
        "how_much_pcs": "How many {item}?",
        "how_much": "How much {item}? For example 500 grams, 2 pieces or one pack.",
        "which_unit": "{amount} what? Grams, kilos, liters, pieces or packs?",
        "added_qty": "Added {qty} {item} to the shopping list.",
        "added_note": "Added {item} to the shopping list, {note}.",
        "added_plain": "Added {item} to the shopping list without an amount.",
        "anything_else": " Anything else?",
        "unknown_item": "I do not know {item} yet. You can add it to the shopping list first.",
        "have": "We have about {qty} of {item}.",
        "have_none": "We have no {item} left.",
        "have_unknown": "{item} is known, but its amount is still being worked out.",
        "list_empty": "The shopping list is empty.",
        "list_intro": "{count} things on the shopping list: {items}.",
        "list_more": " And {count} more, open the app to see them.",
        "nothing_day": "Nothing is planned for {day}.",
        "planned_day": "Planned for {day}: {meals}.",
        "cooked_day": "Cooked {day}: {meals}.",
        "which_day": "For which day should I plan {dish}?",
        "planned": "Planned {dish} for {day}, for {n} people.",
        "cooked": "Noted. {dish} is cooked and the pantry is updated.",
        "cooked_short": "Noted. {dish} is cooked. Some ingredients were not in the pantry: {missing}.",
        "unknown_dish": "I could not find a dish called {dish}. Your dishes include {examples}.",
        "dishes": "You have {count} dishes: {names}.",
        "ran_out": "Got it, {item} is marked as used up.",
        "tomorrow_none": "Nothing is planned for tomorrow yet.",
        "tomorrow_ok": "Tomorrow you have {dishes}, and everything is at home.",
        "tomorrow_short": "For {dish} tomorrow you are missing {items}. Better buy them today or tomorrow morning.",
        "tomorrow_add": " Should I put them on the shopping list?",
        "tomorrow_added": "Done, the missing items are on the shopping list.",
        "past_day": "That day is in the past. Which day should it be?",
        "and": "and",
        "for_n": "for {n}",
        "today": "today",
        "tomorrow": "tomorrow",
        "piece": "piece", "pieces": "pieces", "gram": "grams", "kilo": "kilos", "ml": "milliliters", "liter": "liters", "pack": "pack", "packs": "packs",
    },
    "de": {
        "welcome": "Hier ist die Speisekammer. Du kannst die Einkaufsliste hören oder ergänzen, ein Gericht planen oder fragen, was geplant ist.",
        "help": "Zum Beispiel: was steht auf der Einkaufsliste. Setze Reis auf die Einkaufsliste. Plane Ghormeh Sabzi für morgen. Was ist am Freitag geplant. Haben wir Eier. Ich habe Adas Polo gekocht. Welche Gerichte haben wir.",
        "reprompt": "Was möchtest du tun?",
        "bye": "Tschüss.",
        "fallback": "Das habe ich nicht verstanden. Sag Hilfe, um zu hören, was ich kann.",
        "what_item": "Was soll ich auf die Liste setzen?",
        "what_dish": "Welches Gericht?",
        "how_much_pcs": "Wie viele {item}?",
        "how_much": "Wie viel {item}? Zum Beispiel 500 Gramm, 2 Stück oder eine Packung.",
        "which_unit": "{amount} was? Gramm, Kilo, Liter, Stück oder Packungen?",
        "added_qty": "{qty} {item} stehen auf der Einkaufsliste.",
        "added_note": "{item} steht auf der Einkaufsliste, {note}.",
        "added_plain": "{item} steht ohne Menge auf der Einkaufsliste.",
        "anything_else": " Noch etwas?",
        "unknown_item": "{item} kenne ich noch nicht. Setz es zuerst auf die Einkaufsliste.",
        "have": "Wir haben ungefähr {qty} {item}.",
        "have_none": "Wir haben kein {item} mehr.",
        "have_unknown": "{item} ist bekannt, aber die Menge wird noch berechnet.",
        "list_empty": "Die Einkaufsliste ist leer.",
        "list_intro": "{count} Sachen auf der Einkaufsliste: {items}.",
        "list_more": " Und {count} weitere, schau in die App.",
        "nothing_day": "Für {day} ist nichts geplant.",
        "planned_day": "Für {day} geplant: {meals}.",
        "cooked_day": "{day} gekocht: {meals}.",
        "which_day": "Für welchen Tag soll ich {dish} planen?",
        "planned": "{dish} ist für {day} geplant, für {n} Personen.",
        "cooked": "Notiert. {dish} ist gekocht und der Vorrat ist aktualisiert.",
        "cooked_short": "Notiert. {dish} ist gekocht. Einige Zutaten waren nicht im Vorrat: {missing}.",
        "unknown_dish": "Ich habe kein Gericht namens {dish} gefunden. Deine Gerichte sind zum Beispiel {examples}.",
        "dishes": "Du hast {count} Gerichte: {names}.",
        "ran_out": "Alles klar, {item} ist als aufgebraucht markiert.",
        "tomorrow_none": "Für morgen ist noch nichts geplant.",
        "tomorrow_ok": "Morgen gibt es {dishes}, und alles ist zu Hause.",
        "tomorrow_short": "Für {dish} morgen fehlen {items}. Am besten heute oder morgen früh einkaufen.",
        "tomorrow_add": " Soll ich sie auf die Einkaufsliste setzen?",
        "tomorrow_added": "Erledigt, die fehlenden Sachen stehen auf der Einkaufsliste.",
        "past_day": "Der Tag ist schon vorbei. Für welchen Tag?",
        "and": "und",
        "for_n": "für {n}",
        "today": "heute",
        "tomorrow": "morgen",
        "piece": "Stück", "pieces": "Stück", "gram": "Gramm", "kilo": "Kilo", "ml": "Milliliter", "liter": "Liter", "pack": "Packung", "packs": "Packungen",
    },
}

UNIT_WORDS = {
    "g": ["gram", "grams", "gramm", "gramme", "g"],
    "kg": ["kilo", "kilos", "kilogram", "kilograms", "kilogramm", "kg"],
    "ml": ["milliliter", "milliliters", "millilitre", "ml"],
    "l": ["liter", "liters", "litre", "litres", "l"],
    "pcs": ["piece", "pieces", "stück", "stueck", "stuck", "pcs", "one", "ones", "mal"],
    "pack": ["pack", "packs", "package", "packages", "packet", "packets", "packung", "packungen", "packerl", "jar", "jars", "glas", "gläser",
             "can", "cans", "dose", "dosen", "bottle", "bottles", "flasche", "flaschen", "bag", "bags", "tüte", "tüten", "beutel", "box", "boxes", "karton"],
}
WEEKDAYS = {
    "en": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
    "de": ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"],
}


def _lang(payload):
    locale = ((payload.get("request") or {}).get("locale") or "en-US").lower()
    return "de" if locale.startswith("de") else "en"


def _num(value):
    return ("%g" % round(value, 1)).replace(".", ",") if False else "%g" % round(value, 1)


def _speak_qty(qty, unit, lang):
    text = TEXT[lang]
    if unit == "pcs":
        return _num(qty) + " " + (text["piece"] if qty == 1 else text["pieces"])
    if qty >= 1000:
        return _num(qty / 1000.0) + " " + (text["kilo"] if unit == "g" else text["liter"])
    return "%g" % round(qty) + " " + (text["gram"] if unit == "g" else text["ml"])


def _join(parts, lang):
    parts = [part for part in parts if part]
    if len(parts) <= 1:
        return "".join(parts)
    return ", ".join(parts[:-1]) + " " + TEXT[lang]["and"] + " " + parts[-1]


def _response(text, end=True, reprompt=None, attributes=None):
    response = {"outputSpeech": {"type": "PlainText", "text": text}, "shouldEndSession": end}
    if reprompt:
        response["reprompt"] = {"outputSpeech": {"type": "PlainText", "text": reprompt}}
    result = {"version": "1.0", "response": response}
    if attributes is not None:
        result["sessionAttributes"] = attributes
    return result


def _ask(text, attributes=None):
    return _response(text, end=False, reprompt=text, attributes=attributes or {})


def _slot(intent, name):
    slot = (intent.get("slots") or {}).get(name) or {}
    resolutions = ((slot.get("resolutions") or {}).get("resolutionsPerAuthority") or [])
    for authority in resolutions:
        if (authority.get("status") or {}).get("code") == "ER_SUCCESS_MATCH":
            values = authority.get("values") or []
            if values:
                return (values[0]["value"].get("name") or "").strip() or (slot.get("value") or "").strip()
    return (slot.get("value") or "").strip()


def _ingredient_label(ingredient_id, lang):
    ingredient = db.row("SELECT * FROM ingredients WHERE id = ?", (ingredient_id,))
    if not ingredient:
        return ""
    if lang == "de" and ingredient.get("name_de"):
        return ingredient["name_de"]
    return ingredient.get("name_en") or ingredient["raw_name"]


def _recipe_label(recipe, lang):
    if lang == "de" and recipe.get("name_de"):
        return recipe["name_de"]
    return recipe.get("name_en") or recipe.get("raw_name")


def _parse_unit(word):
    word = (word or "").strip().lower()
    if not word:
        return None
    for unit, words in UNIT_WORDS.items():
        if word in words:
            return unit
    for unit, words in UNIT_WORDS.items():
        if any(word.startswith(entry) for entry in words if len(entry) > 2):
            return unit
    return None


def _parse_amount(value):
    if value in (None, "", "?"):
        return None
    try:
        number = float(str(value).replace(",", "."))
    except ValueError:
        return None
    return number if number > 0 else None


def _parse_date(value, lang):
    value = (value or "").strip()
    if not value:
        return None
    try:
        return date_type.fromisoformat(value)
    except ValueError:
        pass
    if "-W" in value:
        try:
            year, week = value.split("-W")[0], value.split("-W")[1][:2]
            return date_type.fromisocalendar(int(year), int(week), 1)
        except ValueError:
            return None
    return None


def _day_name(day, lang):
    today = services.today()
    if day == today:
        return TEXT[lang]["today"]
    if day == today + timedelta(days=1):
        return TEXT[lang]["tomorrow"]
    name = WEEKDAYS[lang][day.weekday()]
    if 0 < (day - today).days < 7:
        return name
    if lang == "de":
        return name + ", den " + str(day.day) + "." + str(day.month) + "."
    return name + " the " + str(day.day) + ("th" if 10 < day.day % 100 < 14 else {1: "st", 2: "nd", 3: "rd"}.get(day.day % 10, "th"))


def _add_item(item, amount, unit_word, lang, ingredient_id=None):
    text = TEXT[lang]
    unit = _parse_unit(unit_word)
    data = {"ingredient_id": ingredient_id} if ingredient_id else {"name": item}
    ingredient = db.row("SELECT * FROM ingredients WHERE id = ?", (ingredient_id,)) if ingredient_id else None
    base = (ingredient or {}).get("unit") or "g"
    spoken = None
    if amount is not None:
        if unit is None and base == "pcs":
            unit = "pcs"
        if unit in ("g", "kg"):
            data.update(qty=amount * (1000 if unit == "kg" else 1), unit="g" if base != "ml" else "ml")
            spoken = _speak_qty(data["qty"], data["unit"], lang)
        elif unit in ("ml", "l"):
            data.update(qty=amount * (1000 if unit == "l" else 1), unit="ml" if base != "g" else "g")
            spoken = _speak_qty(data["qty"], data["unit"], lang)
        elif unit == "pcs":
            data.update(qty=amount, unit="pcs")
            spoken = _speak_qty(amount, "pcs", lang)
        elif unit == "pack":
            package = (ingredient or {}).get("package_amount")
            if package:
                data.update(qty=amount * float(package), unit=base)
            data["note"] = _num(amount) + " " + (text["pack"] if amount == 1 else text["packs"])
            spoken = data["note"]
    try:
        result = services.add_list_item(dict(data, source="alexa"))
    except services.ServiceError:
        data.pop("qty", None)
        data.pop("unit", None)
        data["note"] = spoken
        result = services.add_list_item(dict(data, source="alexa"))
    added = next((entry for entry in result["list"]["items"] if entry["id"] == result["item_id"]), None)
    label = item
    if added and added["ingredient"]["status"] == "ready":
        label = _ingredient_label(added["ingredient"]["id"], lang)
    if spoken and data.get("qty"):
        return text["added_qty"].format(qty=spoken, item=label)
    if spoken:
        return text["added_note"].format(item=label, note=spoken)
    return text["added_plain"].format(item=label)


def _shopping_lines(lang):
    shopping = services.get_list()
    lines = []
    for item in (shopping or {}).get("items", []):
        if item.get("checked") or item.get("committed"):
            continue
        ingredient = item["ingredient"]
        label = _ingredient_label(ingredient["id"], lang) if ingredient.get("status") == "ready" else ingredient.get("display")
        amount = ""
        if item.get("packages"):
            amount = _num(item["packages"]) + " " + (TEXT[lang]["pack"] if item["packages"] == 1 else TEXT[lang]["packs"])
        elif item.get("pieces"):
            amount = _speak_qty(item["pieces"], "pcs", lang)
        elif item.get("needed_qty"):
            amount = _speak_qty(item["needed_qty"], ingredient.get("unit") or "g", lang)
        elif item.get("note"):
            amount = item["note"]
        lines.append((label + " " + amount).strip() if lang == "de" or not amount else amount + " " + label)
    return lines


def _plan_meal(recipe_id, day, servings, lang):
    recipe = db.row("SELECT * FROM recipes WHERE id = ?", (recipe_id,))
    servings = servings or services.default_servings()
    services.add_meal({"recipe_id": recipe_id, "date": day.isoformat(), "servings": servings, "source": "alexa"})
    return TEXT[lang]["planned"].format(dish=_recipe_label(recipe, lang), day=_day_name(day, lang), n=_num(servings))


def _examples(lang, limit=4):
    rows = db.rows("SELECT * FROM recipes WHERE archived = 0 ORDER BY id DESC LIMIT ?", (limit,))
    return _join([_recipe_label(row, lang) for row in rows], lang)


def _day_report(day, lang):
    text = TEXT[lang]
    meals = db.rows(
        "SELECT m.servings, m.status, r.* FROM meals m JOIN recipes r ON r.id = m.recipe_id WHERE m.date = ? ORDER BY m.position",
        (day.isoformat(),),
    )
    name = _day_name(day, lang)
    planned = [_recipe_label(meal, lang) + " " + text["for_n"].format(n=_num(meal["servings"])) for meal in meals if meal["status"] == "planned"]
    cooked = [_recipe_label(meal, lang) for meal in meals if meal["status"] == "cooked"]
    parts = []
    if planned:
        parts.append(text["planned_day"].format(day=name, meals=_join(planned, lang)))
    if cooked:
        parts.append(text["cooked_day"].format(day=name.capitalize(), meals=_join(cooked, lang)))
    return " ".join(parts) if parts else text["nothing_day"].format(day=name)


def tomorrow_speech(lang):
    text = TEXT[lang]
    day = services.today() + timedelta(days=1)
    report = services.shortages_for(day.isoformat(), lang)
    if not report:
        return text["tomorrow_none"], []
    short = [entry for entry in report if not entry["feasible"]]
    if not short:
        return text["tomorrow_ok"].format(dishes=_join([entry["dish"] for entry in report], lang)), []
    parts = []
    ids = []
    for entry in short:
        items = []
        for missing in entry["missing"]:
            ids.append(missing["ingredient_id"])
            if missing.get("packages"):
                amount = _num(missing["packages"]) + " " + (text["pack"] if missing["packages"] == 1 else text["packs"])
            else:
                amount = _speak_qty(missing["missing_qty"], missing["unit"], lang)
            items.append((missing["name"] + " " + amount) if lang == "de" else (amount + " " + missing["name"]))
        parts.append(text["tomorrow_short"].format(dish=entry["dish"], items=_join(items, lang)))
    return " ".join(parts), ids


def handle(payload):
    lang = _lang(payload)
    text = TEXT[lang]
    request = payload.get("request") or {}
    attributes = dict((payload.get("session") or {}).get("attributes") or {})
    pending = attributes.get("pending")
    kind = request.get("type")
    if kind == "LaunchRequest":
        return _ask(text["welcome"])
    if kind == "SessionEndedRequest":
        return {"version": "1.0", "response": {}}
    if kind != "IntentRequest":
        return _response(text["fallback"])
    intent = request.get("intent") or {}
    name = intent.get("name")
    if name == "AMAZON.HelpIntent":
        return _ask(text["help"])
    if name in ("AMAZON.StopIntent", "AMAZON.CancelIntent", "AMAZON.NavigateHomeIntent"):
        return _response(text["bye"])
    if name == "AMAZON.YesIntent" and pending and pending.get("step") == "tomorrow_add":
        for ingredient_id in pending.get("ids") or []:
            on_list = db.scalar(
                "SELECT COUNT(*) FROM shopping_items si JOIN shopping_lists sl ON sl.id = si.list_id WHERE si.ingredient_id = ? AND si.checked = 0 AND sl.status = 'open'",
                (ingredient_id,))
            if not on_list:
                services.add_list_item({"ingredient_id": ingredient_id, "source": "alexa"})
        return _response(text["tomorrow_added"])
    if name == "TomorrowCheckIntent":
        spoken, ids = tomorrow_speech(lang)
        if ids:
            return _ask(spoken + text["tomorrow_add"], {"pending": {"step": "tomorrow_add", "ids": ids}})
        return _response(spoken)
    if name == "AMAZON.NoIntent":
        if pending and pending.get("step") in ("amount", "unit"):
            return _ask(_add_item(pending["item"], None, None, lang, pending.get("ingredient_id")) + text["anything_else"])
        return _response(text["bye"])

    if name in ("AnswerQuantityIntent", "AnswerDateIntent", "AMAZON.YesIntent") and not pending:
        return _ask(text["fallback"])

    if pending and name in ("AnswerQuantityIntent", "AddItemIntent") and pending.get("step") in ("amount", "unit"):
        amount = _parse_amount(_slot(intent, "amount")) or pending.get("amount")
        unit_word = _slot(intent, "unit")
        if amount is None:
            return _ask(text["how_much"].format(item=pending["label"]), {"pending": pending})
        ingredient = db.row("SELECT unit FROM ingredients WHERE id = ?", (pending.get("ingredient_id"),)) if pending.get("ingredient_id") else None
        if not _parse_unit(unit_word) and not (ingredient and ingredient["unit"] == "pcs"):
            return _ask(text["which_unit"].format(amount=_num(amount)), {"pending": dict(pending, step="unit", amount=amount)})
        return _ask(_add_item(pending["item"], amount, unit_word, lang, pending.get("ingredient_id")) + text["anything_else"])

    if pending and name in ("AnswerDateIntent", "PlanMealIntent", "PlanForDayIntent") and pending.get("step") == "date":
        day = _parse_date(_slot(intent, "date"), lang)
        if not day:
            return _ask(text["which_day"].format(dish=pending["label"]), {"pending": pending})
        if day < services.today():
            return _ask(text["past_day"], {"pending": pending})
        return _ask(_plan_meal(pending["recipe_id"], day, pending.get("servings"), lang) + text["anything_else"])

    if name == "AddItemIntent":
        item = _slot(intent, "item")
        if not item:
            return _ask(text["what_item"])
        amount = _parse_amount(_slot(intent, "amount"))
        unit_word = _slot(intent, "unit")
        ingredient_id = names.match_ingredient(item)
        ingredient = db.row("SELECT * FROM ingredients WHERE id = ?", (ingredient_id,)) if ingredient_id else None
        label = _ingredient_label(ingredient_id, lang) if ingredient and ingredient["status"] == "ready" else item
        state = {"step": "amount", "item": item, "label": label, "ingredient_id": ingredient_id}
        if amount is None:
            question = text["how_much_pcs"] if ingredient and ingredient["unit"] == "pcs" else text["how_much"]
            return _ask(question.format(item=label), {"pending": state})
        if not _parse_unit(unit_word) and not (ingredient and ingredient["unit"] == "pcs"):
            return _ask(text["which_unit"].format(amount=_num(amount)), {"pending": dict(state, step="unit", amount=amount)})
        return _ask(_add_item(item, amount, unit_word, lang, ingredient_id) + text["anything_else"])

    if name == "ReadListIntent":
        lines = _shopping_lines(lang)
        if not lines:
            return _ask(text["list_empty"] + text["anything_else"])
        spoken = text["list_intro"].format(count=len(lines), items=_join(lines[:20], lang))
        if len(lines) > 20:
            spoken += text["list_more"].format(count=len(lines) - 20)
        return _ask(spoken + text["anything_else"])

    if name == "PlanMealIntent":
        dish = _slot(intent, "dish")
        if not dish:
            return _ask(text["what_dish"])
        recipe_id = names.match_recipe(dish, threshold=0.72)
        if not recipe_id:
            return _ask(text["unknown_dish"].format(dish=dish, examples=_examples(lang)))
        recipe = db.row("SELECT * FROM recipes WHERE id = ?", (recipe_id,))
        servings = _parse_amount(_slot(intent, "servings"))
        day = _parse_date(_slot(intent, "date"), lang)
        state = {"step": "date", "recipe_id": recipe_id, "label": _recipe_label(recipe, lang), "servings": servings}
        if not day:
            return _ask(text["which_day"].format(dish=state["label"]), {"pending": state})
        if day < services.today():
            return _ask(text["past_day"], {"pending": state})
        return _ask(_plan_meal(recipe_id, day, servings, lang) + text["anything_else"])

    if name in ("TodayPlanIntent", "PlanForDayIntent"):
        day = _parse_date(_slot(intent, "date"), lang) or services.today()
        return _ask(_day_report(day, lang) + text["anything_else"])

    if name == "ListDishesIntent":
        rows = db.rows("SELECT * FROM recipes WHERE archived = 0 ORDER BY COALESCE(name_en, raw_name)")
        return _ask(text["dishes"].format(count=len(rows), names=_join([_recipe_label(row, lang) for row in rows[:25]], lang)) + text["anything_else"])

    if name == "CheckStockIntent":
        item = _slot(intent, "item")
        if not item:
            return _ask(text["what_item"])
        ingredient_id = names.match_ingredient(item)
        if not ingredient_id:
            return _ask(text["unknown_item"].format(item=item) + text["anything_else"])
        ingredient = db.row("SELECT * FROM ingredients WHERE id = ?", (ingredient_id,))
        label = _ingredient_label(ingredient_id, lang)
        qty = services.stock_map().get(ingredient_id, 0.0)
        if qty <= 0:
            pending_batches = db.scalar("SELECT COUNT(*) FROM batches WHERE ingredient_id = ? AND qty_remaining > 0 AND pending_unit IS NOT NULL", (ingredient_id,))
            spoken = text["have_unknown" if pending_batches else "have_none"].format(item=label)
        else:
            spoken = text["have"].format(qty=_speak_qty(qty, ingredient["unit"], lang), item=label)
        return _ask(spoken + text["anything_else"])

    if name == "CookedIntent":
        dish = _slot(intent, "dish")
        if not dish:
            return _ask(text["what_dish"])
        recipe_id = names.match_recipe(dish, threshold=0.72)
        if not recipe_id:
            return _ask(text["unknown_dish"].format(dish=dish, examples=_examples(lang)))
        today = services.today().isoformat()
        planned = db.row("SELECT id FROM meals WHERE date = ? AND recipe_id = ? AND status = 'planned' ORDER BY position LIMIT 1", (today, recipe_id))
        result = services.cook({"meal_id": planned["id"]} if planned else {"recipe_id": recipe_id, "date": today})
        label = _recipe_label(db.row("SELECT * FROM recipes WHERE id = ?", (recipe_id,)), lang)
        if result.get("shortfalls"):
            missing = _join([entry["display"] for entry in result["shortfalls"]], lang)
            return _response(text["cooked_short"].format(dish=label, missing=missing))
        return _response(text["cooked"].format(dish=label))

    if name == "RanOutIntent":
        item = _slot(intent, "item")
        if not item:
            return _ask(text["what_item"])
        ingredient_id = names.match_ingredient(item)
        if not ingredient_id:
            return _ask(text["unknown_item"].format(item=item) + text["anything_else"])
        services.used_up(ingredient_id)
        return _ask(text["ran_out"].format(item=_ingredient_label(ingredient_id, lang)) + text["anything_else"])

    return _ask(text["fallback"])


UTTERANCES = {
    "en": {
        "AddItemIntent": ["add {item} to the shopping list", "add {item}", "put {item} on the list", "put {item} on the shopping list",
                          "we need {item}", "add {amount} {unit} of {item}", "add {amount} {unit} {item}", "add {amount} {item}",
                          "put {amount} {unit} of {item} on the list", "we need {amount} {unit} of {item}", "buy {item}", "buy {amount} {unit} of {item}"],
        "AnswerQuantityIntent": ["{amount}", "{amount} {unit}", "{unit}", "{amount} of them", "about {amount} {unit}", "just {amount}", "only {amount} {unit}"],
        "AnswerDateIntent": ["{date}", "for {date}", "on {date}", "make it {date}"],
        "ReadListIntent": ["what is on the shopping list", "read the shopping list", "read the list", "what do we need to buy", "what is on the list", "what do I need to buy"],
        "PlanMealIntent": ["plan {dish}", "plan {dish} for {date}", "plan {dish} on {date}", "add {dish} to the plan", "add {dish} to the plan for {date}",
                           "put {dish} on {date}", "we will cook {dish} {date}", "cook {dish} on {date}", "plan {dish} for {servings} people on {date}",
                           "plan {dish} for {date} for {servings} people"],
        "PlanForDayIntent": ["what is planned for {date}", "what is planned on {date}", "what are we eating {date}", "what do we cook {date}", "what is the plan for {date}"],
        "TodayPlanIntent": ["what is planned today", "what are we eating today", "what is for dinner", "what is the plan today", "what do we cook today"],
        "ListDishesIntent": ["which dishes do we have", "what dishes do we have", "list our dishes", "what can we cook"],
        "TomorrowCheckIntent": ["what is missing for tomorrow", "do we have everything for tomorrow", "what do I need for tomorrow", "check tomorrow", "is anything missing for tomorrow"],
        "CheckStockIntent": ["do we have {item}", "do we still have {item}", "how much {item} do we have", "is there {item}", "how much {item} is left"],
        "CookedIntent": ["I cooked {dish}", "we cooked {dish}", "I made {dish}", "we made {dish}", "{dish} is cooked"],
        "RanOutIntent": ["we ran out of {item}", "{item} is used up", "we are out of {item}", "{item} is empty", "{item} is finished"],
    },
    "de": {
        "AddItemIntent": ["setze {item} auf die Einkaufsliste", "setz {item} auf die Liste", "füge {item} hinzu", "füge {item} zur Einkaufsliste hinzu",
                          "wir brauchen {item}", "setze {amount} {unit} {item} auf die Liste", "füge {amount} {unit} {item} hinzu",
                          "wir brauchen {amount} {unit} {item}", "kaufe {item}", "kaufe {amount} {unit} {item}", "setze {amount} {item} auf die Liste"],
        "AnswerQuantityIntent": ["{amount}", "{amount} {unit}", "{unit}", "ungefähr {amount} {unit}", "nur {amount}", "nur {amount} {unit}"],
        "AnswerDateIntent": ["{date}", "für {date}", "am {date}"],
        "ReadListIntent": ["was steht auf der Einkaufsliste", "lies die Einkaufsliste vor", "lies die Liste vor", "was müssen wir kaufen", "was steht auf der Liste"],
        "PlanMealIntent": ["plane {dish}", "plane {dish} für {date}", "plane {dish} am {date}", "setze {dish} auf den Plan", "setze {dish} für {date} auf den Plan",
                           "wir kochen {dish} {date}", "wir kochen {dish} am {date}", "plane {dish} für {servings} Personen am {date}", "plane {dish} für {date} für {servings} Personen"],
        "PlanForDayIntent": ["was ist für {date} geplant", "was ist am {date} geplant", "was essen wir {date}", "was kochen wir {date}", "was gibt es {date}"],
        "TodayPlanIntent": ["was ist heute geplant", "was essen wir heute", "was gibt es heute", "was kochen wir heute"],
        "ListDishesIntent": ["welche Gerichte haben wir", "was können wir kochen", "nenne unsere Gerichte"],
        "TomorrowCheckIntent": ["was fehlt für morgen", "haben wir alles für morgen", "was brauche ich für morgen", "prüfe morgen", "fehlt etwas für morgen"],
        "CheckStockIntent": ["haben wir {item}", "haben wir noch {item}", "wie viel {item} haben wir", "ist noch {item} da", "wie viel {item} ist noch da"],
        "CookedIntent": ["ich habe {dish} gekocht", "wir haben {dish} gekocht", "{dish} ist gekocht", "ich habe {dish} gemacht"],
        "RanOutIntent": ["{item} ist leer", "{item} ist alle", "wir haben kein {item} mehr", "{item} ist aufgebraucht"],
    },
}

INVOCATION = {"en": "pantry home", "de": "meine speisekammer"}


def interaction_model(locale):
    lang = "de" if locale.lower().startswith("de") else "en"
    recipes = db.rows("SELECT * FROM recipes WHERE archived = 0")
    dish_values = []
    for recipe in recipes:
        main = _recipe_label(recipe, lang)
        synonyms = sorted({value for value in (recipe.get("name_en"), recipe.get("name_de"), recipe.get("raw_name")) if value and value != main})
        dish_values.append({"id": str(recipe["id"]), "name": {"value": main, "synonyms": synonyms}})
    item_values = []
    for ingredient in db.rows("SELECT * FROM ingredients WHERE archived = 0 AND status = 'ready'"):
        main = _ingredient_label(ingredient["id"], lang)
        aliases = [row["alias"] for row in db.rows("SELECT alias FROM aliases WHERE ingredient_id = ?", (ingredient["id"],))] if _has_alias_table() else []
        candidates = [ingredient.get("name_en"), ingredient.get("name_de"), ingredient.get("raw_name")] + aliases
        synonyms = sorted({value for value in candidates if value and value != main and not any("\u0600" <= ch <= "\u06ff" for ch in value)})
        item_values.append({"id": str(ingredient["id"]), "name": {"value": main, "synonyms": synonyms[:20]}})
    unit_values = []
    for unit, words in UNIT_WORDS.items():
        filtered = [word for word in words if len(word) > 1]
        unit_values.append({"id": unit, "name": {"value": filtered[0], "synonyms": filtered[1:]}})
    slots = {
        "AddItemIntent": [("item", "ITEM"), ("amount", "AMAZON.NUMBER"), ("unit", "UNIT")],
        "AnswerQuantityIntent": [("amount", "AMAZON.NUMBER"), ("unit", "UNIT")],
        "AnswerDateIntent": [("date", "AMAZON.DATE")],
        "ReadListIntent": [],
        "PlanMealIntent": [("dish", "DISH"), ("date", "AMAZON.DATE"), ("servings", "AMAZON.NUMBER")],
        "PlanForDayIntent": [("date", "AMAZON.DATE")],
        "TodayPlanIntent": [],
        "ListDishesIntent": [],
        "TomorrowCheckIntent": [],
        "CheckStockIntent": [("item", "ITEM")],
        "CookedIntent": [("dish", "DISH")],
        "RanOutIntent": [("item", "ITEM")],
    }
    intents = [{"name": name, "samples": UTTERANCES[lang][name], "slots": [{"name": slot, "type": kind} for slot, kind in slot_list]}
               for name, slot_list in slots.items()]
    intents += [{"name": name, "samples": []} for name in ("AMAZON.HelpIntent", "AMAZON.StopIntent", "AMAZON.CancelIntent",
                                                         "AMAZON.NavigateHomeIntent", "AMAZON.YesIntent", "AMAZON.NoIntent", "AMAZON.FallbackIntent")]
    return {"interactionModel": {"languageModel": {
        "invocationName": INVOCATION[lang],
        "intents": intents,
        "types": [
            {"name": "DISH", "values": dish_values or [{"name": {"value": "pizza"}}]},
            {"name": "ITEM", "values": item_values or [{"name": {"value": "milk"}}]},
            {"name": "UNIT", "values": unit_values},
        ],
    }}}


def _has_alias_table():
    return bool(db.scalar("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'aliases'"))
