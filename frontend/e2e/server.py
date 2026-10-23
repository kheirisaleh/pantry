import os
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = Path(tempfile.mkdtemp(prefix="pantry-e2e-"))
os.environ["DATA_DIR"] = str(DATA)
os.environ["BACKUP_DIR"] = str(DATA / "backups")
os.environ["PANTRY_WORKERS"] = "0"
os.environ["GEMINI_API_KEY"] = ""
os.environ.pop("PEXELS_API_KEY", None)
os.environ.setdefault("WEB_DIR", str(ROOT / "app" / "web"))
sys.path.insert(0, str(ROOT))

import uvicorn  # noqa: E402

from app import ai, db  # noqa: E402

db.DATA_DIR = str(DATA)
db.set_path(str(DATA / "pantry.db"))

from app import main  # noqa: E402

KNOWN = {
    "eggs": dict(name_en="Eggs", name_fa="تخم مرغ", name_de="Eier", category="eggs", unit="pcs", sold_by_piece=True, piece_amount=60, kcal=78, protein=6.5, icon="egg"),
    "tomatoes": dict(name_en="Tomatoes", name_fa="گوجه فرنگی", name_de="Tomaten", category="vegetables", unit="g", sold_by_piece=True, piece_amount=120, kcal=18, protein=1, icon="tomato"),
    "rice": dict(name_en="Basmati rice", name_fa="برنج", name_de="Basmatireis", category="grains", unit="g", kcal=350, protein=7, icon="cooked-rice"),
    "lentils": dict(name_en="Red lentils", name_fa="عدس", name_de="Rote Linsen", category="legumes", unit="g", kcal=340, protein=24, icon="beans"),
    "tuna": dict(name_en="Tuna", name_fa="تن ماهی", name_de="Thunfisch", category="canned", unit="g", kcal=116, protein=26, icon="package", package_amount=150),
    "milk": dict(name_en="Milk", name_fa="شیر", name_de="Milch", category="dairy", unit="ml", kcal=64, protein=3.4, icon="glass-of-milk"),
}


def offline(*args, **kwargs):
    raise OSError("network is switched off for end to end tests")


def fake_generate(prompt, schema, timeout=90):
    typed = prompt.split('"')[1].lower() if '"' in prompt else "dish"
    if "same_as_id" in schema.get("properties", {}):
        base = dict(name_en=typed.title(), name_fa="", name_de=typed.title(), category="other", unit="g", sold_by_piece=False, piece_amount=0, kcal=100, protein=5, icon="package")
        base.update(KNOWN.get(typed, {}))
        return dict(base, understood=True, same_as_id=0, aliases=[], kind="food", fat=1, carbs=10, fiber=1, tolerance_pct=0, shelf_days=7)
    return {"understood": True, "name_en": typed.title(), "name_fa": "", "name_de": typed.title(), "description": "A test dish.", "tags": ["test"], "cook_minutes": 20, "image_query": typed}


def assistant():
    while True:
        try:
            while ai.process_one():
                pass
        except Exception as error:
            print("fake assistant failed:", error, flush=True)
        time.sleep(0.3)


urllib.request.urlopen = offline
ai.generate = fake_generate
ai.HANDLERS["images"] = lambda recipe_id: None

if __name__ == "__main__":
    threading.Thread(target=assistant, daemon=True).start()
    uvicorn.run(main.app, host="127.0.0.1", port=int(os.environ.get("E2E_PORT", "8765")), log_level="warning")
