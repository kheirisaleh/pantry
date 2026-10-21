import os

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app import alexa, push


def test_push_encryption_roundtrip(client):
    receiver = ec.generate_private_key(ec.SECP256R1())
    receiver_public = receiver.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    auth = os.urandom(16)
    body = push.encrypt(b'{"title":"x"}', push.b64url(receiver_public), push.b64url(auth))
    salt, key_length = body[:16], body[20]
    sender_public = body[21:21 + key_length]
    ciphertext = body[21 + key_length:]
    shared = receiver.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), sender_public))
    ikm = HKDF(hashes.SHA256(), 32, auth, b"WebPush: info\x00" + receiver_public + sender_public).derive(shared)
    cek = HKDF(hashes.SHA256(), 16, salt, b"Content-Encoding: aes128gcm\x00").derive(ikm)
    nonce = HKDF(hashes.SHA256(), 12, salt, b"Content-Encoding: nonce\x00").derive(ikm)
    assert AESGCM(cek).decrypt(nonce, ciphertext, None) == b'{"title":"x"}\x02'
    assert len(push.public_key()) > 80


def test_alexa_rejects_unsigned(client, monkeypatch):
    monkeypatch.setenv("ALEXA_SKILL_ID", "amzn1.ask.skill.test")
    response = client.post("/alexa", json={"request": {"type": "LaunchRequest"}})
    assert response.status_code == 400
    assert not alexa._valid_cert_url("https://s3.amazonaws.com/evil/echo.api/x.pem")
    assert alexa._valid_cert_url("https://s3.amazonaws.com/echo.api/echo-api-cert.pem")
    assert not alexa._valid_cert_url("https://s3.amazonaws.com:563/echo.api/x.pem")


def test_alexa_intents(client):
    def intent(name, locale="en-US", **slots):
        return {"request": {"type": "IntentRequest", "locale": locale, "intent": {"name": name, "slots": {key: {"name": key, "value": value} for key, value in slots.items()}}}}

    said = alexa.handle(intent("AddItemIntent", item="milk"))["response"]["outputSpeech"]["text"]
    assert "milk" in said
    said = alexa.handle(intent("CheckStockIntent", "de-DE", item="milk"))["response"]["outputSpeech"]["text"]
    assert "kein" in said
    said = alexa.handle(intent("TodayPlanIntent", "de-DE"))["response"]["outputSpeech"]["text"]
    assert "nichts" in said
    said = alexa.handle(intent("CookedIntent", dish="ghormeh"))["response"]["outputSpeech"]["text"]
    assert "could not find" in said
