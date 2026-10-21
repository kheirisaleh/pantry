from fastapi import APIRouter, Request

from .. import ai, services
from ..deps import body_of, user_of

router = APIRouter()


@router.get("/api/shopping")
def shopping():
    return {"list": services.get_list()}


@router.get("/api/shopping/review")
def shopping_review(start: str, end: str):
    return services.review(start, end)


@router.post("/api/shopping/build")
async def shopping_build(request: Request):
    data = await body_of(request)
    return {"list": services.build_list(data.get("start"), data.get("end"), user_of(request))}


@router.post("/api/shopping/items")
async def shopping_add(request: Request):
    result = services.add_list_item(await body_of(request), user_of(request))
    ai.wake()
    return result


@router.patch("/api/shopping/items/{item_id}")
async def shopping_update(item_id: int, request: Request):
    return {"list": services.update_list_item(item_id, await body_of(request), user_of(request))}


@router.delete("/api/shopping/items/{item_id}")
def shopping_delete(item_id: int):
    return {"list": services.delete_list_item(item_id)}


@router.post("/api/shopping/sessions")
async def shopping_session(request: Request):
    data = await body_of(request)
    return services.start_session(data.get("store"), user_of(request))


@router.post("/api/shopping/sessions/{session_id}/finish")
def shopping_finish(session_id: int, request: Request):
    return {"list": services.finish_session(session_id, user_of(request))}


@router.post("/api/shopping/sessions/{session_id}/pause")
def shopping_pause(session_id: int):
    return {"list": services.pause_session(session_id)}


@router.post("/api/shopping/sessions/{session_id}/resume")
def shopping_resume(session_id: int):
    return {"list": services.resume_session(session_id)}


@router.post("/api/shopping/{list_id}/close")
def shopping_close(list_id: int, request: Request):
    return services.close_list(list_id, user_of(request))
