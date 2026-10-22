from fastapi import APIRouter, Request

from .. import ai, services
from ..deps import body_of, user_of

router = APIRouter()


@router.get("/api/recipes")
def recipes(archived: int = 0):
    return services.list_recipes(bool(archived))


@router.post("/api/recipes")
async def create_recipe(request: Request):
    result = services.create_recipe(await body_of(request), user_of(request))
    ai.wake()
    return result


@router.get("/api/recipes/{recipe_id}")
def recipe(recipe_id: int):
    return services.get_recipe(recipe_id)


@router.put("/api/recipes/{recipe_id}")
async def update_recipe(recipe_id: int, request: Request):
    result = services.update_recipe(recipe_id, await body_of(request), user_of(request))
    ai.wake()
    return result


@router.post("/api/recipes/{recipe_id}/archive")
async def archive_recipe(recipe_id: int, request: Request):
    data = await body_of(request)
    services.archive_recipe(recipe_id, data.get("archived", True))
    return {"ok": True}


@router.post("/api/recipes/{recipe_id}/images/refresh")
def refresh_images(recipe_id: int):
    services.refresh_images(recipe_id)
    ai.wake()
    return services.get_recipe(recipe_id)


@router.post("/api/recipes/{recipe_id}/images/choose")
async def choose_image(recipe_id: int, request: Request):
    data = await body_of(request)
    try:
        index = int(data.get("index", -1))
    except (TypeError, ValueError):
        raise services.ServiceError("No such image")
    return services.choose_image(recipe_id, index)
