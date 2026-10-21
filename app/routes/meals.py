from fastapi import APIRouter, Request

from .. import ai, services
from ..deps import body_of, user_of

router = APIRouter()


@router.get("/api/calendar")
def calendar(start: str, end: str):
    return services.calendar(start, end)


@router.post("/api/meals")
async def add_meal(request: Request):
    return services.add_meal(await body_of(request), user_of(request))


@router.patch("/api/meals/{meal_id}")
async def update_meal(meal_id: int, request: Request):
    return services.update_meal(meal_id, await body_of(request))


@router.delete("/api/meals/{meal_id}")
def delete_meal(meal_id: int):
    services.delete_meal(meal_id)
    return {"ok": True}


@router.post("/api/meals/{meal_id}/move")
async def move_meal(meal_id: int, request: Request):
    data = await body_of(request)
    return services.move_meal(meal_id, data)


@router.post("/api/meals/{meal_id}/uncook")
def uncook(meal_id: int):
    return services.uncook(meal_id)


@router.get("/api/suggestions")
def suggestions(date: str, meal_id: int = None, servings: float = None):
    return services.suggestions(date, meal_id, servings)


@router.post("/api/cook/preview")
async def cook_preview(request: Request):
    data = await body_of(request)
    return services.cook_preview(
        data.get("meal_id"), data.get("recipe_id"), data.get("servings"), data.get("choices"), data.get("optional_items")
    )


@router.post("/api/cook")
async def cook(request: Request):
    return services.cook(await body_of(request), user_of(request))


@router.post("/api/snacks")
async def snack(request: Request):
    result = services.log_snack(await body_of(request), user_of(request))
    ai.wake()
    return result


@router.delete("/api/snacks/{snack_id}")
def delete_snack(snack_id: int):
    services.delete_snack(snack_id)
    return {"ok": True}
