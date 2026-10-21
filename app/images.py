import json
import os
import time
import urllib.parse
import urllib.request

from . import db

USER_AGENT = "PantryHomeServer/1.0 (self hosted meal planner)"
MAX_BYTES = 8 * 1024 * 1024
ALLOWED_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}


def media_dir():
    path = os.path.join(db.DATA_DIR, "media", "recipes")
    os.makedirs(path, exist_ok=True)
    return path


def _get_json(url, headers=None, timeout=20):
    request = urllib.request.Request(url, headers=dict({"User-Agent": USER_AGENT}, **(headers or {})))
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def wikimedia(query, limit=8):
    params = {
        "action": "query", "format": "json", "generator": "search", "gsrnamespace": "6",
        "gsrsearch": "filetype:bitmap " + query, "gsrlimit": str(limit), "prop": "imageinfo",
        "iiprop": "url|extmetadata|mime", "iiurlwidth": "900",
    }
    data = _get_json("https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(params))
    pages = sorted((data.get("query") or {}).get("pages", {}).values(), key=lambda page: page.get("index", 0))
    results = []
    for page in pages:
        info = (page.get("imageinfo") or [{}])[0]
        if info.get("mime") not in ALLOWED_TYPES:
            continue
        meta = info.get("extmetadata") or {}
        author = (meta.get("Artist") or {}).get("value", "")
        license_name = (meta.get("LicenseShortName") or {}).get("value", "")
        results.append({
            "url": info.get("thumburl") or info.get("url"),
            "thumb": info.get("thumburl") or info.get("url"),
            "source": "Wikimedia Commons",
            "page": info.get("descriptionurl"),
            "credit": _strip_tags(author)[:120],
            "license": license_name,
        })
    return results


def pexels(query, limit=8):
    key = (os.environ.get("PEXELS_API_KEY") or "").strip()
    if not key:
        return []
    params = {"query": query, "per_page": str(limit), "orientation": "landscape"}
    data = _get_json("https://api.pexels.com/v1/search?" + urllib.parse.urlencode(params), headers={"Authorization": key})
    return [
        {
            "url": photo["src"].get("large") or photo["src"].get("original"),
            "thumb": photo["src"].get("medium") or photo["src"].get("small"),
            "source": "Pexels",
            "page": photo.get("url"),
            "credit": photo.get("photographer"),
            "license": "Pexels License",
        }
        for photo in data.get("photos", [])
        if photo.get("src")
    ]


def _strip_tags(text):
    output = []
    inside = False
    for char in text or "":
        if char == "<":
            inside = True
        elif char == ">":
            inside = False
        elif not inside:
            output.append(char)
    return "".join(output).strip()


def search(query):
    results = []
    errors = []
    for provider in (pexels, wikimedia):
        try:
            results.extend(provider(query))
        except Exception as error:
            errors.append(str(error))
    if not results and errors:
        from .ai import AIError

        raise AIError("Image search failed: " + "; ".join(errors)[:200], retry_after=900)
    seen = set()
    unique = []
    for entry in results:
        if entry["url"] and entry["url"] not in seen:
            seen.add(entry["url"])
            unique.append(entry)
    return unique[:12]


def download(recipe_id, url):
    if not url.startswith("https://"):
        from .services import ServiceError

        raise ServiceError("Only secure image links are allowed")
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=30) as response:
        content_type = (response.headers.get("Content-Type") or "").split(";")[0].strip()
        if content_type not in ALLOWED_TYPES:
            from .services import ServiceError

            raise ServiceError("The link is not an image")
        data = response.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        from .services import ServiceError

        raise ServiceError("The image is too large")
    name = str(recipe_id) + "-" + str(int(time.time())) + ALLOWED_TYPES[content_type]
    folder = media_dir()
    for old in os.listdir(folder):
        if old.startswith(str(recipe_id) + "-"):
            try:
                os.remove(os.path.join(folder, old))
            except OSError:
                pass
    with open(os.path.join(folder, name), "wb") as handle:
        handle.write(data)
    return "/media/recipes/" + name


STOP_WORDS = {"with", "and", "the", "persian", "iranian", "dish", "food", "style", "recipe", "of", "a", "in"}


def _tokens(text):
    cleaned = "".join(char.lower() if char.isalnum() else " " for char in text or "")
    return {word for word in cleaned.split() if len(word) > 2 and word not in STOP_WORDS}


def _relevant(title, keywords):
    if not keywords:
        return True
    words = _tokens(title)
    return all(word in words or any(word in other or other in word for other in words) for word in keywords)


def wikipedia_page(host, title):
    params = {
        "action": "query", "format": "json", "titles": title, "redirects": "1",
        "prop": "pageimages", "piprop": "thumbnail", "pithumbsize": "900",
    }
    data = _get_json("https://" + host + ".wikipedia.org/w/api.php?" + urllib.parse.urlencode(params))
    results = []
    for page in (data.get("query") or {}).get("pages", {}).values():
        thumb = (page.get("thumbnail") or {}).get("source")
        if thumb and thumb.startswith("https://"):
            results.append({
                "url": thumb, "thumb": thumb, "source": "Wikipedia",
                "page": "https://" + host + ".wikipedia.org/wiki/" + urllib.parse.quote(page.get("title", "")),
                "credit": "", "license": "Wikimedia Commons",
            })
    return results


def openverse(query, keywords, limit=20):
    params = {"q": query, "page_size": str(limit), "mature": "false"}
    data = _get_json("https://api.openverse.org/v1/images/?" + urllib.parse.urlencode(params), timeout=45)
    results = []
    for item in data.get("results", []):
        url = item.get("url") or ""
        if not url.startswith("https://") or not _relevant(item.get("title", ""), keywords):
            continue
        results.append({
            "url": url, "thumb": item.get("thumbnail") or url, "source": "Openverse",
            "page": item.get("foreign_landing_url"), "credit": (item.get("creator") or "")[:120],
            "license": ("CC " + (item.get("license") or "")).strip().upper(),
        })
    return results


def search_recipe(recipe):
    name_en = (recipe.get("name_en") or "").strip()
    name_fa = (recipe.get("name_fa") or "").strip()
    raw = (recipe.get("raw_name") or "").strip()
    short_query = (recipe.get("image_query") or "").strip()
    keywords = _tokens(name_en) or _tokens(raw)
    steps = []
    if name_fa:
        steps.append(lambda: wikipedia_page("fa", name_fa))
    for title in (name_en, raw):
        if title:
            steps.append(lambda title=title: wikipedia_page("en", title))
    for query in (name_en, raw, short_query):
        if query:
            steps.append(lambda query=query: openverse(query, keywords))
    if name_en:
        steps.append(lambda: pexels(name_en + " food"))
    results = []
    errors = []
    seen = set()
    for step in steps:
        try:
            found = step()
        except Exception as error:
            errors.append(str(error))
            continue
        for entry in found:
            if entry["url"] not in seen:
                seen.add(entry["url"])
                results.append(entry)
        if len(results) >= 12:
            break
    if not results and errors:
        from .ai import AIError

        raise AIError("Image search failed: " + "; ".join(errors)[:200], retry_after=900)
    return results[:12]
