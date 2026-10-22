import pytest

from app import main


@pytest.fixture()
def web(client, tmp_path, monkeypatch):
    folder = tmp_path / "web"
    (folder / "assets").mkdir(parents=True)
    (folder / "icons").mkdir()
    (folder / "index.html").write_text("<!doctype html><div id=root></div>")
    (folder / "sw.js").write_text("self.x = 1;")
    (folder / "assets" / "index-abc.js").write_text("console.log(1)")
    (folder / "icons" / "egg.svg").write_text("<svg/>")
    monkeypatch.setattr(main, "WEB_DIR", folder)
    return client


def test_pages_fall_back_to_the_app(web):
    for path in ("/", "/plan", "/m", "/m/shop", "/recipes/anything"):
        response = web.get(path)
        assert response.status_code == 200 and "root" in response.text
        assert response.headers["cache-control"] == "no-cache"
    assert web.head("/m/plan").status_code == 200


def test_files_and_cache_headers(web):
    worker = web.get("/sw.js")
    assert worker.text == "self.x = 1;" and worker.headers["cache-control"] == "no-cache"
    icon = web.get("/icons/egg.svg")
    assert icon.status_code == 200 and icon.headers["cache-control"] == "public, max-age=86400"
    assert web.get("/assets/index-abc.js").headers["cache-control"] == "public, max-age=31536000, immutable"


def test_reserved_paths_and_escapes_are_not_the_app(web):
    assert web.get("/api/nothing").status_code == 404
    assert web.get("/media/nothing").status_code == 404
    assert web.get("/assets/missing.js").status_code == 404
    assert web.get("/healthz").json() == {"ok": True}
    assert "root" in web.get("/..%2Fpantry.db").text


def test_missing_build_is_reported(client, tmp_path, monkeypatch):
    monkeypatch.setattr(main, "WEB_DIR", tmp_path / "nothing")
    response = client.get("/plan")
    assert response.status_code == 503
    assert "npm run build" in response.json()["error"]
