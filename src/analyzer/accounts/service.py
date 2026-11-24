"""Account and session logic (framework-independent). Raises AccountError for client-visible failures."""
from __future__ import annotations

import logging
import secrets
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import jwt

from . import crypto
from .mailer import ConsoleMailer, Mailer, ResendMailer
from .oidc import (APPLE_ISSUERS, APPLE_JWKS, GOOGLE_ISSUERS, GOOGLE_JWKS, Fetch, Identity, JwksCache, StateStore,
                   TokenInvalid, google_auth_url, google_exchange_code, http_fetch_json, pkce_pair, verify_id_token)
from .passwords import Passwords, password_problem
from .quarantine import Quarantine, move_db
from .ratelimit import SlidingWindow
from .repos import (AccountsDB, ApiTokens, Audit, EmailTokens, Invites, RefreshTokens, UserRow, Users, iso,
                    new_id, now_iso, utcnow)
from .userdb import UserDBManager

log = logging.getLogger("analyzer.accounts")

ACCESS_TTL_S = 900
REFRESH_DAYS = 30
REFRESH_GRACE_S = 10.0
REAUTH_WINDOW = timedelta(minutes=10)
NONCE_TTL_S = 600.0
MAINTENANCE_EVERY_S = 86400.0
PENDING_DELETE_AFTER = timedelta(minutes=1)
VERIFY_TTL = timedelta(hours=24)
RESET_TTL = timedelta(minutes=30)
DELETE_PHRASE = "DELETE MY ACCOUNT"
DEMO_EMAILS = ("judge1@demo.lvs", "judge2@demo.lvs")


class AccountError(Exception):
    def __init__(self, status: int, code: str, message: str, field: str | None = None,
                 retry_after: int | None = None):
        super().__init__(message)
        self.status, self.code, self.message, self.field, self.retry_after = status, code, message, field, retry_after


def _unauth(msg: str = "Not signed in.") -> AccountError:
    return AccountError(401, "unauthenticated", msg)


@dataclass
class Tokens:
    access: str
    refresh: str
    family_id: str


@dataclass
class Principal:
    user: UserRow
    kind: str            # "session" | "api" | "extension"
    sid: str | None = None
    token_id: str | None = None


class NonceStore:
    """Server-issued single-use nonces for native ID tokens (memory, single process)."""

    def __init__(self, ttl: float = NONCE_TTL_S):
        self.ttl = ttl
        self._raw: dict[str, float] = {}       # raw nonce -> deadline
        self._hashed: dict[str, str] = {}      # sha256 hex -> raw nonce
        self._lock = threading.Lock()

    def issue(self) -> str:
        raw = secrets.token_urlsafe(24)
        with self._lock:
            now = time.monotonic()
            for k in [k for k, d in self._raw.items() if d <= now]:
                self._raw.pop(k, None)
                self._hashed.pop(crypto.sha256_hex(k), None)
            self._raw[raw] = now + self.ttl
            self._hashed[crypto.sha256_hex(raw)] = raw
        return raw

    def consume(self, claim: str) -> bool:
        """True if `claim` is an issued, unexpired nonce or the sha256 hex of one; it can never be used again."""
        with self._lock:
            raw = claim if claim in self._raw else self._hashed.get(claim)
            if raw is None:
                return False
            deadline = self._raw.pop(raw, 0.0)
            self._hashed.pop(crypto.sha256_hex(raw), None)
            return deadline > time.monotonic()


