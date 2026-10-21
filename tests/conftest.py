import os
import sys
import urllib.request

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
sys.path.insert(0, os.path.dirname(__file__))
os.environ["PANTRY_WORKERS"] = "0"
os.environ.pop("GEMINI_API_KEY", None)
os.environ.pop("PEXELS_API_KEY", None)
os.environ.pop("ALEXA_SKILL_ID", None)


class NetworkBlocked(OSError):
    pass


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    calls = []

    def blocked(request, *args, **kwargs):
        calls.append(getattr(request, "full_url", request))
        raise NetworkBlocked("network is disabled in tests")

    monkeypatch.setattr(urllib.request, "urlopen", blocked)
    return calls


@pytest.fixture()
def client(tmp_path, monkeypatch):
    from app import ai, db

    monkeypatch.setattr(db, "DATA_DIR", str(tmp_path))
    db.set_path(str(tmp_path / "pantry.db"))
    ai._model_blocked.clear()
    ai._model_errors.clear()
    ai._model_unavailable.clear()
    ai._state.update(last_error=None, last_ok=None, cooldown_until=0.0)
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as test_client:
        test_client.headers.update({"x-user-id": "1"})
        yield test_client


@pytest.fixture()
def drain(client, monkeypatch):
    from app import ai
    from helpers import fake_generate

    monkeypatch.setattr(ai, "generate", fake_generate)
    monkeypatch.setitem(ai.HANDLERS, "images", lambda recipe_id: None)

    def run():
        count = 0
        while ai.process_one():
            count += 1
        return count

    return run


@pytest.fixture()
def kitchen(client, drain):
    from helpers import Kitchen

    return Kitchen(client, drain)
