from fastapi import APIRouter, Request

from .. import services
from ..deps import user_of

router = APIRouter()


@router.get("/api/alerts")
def alerts(status: str = "open"):
    return services.alerts(status)


@router.post("/api/alerts/{alert_id}/dismiss")
def dismiss(alert_id: int):
    services.dismiss_alert(alert_id)
    return {"ok": True}


@router.post("/api/alerts/{alert_id}/act")
def act(alert_id: int, request: Request):
    return services.act_on_alert(alert_id, user_of(request))
