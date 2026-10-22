import base64
import json
import logging
import os
import struct
import time
import urllib.error
import urllib.parse
import urllib.request

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from . import db

log = logging.getLogger("pantry.push")
SUBJECT = os.environ.get("VAPID_SUBJECT", "mailto:admin@example.com")


def b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def b64url_decode(text):
    text = text.strip()
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _raw_public(key):
    return key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)


def vapid_key():
    stored = db.get_setting("vapid_private")
    if stored:
        return serialization.load_pem_private_key(stored.encode("ascii"), password=None)
    key = ec.generate_private_key(ec.SECP256R1())
    pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode("ascii")
    with db.tx() as c:
        db.set_setting("vapid_private", pem, c)
    return key


def public_key():
    return b64url(_raw_public(vapid_key()))


def _jwt(audience, key):
    header = b64url(json.dumps({"typ": "JWT", "alg": "ES256"}).encode())
    claims = b64url(json.dumps({"aud": audience, "exp": int(time.time()) + 12 * 3600, "sub": SUBJECT}).encode())
    signing_input = (header + "." + claims).encode("ascii")
    r, s = decode_dss_signature(key.sign(signing_input, ec.ECDSA(hashes.SHA256())))
    return header + "." + claims + "." + b64url(r.to_bytes(32, "big") + s.to_bytes(32, "big"))


def encrypt(payload, p256dh, auth):
    client_public_bytes = b64url_decode(p256dh)
    auth_secret = b64url_decode(auth)
    client_public = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), client_public_bytes)
    server_key = ec.generate_private_key(ec.SECP256R1())
    server_public_bytes = _raw_public(server_key)
    shared = server_key.exchange(ec.ECDH(), client_public)
    key_info = b"WebPush: info\x00" + client_public_bytes + server_public_bytes
    ikm = HKDF(algorithm=hashes.SHA256(), length=32, salt=auth_secret, info=key_info).derive(shared)
    salt = os.urandom(16)
    cek = HKDF(algorithm=hashes.SHA256(), length=16, salt=salt, info=b"Content-Encoding: aes128gcm\x00").derive(ikm)
    nonce = HKDF(algorithm=hashes.SHA256(), length=12, salt=salt, info=b"Content-Encoding: nonce\x00").derive(ikm)
    ciphertext = AESGCM(cek).encrypt(nonce, payload + b"\x02", None)
    header = salt + struct.pack("!I", 4096) + bytes([len(server_public_bytes)]) + server_public_bytes
    return header + ciphertext


def send_one(subscription, message):
    key = vapid_key()
    endpoint = subscription["endpoint"]
    parsed = urllib.parse.urlparse(endpoint)
    audience = parsed.scheme + "://" + parsed.netloc
    body = encrypt(json.dumps(message).encode("utf-8"), subscription["p256dh"], subscription["auth"])
    request = urllib.request.Request(
        endpoint,
        data=body,
        method="POST",
        headers={
            "Content-Encoding": "aes128gcm",
            "Content-Type": "application/octet-stream",
            "TTL": "86400",
            "Urgency": "normal",
            "Authorization": "vapid t=" + _jwt(audience, key) + ", k=" + b64url(_raw_public(key)),
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return response.status
    except urllib.error.HTTPError as error:
        if error.code in (404, 410):
            with db.tx() as c:
                c.execute("DELETE FROM push_subscriptions WHERE endpoint = ?", (endpoint,))
        log.warning("Push to %s failed with %s", parsed.netloc, error.code)
        return error.code
    except (urllib.error.URLError, OSError) as error:
        log.warning("Push to %s failed: %s", parsed.netloc, error)
        return None


def broadcast(title, body, url="/m"):
    sent = 0
    for subscription in db.rows("SELECT * FROM push_subscriptions"):
        status = send_one(subscription, {"title": title, "body": body, "url": url})
        if status and 200 <= status < 300:
            sent += 1
    return sent


def subscribe(data, user_id=None):
    keys = data.get("keys") or {}
    endpoint = data.get("endpoint") or ""
    if not endpoint.startswith("https://") or not keys.get("p256dh") or not keys.get("auth"):
        from .services import ServiceError

        raise ServiceError("Invalid push subscription")
    with db.tx() as c:
        c.execute(
            "INSERT INTO push_subscriptions(endpoint, p256dh, auth, user_id) VALUES (?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, user_id = excluded.user_id",
            (endpoint, keys["p256dh"], keys["auth"], user_id),
        )
    return {"ok": True}


def unsubscribe(endpoint):
    with db.tx() as c:
        c.execute("DELETE FROM push_subscriptions WHERE endpoint = ?", (endpoint,))
    return {"ok": True}
