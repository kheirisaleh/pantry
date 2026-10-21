from fastapi import APIRouter, Request

from .. import ai, db, services
from ..deps import body_of

router = APIRouter()


@router.get("/api/ai")
def ai_status():
    status = ai.status()
    status["jobs"] = db.rows("SELECT kind, target_id, attempts, next_at, error FROM ai_jobs ORDER BY next_at LIMIT 50")
    return status


@router.patch("/api/ai/settings")
async def ai_settings(request: Request):
    data = await body_of(request)
    return ai.update_settings(data)


@router.get("/api/ai/models")
def ai_models():
    try:
        return {"models": ai.available_models()}
    except Exception as error:
        raise services.ServiceError("Could not load the model list: " + str(error)[:200])


@router.post("/api/ai/test")
async def ai_test(request: Request):
    data = await body_of(request)
    return ai.test_model((data.get("model") or "").strip())


@router.post("/api/ai/wake")
def ai_wake():
    with db.tx() as c:
        c.execute("UPDATE ai_jobs SET next_at = datetime('now') WHERE status = 'queued'")
    ai._state["cooldown_until"] = 0
    ai.wake()
    return ai.status()
