"""ID-token verification against cached JWKS (Google, Apple) and the Google web code flow."""
from __future__ import annotations

import base64
import hashlib
import secrets
import threading
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

import httpx
import jwt

GOOGLE_JWKS = "https://www.googleapis.com/oauth2/v3/certs"
GOOGLE_ISSUERS = ("https://accounts.google.com", "accounts.google.com")
GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"
APPLE_JWKS = "https://appleid.apple.com/auth/keys"
APPLE_ISSUERS = ("https://appleid.apple.com",)


class TokenInvalid(Exception):
    pass


Fetch = Callable[[str], dict[str, Any]]


def http_fetch_json(transport: httpx.BaseTransport | None = None) -> Fetch:
    def fetch(url: str) -> dict[str, Any]:
        with httpx.Client(transport=transport, timeout=10.0) as c:
            r = c.get(url)
            r.raise_for_status()
            return r.json()
    return fetch


class JwksCache:
    """Caches a JWKS document; refetches on unknown kid at most once per `min_refetch` seconds."""

    def __init__(self, url: str, fetch: Fetch, ttl: float = 3600.0, min_refetch: float = 60.0):
        self.url, self._fetch, self.ttl, self.min_refetch = url, fetch, ttl, min_refetch
        self._keys: dict[str, jwt.PyJWK] = {}
        self._fetched_at = 0.0
        self._lock = threading.Lock()

    def _refresh(self) -> None:
        doc = self._fetch(self.url)
        keys = {}
        for k in doc.get("keys", []):
            if "kid" in k:
                try:
                    keys[k["kid"]] = jwt.PyJWK(k)
                except jwt.PyJWTError:
                    continue
        self._keys, self._fetched_at = keys, time.monotonic()

    def key(self, kid: str) -> jwt.PyJWK:
        with self._lock:
            age = time.monotonic() - self._fetched_at
            if not self._keys or age > self.ttl or (kid not in self._keys and age > self.min_refetch):
                try:
                    self._refresh()
                except Exception as e:
                    if not self._keys:
                        raise TokenInvalid("jwks unavailable") from e
            if kid not in self._keys:
                raise TokenInvalid("unknown key")
            return self._keys[kid]


@dataclass
class Identity:
    provider: str
    sub: str
    email: str | None
    email_verified: bool
    name: str | None


def verify_id_token(token: str, jwks: JwksCache, issuers: Sequence[str], audiences: Sequence[str],
                    provider: str, nonce: str | None = None) -> Identity:
    if not audiences:
        raise TokenInvalid("provider not configured")
    try:
        header = jwt.get_unverified_header(token)
        if header.get("alg") not in ("RS256", "ES256"):
            raise TokenInvalid("bad alg")
        key = jwks.key(header.get("kid", ""))
        claims = jwt.decode(token, key, algorithms=[header["alg"]], audience=list(audiences), issuer=list(issuers),
                            options={"require": ["exp", "iat", "sub", "iss", "aud"]}, leeway=30)
    except TokenInvalid:
        raise
    except jwt.PyJWTError as e:
        raise TokenInvalid(type(e).__name__) from e
    if nonce is not None and not secrets.compare_digest(str(claims.get("nonce", "")), nonce):
        raise TokenInvalid("nonce mismatch")
    ev = claims.get("email_verified", False)
    verified = ev is True or (isinstance(ev, str) and ev.lower() == "true")
    email = claims.get("email")
    return Identity(provider, str(claims["sub"]), email.lower() if isinstance(email, str) else None,
                    bool(email and verified), claims.get("name"))


# ---- Google web authorisation-code flow with PKCE ----

def pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


def google_auth_url(client_id: str, redirect_uri: str, state: str, challenge: str, nonce: str) -> str:
    return GOOGLE_AUTH + "?" + urlencode({
        "client_id": client_id, "redirect_uri": redirect_uri, "response_type": "code", "scope": "openid email profile",
        "state": state, "nonce": nonce, "code_challenge": challenge, "code_challenge_method": "S256",
        "prompt": "select_account",
    })


def google_exchange_code(code: str, verifier: str, client_id: str, client_secret: str, redirect_uri: str,
                         transport: httpx.BaseTransport | None = None) -> str:
    try:
        with httpx.Client(transport=transport, timeout=10.0) as c:
            r = c.post(GOOGLE_TOKEN, data={
                "code": code, "client_id": client_id, "client_secret": client_secret, "redirect_uri": redirect_uri,
                "grant_type": "authorization_code", "code_verifier": verifier,
            })
    except httpx.HTTPError as e:
        raise TokenInvalid("exchange failed") from e
    if r.status_code != 200 or "id_token" not in r.json():
        raise TokenInvalid("exchange failed")
    return r.json()["id_token"]


class StateStore:
    """Short-lived in-memory OAuth state (single process)."""

    def __init__(self, ttl: float = 600.0):
        self.ttl = ttl
        self._items: dict[str, tuple[float, dict[str, Any]]] = {}
        self._lock = threading.Lock()

    def put(self, data: dict[str, Any]) -> str:
        state = secrets.token_urlsafe(32)
        with self._lock:
            now = time.monotonic()
            self._items = {k: v for k, v in self._items.items() if now - v[0] < self.ttl}
            self._items[state] = (now, data)
        return state

    def pop(self, state: str) -> dict[str, Any] | None:
        with self._lock:
            item = self._items.pop(state, None)
        if item is None or time.monotonic() - item[0] > self.ttl:
            return None
        return item[1]
