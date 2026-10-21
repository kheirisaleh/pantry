import json
import logging
import os
import threading
from datetime import timedelta
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from . import ai, alexa, cycle, db, integrations, names, push, reports, scheduler, services

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
STATIC = os.path.join(os.path.dirname(__file__), "static")
_stop = threading.Event()


@asynccontextmanager
async def lifespan(app):
    db.init()
    integrations.init()
    os.makedirs(os.path.join(db.DATA_DIR, "media", "recipes"), exist_ok=True)
    threads = []
    if os.environ.get("PANTRY_WORKERS", "1") == "1":
        for target in (ai.worker, scheduler.worker, integrations.delivery_worker):
            thread = threading.Thread(target=target, args=(_stop,), daemon=True)
            thread.start()
            threads.append(thread)
    yield
    _stop.set()


integrations.install_hooks()

app = FastAPI(title="Pantry", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.exception_handler(services.ServiceError)
async def service_error(request, error):
    return JSONResponse({"error": str(error)}, status_code=error.status)


@app.middleware("http")
async def idempotency(request: Request, call_next):
    op_id = request.headers.get("x-op-id")
    if not op_id or request.method not in ("POST", "PATCH", "PUT", "DELETE") or not request.url.path.startswith("/api/"):
        return await call_next(request)
    stored = db.row("SELECT response FROM processed_ops WHERE op_id = ?", (op_id,))
    if stored:
        payload = json.loads(stored["response"])
        return Response(payload["body"], status_code=payload["status"], media_type="application/json", headers={"x-op-replayed": "1"})
    response = await call_next(request)
    body = b""
    async for chunk in response.body_iterator:
        body += chunk
    if response.status_code < 500:
        with db.tx() as c:
            c.execute(
                "INSERT OR IGNORE INTO processed_ops(op_id, response) VALUES (?, ?)",
                (op_id, json.dumps({"status": response.status_code, "body": body.decode("utf-8", "replace")})),
            )
            c.execute("DELETE FROM processed_ops WHERE created_at < datetime('now', '-30 days')")
    headers = {key: value for key, value in response.headers.items() if key.lower() != "content-length"}
    return Response(body, status_code=response.status_code, headers=headers, media_type=response.media_type)


def user_of(request):
    value = request.headers.get("x-user-id")
    try:
        user_id = int(value)
    except (TypeError, ValueError):
        return None
    return user_id if db.scalar("SELECT 1 FROM users WHERE id = ?", (user_id,)) else None


async def body_of(request):
    try:
        data = await request.json()
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


@app.get("/healthz")
def healthz():
    db.scalar("SELECT 1")
    return {"ok": True}


@app.get("/api/bootstrap")
def bootstrap():
    return {
        "users": services.users(),
        "ai": ai.status(),
        "alerts": db.scalar("SELECT COUNT(*) FROM alerts WHERE status = 'open'"),
        "vapid": push.public_key(),
        "today": services.today().isoformat(),
        "default_servings": services.default_servings(),
        "alexa_skill_id": alexa._skill_id(),
        "alexa_endpoint": os.environ.get("PUBLIC_URL", "").rstrip("/") + "/alexa",
        "categories": services.CATEGORY_ORDER,
        "icons": ai.ICON_NAMES,
        "stores": [entry["store"] for entry in db.rows("SELECT store, MAX(started_at) AS last FROM shopping_sessions GROUP BY store ORDER BY last DESC LIMIT 12")],
    }


@app.patch("/api/users/{user_id}")
async def rename_user(user_id: int, request: Request):
    data = await body_of(request)
    return services.rename_user(user_id, data.get("name"), data.get("color"))


@app.patch("/api/settings")
async def update_settings(request: Request):
    data = await body_of(request)
    if "alexa_skill_id" in data:
        with db.tx() as c:
            db.set_setting("alexa_skill_id", (data.get("alexa_skill_id") or "").strip(), c)
    if "default_servings" in data:
        value = services.positive(data["default_servings"], "Default servings")
        with db.tx() as c:
            db.set_setting("default_servings", value, c)
    return {"default_servings": services.default_servings(), "alexa_skill_id": alexa._skill_id()}


@app.get("/api/ai")
def ai_status():
    status = ai.status()
    status["jobs"] = db.rows("SELECT kind, target_id, attempts, next_at, error FROM ai_jobs ORDER BY next_at LIMIT 50")
    return status


@app.patch("/api/ai/settings")
async def ai_settings(request: Request):
    data = await body_of(request)
    return ai.update_settings(data)


@app.get("/api/ai/models")
def ai_models():
    try:
        return {"models": ai.available_models()}
    except Exception as error:
        raise services.ServiceError("Could not load the model list: " + str(error)[:200])


@app.post("/api/ai/test")
async def ai_test(request: Request):
    data = await body_of(request)
    return ai.test_model((data.get("model") or "").strip())


@app.post("/api/meals/{meal_id}/move")
async def move_meal(meal_id: int, request: Request):
    data = await body_of(request)
    return services.move_meal(meal_id, data)


@app.get("/api/cycle")
def cycle_status():
    return cycle.status()


@app.get("/api/home/week")
def home_week(start: str = None):
    return integrations.week_summary(start)


def _require_token(request: Request):
    header = request.headers.get("authorization") or ""
    token = header[7:].strip() if header.lower().startswith("bearer ") else (request.query_params.get("token") or "")
    if not integrations.check_token(token):
        raise services.ServiceError("A valid API key is required", 401)


@app.get("/api/export/nutrition")
def export_nutrition(request: Request, date: str = None, start: str = None, end: str = None, user: int = None):
    _require_token(request)
    if date:
        return {"days": integrations.nutrition_for_day(date, user)}
    start = start or (services.today() - timedelta(days=6)).isoformat()
    end = end or services.today().isoformat()
    return {"days": integrations.nutrition_range(start, end, user)}


@app.get("/api/export/nutrition/daily")
def export_nutrition_daily(request: Request, start: str = None, end: str = None, user: int = None):
    _require_token(request)
    start = start or (services.today() - timedelta(days=30)).isoformat()
    end = end or services.today().isoformat()
    return {"days": integrations.stored_exports(start, end, user)}


@app.get("/api/automation/events")
def automation_events(request: Request, after: int = 0, types: str = None, limit: int = 200):
    _require_token(request)
    return integrations.events_since(after, types, limit)


@app.get("/api/automation/state")
def automation_state(request: Request):
    _require_token(request)
    shopping = services.get_list()
    return {
        "today": services.today().isoformat(),
        "calendar": services.calendar(services.today().isoformat(), (services.today() + timedelta(days=6)).isoformat()),
        "shopping": [{"name": item["ingredient"]["display"], "needed_qty": item.get("needed_qty"), "unit": item["ingredient"]["unit"],
                      "checked": bool(item.get("checked"))} for item in (shopping or {}).get("items", [])],
        "alerts": services.alerts(),
    }


@app.post("/api/automation/shopping")
async def automation_add_item(request: Request):
    _require_token(request)
    data = await body_of(request)
    return services.add_list_item({"name": data.get("name"), "qty": data.get("qty"), "unit": data.get("unit"), "source": "automation"})


@app.post("/api/automation/meals")
async def automation_add_meal(request: Request):
    _require_token(request)
    data = await body_of(request)
    recipe_id = data.get("recipe_id") or names.match_recipe(data.get("dish") or "")
    if not recipe_id:
        raise services.ServiceError("Dish not found", 404)
    return services.add_meal({"recipe_id": recipe_id, "date": data.get("date") or services.today().isoformat(),
                              "servings": data.get("servings") or services.default_servings(), "source": "automation"})


@app.get("/api/automation/tomorrow")
def automation_tomorrow(request: Request, lang: str = "en", date: str = None):
    _require_token(request)
    lang = "de" if lang.lower().startswith("de") else "en"
    day = date or (services.today() + timedelta(days=1)).isoformat()
    meals = services.shortages_for(day, lang)
    speech = alexa.tomorrow_speech(lang)[0] if not date else None
    return {"date": day, "meals": meals, "has_meals": bool(meals), "has_shortages": any(not entry["feasible"] for entry in meals),
            "missing": [item for entry in meals for item in entry["missing"]], "speech": speech}


@app.get("/api/integrations")
def integrations_overview():
    return {"tokens": integrations.list_tokens(), "webhooks": integrations.list_webhooks(), "event_types": integrations.EVENT_TYPES,
            "last_export": db.scalar("SELECT MAX(updated_at) FROM nutrition_exports WHERE final = 1")}


@app.post("/api/integrations/tokens")
async def create_token(request: Request):
    data = await body_of(request)
    return integrations.create_token(data.get("name"))


@app.delete("/api/integrations/tokens/{token_id}")
def delete_token(token_id: int):
    return integrations.delete_token(token_id)


@app.post("/api/integrations/webhooks")
async def create_webhook(request: Request):
    data = await body_of(request)
    return integrations.save_webhook(data)


@app.patch("/api/integrations/webhooks/{webhook_id}")
async def update_webhook(webhook_id: int, request: Request):
    data = await body_of(request)
    return integrations.save_webhook(data, webhook_id)


@app.delete("/api/integrations/webhooks/{webhook_id}")
def delete_webhook(webhook_id: int):
    return integrations.delete_webhook(webhook_id)


@app.post("/api/integrations/webhooks/{webhook_id}/test")
def test_webhook(webhook_id: int):
    return integrations.test_webhook(webhook_id)


@app.post("/api/integrations/export-now")
def export_now():
    integrations.daily_export()
    return {"ok": True}


@app.get("/api/alexa/model/{locale}")
def alexa_model(locale: str):
    return alexa.interaction_model(locale)


@app.post("/api/ai/wake")
def ai_wake():
    with db.tx() as c:
        c.execute("UPDATE ai_jobs SET next_at = datetime('now') WHERE status = 'queued'")
    ai._state["cooldown_until"] = 0
    ai.wake()
    return ai.status()


@app.get("/api/ingredients")
def ingredients(archived: int = 0):
    return services.list_ingredients(bool(archived))


@app.get("/api/ingredients/search")
def ingredient_search(q: str = ""):
    ids = names.search(q)
    found = services.ingredient_map(ids)
    stock = services.stock_map()
    return [services.ingredient_view(found[key], stock) for key in ids if key in found and not found[key]["archived"]]


@app.post("/api/ingredients")
async def create_ingredient(request: Request):
    data = await body_of(request)
    with db.tx() as c:
        ingredient_id = services.resolve_or_create(c, data.get("name"), user_of(request), data.get("kind"))
    ai.wake()
    return services.get_ingredient(ingredient_id)


@app.get("/api/ingredients/{ingredient_id}")
def ingredient(ingredient_id: int):
    return services.get_ingredient(ingredient_id)


@app.patch("/api/ingredients/{ingredient_id}")
async def update_ingredient(ingredient_id: int, request: Request):
    return services.update_ingredient(ingredient_id, await body_of(request))


@app.post("/api/ingredients/{ingredient_id}/archive")
async def archive_ingredient(ingredient_id: int, request: Request):
    data = await body_of(request)
    services.archive_ingredient(ingredient_id, data.get("archived", True))
    return {"ok": True}


@app.post("/api/ingredients/{ingredient_id}/retry")
def retry_ingredient(ingredient_id: int):
    services.requeue_ingredient(ingredient_id)
    ai.wake()
    return services.get_ingredient(ingredient_id)


@app.get("/api/recipes")
def recipes(archived: int = 0):
    return services.list_recipes(bool(archived))


@app.post("/api/recipes")
async def create_recipe(request: Request):
    result = services.create_recipe(await body_of(request), user_of(request))
    ai.wake()
    return result


@app.get("/api/recipes/{recipe_id}")
def recipe(recipe_id: int):
    return services.get_recipe(recipe_id)


@app.put("/api/recipes/{recipe_id}")
async def update_recipe(recipe_id: int, request: Request):
    result = services.update_recipe(recipe_id, await body_of(request), user_of(request))
    ai.wake()
    return result


@app.post("/api/recipes/{recipe_id}/archive")
async def archive_recipe(recipe_id: int, request: Request):
    data = await body_of(request)
    services.archive_recipe(recipe_id, data.get("archived", True))
    return {"ok": True}


@app.post("/api/recipes/{recipe_id}/images/refresh")
def refresh_images(recipe_id: int):
    services.refresh_images(recipe_id)
    ai.wake()
    return services.get_recipe(recipe_id)


@app.post("/api/recipes/{recipe_id}/images/choose")
async def choose_image(recipe_id: int, request: Request):
    data = await body_of(request)
    try:
        index = int(data.get("index", -1))
    except (TypeError, ValueError):
        raise services.ServiceError("No such image")
    return services.choose_image(recipe_id, index)


@app.get("/api/calendar")
def calendar(start: str, end: str):
    return services.calendar(start, end)


@app.post("/api/meals")
async def add_meal(request: Request):
    return services.add_meal(await body_of(request), user_of(request))


@app.patch("/api/meals/{meal_id}")
async def update_meal(meal_id: int, request: Request):
    return services.update_meal(meal_id, await body_of(request))


@app.delete("/api/meals/{meal_id}")
def delete_meal(meal_id: int):
    services.delete_meal(meal_id)
    return {"ok": True}


@app.post("/api/meals/{meal_id}/uncook")
def uncook(meal_id: int):
    return services.uncook(meal_id)


@app.get("/api/suggestions")
def suggestions(date: str, meal_id: int = None, servings: float = None):
    return services.suggestions(date, meal_id, servings)


@app.post("/api/cook/preview")
async def cook_preview(request: Request):
    data = await body_of(request)
    return services.cook_preview(data.get("meal_id"), data.get("recipe_id"), data.get("servings"), data.get("choices"), data.get("optional_items"))


@app.post("/api/cook")
async def cook(request: Request):
    return services.cook(await body_of(request), user_of(request))


@app.post("/api/snacks")
async def snack(request: Request):
    result = services.log_snack(await body_of(request), user_of(request))
    ai.wake()
    return result


@app.delete("/api/snacks/{snack_id}")
def delete_snack(snack_id: int):
    services.delete_snack(snack_id)
    return {"ok": True}


@app.get("/api/inventory")
def inventory():
    return services.inventory()


@app.post("/api/inventory/add")
async def inventory_add(request: Request):
    result = services.manual_add(await body_of(request), user_of(request))
    ai.wake()
    return result


@app.post("/api/inventory/{ingredient_id}/used-up")
def used_up(ingredient_id: int, request: Request):
    return services.used_up(ingredient_id, user_of(request))


@app.post("/api/inventory/{ingredient_id}/waste")
async def waste(ingredient_id: int, request: Request):
    data = await body_of(request)
    return services.waste(ingredient_id, data.get("qty"), data.get("unit"), user_of(request))


@app.post("/api/inventory/count")
async def stock_count(request: Request):
    data = await body_of(request)
    return services.stock_count(data.get("entries") or [], user_of(request), bool(data.get("full")))


@app.get("/api/shopping")
def shopping():
    return {"list": services.get_list()}


@app.get("/api/shopping/review")
def shopping_review(start: str, end: str):
    return services.review(start, end)


@app.post("/api/shopping/build")
async def shopping_build(request: Request):
    data = await body_of(request)
    return {"list": services.build_list(data.get("start"), data.get("end"), user_of(request))}


@app.post("/api/shopping/items")
async def shopping_add(request: Request):
    result = services.add_list_item(await body_of(request), user_of(request))
    ai.wake()
    return result


@app.patch("/api/shopping/items/{item_id}")
async def shopping_update(item_id: int, request: Request):
    return {"list": services.update_list_item(item_id, await body_of(request), user_of(request))}


@app.delete("/api/shopping/items/{item_id}")
def shopping_delete(item_id: int):
    return {"list": services.delete_list_item(item_id)}


@app.post("/api/shopping/sessions")
async def shopping_session(request: Request):
    data = await body_of(request)
    return services.start_session(data.get("store"), user_of(request))


@app.post("/api/shopping/sessions/{session_id}/finish")
def shopping_finish(session_id: int, request: Request):
    return {"list": services.finish_session(session_id, user_of(request))}


@app.post("/api/shopping/sessions/{session_id}/pause")
def shopping_pause(session_id: int):
    return {"list": services.pause_session(session_id)}


@app.post("/api/shopping/sessions/{session_id}/resume")
def shopping_resume(session_id: int):
    return {"list": services.resume_session(session_id)}


@app.post("/api/shopping/{list_id}/close")
def shopping_close(list_id: int, request: Request):
    return services.close_list(list_id, user_of(request))


@app.get("/api/alerts")
def alerts(status: str = "open"):
    return services.alerts(status)


@app.post("/api/alerts/{alert_id}/dismiss")
def dismiss(alert_id: int):
    services.dismiss_alert(alert_id)
    return {"ok": True}


@app.post("/api/alerts/{alert_id}/act")
def act(alert_id: int, request: Request):
    return services.act_on_alert(alert_id, user_of(request))


@app.get("/api/reports/finance")
def report_finance(start: str = None, end: str = None, period: str = "week"):
    return reports.finance(start, end, period)


@app.get("/api/reports/prices")
def report_prices():
    return reports.price_trends()


@app.get("/api/reports/nutrition")
def report_nutrition(start: str = None, end: str = None):
    return reports.nutrition(start, end)


@app.get("/api/reports/periods")
def report_periods():
    return reports.periods()


@app.get("/api/reports/period/{list_id}")
def report_period(list_id: int):
    return reports.period_report(list_id)


@app.get("/api/export.xlsx")
def export_xlsx():
    return Response(
        reports.export_xlsx(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="pantry-' + services.today().isoformat() + '.xlsx"'},
    )


@app.get("/api/export/{name}.csv")
def export_csv(name: str):
    return Response(
        reports.export_csv(name),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="pantry-' + name + "-" + services.today().isoformat() + '.csv"'},
    )


@app.post("/api/push/subscribe")
async def push_subscribe(request: Request):
    return push.subscribe(await body_of(request), user_of(request))


@app.post("/api/push/unsubscribe")
async def push_unsubscribe(request: Request):
    data = await body_of(request)
    return push.unsubscribe(data.get("endpoint") or "")


@app.post("/api/push/test")
def push_test():
    return {"sent": push.broadcast("Pantry", "Notifications are working.", "/m/")}


@app.post("/alexa")
async def alexa_endpoint(request: Request):
    body = await request.body()
    try:
        payload = json.loads(body.decode("utf-8"))
    except ValueError:
        return JSONResponse({"error": "bad request"}, status_code=400)
    headers = {key.lower(): value for key, value in request.headers.items()}
    try:
        alexa.verify(headers, body, payload)
    except alexa.AlexaRejected as error:
        logging.getLogger("pantry.alexa").warning("Rejected Alexa request: %s", error)
        return JSONResponse({"error": "forbidden"}, status_code=400)
    result = alexa.handle(payload)
    ai.wake()
    return JSONResponse(result)


@app.get("/media/recipes/{name}")
def media(name: str):
    if "/" in name or ".." in name:
        return JSONResponse({"error": "not found"}, status_code=404)
    path = os.path.join(db.DATA_DIR, "media", "recipes", name)
    if not os.path.isfile(path):
        return JSONResponse({"error": "not found"}, status_code=404)
    return FileResponse(path, headers={"Cache-Control": "public, max-age=31536000, immutable"})


@app.get("/sw.js")
def service_worker():
    return FileResponse(os.path.join(STATIC, "sw.js"), media_type="application/javascript", headers={"Cache-Control": "no-cache", "Service-Worker-Allowed": "/"})


@app.get("/m")
@app.get("/m/")
def mobile():
    return FileResponse(os.path.join(STATIC, "m", "index.html"), headers={"Cache-Control": "no-cache"})


@app.get("/")
def desktop():
    return FileResponse(os.path.join(STATIC, "index.html"), headers={"Cache-Control": "no-cache"})


app.mount("/static", StaticFiles(directory=STATIC), name="static")
