import io
import os

import pytest

from app import ai, db, images, services


class Response(io.BytesIO):
    def __init__(self, data, content_type):
        super().__init__(data)
        self.headers = {"Content-Type": content_type}

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def test_download_saves_and_replaces(client, monkeypatch):
    monkeypatch.setattr(images.urllib.request, "urlopen", lambda request, timeout=None: Response(b"\xff\xd8data", "image/jpeg; charset=x"))
    first = images.download(7, "https://img.example/a.jpg")
    assert first.startswith("/media/recipes/7-") and first.endswith(".jpg")
    folder = os.path.join(db.DATA_DIR, "media", "recipes")
    os.rename(os.path.join(folder, first.split("/")[-1]), os.path.join(folder, "7-1.jpg"))
    second = images.download(7, "https://img.example/b.jpg")
    assert os.listdir(folder) == [second.split("/")[-1]]


def test_download_rules(client, monkeypatch):
    with pytest.raises(services.ServiceError):
        images.download(1, "http://img.example/a.jpg")
    monkeypatch.setattr(images.urllib.request, "urlopen", lambda request, timeout=None: Response(b"<html>", "text/html"))
    with pytest.raises(services.ServiceError, match="not an image"):
        images.download(1, "https://img.example/a.jpg")
    monkeypatch.setattr(images, "MAX_BYTES", 3)
    monkeypatch.setattr(images.urllib.request, "urlopen", lambda request, timeout=None: Response(b"12345", "image/png"))
    with pytest.raises(services.ServiceError, match="too large"):
        images.download(1, "https://img.example/a.png")


def test_search_recipe_order_and_dedupe(client, monkeypatch):
    seen = []
    monkeypatch.setattr(images, "wikipedia_page", lambda host, title: seen.append(("wiki", host, title)) or [{"url": "https://w/" + host}])
    monkeypatch.setattr(
        images,
        "openverse",
        lambda query, keywords: seen.append(("openverse", query)) or [{"url": "https://w/en"}, {"url": "https://o/" + query}],
    )
    monkeypatch.setattr(images, "pexels", lambda query: seen.append(("pexels", query)) or [])
    found = images.search_recipe(
        {"name_en": "Loobia Polo", "name_fa": "لوبیا پلو", "raw_name": "loobia polo", "image_query": "green bean rice"}
    )
    assert [entry["url"] for entry in found] == [
        "https://w/fa",
        "https://w/en",
        "https://o/Loobia Polo",
        "https://o/loobia polo",
        "https://o/green bean rice",
    ]
    assert seen[0] == ("wiki", "fa", "لوبیا پلو") and seen[-1] == ("pexels", "Loobia Polo food")


def test_search_recipe_reports_failures(client, monkeypatch):
    with pytest.raises(ai.AIError, match="Image search failed"):
        images.search_recipe({"name_en": "Soup", "raw_name": "soup"})
    assert images.search_recipe({}) == []


def test_relevance_and_tags():
    keywords = images._tokens("Loobia Polo with rice")
    assert keywords == {"loobia", "polo", "rice"}
    assert images._relevant("Persian loobia polo and rice", keywords)
    assert not images._relevant("Pizza", keywords)
    assert images._relevant("anything", set())
    assert images._strip_tags("<a href='x'>Jane</a> Doe") == "Jane Doe"


def test_pexels_needs_a_key(monkeypatch):
    monkeypatch.delenv("PEXELS_API_KEY", raising=False)
    assert images.pexels("soup") == []


def test_provider_parsers(monkeypatch):
    answers = {
        "commons": {
            "query": {
                "pages": {
                    "2": {"index": 2, "imageinfo": [{"mime": "image/gif", "url": "https://c/x.gif"}]},
                    "1": {
                        "index": 1,
                        "imageinfo": [
                            {
                                "mime": "image/jpeg",
                                "url": "https://c/a.jpg",
                                "thumburl": "https://c/t.jpg",
                                "descriptionurl": "https://c/page",
                                "extmetadata": {"Artist": {"value": "<b>Ana</b>"}, "LicenseShortName": {"value": "CC BY"}},
                            }
                        ],
                    },
                }
            }
        },
        "pexels": {
            "photos": [
                {"src": {"large": "https://p/l.jpg", "medium": "https://p/m.jpg"}, "url": "https://p/page", "photographer": "Bo"},
                {"src": {}},
            ]
        },
        "openverse": {
            "results": [
                {"url": "https://o/a.jpg", "title": "Loobia polo plate", "creator": "Cy", "license": "by"},
                {"url": "http://o/b.jpg", "title": "Loobia polo"},
                {"url": "https://o/c.jpg", "title": "Pizza"},
            ]
        },
        "wikipedia": {"query": {"pages": {"1": {"title": "Loobia polo", "thumbnail": {"source": "https://w/t.jpg"}}, "2": {"title": "x"}}}},
    }

    def fake(url, headers=None, timeout=20):
        for key, value in answers.items():
            if key in url:
                return value
        raise AssertionError(url)

    monkeypatch.setattr(images, "_get_json", fake)
    monkeypatch.setenv("PEXELS_API_KEY", "k")
    assert images.wikimedia("soup") == [
        {
            "url": "https://c/t.jpg",
            "thumb": "https://c/t.jpg",
            "source": "Wikimedia Commons",
            "page": "https://c/page",
            "credit": "Ana",
            "license": "CC BY",
        }
    ]
    assert images.pexels("soup") == [
        {
            "url": "https://p/l.jpg",
            "thumb": "https://p/m.jpg",
            "source": "Pexels",
            "page": "https://p/page",
            "credit": "Bo",
            "license": "Pexels License",
        }
    ]
    found = images.openverse("loobia polo", {"loobia", "polo"})
    assert [entry["url"] for entry in found] == ["https://o/a.jpg"] and found[0]["license"] == "CC BY"
    wiki = images.wikipedia_page("en", "Loobia polo")
    assert wiki == [
        {
            "url": "https://w/t.jpg",
            "thumb": "https://w/t.jpg",
            "source": "Wikipedia",
            "page": "https://en.wikipedia.org/wiki/Loobia%20polo",
            "credit": "",
            "license": "Wikimedia Commons",
        }
    ]
    combined = images.search("soup")
    assert [entry["source"] for entry in combined] == ["Pexels", "Wikimedia Commons"]


def test_generic_search_failure(monkeypatch):
    monkeypatch.setenv("PEXELS_API_KEY", "k")
    with pytest.raises(ai.AIError, match="Image search failed"):
        images.search("soup")
