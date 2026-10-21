import json
from datetime import timedelta

from . import db, logic, services

FALLBACK_DAYS = 14
MAX_SIMULATED = 120


def _date_of(value):
    return services.parse_date(str(value)[:10])


def _list_span(shopping):
    if not shopping or not shopping.get("range_start") or not shopping.get("range_end"):
        return None
    days = (_date_of(shopping["range_end"]) - _date_of(shopping["range_start"])).days + 1
    return max(1, days)


def _trip_date(shopping):
    finished = db.scalar(
        "SELECT MIN(finished_at) FROM shopping_sessions WHERE list_id = ? AND finished_at IS NOT NULL", (shopping["id"],))
    started = db.scalar("SELECT MIN(started_at) FROM shopping_sessions WHERE list_id = ?", (shopping["id"],))
    value = finished or started or shopping.get("closed_at")
    return _date_of(value) if value else None


def _spend(list_id):
    total = db.scalar("SELECT SUM(price) FROM shopping_items WHERE list_id = ? AND checked = 1", (list_id,))
    return round(float(total or 0), 2)


def default_days():
    stored = db.get_setting("default_cycle_days", None)
    if stored:
        return max(1, int(float(stored)))
    last = db.row("SELECT * FROM shopping_lists WHERE range_start IS NOT NULL ORDER BY id DESC LIMIT 1")
    return _list_span(last) or FALLBACK_DAYS


def remember_span(shopping):
    span = _list_span(shopping)
    if span:
        db.set_setting("default_cycle_days", span)


def _recipe_requirements(ingredients, servings):
    result = []
    for recipe in db.rows("SELECT * FROM recipes WHERE archived = 0"):
        record = {"recipe_id": recipe["id"], "servings": servings, "choices": {}, "optional_items": []}
        required, unconvertible = logic.meal_requirements(record, services.recipe_items(recipe["id"]), ingredients)
        if required and not unconvertible:
            result.append((recipe, required))
    return result


def _fits(stock, required):
    return all(stock.get(key, 0.0) + logic.EPSILON >= qty for key, qty in required.items())


def cookable_meals(stock=None, servings=None):
    ingredients = services.ingredient_map()
    servings = float(servings or services.default_servings())
    stock = dict(stock if stock is not None else services.stock_map())
    recipes = _recipe_requirements(ingredients, servings)
    now_cookable = [recipe for recipe, required in recipes if _fits(stock, required)]
    used = {}
    count = 0
    while count < MAX_SIMULATED:
        options = [(recipe, required) for recipe, required in recipes if _fits(stock, required)]
        if not options:
            break
        options.sort(key=lambda entry: (used.get(entry[0]["id"], 0), entry[0]["id"]))
        recipe, required = options[0]
        for key, qty in required.items():
            stock[key] = max(0.0, stock.get(key, 0.0) - qty)
        used[recipe["id"]] = used.get(recipe["id"], 0) + 1
        count += 1
    return {"now": now_cookable, "meals_left": count, "recipes_considered": len(recipes)}


def _meals_per_day(start, today, planned_days):
    elapsed = max(1, (today - start).days + 1)
    cooked = db.scalar("SELECT COUNT(*) FROM meals WHERE status = 'cooked' AND date >= ?", (start.isoformat(),)) or 0
    end = (start + timedelta(days=planned_days - 1)).isoformat()
    planned = db.scalar("SELECT COUNT(*) FROM meals WHERE date >= ? AND date <= ?", (start.isoformat(), end)) or 0
    planned_rate = planned / float(planned_days) if planned else 0.0
    if cooked >= 2 and elapsed >= 2:
        return max(cooked / elapsed, planned_rate * 0.5, 0.5), "measured"
    if planned_rate:
        return max(0.25, planned_rate), "planned"
    return 1.0, "assumed"


