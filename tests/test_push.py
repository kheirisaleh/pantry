import io
import json
import os
import urllib.error
import urllib.request

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app import db, push


def browser_keys():
    receiver = ec.generate_private_key(ec.SECP256R1())
    public = receiver.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return receiver, public, os.urandom(16)


def test_encryption_roundtrip(client):
    receiver, receiver_public, auth = browser_keys()
    body = push.encrypt(b'{"title":"x"}', push.b64url(receiver_public), push.b64url(auth))
    salt, key_length = body[:16], body[20]
    sender_public = body[21 : 21 + key_length]
    ciphertext = body[21 + key_length :]
    shared = receiver.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), sender_public))
    ikm = HKDF(hashes.SHA256(), 32, auth, b"WebPush: info\x00" + receiver_public + sender_public).derive(shared)
    cek = HKDF(hashes.SHA256(), 16, salt, b"Content-Encoding: aes128gcm\x00").derive(ikm)
    nonce = HKDF(hashes.SHA256(), 12, salt, b"Content-Encoding: nonce\x00").derive(ikm)
    assert AESGCM(cek).decrypt(nonce, ciphertext, None) == b'{"title":"x"}\x02'


def test_vapid_key_is_stable(client):
    first = push.public_key()
    assert len(first) > 80 and push.public_key() == first


def test_subscribe_and_unsubscribe(client):
    _receiver, public, auth = browser_keys()
    subscription = {"endpoint": "https://push.example/abc", "keys": {"p256dh": push.b64url(public), "auth": push.b64url(auth)}}
    assert client.post("/api/push/subscribe", json=subscription).json() == {"ok": True}
    assert client.post("/api/push/subscribe", json=subscription).json() == {"ok": True}
    assert db.scalar("SELECT user_id FROM push_subscriptions") == 1
    assert client.post("/api/push/subscribe", json={"endpoint": "http://push.example/abc", "keys": subscription["keys"]}).status_code == 400
    assert client.post("/api/push/subscribe", json={"endpoint": "https://push.example/abc"}).status_code == 400
    assert client.post("/api/push/unsubscribe", json={"endpoint": "https://push.example/abc"}).json() == {"ok": True}
    assert db.scalar("SELECT COUNT(*) FROM push_subscriptions") == 0


def test_broadcast_sends_signed_requests_and_drops_gone_endpoints(client, monkeypatch):
    _receiver, public, auth = browser_keys()
    for endpoint in ("https://push.example/ok", "https://push.example/gone"):
        client.post("/api/push/subscribe", json={"endpoint": endpoint, "keys": {"p256dh": push.b64url(public), "auth": push.b64url(auth)}})
    sent = []

    class Response:
        status = 201

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    def urlopen(request, timeout=None):
        sent.append(request)
        if request.full_url.endswith("gone"):
            raise urllib.error.HTTPError(request.full_url, 410, "gone", {}, io.BytesIO())
        return Response()

    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    assert client.post("/api/push/test").json() == {"sent": 1}
    headers = {key.lower(): value for key, value in sent[0].header_items()}
    assert headers["content-encoding"] == "aes128gcm" and headers["authorization"].startswith("vapid t=")
    header, claims, _signature = headers["authorization"][8:].split(",")[0].split(".")
    decoded = json.loads(push.b64url_decode(claims))
    assert decoded["aud"] == "https://push.example"
    assert [row["endpoint"] for row in db.rows("SELECT endpoint FROM push_subscriptions")] == ["https://push.example/ok"]


def test_unreachable_push_service(client, monkeypatch):
    _receiver, public, auth = browser_keys()
    client.post(
        "/api/push/subscribe",
        json={"endpoint": "https://push.example/x", "keys": {"p256dh": push.b64url(public), "auth": push.b64url(auth)}},
    )
    assert push.broadcast("t", "b") == 0
    assert db.scalar("SELECT COUNT(*) FROM push_subscriptions") == 1
