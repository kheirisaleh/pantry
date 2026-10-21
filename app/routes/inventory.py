from fastapi import APIRouter, Request

from .. import ai, services
from ..deps import body_of, user_of

router = APIRouter()


@router.get("/api/inventory")
def inventory():
    return services.inventory()


@router.post("/api/inventory/add")
async def inventory_add(request: Request):
    result = services.manual_add(await body_of(request), user_of(request))
    ai.wake()
    return result


@router.post("/api/inventory/count")
async def stock_count(request: Request):
    data = await body_of(request)
    return services.stock_count(data.get("entries") or [], user_of(request), bool(data.get("full")))


@router.post("/api/inventory/{ingredient_id}/used-up")
def used_up(ingredient_id: int, request: Request):
    return services.used_up(ingredient_id, user_of(request))


@router.post("/api/inventory/{ingredient_id}/waste")
async def waste(ingredient_id: int, request: Request):
    data = await body_of(request)
    return services.waste(ingredient_id, data.get("qty"), data.get("unit"), user_of(request))
