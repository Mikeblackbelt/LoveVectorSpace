"""Key derivation, per-user data-key wrapping and token helpers."""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

DEK_WRAP_INFO = b"lvs-dek-wrap"
IP_HASH_INFO = b"lvs-ip-hash"
_NONCE_LEN = 12


def hkdf(master_key: str, info: bytes, length: int = 32) -> bytes:
    if not master_key:
        raise ValueError("MASTER_KEY is missing")
    return HKDF(algorithm=hashes.SHA256(), length=length, salt=None, info=info).derive(
        master_key.encode("utf-8")
    )


def new_dek() -> bytes:
    return os.urandom(32)


def wrap_dek(master_key: str, dek: bytes, user_id: str) -> bytes:
    """AES-256-GCM(HKDF(MASTER_KEY, 'lvs-dek-wrap')); returns nonce||ciphertext. user_id is bound as AAD."""
    nonce = os.urandom(_NONCE_LEN)
    ct = AESGCM(hkdf(master_key, DEK_WRAP_INFO)).encrypt(nonce, dek, user_id.encode("utf-8"))
    return nonce + ct


def unwrap_dek(master_key: str, wrapped: bytes, user_id: str) -> bytes:
    nonce, ct = wrapped[:_NONCE_LEN], wrapped[_NONCE_LEN:]
    return AESGCM(hkdf(master_key, DEK_WRAP_INFO)).decrypt(nonce, ct, user_id.encode("utf-8"))


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def random_token(prefix: str = "") -> str:
    return prefix + secrets.token_urlsafe(32)


def consteq(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))


class IpHasher:
    def __init__(self, master_key: str):
        self._key = hkdf(master_key, IP_HASH_INFO)

    def __call__(self, ip: str | None) -> str | None:
        if not ip:
            return None
        return hmac.new(self._key, ip.encode("utf-8"), hashlib.sha256).hexdigest()[:24]
