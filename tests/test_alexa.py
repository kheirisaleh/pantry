import base64
from datetime import datetime, timedelta, timezone

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.x509.oid import NameOID

from app import alexa, db, services

SKILL = "amzn1.ask.skill.test"


def intent(name, locale="en-US", attributes=None, **slots):
    payload = {
        "request": {
            "type": "IntentRequest",
            "locale": locale,
            "intent": {"name": name, "slots": {key: {"name": key, "value": value} for key, value in slots.items()}},
        }
    }
    if attributes is not None:
        payload["session"] = {"attributes": attributes}
    return payload


def said(result):
    return result["response"]["outputSpeech"]["text"]


def test_launch_help_stop(client):
    assert said(alexa.handle({"request": {"type": "LaunchRequest"}})).startswith("Pantry here")
    assert said(alexa.handle({"request": {"type": "LaunchRequest", "locale": "de-DE"}})).startswith("Hier ist die Speisekammer")
    assert "Try:" in said(alexa.handle(intent("AMAZON.HelpIntent")))
    assert said(alexa.handle(intent("AMAZON.StopIntent"))) == "Bye."
    assert alexa.handle({"request": {"type": "SessionEndedRequest"}}) == {"version": "1.0", "response": {}}
    assert "did not get that" in said(alexa.handle(intent("AnswerQuantityIntent", amount="2")))


def test_add_item_dialogue(client, kitchen):
    first = alexa.handle(intent("AddItemIntent", item="milk"))
    assert said(first) == "How much milk? For example 500 grams, 2 pieces or one pack."
    pending = first["sessionAttributes"]["pending"]
    second = alexa.handle(intent("AnswerQuantityIntent", attributes={"pending": pending}, amount="2"))
    assert said(second) == "2 what? Grams, kilos, liters, pieces or packs?"
    third = alexa.handle(intent("AnswerQuantityIntent", attributes=second["sessionAttributes"], unit="liters"))
    assert said(third) == "Added 2 liters milk to the shopping list. Anything else?"
    item = client.get("/api/shopping").json()["list"]["items"][0]
    assert item["needed_qty"] == 2000.0 and item["source"] == "alexa"


def test_add_item_in_one_sentence_and_without_amount(client, kitchen):
    kitchen.ingredient("tokhm morgh")
    assert (
        said(alexa.handle(intent("AddItemIntent", item="eggs", amount="6"))) == "Added 6 pieces Eggs to the shopping list. Anything else?"
    )
    first = alexa.handle(intent("AddItemIntent", item="sugar"))
    answer = alexa.handle(intent("AMAZON.NoIntent", attributes=first["sessionAttributes"]))
    assert said(answer) == "Added sugar to the shopping list without an amount. Anything else?"
    assert said(alexa.handle(intent("AddItemIntent", item="rice", amount="2", unit="packs"))).startswith(
        "Added rice to the shopping list, 2 packs"
    )


def test_check_stock_and_ran_out(client, kitchen):
    kitchen.stock("berenj", 1500)
    assert said(alexa.handle(intent("CheckStockIntent", item="berenj"))) == "We have about 1.5 kilos of Basmati rice. Anything else?"
    assert said(alexa.handle(intent("CheckStockIntent", "de-DE", item="berenj"))) == "Wir haben ungefähr 1.5 Kilo Basmatireis. Noch etwas?"
    assert "do not know" in said(alexa.handle(intent("CheckStockIntent", item="unicorn")))
    assert said(alexa.handle(intent("RanOutIntent", item="berenj"))).startswith("Got it, Basmati rice is marked as used up")
    assert said(alexa.handle(intent("CheckStockIntent", item="berenj"))) == "We have no Basmati rice left. Anything else?"


def test_plan_read_and_cook(client, kitchen):
    recipe = kitchen.recipe()
    tomorrow = kitchen.day(1)
    ask = alexa.handle(intent("PlanMealIntent", dish="loobia polo"))
    assert said(ask) == "For which day should I plan Loobia Polo?"
    planned = alexa.handle(intent("AnswerDateIntent", attributes=ask["sessionAttributes"], date=tomorrow))
    assert said(planned) == "Planned Loobia Polo for tomorrow, for 2 people. Anything else?"
    past = alexa.handle(intent("PlanMealIntent", dish="loobia polo", date=kitchen.day(-3)))
    assert said(past).startswith("That day is in the past")
    assert said(alexa.handle(intent("PlanForDayIntent", date=tomorrow))) == "Planned for tomorrow: Loobia Polo for 2. Anything else?"
    assert said(alexa.handle(intent("TodayPlanIntent"))) == "Nothing is planned for today. Anything else?"
    assert said(alexa.handle(intent("ListDishesIntent"))) == "You have 1 dishes: Loobia Polo. Anything else?"
    assert "could not find" in said(alexa.handle(intent("PlanMealIntent", dish="pizza")))
    cooked = alexa.handle(intent("CookedIntent", dish="loobia polo"))
    assert said(cooked).startswith("Noted. Loobia Polo is cooked. Some ingredients were not in the pantry")
    assert db.scalar("SELECT COUNT(*) FROM meals WHERE status = 'cooked' AND recipe_id = ?", (recipe["id"],)) == 1


def test_read_list(client, kitchen):
    assert said(alexa.handle(intent("ReadListIntent"))) == "The shopping list is empty. Anything else?"
    kitchen.ingredient("tokhm morgh")
    client.post("/api/shopping/items", json={"name": "tokhm morgh", "qty": 6, "unit": "pcs"})
    client.post("/api/shopping/items", json={"name": "bread", "note": "2 loaves"})
    assert said(alexa.handle(intent("ReadListIntent"))) == "2 things on the shopping list: 6 pieces Eggs and 2 loaves bread. Anything else?"
    assert (
        said(alexa.handle(intent("ReadListIntent", "de-DE")))
        == "2 Sachen auf der Einkaufsliste: Eier 6 Stück und bread 2 loaves. Noch etwas?"
    )