def history():
    lists = db.rows("SELECT * FROM shopping_lists WHERE range_start IS NOT NULL ORDER BY id")
    trips = []
    for shopping in lists:
        trip = _trip_date(shopping)
        if trip:
            trips.append((shopping, trip))
    result = []
    for index, (shopping, trip) in enumerate(trips):
        planned = _list_span(shopping)
        following = trips[index + 1][1] if index + 1 < len(trips) else None
        actual = (following - trip).days if following else None
        spend = _spend(shopping["id"])
        entry = {"list_id": shopping["id"], "trip": trip.isoformat(), "planned_days": planned, "actual_days": actual, "spend": spend}
        if actual is not None and planned:
            daily = spend / planned
            entry["difference_days"] = actual - planned
            entry["saved"] = round(daily * (actual - planned), 2) if actual > planned else 0.0
            entry["extra_cost"] = round(daily * (planned - actual), 2) if actual < planned else 0.0
        result.append(entry)
    return result


def _raise_alert(kind, key, title, body, payload):
    with db.tx() as c:
        c.execute(
            "INSERT OR IGNORE INTO alerts(kind, dedupe_key, title, body, payload) VALUES (?, ?, ?, ?, ?)",
            (kind, key, title, body, json.dumps(payload)),
        )


def status(raise_alerts=True):
    today = services.today()
    past = history()
    current = past[-1] if past else None
    open_shopping = services.open_list()
    simulation = cookable_meals()
    stock_known = bool(services.stock_map())
    result = {
        "today": today.isoformat(),
        "default_days": default_days(),
        "history": past[-6:],
        "cookable_now": len(simulation["now"]),
        "meals_left": simulation["meals_left"],
        "recipes_considered": simulation["recipes_considered"],
        "open_list": {"id": open_shopping["id"], "range_start": open_shopping.get("range_start"), "range_end": open_shopping.get("range_end")} if open_shopping else None,
        "must_shop": stock_known and simulation["meals_left"] == 0,
        "empty_pantry": not stock_known,
        "cycle": None,
    }
    if current and current["actual_days"] is None:
        start = _date_of(current["trip"])
        planned_days = current["planned_days"] or result["default_days"]
        planned_end = start + timedelta(days=planned_days)
        elapsed = (today - start).days
        rate, basis = _meals_per_day(start, today, planned_days)
        days_left = min(simulation["meals_left"] / rate if rate else 0, planned_days * 3)
        run_out = today + timedelta(days=int(days_left))
        difference = (run_out - planned_end).days
        daily = current["spend"] / planned_days if planned_days else 0
        if today >= planned_end and simulation["meals_left"] > 0:
            state = "extended"
        elif difference < -1:
            state = "early"
        elif difference > 1:
            state = "ahead"
        else:
            state = "on_track"
        result["cycle"] = {
            "start": start.isoformat(),
            "planned_days": planned_days,
            "planned_end": planned_end.isoformat(),
            "elapsed_days": elapsed,
            "progress": min(1.0, max(0.0, elapsed / planned_days)),
            "meals_per_day": round(rate, 2),
            "rate_basis": basis,
            "forecast_days_left": round(days_left, 1),
            "forecast_run_out": run_out.isoformat(),
            "difference_days": difference,
            "spend": current["spend"],
            "daily_spend": round(daily, 2),
            "extra_days_so_far": max(0, elapsed - planned_days),
            "saved_so_far": round(daily * max(0, elapsed - planned_days), 2),
            "projected_saving": round(daily * difference, 2) if difference > 0 else 0.0,
            "projected_extra_cost": round(daily * -difference, 2) if difference < 0 else 0.0,
            "state": state,
        }
        if raise_alerts and state == "early":
            _raise_alert("cycle", "cycle-early-" + start.isoformat(), "Food runs out early",
                         "At this pace the pantry lasts until " + run_out.isoformat() + ", " + str(-difference) + " days before the planned " + str(planned_days) + " days are over.",
                         {"date": today.isoformat()})
        if raise_alerts and state == "extended":
            _raise_alert("cycle", "cycle-extended-" + start.isoformat(), "Well done, the shop is stretching",
                         "You are past the planned " + str(planned_days) + " days and can still cook.", {"date": today.isoformat()})
    if raise_alerts and result["must_shop"]:
        _raise_alert("cycle", "must-shop-" + today.isoformat(), "Time to go shopping",
                     "Nothing in the recipe book can be cooked with what is at home.", {"date": today.isoformat()})
    return result
