"""argon2id password hashing and the password policy."""
from __future__ import annotations

import re
from functools import lru_cache
from importlib import resources

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

MIN_LENGTH = 12
MAX_LENGTH = 256


@lru_cache(maxsize=1)
def common_passwords() -> frozenset[str]:
    text = resources.files("analyzer.accounts").joinpath("common_passwords.txt").read_text("utf-8")
    return frozenset(
        line.strip().lower() for line in text.splitlines() if line.strip() and not line.startswith("#")
    )


_SUFFIX = re.compile(r"[\d\W_]+$")
_PREFIX = re.compile(r"^[\d\W_]+")


def password_problem(password: str, email: str | None = None) -> str | None:
    """Return a human message if the password is unacceptable, else None."""
    if len(password) < MIN_LENGTH:
        return f"Password must be at least {MIN_LENGTH} characters."
    if len(password) > MAX_LENGTH:
        return "Password is too long."
    low = password.lower()
    common = common_passwords()
    base = _PREFIX.sub("", _SUFFIX.sub("", low))
    if low in common or (base and base in common) or len(set(low)) <= 2:
        return "This password is too common."
    if email and low.startswith(email.lower().split("@")[0]) and len(email.split("@")[0]) >= 6:
        return "Password must not be based on your email address."
    return None


class Passwords:
    def __init__(self, time_cost: int = 3, memory_cost: int = 65536, parallelism: int = 4):
        self._ph = PasswordHasher(time_cost=time_cost, memory_cost=memory_cost, parallelism=parallelism)
        self._dummy = self._ph.hash("lvs-dummy-password-for-timing")

    def hash(self, password: str) -> str:
        return self._ph.hash(password)

    def verify(self, stored_hash: str | None, password: str) -> bool:
        """Constant-ish time: runs a dummy verification when there is no hash."""
        try:
            return self._ph.verify(stored_hash or self._dummy, password) and stored_hash is not None
        except (VerifyMismatchError, VerificationError, InvalidHashError):
            return False
