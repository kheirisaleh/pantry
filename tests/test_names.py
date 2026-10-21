from app import db, names


def test_normalize():
    assert names.normalize("  Gemüse-Brühe!! ") == "gemuse bruhe"
    assert names.normalize("Straße") == "strasse"
    assert names.normalize("كيك") == "کیک"
    assert names.normalize("") == "" and names.compact("Loobia  Polo") == "loobiapolo"


def test_match_ingredient(client, kitchen):
    rice = kitchen.ingredient("berenj")
    assert names.match_ingredient("Berenj") == rice["id"]
    assert names.match_ingredient("basmati rice") == rice["id"]
    assert names.match_ingredient("basmati rise") == rice["id"]
    assert names.match_ingredient("bere") is None
    assert names.match_ingredient("") is None
    with db.tx() as c:
        c.execute("UPDATE ingredients SET archived = 1")
    assert names.match_ingredient("berenj") is None


def test_match_recipe(client, kitchen):
    recipe = kitchen.recipe()
    assert names.match_recipe("loobia polo") == recipe["id"]
    assert names.match_recipe("Lubia Polo", threshold=0.72) == recipe["id"]
    assert names.match_recipe("لوبیا پلو") == recipe["id"]
    assert names.match_recipe("pizza") is None and names.match_recipe("") is None


def test_search_ranks_prefixes(client, kitchen):
    kitchen.ingredient("berenj")
    kitchen.ingredient("panir")
    assert names.search("fe") == [db.scalar("SELECT id FROM ingredients WHERE name_en = 'Feta cheese'")]
    assert names.search("   ") == []
