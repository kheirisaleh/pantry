import io
import json
import time
import urllib.error

import pytest

from app import ai, db


def http_error(code, body=""):
    return urllib.error.HTTPError("https://gemini", code, "error", {}, io.BytesIO(body.encode()))


def answer(payload):
    return {"candidates": [{"content": {"parts": [{"text": json.dumps(payload)}]}}]}


@pytest.fixture()
def keyed(client, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-123456")
    monkeypatch.delenv("GEMINI_MODELS", raising=False)
    return client


def test_schema_conversion():
    converted = ai._schema({"type": "object", "properties": {"a": {"type": "string"}, "b": {"type": "array", "items": {"type": "number"}}}})
    assert converted == {
        "type": "OBJECT",
        "properties": {"a": {"type": "STRING"}, "b": {"type": "ARRAY", "items": {"type": "NUMBER"}}},
        "propertyOrdering": ["a", "b"],
    }


def test_retry_seconds():
    assert ai._retry_seconds("Please retry in 1m30.5s", 600) == 95
    assert ai._retry_seconds("Please retry in 2h0m1s", 600) == 7206
    assert ai._retry_seconds("no hint", 600) == 600


def test_generate_needs_a_key(client):
    with pytest.raises(ai.AIError) as error:
        ai.generate("x", {"type": "object"})
    assert error.value.retry_after == 3600


def test_generate_falls_back_between_models(keyed, monkeypatch):
    calls = []

    def call(name, payload, timeout):
        calls.append(name)
        if name == "gemini-flash-lite-latest":
            raise http_error(429, "quota, retry in 30s")
        return answer({"ok": 1})

    monkeypatch.setattr(ai, "_call", call)
    assert ai.generate("x", {"type": "object"}) == {"ok": 1}
    assert calls == ["gemini-flash-lite-latest", "gemini-flash-latest"]
    assert ai._model_blocked["gemini-flash-lite-latest"] > time.time() + 20
    usage = json.loads(db.get_setting("ai_usage"))["models"]
    assert usage["gemini-flash-lite-latest"]["limited"] == 1 and usage["gemini-flash-latest"]["ok"] == 1
    calls.clear()
    ai.generate("y", {"type": "object"})
    assert calls == ["gemini-flash-latest"]


def test_generate_errors(keyed, monkeypatch):
    monkeypatch.setattr(ai, "_call", lambda name, payload, timeout: (_ for _ in ()).throw(http_error(500)))
    with pytest.raises(ai.AIError, match="server error"):
        ai.generate("x", {})
    monkeypatch.setattr(ai, "_call", lambda name, payload, timeout: (_ for _ in ()).throw(http_error(400, "bad request")))
    with pytest.raises(ai.AIError, match="answered 400"):
        ai.generate("x", {})
    monkeypatch.setattr(ai, "_call", lambda name, payload, timeout: (_ for _ in ()).throw(urllib.error.URLError("down")))
    with pytest.raises(ai.AIError, match="unreachable"):
        ai.generate("x", {})
    monkeypatch.setattr(ai, "_call", lambda name, payload, timeout: {"candidates": []})
    with pytest.raises(ai.AIError, match="no answer"):
        ai.generate("x", {})
    monkeypatch.setattr(ai, "_call", lambda name, payload, timeout: {"candidates": [{"content": {"parts": [{"text": "not json"}]}}]})
    with pytest.raises(ai.AIError, match="invalid JSON"):
        ai.generate("x", {})
    monkeypatch.setattr(ai, "_call", lambda name, payload, timeout: (_ for _ in ()).throw(http_error(404)))
    with pytest.raises(ai.AIError, match="None of the chosen Gemini models is available"):
        ai.generate("x", {})


def test_unavailable_models_are_not_reported_as_quota(keyed, monkeypatch):
    monkeypatch.setattr(ai, "_call", lambda name, payload, timeout: (_ for _ in ()).throw(http_error(404)))
    with pytest.raises(ai.AIError) as first:
        ai.generate("x", {})
    assert "quota" not in str(first.value)
    with pytest.raises(ai.AIError) as second:
        ai.generate("x", {})
    assert "quota" not in str(second.value) and second.value.retry_after >= 60
    keyed.patch("/api/ai/settings", json={"models": ["other"]})
    monkeypatch.setattr(ai, "_call", lambda name, payload, timeout: (_ for _ in ()).throw(http_error(429, "retry in 50s")))
    with pytest.raises(ai.AIError, match="quota"):
        ai.generate("x", {})
    with pytest.raises(ai.AIError, match="quota"):
        ai.generate("x", {})


def test_quota_error_sets_cooldown_and_backoff(client, monkeypatch):
    client.post("/api/ingredients", json={"name": "berenj"})

    def limited(prompt, schema, timeout=90):
        raise ai.AIError("Gemini quota reached", retry_after=120)

    monkeypatch.setattr(ai, "generate", limited)
    assert ai.process_one() is False
    job = db.row("SELECT * FROM ai_jobs")
    assert job["attempts"] == 1 and job["error"] == "Gemini quota reached"
    assert ai.status()["cooldown_seconds"] > 100
    assert db.scalar("SELECT ai_error FROM ingredients") == "Gemini quota reached"
    assert ai.process_one() is False
    woke = client.post("/api/ai/wake").json()
    assert woke["cooldown_seconds"] == 0 and woke["queued"] == 1


def test_crashing_job_is_rescheduled(client, monkeypatch):
    client.post("/api/ingredients", json={"name": "berenj"})
    monkeypatch.setattr(ai, "generate", lambda prompt, schema, timeout=90: {"understood": True, "same_as_id": 0, "unit": None})
    assert ai.process_one() is False
    assert db.row("SELECT attempts, error FROM ai_jobs")["attempts"] == 1


def test_unknown_job_kind_is_dropped(client):
    with db.tx() as c:
        c.execute("INSERT INTO ai_jobs(kind, target_id) VALUES ('nonsense', 1)")
    assert ai.process_one() is False
    assert db.scalar("SELECT COUNT(*) FROM ai_jobs") == 0


def test_disabled_assistant_does_nothing(client, drain):
    client.patch("/api/ai/settings", json={"enabled": False})
    client.post("/api/ingredients", json={"name": "berenj"})
    assert drain() == 0
    client.patch("/api/ai/settings", json={"enabled": True})
    assert drain() == 1


def test_invalid_numbers_from_the_model_are_dropped(client, monkeypatch):
    client.post("/api/ingredients", json={"name": "berenj"})
    from helpers import CATALOG

    monkeypatch.setattr(
        ai,
        "generate",
        lambda prompt, schema, timeout=90: dict(
            CATALOG["berenj"], understood=True, same_as_id=0, aliases=[], protein=90, fat=90, icon="not-an-icon", shelf_days=0
        ),
    )
    assert ai.process_one() is True
    row = db.row("SELECT * FROM ingredients")
    assert row["kcal"] is None and row["protein"] is None and row["icon"] == "sheaf-of-rice" and row["shelf_days"] is None


def test_unrecognised_dish(client, monkeypatch):
    client.post("/api/recipes", json={"name": "qwerty", "slots": [{"items": [{"name": "berenj", "amount": 1}]}]})
    db.conn().execute("DELETE FROM ai_jobs WHERE kind = 'ingredient'")
    monkeypatch.setattr(ai, "generate", lambda prompt, schema, timeout=90: {"understood": False, "image_query": "food"})
    monkeypatch.setitem(ai.HANDLERS, "images", lambda recipe_id: None)
    assert ai.process_one() is True
    recipe = db.row("SELECT * FROM recipes")
    assert recipe["status"] == "unresolved" and recipe["image_query"] == "food"


def test_run_images_picks_the_first_photo(client, monkeypatch):
    from app import images

    client.post("/api/recipes", json={"name": "polo", "slots": [{"items": [{"name": "berenj", "amount": 1}]}]})
    recipe_id = db.scalar("SELECT id FROM recipes")
    monkeypatch.setattr(images, "search_recipe", lambda recipe: [{"url": "https://a/1.jpg"}, {"url": "https://a/2.jpg"}])

    def download(recipe_id, url):
        if url.endswith("1.jpg"):
            raise OSError("broken")
        return "/media/recipes/x.jpg"

    monkeypatch.setattr(images, "download", download)
    ai.run_images(recipe_id)
    recipe = db.row("SELECT * FROM recipes")
    assert recipe["image_path"] == "/media/recipes/x.jpg" and recipe["image_status"] == "set"
    assert json.loads(recipe["image_source"]) == {"url": "https://a/2.jpg"}


def test_settings_and_status_routes(keyed, monkeypatch):
    status = keyed.get("/api/ai").json()
    assert status["key_source"] == "server" and status["key_hint"] == "...3456" and status["jobs"] == []
    saved = keyed.patch("/api/ai/settings", json={"api_key": " stored-key-abcdef ", "models": [" m1 ", "", "m2"]}).json()
    assert saved["key_source"] == "settings" and [entry["name"] for entry in saved["models"]] == ["m1", "m2"]
    assert keyed.patch("/api/ai/settings", json={"models": "m1"}).status_code == 400
    assert keyed.get("/api/ai/models").status_code == 400
    monkeypatch.setattr(ai, "available_models", lambda: [{"name": "gemini-x", "label": "Gemini X"}])
    assert keyed.get("/api/ai/models").json() == {"models": [{"name": "gemini-x", "label": "Gemini X"}]}


def test_model_test_route(keyed, monkeypatch):
    monkeypatch.setattr(ai, "_call", lambda name, payload, timeout: answer({}))
    assert keyed.post("/api/ai/test", json={"model": "m1"}).json()["ok"] is True
    monkeypatch.setattr(ai, "_call", lambda name, payload, timeout: (_ for _ in ()).throw(http_error(429, "retry in 5s")))
    result = keyed.post("/api/ai/test", json={"model": "m1"}).json()
    assert result["ok"] is False and result["error"].startswith("429")
    assert ai._model_blocked["m1"] > time.time()
    monkeypatch.setattr(ai, "_call", lambda name, payload, timeout: (_ for _ in ()).throw(OSError("down")))
    assert keyed.post("/api/ai/test", json={"model": "m1"}).json() == {"ok": False, "error": "down"}


def test_available_models_filters(keyed, monkeypatch):
    import urllib.request

    class Response(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    body = {
        "models": [
            {"name": "models/gemini-a", "displayName": "A", "supportedGenerationMethods": ["generateContent"]},
            {"name": "models/embedding", "supportedGenerationMethods": ["embedContent"]},
        ]
    }
    monkeypatch.setattr(urllib.request, "urlopen", lambda request, timeout=None: Response(json.dumps(body).encode()))
    assert ai.available_models() == [{"name": "gemini-a", "label": "A"}]