def test_tomorrow_check_and_add_missing(client, kitchen):
    assert said(alexa.handle(intent("TomorrowCheckIntent"))) == "Nothing is planned for tomorrow yet."
    recipe = kitchen.recipe()
    kitchen.meal(recipe["id"], 1, servings=1)
    ask = alexa.handle(intent("TomorrowCheckIntent"))
    assert said(ask).startswith("For Loobia Polo tomorrow you are missing 100 grams Basmati rice")
    assert said(ask).endswith("Should I put them on the shopping list?")
    done = alexa.handle(intent("AMAZON.YesIntent", attributes=ask["sessionAttributes"]))
    assert said(done) == "Done, the missing items are on the shopping list."
    names = {item["ingredient"]["display"] for item in client.get("/api/shopping").json()["list"]["items"]}
    assert {"Basmati rice", "Ground beef", "Green beans"} <= names


def test_interaction_model(client, kitchen):
    kitchen.recipe()
    model = client.get("/api/alexa/model/de-DE").json()["interactionModel"]["languageModel"]
    assert model["invocationName"] == "meine speisekammer"
    types = {entry["name"]: entry["values"] for entry in model["types"]}
    assert types["DISH"][0]["name"]["value"] == "Loobia Polo"
    assert any(value["name"]["value"] == "Basmatireis" for value in types["ITEM"])
    assert all(char < "؀" or char > "ۿ" for value in types["ITEM"] for synonym in value["name"]["synonyms"] for char in synonym)
    assert {intent["name"] for intent in model["intents"]} >= {"AddItemIntent", "CookedIntent", "AMAZON.HelpIntent"}
    english = client.get("/api/alexa/model/en-US").json()["interactionModel"]["languageModel"]
    assert english["invocationName"] == "pantry home"


def test_parsers():
    assert alexa._parse_unit("Kilos") == "kg" and alexa._parse_unit("packungen") == "pack" and alexa._parse_unit("") is None
    assert alexa._parse_amount("2,5") == 2.5 and alexa._parse_amount("?") is None and alexa._parse_amount("-1") is None
    assert alexa._parse_date("2026-W10", "en").isoformat() == "2026-03-02"
    assert alexa._parse_date("next week", "en") is None
    assert alexa._speak_qty(1, "pcs", "en") == "1 piece" and alexa._speak_qty(250, "ml", "de") == "250 Milliliter"


def test_endpoint_rejects_unsigned_requests(client, monkeypatch):
    assert client.post("/alexa", content=b"not json").status_code == 400
    assert client.post("/alexa", json={"request": {"type": "LaunchRequest"}}).status_code == 400
    monkeypatch.setenv("ALEXA_SKILL_ID", SKILL)
    response = client.post("/alexa", json={"request": {"type": "LaunchRequest"}})
    assert response.status_code == 400 and response.json() == {"error": "forbidden"}


def test_certificate_url_rules():
    assert alexa._valid_cert_url("https://s3.amazonaws.com/echo.api/echo-api-cert.pem")
    assert alexa._valid_cert_url("https://s3.amazonaws.com:443/echo.api/../echo.api/cert.pem")
    assert not alexa._valid_cert_url("https://s3.amazonaws.com/evil/echo.api/x.pem")
    assert not alexa._valid_cert_url("https://s3.amazonaws.com:563/echo.api/x.pem")
    assert not alexa._valid_cert_url("http://s3.amazonaws.com/echo.api/x.pem")
    assert not alexa._valid_cert_url("https://evil.com/echo.api/x.pem")


@pytest.fixture()
def signer(monkeypatch):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "echo-api.amazon.com")])
    now = datetime.now(timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(1)
        .not_valid_before(now - timedelta(days=1))
        .not_valid_after(now + timedelta(days=1))
        .sign(key, hashes.SHA256())
    )
    monkeypatch.setattr(alexa, "_load_chain", lambda url: cert)
    monkeypatch.setenv("ALEXA_SKILL_ID", SKILL)
    return key


def signed_post(client, key, payload):
    import json

    body = json.dumps(payload).encode()
    signature = base64.b64encode(key.sign(body, padding.PKCS1v15(), hashes.SHA256())).decode()
    return client.post(
        "/alexa",
        content=body,
        headers={
            "content-type": "application/json",
            "signature-256": signature,
            "signaturecertchainurl": "https://s3.amazonaws.com/echo.api/echo-api-cert.pem",
        },
    )


def request_payload(skill=SKILL, stamp=None):
    return {
        "context": {"System": {"application": {"applicationId": skill}}},
        "request": {
            "type": "LaunchRequest",
            "locale": "en-US",
            "timestamp": stamp or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        },
    }


def test_signed_request_is_answered(client, signer):
    response = signed_post(client, signer, request_payload())
    assert response.status_code == 200 and response.json()["response"]["outputSpeech"]["text"].startswith("Pantry here")


def test_signed_request_checks(client, signer):
    assert signed_post(client, signer, request_payload(skill="amzn1.ask.skill.other")).status_code == 400
    stale = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
    assert signed_post(client, signer, request_payload(stamp=stale)).status_code == 400
    assert signed_post(client, signer, request_payload(stamp="yesterday")).status_code == 400
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    assert signed_post(client, other, request_payload()).status_code == 400


def test_skill_id_from_settings(client):
    client.patch("/api/settings", json={"alexa_skill_id": SKILL})
    assert alexa._skill_id() == SKILL
    assert services.today()
