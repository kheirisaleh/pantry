from fastapi import APIRouter, Request

from .. import ai, db, names, services
from ..deps import body_of, user_of

router = APIRouter()


@router.get("/api/ingredients")
def ingredients(archived: int = 0):
    return services.list_ingredients(bool(archived))


@router.get("/api/ingredients/search")
def ingredient_search(q: str = ""):
    ids = names.search(q)
    found = services.ingredient_map(ids)
    stock = services.stock_map()
    return [services.ingredient_view(found[key], stock) for key in ids if key in found and not found[key]["archived"]]


@router.post("/api/ingredients")
async def create_ingredient(request: Request):
    data = await body_of(request)
    with db.tx() as c:
        ingredient_id = services.resolve_or_create(c, data.get("name"), user_of(request), data.get("kind"))
    ai.wake()
    return services.get_ingredient(ingredient_id)


@router.get("/api/ingredients/{ingredient_id}")
def ingredient(ingredient_id: int):
    return services.get_ingredient(ingredient_id)


@router.patch("/api/ingredients/{ingredient_id}")
async def update_ingredient(ingredient_id: int, request: Request):
    return services.update_ingredient(ingredient_id, await body_of(request))


@router.post("/api/ingredients/{ingredient_id}/archive")
async def archive_ingredient(ingredient_id: int, request: Request):
    data = await body_of(request)
    services.archive_ingredient(ingredient_id, data.get("archived", True))
    return {"ok": True}


@router.post("/api/ingredients/{ingredient_id}/retry")
def retry_ingredient(ingredient_id: int):
    services.requeue_ingredient(ingredient_id)
    ai.wake()
    return services.get_ingredient(ingredient_id)
