import functools
import hashlib
import hmac
import json
import logging
import os
import queue
import secrets
import time
import urllib.request
from datetime import timedelta

from . import db, services

log = logging.getLogger("pantry.integrations")

SCHEMA = """
CREATE TABLE IF NOT EXISTS api_tokens (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    hint TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used TEXT
);
CREATE TABLE IF NOT EXISTS webhooks (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    events TEXT NOT NULL DEFAULT '*',
    secret TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    last_status TEXT,
    last_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS event_log (
    id INTEGER PRIMARY KEY,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS event_log_type ON event_log(type, id);
CREATE TABLE IF NOT EXISTS nutrition_exports (
    date TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    payload TEXT NOT NULL,
    final INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (date, user_id)
);
"""

EVENT_TYPES = [
    "meal.planned",
    "meal.moved",
    "meal.updated",
    "meal.removed",
    "meal.cooked",
    "meal.uncooked",
    "shopping.item_added",
    "shopping.list_built",
    "shopping.finished",
    "stock.used_up",
    "stock.added",
    "recipe.created",
    "nutrition.daily",
]

_deliveries = queue.Queue()


def init():
    db.conn().executescript(SCHEMA)


def _hash(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_token(name):
    name = (name or "").strip() or "Automation"
    token = "pk_" + secrets.token_urlsafe(30)
    with db.tx() as c:
        cursor = c.execute("INSERT INTO api_tokens(name, token_hash, hint) VALUES (?, ?, ?)", (name, _hash(token), token[-4:]))
    return {"id": cursor.lastrowid, "name": name, "token": token}


def list_tokens():
    return db.rows("SELECT id, name, hint, created_at, last_used FROM api_tokens ORDER BY id")


def delete_token(token_id):
    with db.tx() as c:
        c.execute("DELETE FROM api_tokens WHERE id = ?", (token_id,))
    return {"ok": True}


def check_token(token):
    if not token:
        return False
    found = db.row("SELECT id FROM api_tokens WHERE token_hash = ?", (_hash(token),))
    if not found:
        return False
    with db.tx() as c:
        c.execute("UPDATE api_tokens SET last_used = datetime('now') WHERE id = ?", (found["id"],))
    return True


def list_webhooks():
    rows = db.rows("SELECT id, name, url, events, active, last_status, last_at, created_at FROM webhooks ORDER BY id")
    for row in rows:
        row["events"] = [entry for entry in row["events"].split(",") if entry]
    return rows


def save_webhook(data, webhook_id=None):
    url = (data.get("url") or "").strip()
    if not url.startswith(("http://", "https://")):
        raise services.ServiceError("The address must start with http:// or https://")
    events = data.get("events") or ["*"]
    unknown = [entry for entry in events if entry != "*" and entry not in EVENT_TYPES]
    if unknown:
        raise services.ServiceError("Unknown event: " + ", ".join(unknown))
    name = (data.get("name") or "").strip() or url
    with db.tx() as c:
        if webhook_id:
            c.execute(
                "UPDATE webhooks SET name = ?, url = ?, events = ?, active = ? WHERE id = ?",
                (name, url, ",".join(events), 1 if data.get("active", True) else 0, webhook_id),
            )
            secret = None
        else:
            secret = "whsec_" + secrets.token_urlsafe(24)
            cursor = c.execute("INSERT INTO webhooks(name, url, events, secret) VALUES (?, ?, ?, ?)", (name, url, ",".join(events), secret))
            webhook_id = cursor.lastrowid
    result = next(entry for entry in list_webhooks() if entry["id"] == webhook_id)
    if secret:
        result["secret"] = secret
    return result


def delete_webhook(webhook_id):
    with db.tx() as c:
        c.execute("DELETE FROM webhooks WHERE id = ?", (webhook_id,))
    return {"ok": True}


def emit(event_type, payload):
    try:
        body = {"type": event_type, "at": services.iso_now(), "data": payload}
        with db.tx() as c:
            cursor = c.execute("INSERT INTO event_log(type, payload) VALUES (?, ?)", (event_type, json.dumps(body, default=str)))
            body["id"] = cursor.lastrowid
            c.execute("DELETE FROM event_log WHERE id < ? - 5000", (body["id"],))
        for hook in db.rows("SELECT * FROM webhooks WHERE active = 1"):
            wanted = hook["events"].split(",")
            if "*" in wanted or event_type in wanted:
                _deliveries.put((hook["id"], body, 0))
    except Exception:
        log.exception("Could not emit %s", event_type)


def events_since(after=0, types=None, limit=200):
    sql = "SELECT id, payload FROM event_log WHERE id > ?"
    params = [int(after or 0)]
    if types:
        wanted = [entry for entry in types.split(",") if entry]
        sql += " AND type IN (" + ",".join("?" for _ in wanted) + ")"
        params += wanted
    sql += " ORDER BY id LIMIT ?"
    params.append(min(int(limit), 500))
    result = []
    for row in db.rows(sql, params):
        entry = json.loads(row["payload"])
        entry["id"] = row["id"]
        result.append(entry)
    return {"events": result, "last_id": result[-1]["id"] if result else int(after or 0)}


def _deliver(hook_id, body):
    hook = db.row("SELECT * FROM webhooks WHERE id = ? AND active = 1", (hook_id,))
    if not hook:
        return True
    raw = json.dumps(body, default=str).encode("utf-8")
    stamp = str(int(time.time()))
    signature = hmac.new(hook["secret"].encode("utf-8"), (stamp + ".").encode("utf-8") + raw, hashlib.sha256).hexdigest()
    request = urllib.request.Request(
        hook["url"],
        data=raw,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "User-Agent": "PantryHome/1.0",
            "X-Pantry-Event": body["type"],
            "X-Pantry-Timestamp": stamp,
            "X-Pantry-Signature": "sha256=" + signature,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            status = str(response.status)
            ok = 200 <= response.status < 300
    except Exception as error:
        status = str(error)[:120]
        ok = False
    with db.tx() as c:
        c.execute("UPDATE webhooks SET last_status = ?, last_at = datetime('now') WHERE id = ?", (status, hook_id))
    return ok


def delivery_worker(stop_event):
    while not stop_event.is_set():
        try:
            hook_id, body, attempt = _deliveries.get(timeout=5)
        except queue.Empty:
            continue
        try:
            if not _deliver(hook_id, body) and attempt < 3:
                time.sleep(2**attempt * 5)
                _deliveries.put((hook_id, body, attempt + 1))
        except Exception:
            log.exception("Webhook delivery failed")


def test_webhook(webhook_id):
    body = {"type": "test", "at": services.iso_now(), "data": {"message": "Hello from Pantry"}, "id": 0}
    ok = _deliver(webhook_id, body)
    hook = db.row("SELECT last_status FROM webhooks WHERE id = ?", (webhook_id,))
    return {"ok": ok, "status": hook["last_status"] if hook else None}


def nutrition_for_day(day, user_id=None):
    day = services.parse_date(day).isoformat()
    users = db.rows("SELECT id, name FROM users ORDER BY id")
    people_count = max(len(users), 1)
    if user_id:
        users = [user for user in users if user["id"] == int(user_id)]
    meals = db.rows(
        "SELECT m.id, m.servings, m.kcal, m.protein, m.fat, m.carbs, m.fiber, m.cooked_at, COALESCE(r.name_en, r.raw_name) AS dish, r.name_fa "
        "FROM meals m JOIN recipes r ON r.id = m.recipe_id WHERE m.status = 'cooked' AND m.date = ? ORDER BY m.position",
        (day,),
    )
    keys = ("kcal", "protein", "fat", "carbs", "fiber")
    result = []
    for user in users:
        totals = dict.fromkeys(keys, 0.0)
        complete = True
        entries = []
        for meal in meals:
            servings = float(meal["servings"] or 1)
            portion = {}
            for key in keys:
                value = meal[key]
                if value is None:
                    complete = False
                    portion[key] = None
                else:
                    portion[key] = round(value / servings, 1)
                    totals[key] += value / servings
            entries.append(
                {"type": "meal", "meal_id": meal["id"], "name": meal["dish"], "name_fa": meal["name_fa"], "portion": 1, **portion}
            )
        snacks = db.rows(
            "SELECT s.*, COALESCE(i.name_en, i.raw_name) AS name, i.unit FROM snacks s JOIN ingredients i ON i.id = s.ingredient_id "
            "WHERE s.date = ? AND (s.user_id = ? OR s.user_id IS NULL)",
            (day, user["id"]),
        )
        for snack in snacks:
            share = 1.0 if snack["user_id"] else 1.0 / people_count
            item = {"type": "snack", "name": snack["name"], "qty": snack["qty"], "unit": snack["unit"]}
            for key in keys:
                value = snack[key]
                if value is None:
                    complete = False
                    item[key] = None
                else:
                    item[key] = round(value * share, 1)
                    totals[key] += value * share
            entries.append(item)
        result.append(
            {
                "date": day,
                "user": {"id": user["id"], "name": user["name"]},
                "totals": {key: round(value, 1) for key, value in totals.items()},
                "complete": complete,
                "entries": entries,
                "note": "Meals are split evenly by the number of servings cooked.",
            }
        )
    return result


def nutrition_range(start, end, user_id=None):
    first = services.parse_date(start)
    last = services.parse_date(end)
    if (last - first).days > 120:
        raise services.ServiceError("Range is limited to 120 days")
    days = []
    current = first
    while current <= last:
        days.extend(nutrition_for_day(current.isoformat(), user_id))
        current += timedelta(days=1)
    return days


def export_dir():
    path = os.path.join(db.DATA_DIR, "exports", "nutrition")
    os.makedirs(path, exist_ok=True)
    return path


def export_day(day, final=False):
    day = services.parse_date(day).isoformat()
    reports = nutrition_for_day(day)
    with db.tx() as c:
        for report in reports:
            c.execute(
                "INSERT INTO nutrition_exports(date, user_id, payload, final, updated_at) VALUES (?, ?, ?, ?, datetime('now')) "
                "ON CONFLICT(date, user_id) DO UPDATE SET payload = excluded.payload, final = excluded.final, updated_at = excluded.updated_at",
                (day, report["user"]["id"], json.dumps(report), 1 if final else 0),
            )
    with open(os.path.join(export_dir(), day + ".json"), "w", encoding="utf-8") as handle:
        json.dump({"date": day, "final": final, "people": reports}, handle, ensure_ascii=False, indent=2)
    if final:
        emit(
            "nutrition.daily",
            {
                "date": day,
                "people": [{"user": report["user"], "totals": report["totals"], "complete": report["complete"]} for report in reports],
            },
        )
    return reports


def daily_export():
    yesterday = (services.today() - timedelta(days=1)).isoformat()
    export_day(yesterday, final=True)
    export_day(services.today().isoformat(), final=False)


def stored_exports(start, end, user_id=None):
    sql = "SELECT payload, final, updated_at FROM nutrition_exports WHERE date BETWEEN ? AND ?"
    params = [start, end]
    if user_id:
        sql += " AND user_id = ?"
        params.append(int(user_id))
    rows = db.rows(sql + " ORDER BY date, user_id", params)
    return [dict(json.loads(row["payload"]), final=bool(row["final"]), exported_at=row["updated_at"]) for row in rows]


def _wrap(name, event_type, describe):
    original = getattr(services, name)

    @functools.wraps(original)
    def wrapped(*args, **kwargs):
        result = original(*args, **kwargs)
        try:
            emit(event_type, describe(result, args, kwargs))
        except Exception:
            log.exception("Event for %s failed", name)
        return result

    setattr(services, name, wrapped)


def _meal_summary(result, args, kwargs):
    meal = result.get("meal", result) if isinstance(result, dict) else {}
    recipe = meal.get("recipe") or result.get("recipe") or {}
    return {
        "meal_id": meal.get("id"),
        "date": meal.get("date"),
        "position": meal.get("position"),
        "servings": meal.get("servings"),
        "recipe_id": recipe.get("id"),
        "dish": recipe.get("display"),
    }


def install_hooks():
    _wrap("add_meal", "meal.planned", _meal_summary)
    _wrap("move_meal", "meal.moved", _meal_summary)
    _wrap("update_meal", "meal.updated", _meal_summary)
    _wrap("delete_meal", "meal.removed", lambda result, args, kwargs: {"meal_id": args[0] if args else None})
    _wrap(
        "cook",
        "meal.cooked",
        lambda result, args, kwargs: {
            "meal_id": result.get("id"),
            "date": result.get("date"),
            "dish": (result.get("recipe") or {}).get("display"),
            "servings": result.get("servings"),
            "kcal": result.get("kcal"),
            "protein": result.get("protein"),
            "shortfalls": [entry.get("display") for entry in result.get("shortfalls") or []],
        },
    )
    _wrap("uncook", "meal.uncooked", lambda result, args, kwargs: {"meal_id": args[0] if args else None})
    _wrap("add_list_item", "shopping.item_added", lambda result, args, kwargs: _item_summary(result))
    _wrap(
        "build_list",
        "shopping.list_built",
        lambda result, args, kwargs: {"start": args[0] if args else None, "end": args[1] if len(args) > 1 else None},
    )
    _wrap("used_up", "stock.used_up", lambda result, args, kwargs: {"ingredient_id": args[0] if args else None})
    _wrap("create_recipe", "recipe.created", lambda result, args, kwargs: {"recipe_id": result.get("id"), "name": result.get("display")})


def _item_summary(result):
    item = next((entry for entry in (result.get("list") or {}).get("items", []) if entry["id"] == result.get("item_id")), None) or {}
    ingredient = item.get("ingredient") or {}
    return {
        "item_id": result.get("item_id"),
        "ingredient_id": ingredient.get("id"),
        "name": ingredient.get("display"),
        "needed_qty": item.get("needed_qty"),
        "unit": ingredient.get("unit"),
    }


def week_summary(start=None):
    first = services.parse_date(start) if start else services.today() - timedelta(days=services.today().weekday())
    today = services.today()
    users = db.rows("SELECT id, name FROM users ORDER BY id")
    recipes = {}
    days = []
    for offset in range(7):
        day = first + timedelta(days=offset)
        iso = day.isoformat()
        people = nutrition_for_day(iso) if day <= today else []
        eaten = {"kcal": 0.0, "protein": 0.0}
        for report in people:
            for key in eaten:
                eaten[key] += report["totals"][key] or 0
        count = max(len(people), 1)
        planned = {"kcal": 0.0, "protein": 0.0}
        for meal in db.rows("SELECT recipe_id FROM meals WHERE date = ? AND status = 'planned'", (iso,)):
            recipe_id = meal["recipe_id"]
            if recipe_id not in recipes:
                try:
                    recipes[recipe_id] = services.get_recipe(recipe_id).get("nutrition_per_person") or {}
                except Exception:
                    recipes[recipe_id] = {}
            for key in planned:
                planned[key] += recipes[recipe_id].get(key) or 0
        days.append(
            {
                "date": iso,
                "is_today": day == today,
                "is_future": day > today,
                "eaten_kcal": round(eaten["kcal"] / count),
                "eaten_protein": round(eaten["protein"] / count, 1),
                "planned_kcal": round(planned["kcal"]),
                "planned_protein": round(planned["protein"], 1),
                "people": [{"name": report["user"]["name"], "kcal": round(report["totals"]["kcal"] or 0)} for report in people],
            }
        )
    past = [day for day in days if not day["is_future"] and day["eaten_kcal"]]
    planned_days = [day for day in days if day["planned_kcal"]]
    return {
        "average_planned_kcal": round(sum(day["planned_kcal"] for day in planned_days) / len(planned_days)) if planned_days else 0,
        "start": first.isoformat(),
        "days": days,
        "users": [user["name"] for user in users],
        "total_kcal": sum(day["eaten_kcal"] for day in days),
        "average_kcal": round(sum(day["eaten_kcal"] for day in past) / len(past)) if past else 0,
        "total_protein": round(sum(day["eaten_protein"] for day in days), 1),
    }
