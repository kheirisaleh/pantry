from fastapi import Request

from . import db, integrations, services


def user_of(request: Request):
    value = request.headers.get("x-user-id")
    try:
        user_id = int(value)
    except (TypeError, ValueError):
        return None
    return user_id if db.scalar("SELECT 1 FROM users WHERE id = ?", (user_id,)) else None


async def body_of(request: Request):
    try:
        data = await request.json()
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def require_token(request: Request):
    header = request.headers.get("authorization") or ""
    token = header[7:].strip() if header.lower().startswith("bearer ") else (request.query_params.get("token") or "")
    if not integrations.check_token(token):
        raise services.ServiceError("A valid API key is required", 401)