class AccountService:
    def __init__(self, settings: Any, factory: Any, events: Any, *, mailer: Mailer | None = None,
                 fetch: Fetch | None = None, google_transport: Any = None, passwords: Passwords | None = None):
        self.s = settings
        data_dir = Path(settings.data_dir)
        data_dir.mkdir(parents=True, exist_ok=True)
        self.db = AccountsDB(data_dir / "accounts.db", settings.master_key)
        self.users, self.invites = Users(self.db), Invites(self.db)
        self.refresh_tokens, self.email_tokens = RefreshTokens(self.db), EmailTokens(self.db)
        self.api_tokens, self.audit = ApiTokens(self.db), Audit(self.db)
        self.passwords = passwords or Passwords()
        self.ip_hash = crypto.IpHasher(settings.master_key)
        self.login_limiter = SlidingWindow(5, 15 * 60)                       # failures per (email, IP)
        self.ip_limiter = SlidingWindow(getattr(settings, "auth_ip_limit", 60), 15 * 60)   # per IP and action
        self.mail_limiter = SlidingWindow(5, 15 * 60)
        if mailer is not None:
            self.mailer = mailer
        elif settings.resend_api_key and settings.mail_from:
            self.mailer = ResendMailer(settings.resend_api_key, settings.mail_from)
        elif settings.cookie_secure and not getattr(settings, "mail_dev_allow", False):
            raise RuntimeError("RESEND_API_KEY and MAIL_FROM are not set; refusing to run the console mailer in "
                               "production (set MAIL_DEV_ALLOW=1 for development)")
        else:
            self.mailer = ConsoleMailer()
        fetch = fetch or http_fetch_json()
        self.google_jwks = JwksCache(GOOGLE_JWKS, fetch)
        self.apple_jwks = JwksCache(APPLE_JWKS, fetch)
        self.google_transport = google_transport
        self.oauth_states = StateStore()
        self.factory, self.events = factory, events
        self.userdbs = UserDBManager(data_dir, self._key_for,
                                     lambda uid, conn: factory.for_user(uid, conn, events),
                                     capacity=settings.user_db_cache_size,
                                     close_user=self._close_user,
                                     is_active=lambda uid: self.users.get(uid) is not None)
        if hasattr(factory, "conn_opener") and getattr(factory, "conn_opener") is None:
            factory.conn_opener = self.userdbs.open_existing   # background jobs never re-create a deleted DB
        self._grace: dict[str, tuple[float, str, str]] = {}   # old refresh hash -> (deadline, new raw, family)
        self._grace_lock = threading.Lock()
        self.quarantine = Quarantine(self.db, data_dir)
        self.nonces = NonceStore()
        self.nonce_limiter = SlidingWindow(60, 15 * 60)
        self._stop = threading.Event()
        self.maintenance()
        self._maint = threading.Thread(target=self._maintenance_loop, name="accounts-maintenance", daemon=True)
        self._maint.start()

    # ---------- maintenance (startup + daily) ----------
    def maintenance(self) -> None:
        """Purge quarantine older than 30 days and finish deletions that failed earlier."""
        try:
            purged = self.quarantine.purge()
            if purged:
                log.info("quarantine: purged %d expired entries", purged)
        except Exception as e:
            log.warning("quarantine purge failed: %s", type(e).__name__)
        self.finish_pending_deletions()

    def _maintenance_loop(self) -> None:
        while not self._stop.wait(MAINTENANCE_EVERY_S):
            self.maintenance()

    def finish_pending_deletions(self, older_than: timedelta = PENDING_DELETE_AFTER) -> int:
        cutoff = iso(utcnow() - older_than)
        done = 0
        for (uid,) in self.db.q("SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at <= ?", (cutoff,)):
            try:
                self.userdbs.delete(uid)
                self.users.hard_delete(uid)
                self.audit.log(uid, "account_deleted")
                done += 1
            except Exception as e:
                log.warning("pending deletion still failing: %s", type(e).__name__)
        return done

    def _close_user(self, user_id: str) -> None:
        close_user = getattr(self.factory, "close_user", None)
        if callable(close_user):
            close_user(user_id)

    def close(self) -> None:
        self._stop.set()
        self.userdbs.close_all()
        self.db.close()

    # ---------- keys ----------
    def _key_for(self, user_id: str) -> str:
        u = self.users.get(user_id)
        if u is None:
            raise KeyError("unknown user")
        return crypto.unwrap_dek(self.s.master_key, u.wrapped_dek, user_id).hex()

    # ---------- tokens ----------
    def _access(self, user: UserRow, sid: str | None) -> str:
        now = datetime.now(timezone.utc)
        claims = {"sub": user.id, "role": user.role, "iat": int(now.timestamp()),
                  "exp": int((now + timedelta(seconds=ACCESS_TTL_S)).timestamp()), "typ": "access"}
        if sid:
            claims["sid"] = sid
        return jwt.encode(claims, self.s.jwt_secret, algorithm="HS256")

    def _issue(self, user: UserRow, device: str | None, family_id: str | None = None) -> Tokens:
        raw = crypto.random_token("lvsr_")
        family = family_id or new_id()
        self.refresh_tokens.create(user.id, family, crypto.sha256_hex(raw), device, REFRESH_DAYS)
        return Tokens(self._access(user, family), raw, family)

    def authenticate_bearer(self, token: str) -> Principal:
        if token.startswith(("lvsa_", "lvse_")):
            h = crypto.sha256_hex(token)
            row = self.api_tokens.lookup(h)
            if row is None or not crypto.consteq(row["token_hash"], h):
                raise _unauth()
            user = self.users.get(row["user_id"])
            if user is None:
                raise _unauth()
            return Principal(user, row["kind"], token_id=row["id"])
        return self.authenticate_access(token)

    def authenticate_access(self, token: str) -> Principal:
        try:
            claims = jwt.decode(token, self.s.jwt_secret, algorithms=["HS256"],
                                options={"require": ["exp", "sub", "iat"]})
        except jwt.PyJWTError:
            raise _unauth() from None
        if claims.get("typ") != "access":
            raise _unauth()
        user = self.users.get(str(claims["sub"]))
        if user is None:
            raise _unauth()
        sid = claims.get("sid")
        if not sid or not self.refresh_tokens.family_active(str(sid)):   # every issued access token has a sid
            raise _unauth()
        return Principal(user, "session", sid=str(sid))

    def session_valid(self, user_id: str, sid: str | None) -> bool:
        """Still signed in? (user exists and, for session tokens, the refresh family is not revoked)."""
        if self.users.get(user_id) is None:
            return False
        return sid is None or self.refresh_tokens.family_active(sid)

    # ---------- signup / login ----------
    def _new_user(self, email: str, **kw: Any) -> UserRow:
        uid = new_id()
        wrapped = crypto.wrap_dek(self.s.master_key, crypto.new_dek(), uid)
        return self.users.create(email=email, wrapped_dek=wrapped, user_id=uid, **kw)

    def _create_db(self, user_id: str) -> None:
        """Create the encrypted per-user DB file. Never call while holding the accounts lock."""
        with self.userdbs.use(user_id, create=True):
            pass

    def _is_admin_email(self, email: str | None) -> bool:
        return bool(self.s.admin_email and email and email.lower() == self.s.admin_email.lower())

    def _maybe_promote(self, user: UserRow) -> UserRow:
        if user.role != "admin" and user.email_verified and self._is_admin_email(user.email):
            self.users.update(user.id, role="admin")
            self.audit.log(user.id, "admin_bootstrap")
            return self.users.get(user.id)
        return user

    @staticmethod
    def _norm_email(email: str) -> str:
        email = (email or "").strip().lower()
        if "@" not in email or len(email) > 254 or email.startswith("@") or email.endswith("@"):
            raise AccountError(422, "validation_error", "Enter a valid email address.", "email")
        return email

    def _limit_ip(self, action: str, ip: str | None) -> None:
        wait = self.ip_limiter.try_hit((action, ip or ""))
        if wait:
            raise AccountError(429, "rate_limited", "Too many attempts. Try again later.", retry_after=wait)

    @property
    def invite_only(self) -> bool:
        return getattr(self.s, "registration", "open") == "invite"

    def _signup_checks(self, email: str, invite_code: str | None) -> dict | None:
        """REGISTRATION=invite: password sign-ups need an invite (the ADMIN_EMAIL bootstrap is provider-verified
        sign-in only). REGISTRATION=open: no invite needed; a valid one given anyway is still consumed."""
        invite = self.invites.usable(invite_code, email)
        if invite is None and self.invite_only:
            raise AccountError(403, "invite_required", "A valid invite code is required.", "invite_code")
        if self.users.by_email(email) is not None:
            raise AccountError(409, "conflict", "An account with this email already exists.", "email")
        return invite

    def signup(self, email: str, password: str, invite_code: str | None, display_name: str | None,
               ip: str | None, device: str | None) -> tuple[UserRow, Tokens]:
        email = self._norm_email(email)
        problem = password_problem(password, email)
        if problem:
            raise AccountError(422, "validation_error", problem, "password")
        self._limit_ip("signup", ip)
        with self.db.lock:
            self._signup_checks(email, invite_code)      # before the (expensive) argon2 hash
        pw_hash = self.passwords.hash(password)          # outside the accounts lock
        with self.db.lock:
            invite = self._signup_checks(email, invite_code)   # re-check: another request may have raced us
            user = self._new_user(email, password_hash=pw_hash, display_name=(display_name or None))
            if invite is not None:
                self.invites.consume(invite["code"], user.id)
        self._create_db(user.id)
        self.audit.log(user.id, "signup", self.ip_hash(ip))
        self._send_verification(user)
        return user, self._issue(user, device)

    def login(self, email: str, password: str, ip: str | None, device: str | None) -> tuple[UserRow, Tokens]:
        email = (email or "").strip().lower()
        key = (email, ip or "")
        self._limit_ip("login", ip)                      # reserve before hashing (atomic check+hit)
        wait = self.login_limiter.try_hit(key)
        if wait:
            self.ip_limiter.refund(("login", ip or ""))
            raise AccountError(429, "rate_limited", "Too many attempts. Try again later.", retry_after=wait)
        user = self.users.by_email(email)
        ok = self.passwords.verify(user.password_hash if user else None, password or "")
        if not ok or user is None:
            self.audit.log(user.id if user else None, "login_failed", self.ip_hash(ip))
            raise _unauth("Invalid email or password.")
        self.login_limiter.reset(key)                    # only failures count
        self.ip_limiter.refund(("login", ip or ""))
        if self.passwords.needs_rehash(user.password_hash):
            # conditional: never overwrite a password changed concurrently (reset / change)
            self.users.replace_password_hash(user.id, user.password_hash, self.passwords.hash(password))
        user = self._maybe_promote(user)
        self.audit.log(user.id, "login", self.ip_hash(ip))
        return user, self._issue(user, device)

    def refresh(self, raw: str | None, device: str | None) -> tuple[UserRow, Tokens]:
        if not raw:
            raise _unauth()
        h = crypto.sha256_hex(raw)
        with self.db.lock:
            row = self.refresh_tokens.by_hash(h)
            if row is None or not crypto.consteq(row["token_hash"], h):
                raise _unauth()
            if row["revoked_at"] is not None:
                grace = self._grace_pair(h, row)
                if grace is not None:
                    return grace
                self.refresh_tokens.revoke_family(row["family_id"])
                self.audit.log(row["user_id"], "refresh_reuse_family_revoked")
                raise _unauth()
            if row["expires_at"] <= now_iso():
                raise _unauth()
            user = self.users.get(row["user_id"])
            if user is None:
                raise _unauth()
            tokens = self._issue(user, row["device"] or device, family_id=row["family_id"])
            new = self.refresh_tokens.by_hash(crypto.sha256_hex(tokens.refresh))
            if not self.refresh_tokens.mark_rotated(row["id"], new["id"]):
                self.refresh_tokens.revoke_family(row["family_id"])
                raise _unauth()
            self._remember_rotation(h, tokens)
        return user, tokens

    def _remember_rotation(self, old_hash: str, tokens: Tokens) -> None:
        """Concurrent web refreshes (two tabs) may present the same token: for REFRESH_GRACE_S after a rotation
        the old token yields the same new refresh token instead of being treated as reuse. Memory only."""
        now = time.monotonic()
        with self._grace_lock:
            self._grace = {k: v for k, v in self._grace.items() if v[0] > now}
            self._grace[old_hash] = (now + REFRESH_GRACE_S, tokens.refresh, tokens.family_id)

    def _grace_pair(self, old_hash: str, row: dict) -> tuple[UserRow, Tokens] | None:
        with self._grace_lock:
            entry = self._grace.get(old_hash)
        if entry is None or entry[0] <= time.monotonic() or entry[2] != row["family_id"]:
            return None
        if not self.refresh_tokens.family_active(row["family_id"]):
            return None
        new_row = self.refresh_tokens.by_hash(crypto.sha256_hex(entry[1]))
        if new_row is None or new_row["revoked_at"] is not None:
            return None    # the replacement was itself rotated or revoked: treat as reuse
        user = self.users.get(row["user_id"])
        if user is None:
            return None
        return user, Tokens(self._access(user, row["family_id"]), entry[1], row["family_id"])

    def logout(self, p: Principal, raw: str | None) -> None:
        family = None
        if raw:
            row = self.refresh_tokens.by_hash(crypto.sha256_hex(raw))
            if row and row["user_id"] == p.user.id:
                family = row["family_id"]
        family = family or p.sid
        if family and self.refresh_tokens.family_owner(family) == p.user.id:
            self.refresh_tokens.revoke_family(family)
        self.audit.log(p.user.id, "logout")

    # ---------- email verification / reset ----------
    def _link(self, path: str, raw: str) -> str:
        return f"{self.s.app_origin.rstrip('/')}{path}#token={raw}"

    def _send_verification(self, user: UserRow) -> None:
        raw = crypto.random_token()
        self.email_tokens.create(user.id, "verify", crypto.sha256_hex(raw), VERIFY_TTL)
        self.mailer.send(user.email, "Verify your LoveVectorSpace email",
                         "Confirm your email address (link valid for 24 hours):", self._link("/auth/verify", raw))

    def resend_verification(self, user: UserRow) -> None:
        if user.email_verified or self.mail_limiter.retry_after(("verify", user.id)):
            return
        self.mail_limiter.hit(("verify", user.id))
        self.email_tokens.invalidate(user.id, "verify")
        self._send_verification(user)

    def verify_email(self, token: str) -> None:
        uid = self.email_tokens.consume("verify", crypto.sha256_hex(token or ""))
        if uid is None or self.users.get(uid) is None:
            raise AccountError(400, "invalid_input", "This link is invalid or has expired.", "token")
        self.users.update(uid, email_verified=True)
        self._maybe_promote(self.users.get(uid))
        self.audit.log(uid, "email_verified")

    def forgot_password(self, email: str, ip: str | None) -> None:
        email = (email or "").strip().lower()
        key = ("reset", email)
        if self.mail_limiter.retry_after(key) or self.mail_limiter.retry_after(("reset-ip", ip or "")):
            return
        self.mail_limiter.hit(key)
        self.mail_limiter.hit(("reset-ip", ip or ""))
        user = self.users.by_email(email)
        if user is None:
            return
        self.email_tokens.invalidate(user.id, "reset")
        raw = crypto.random_token()
        self.email_tokens.create(user.id, "reset", crypto.sha256_hex(raw), RESET_TTL)
        self.audit.log(user.id, "password_reset_requested", self.ip_hash(ip))
        self.mailer.send(user.email, "Reset your LoveVectorSpace password",
                         "Reset your password (link valid for 30 minutes):", self._link("/auth/reset", raw))

    def _revoke_all_credentials(self, user_id: str) -> None:
        self.refresh_tokens.revoke_user(user_id)
        self.api_tokens.revoke_all(user_id)

    def _takeover_fields(self, user: UserRow) -> dict[str, Any]:
        """The address was never proven by whoever created this account: forget their password and role and
        start a fresh data key (the old database was already moved to quarantine)."""
        return {"password_hash": None, "role": "user", "email_verified": True,
                "wrapped_dek": crypto.wrap_dek(self.s.master_key, crypto.new_dek(), user.id)}

    def _quarantine_db(self, user: UserRow) -> Path | None:
        """Step 1 of a takeover, before any accounts.db change: move the old DB file aside.
        If the move fails nothing has changed and the caller gets 503 (retry)."""
        dest = self.quarantine.target(user.id)
        try:
            return dest if self.userdbs.quarantine_file(user.id, dest) else None
        except OSError:
            raise AccountError(503, "unavailable", "Please try again in a moment.", retry_after=1) from None

    def _unquarantine(self, user_id: str, dest: Path | None) -> None:
        """Roll back step 1 when the takeover could not be committed."""
        if dest is not None:
            try:
                move_db(dest, self.userdbs.path(user_id))
            except OSError:
                log.error("could not roll back a quarantine move; the entry stays in the quarantine folder")

    def reset_password(self, token: str, new_password: str) -> None:
        h = crypto.sha256_hex(token or "")
        row = self.db.one("SELECT user_id FROM email_tokens WHERE kind='reset' AND token_hash=? AND used_at IS NULL"
                          " AND expires_at>?", (h, now_iso()))
        user = self.users.get(row[0]) if row else None
        if user is None:
            raise AccountError(400, "invalid_input", "This link is invalid or has expired.", "token")
        problem = password_problem(new_password or "", user.email)
        if problem:
            raise AccountError(422, "validation_error", problem, "new_password")
        pw_hash = self.passwords.hash(new_password)      # argon2 outside the accounts lock
        takeover = not user.email_verified
        dest = self._quarantine_db(user) if takeover else None   # file first; accounts.db changes only after
        committed = False
        try:
            with self.db.lock:
                if self.email_tokens.consume("reset", h) is None:
                    raise AccountError(400, "invalid_input", "This link is invalid or has expired.", "token")
                current = self.users.get(user.id)
                if current is None or current.email_verified != user.email_verified:
                    raise AccountError(503, "unavailable", "Please try again in a moment.", retry_after=1)
                fields: dict[str, Any] = self._takeover_fields(current) if takeover else {"email_verified": True}
                fields["password_hash"] = pw_hash
                if dest is not None:
                    self.quarantine.add(user.id, dest, current.wrapped_dek)
                self.users.update(user.id, **fields)
                self._revoke_all_credentials(user.id)        # refresh families AND api/extension tokens
                self.email_tokens.invalidate(user.id, "reset")
                committed = True
        finally:
            if takeover and not committed:
                self._unquarantine(user.id, dest)
        if takeover:
            self._create_db(user.id)                     # fresh, empty DB under the new key
            self.audit.log(user.id, "takeover_data_quarantined")
        self._maybe_promote(self.users.get(user.id))
        self.audit.log(user.id, "password_reset")

    def change_password(self, p: Principal, current: str | None, new: str) -> None:
        user = p.user
        if user.password_hash and not self.passwords.verify(user.password_hash, current or ""):
            raise AccountError(403, "forbidden", "Current password is incorrect.", "current_password")
        if not user.password_hash:
            # adding a first password to a social-only account needs a fresh sign-in, not just a live session
            started = self.refresh_tokens.family_started(p.sid) if p.sid else None
            if not started or started < iso(utcnow() - REAUTH_WINDOW):
                raise AccountError(403, "reauth_required", "Sign in again to set a password.")
        problem = password_problem(new or "", user.email)
        if problem:
            raise AccountError(422, "validation_error", problem, "new_password")
        self.users.update(user.id, password_hash=self.passwords.hash(new))
        self.refresh_tokens.revoke_user(user.id, except_family=p.sid)
        self.audit.log(user.id, "password_changed")

    # ---------- social ----------
    def issue_nonce(self, ip: str | None) -> str:
        wait = self.nonce_limiter.try_hit(ip or "")
        if wait:
            raise AccountError(429, "rate_limited", "Too many attempts. Try again later.", retry_after=wait)
        return self.nonces.issue()

    def _check_nonce(self, ident: Identity, provider: str) -> Identity:
        """The token's nonce claim must be a server-issued nonce (raw, or its sha256 hex); it is consumed."""
        if ident.nonce:
            if not self.nonces.consume(ident.nonce):
                raise _unauth(f"{provider} sign-in expired. Try again.")
        elif getattr(self.s, "native_nonce_required", True):
            raise _unauth(f"{provider} sign-in failed.")
        return ident

    def verify_google(self, id_token: str) -> Identity:
        try:
            ident = verify_id_token(id_token, self.google_jwks, GOOGLE_ISSUERS, self.s.google_audiences, "google")
        except TokenInvalid:
            raise _unauth("Google sign-in failed.") from None
        return self._check_nonce(ident, "Google")

    def verify_apple(self, id_token: str) -> Identity:
        try:
            ident = verify_id_token(id_token, self.apple_jwks, APPLE_ISSUERS, self.s.apple_audiences, "apple")
        except TokenInvalid:
            raise _unauth("Apple sign-in failed.") from None
        return self._check_nonce(ident, "Apple")

    def social_login(self, ident: Identity, invite_code: str | None, name: str | None, ip: str | None,
                     device: str | None) -> tuple[UserRow, Tokens]:
        col = {"google": "google_sub", "apple": "apple_sub"}[ident.provider]
        dest: Path | None = None
        candidate: str | None = None
        if self.users.by_sub(ident.provider, ident.sub) is None and ident.email and ident.email_verified:
            ex = self.users.by_email(ident.email)
            if ex is not None and not ex.email_verified and not getattr(ex, col):
                dest, candidate = self._quarantine_db(ex), ex.id      # before any accounts.db change
        try:
            user, created, took_over = self._social_commit(ident, col, invite_code, name, ip, candidate, dest)
        except BaseException:
            if candidate is not None:
                self._unquarantine(candidate, dest)
            raise
        taken_over = candidate is not None and user.id == candidate and took_over
        if candidate is not None and not taken_over:
            self._unquarantine(candidate, dest)
        if created or taken_over:
            self._create_db(user.id)
        if taken_over:
            self.audit.log(user.id, "takeover_data_quarantined")
        user = self._maybe_promote(self.users.get(user.id))
        self.audit.log(user.id, f"login_{ident.provider}", self.ip_hash(ip))
        return user, self._issue(user, device)

    def _social_commit(self, ident: Identity, col: str, invite_code: str | None, name: str | None,
                       ip: str | None, candidate: str | None, dest: Path | None) -> tuple[UserRow, bool, bool]:
        created = took_over = False
        with self.db.lock:
            user = self.users.by_sub(ident.provider, ident.sub)
            if user is None and ident.email and ident.email_verified:
                existing = self.users.by_email(ident.email)
                if existing is not None:
                    if getattr(existing, col):
                        raise AccountError(409, "conflict", "This email is linked to another account.")
                    fields: dict[str, Any] = {col: ident.sub}
                    if not existing.email_verified:
                        # someone pre-registered this address without proving it: their data was moved to
                        # quarantine; now drop their password, role, sessions and api/extension tokens
                        if candidate != existing.id:
                            raise AccountError(503, "unavailable", "Please try again in a moment.", retry_after=1)
                        if dest is not None:
                            self.quarantine.add(existing.id, dest, existing.wrapped_dek)
                        fields.update(self._takeover_fields(existing))
                        self._revoke_all_credentials(existing.id)
                        took_over = True
                    self.users.update(existing.id, **fields)
                    self.audit.log(existing.id, f"link_{ident.provider}", self.ip_hash(ip))
                    user = self.users.get(existing.id)
            if user is None:
                if not ident.email or not ident.email_verified:
                    raise AccountError(400, "invalid_input", "The provider did not share a verified email.")
                invite = self.invites.usable(invite_code, ident.email)
                if invite is None and self.invite_only and not self._is_admin_email(ident.email):
                    raise AccountError(403, "invite_required", "A valid invite code is required.", "invite_code")
                display = (name or ident.name or None)
                user = self._new_user(ident.email, display_name=display, email_verified=True, **{col: ident.sub})
                if invite is not None:
                    self.invites.consume(invite["code"], user.id)
                created = True
                self.audit.log(user.id, f"signup_{ident.provider}", self.ip_hash(ip))
        return user, created, took_over

    def providers(self) -> dict:
        return {"google": self.s.google_web_enabled, "apple": self.s.apple_enabled,
                "registration": "invite" if self.invite_only else "open"}

    def google_start(self, redirect: str, invite: str | None) -> tuple[str, str]:
        if not self.s.google_web_enabled:
            raise AccountError(404, "not_configured", "Google sign-in is not configured.")
        verifier, challenge = pkce_pair()
        nonce = secrets.token_urlsafe(16)
        state = self.oauth_states.put({"verifier": verifier, "nonce": nonce, "redirect": redirect, "invite": invite})
        return google_auth_url(self.s.google_client_id, self.google_redirect_uri, state, challenge, nonce), state

    @property
    def google_redirect_uri(self) -> str:
        return f"{self.s.public_base_url.rstrip('/')}/api/auth/google/callback"

    def google_callback(self, code: str, state: str, ip: str | None, device: str | None):
        data = self.oauth_states.pop(state or "")
        if data is None or not code:
            raise AccountError(400, "invalid_state", "Sign-in expired. Try again.")
        try:
            id_token = google_exchange_code(code, data["verifier"], self.s.google_client_id,
                                            self.s.google_client_secret, self.google_redirect_uri,
                                            transport=self.google_transport)
            ident = verify_id_token(id_token, self.google_jwks, GOOGLE_ISSUERS,
                                    [self.s.google_client_id], "google", nonce=data["nonce"])
        except TokenInvalid:
            raise AccountError(401, "google_failed", "Google sign-in failed.") from None
        user, tokens = self.social_login(ident, data.get("invite"), None, ip, device)
        return user, tokens, data["redirect"]

    # ---------- personal tokens ----------
    def create_api_token(self, user: UserRow, kind: str, label: str | None) -> tuple[str, dict]:
        raw = crypto.random_token("lvsa_" if kind == "api" else "lvse_")
        info = self.api_tokens.create(user.id, kind, label, crypto.sha256_hex(raw))
        self.audit.log(user.id, f"token_created_{kind}")
        return raw, info

    def revoke_api_token(self, user: UserRow, token_id: str) -> None:
        if not self.api_tokens.owned(user.id, token_id):
            raise AccountError(404, "not_found", "Token not found.")
        self.api_tokens.revoke(user.id, token_id)
        self.audit.log(user.id, "token_revoked")

    # ---------- sessions ----------
    def sessions(self, p: Principal) -> list[dict]:
        return [{**s, "current": s["id"] == p.sid} for s in self.refresh_tokens.sessions(p.user.id)]

    def revoke_session(self, p: Principal, family_id: str) -> None:
        if self.refresh_tokens.family_owner(family_id) != p.user.id:
            raise AccountError(404, "not_found", "Session not found.")
        self.refresh_tokens.revoke_family(family_id)
        self.audit.log(p.user.id, "session_revoked")

    # ---------- invites ----------
    def create_invite(self, admin: UserRow, email: str | None, expires_days: int) -> dict:
        inv = self.invites.create(secrets.token_urlsafe(9), admin.id, email, expires_days)
        self.audit.log(admin.id, "invite_created")
        return inv

    # ---------- deletion / demo ----------
    def delete_account(self, user: UserRow, confirm: str, password: str | None) -> None:
        if confirm != DELETE_PHRASE:
            raise AccountError(400, "invalid_input", f'Type "{DELETE_PHRASE}" to confirm.', "confirm")
        if user.password_hash and not self.passwords.verify(user.password_hash, password or ""):
            raise AccountError(403, "forbidden", "Password is incorrect.", "password")
        # 1) make every credential fail immediately (concurrent requests get 401; acquire refuses the user)
        self.users.mark_deleted(user.id)
        self._revoke_all_credentials(user.id)
        # 2) stop the user's background work and remove the database file
        try:
            self.userdbs.delete(user.id)
        except Exception as e:
            # the account stays soft-deleted (no credential works); maintenance finishes the deletion later
            log.warning("account deletion deferred: %s", type(e).__name__)
            self.audit.log(user.id, "account_deletion_deferred")
            return
        # 3) remove the rows
        self.users.hard_delete(user.id)
        self.audit.log(user.id, "account_deleted")

    def request_stop(self) -> None:
        """Ask background loops (maintenance, demo seeding) to stop at their next check."""
        self._stop.set()

    def seed_demo(self) -> None:
        """Create the demo accounts if missing and bring their data to a complete state. Idempotent and
        resumable: runs on every start (from a background thread, see web/app.py); a user row without a
        database file, or a partial seed, is completed; an already complete account is left as it is."""
        if not self.s.demo_password:
            log.warning("SEED_DEMO=1 but DEMO_PASSWORD is not set; skipping demo accounts")
            return
        for i, email in enumerate(DEMO_EMAILS, start=1):
            if self._stop.is_set():
                return
            try:
                user = self.users.by_email(email)
                if user is None:
                    user = self._new_user(email, password_hash=self.passwords.hash(self.s.demo_password),
                                          display_name=f"Judge {i}", email_verified=True)
                elif not self.passwords.verify(user.password_hash, self.s.demo_password):
                    self.users.update(user.id, password_hash=self.passwords.hash(self.s.demo_password))
                # create=True also recreates a missing file. No user lock here: seed_demo takes it itself
                # and releases it while the models run, so the judge can sign in and browse meanwhile.
                with self.userdbs.use(user.id, create=True) as h:
                    self.factory.seed_demo(user.id, h.conn)
                self.audit.log(user.id, "demo_seeded")
            except Exception as e:
                log.warning("demo seeding for judge %d failed: %s", i, type(e).__name__)
