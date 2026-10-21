import json
import logging
import os

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, JSONResponse

from .. import ai, alexa, cycle, db, integrations, push, services
from ..deps import body_of, user_of

router = APIRouter()


@router.get("/healthz")
def healthz():
    db.scalar("SELECT 1")
    return {"ok": True}


@router.get("/api/bootstrap")
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
        "stores": [
            entry["store"]
            for entry in db.rows("SELECT store, MAX(started_at) AS last FROM shopping_sessions GROUP BY store ORDER BY last DESC LIMIT 12")
        ],
    }


@router.patch("/api/users/{user_id}")
async def rename_user(user_id: int, request: Request):
    data = await body_of(request)
    return services.rename_user(user_id, data.get("name"), data.get("color"))


@router.patch("/api/settings")
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


@router.get("/api/cycle")
def cycle_status():
    return cycle.status()


@router.get("/api/home/week")
def home_week(start: str = None):
    return integrations.week_summary(start)


@router.get("/api/alexa/model/{locale}")
def alexa_model(locale: str):
    return alexa.interaction_model(locale)


@router.post("/api/push/subscribe")
async def push_subscribe(request: Request):
    return push.subscribe(await body_of(request), user_of(request))


@router.post("/api/push/unsubscribe")
async def push_unsubscribe(request: Request):
    data = await body_of(request)
    return push.unsubscribe(data.get("endpoint") or "")


@router.post("/api/push/test")
def push_test():
    return {"sent": push.broadcast("Pantry", "Notifications are working.", "/m/")}


@router.post("/alexa")
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


@router.get("/media/recipes/{name}")
def media(name: str):
    if "/" in name or ".." in name:
        return JSONResponse({"error": "not found"}, status_code=404)
    path = os.path.join(db.DATA_DIR, "media", "recipes", name)
    if not os.path.isfile(path):
        return JSONResponse({"error": "not found"}, status_code=404)
    return FileResponse(path, headers={"Cache-Control": "public, max-age=31536000, immutable"})
