from datetime import timedelta

from fastapi import APIRouter, Request

from .. import alexa, db, integrations, names, services
from ..deps import body_of, require_token

router = APIRouter()


@router.get("/api/export/nutrition")
def export_nutrition(request: Request, date: str = None, start: str = None, end: str = None, user: int = None):
    require_token(request)
    if date:
        return {"days": integrations.nutrition_for_day(date, user)}
    start = start or (services.today() - timedelta(days=6)).isoformat()
    end = end or services.today().isoformat()
    return {"days": integrations.nutrition_range(start, end, user)}


@router.get("/api/export/nutrition/daily")
def export_nutrition_daily(request: Request, start: str = None, end: str = None, user: int = None):
    require_token(request)
    start = start or (services.today() - timedelta(days=30)).isoformat()
    end = end or services.today().isoformat()
    return {"days": integrations.stored_exports(start, end, user)}


@router.get("/api/automation/events")
def automation_events(request: Request, after: int = 0, types: str = None, limit: int = 200):
    require_token(request)
    return integrations.events_since(after, types, limit)


@router.get("/api/automation/state")
def automation_state(request: Request):
    require_token(request)
    shopping = services.get_list()
    return {
        "today": services.today().isoformat(),
        "calendar": services.calendar(services.today().isoformat(), (services.today() + timedelta(days=6)).isoformat()),
        "shopping": [
            {
                "name": item["ingredient"]["display"],
                "needed_qty": item.get("needed_qty"),
                "unit": item["ingredient"]["unit"],
                "checked": bool(item.get("checked")),
            }
            for item in (shopping or {}).get("items", [])
        ],
        "alerts": services.alerts(),
    }


@router.post("/api/automation/shopping")
async def automation_add_item(request: Request):
    require_token(request)
    data = await body_of(request)
    return services.add_list_item({"name": data.get("name"), "qty": data.get("qty"), "unit": data.get("unit"), "source": "automation"})


@router.post("/api/automation/meals")
async def automation_add_meal(request: Request):
    require_token(request)
    data = await body_of(request)
    recipe_id = data.get("recipe_id") or names.match_recipe(data.get("dish") or "")
    if not recipe_id:
        raise services.ServiceError("Dish not found", 404)
    return services.add_meal(
        {
            "recipe_id": recipe_id,
            "date": data.get("date") or services.today().isoformat(),
            "servings": data.get("servings") or services.default_servings(),
            "source": "automation",
        }
    )


@router.get("/api/automation/tomorrow")
def automation_tomorrow(request: Request, lang: str = "en", date: str = None):
    require_token(request)
    lang = "de" if lang.lower().startswith("de") else "en"
    day = date or (services.today() + timedelta(days=1)).isoformat()
    meals = services.shortages_for(day, lang)
    speech = alexa.tomorrow_speech(lang)[0] if not date else None
    return {
        "date": day,
        "meals": meals,
        "has_meals": bool(meals),
        "has_shortages": any(not entry["feasible"] for entry in meals),
        "missing": [item for entry in meals for item in entry["missing"]],
        "speech": speech,
    }


@router.get("/api/integrations")
def integrations_overview():
    return {
        "tokens": integrations.list_tokens(),
        "webhooks": integrations.list_webhooks(),
        "event_types": integrations.EVENT_TYPES,
        "last_export": db.scalar("SELECT MAX(updated_at) FROM nutrition_exports WHERE final = 1"),
    }


@router.post("/api/integrations/tokens")
async def create_token(request: Request):
    data = await body_of(request)
    return integrations.create_token(data.get("name"))


@router.delete("/api/integrations/tokens/{token_id}")
def delete_token(token_id: int):
    return integrations.delete_token(token_id)


@router.post("/api/integrations/webhooks")
async def create_webhook(request: Request):
    data = await body_of(request)
    return integrations.save_webhook(data)


@router.patch("/api/integrations/webhooks/{webhook_id}")
async def update_webhook(webhook_id: int, request: Request):
    data = await body_of(request)
    return integrations.save_webhook(data, webhook_id)


@router.delete("/api/integrations/webhooks/{webhook_id}")
def delete_webhook(webhook_id: int):
    return integrations.delete_webhook(webhook_id)


@router.post("/api/integrations/webhooks/{webhook_id}/test")
def test_webhook(webhook_id: int):
    return integrations.test_webhook(webhook_id)


@router.post("/api/integrations/export-now")
def export_now():
    integrations.daily_export()
    return {"ok": True}
