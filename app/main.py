import json
import logging
import os
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from . import ai, db, integrations, scheduler, services
from .routes import ROUTERS

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
WEB_DIR = Path(os.environ.get("WEB_DIR", str(Path(__file__).parent / "web")))
RESERVED_PREFIXES = ("api/", "media/", "alexa/")
_stop = threading.Event()


@asynccontextmanager
async def lifespan(app):
    db.init()
    integrations.init()
    os.makedirs(os.path.join(db.DATA_DIR, "media", "recipes"), exist_ok=True)
    threads = []
    if os.environ.get("PANTRY_WORKERS", "1") == "1":
        for target in (ai.worker, scheduler.worker, integrations.delivery_worker):
            thread = threading.Thread(target=target, args=(_stop,), daemon=True)
            thread.start()
            threads.append(thread)
    yield
    _stop.set()


integrations.install_hooks()

app = FastAPI(title="Pantry", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.exception_handler(services.ServiceError)
async def service_error(request, error):
    return JSONResponse({"error": str(error)}, status_code=error.status)


@app.middleware("http")
async def idempotency(request: Request, call_next):
    op_id = request.headers.get("x-op-id")
    if not op_id or request.method not in ("POST", "PATCH", "PUT", "DELETE") or not request.url.path.startswith("/api/"):
        return await call_next(request)
    stored = db.row("SELECT response FROM processed_ops WHERE op_id = ?", (op_id,))
    if stored:
        payload = json.loads(stored["response"])
        return Response(payload["body"], status_code=payload["status"], media_type="application/json", headers={"x-op-replayed": "1"})
    response = await call_next(request)
    body = b""
    async for chunk in response.body_iterator:
        body += chunk
    if response.status_code < 500:
        with db.tx() as c:
            c.execute(
                "INSERT OR IGNORE INTO processed_ops(op_id, response) VALUES (?, ?)",
                (op_id, json.dumps({"status": response.status_code, "body": body.decode("utf-8", "replace")})),
            )
            c.execute("DELETE FROM processed_ops WHERE created_at < datetime('now', '-30 days')")
    headers = {key: value for key, value in response.headers.items() if key.lower() != "content-length"}
    return Response(body, status_code=response.status_code, headers=headers, media_type=response.media_type)


for router in ROUTERS:
    app.include_router(router)


@app.middleware("http")
async def cache_headers(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path
    if path.startswith("/assets/"):
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return response


if (WEB_DIR / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=WEB_DIR / "assets"), name="assets")


def web_file(path):
    if not path:
        return None
    root = WEB_DIR.resolve()
    candidate = (root / path).resolve()
    if candidate.is_file() and root in candidate.parents:
        return candidate
    return None


@app.api_route("/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
def single_page_app(path: str):
    if path.startswith(RESERVED_PREFIXES) or path in ("api", "alexa", "healthz"):
        return JSONResponse({"error": "not found"}, status_code=404)
    file = web_file(path)
    if file:
        if path.startswith("assets/"):
            return FileResponse(file)
        no_cache = file.name in ("sw.js", "index.html", "manifest.webmanifest")
        return FileResponse(file, headers={"Cache-Control": "no-cache"} if no_cache else {"Cache-Control": "public, max-age=86400"})
    if path.startswith("assets/"):
        return JSONResponse({"error": "not found"}, status_code=404)
    index = WEB_DIR / "index.html"
    if not index.is_file():
        return JSONResponse({"error": "The web app is not built yet. Run npm run build in the frontend folder."}, status_code=503)
    return FileResponse(index, headers={"Cache-Control": "no-cache"})
