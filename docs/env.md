# Server environment variables

The server reads these from the environment (or a local `.env`, which is never committed). Start it with
`uvicorn analyzer.web.main:app --no-proxy-headers --no-access-log` (the RequestLog middleware already logs redacted route templates). X-Forwarded-For is parsed only by the app (`TRUSTED_PROXIES`, rightmost hop); uvicorn must not rewrite the peer address, because with `--forwarded-allow-ips=*` it takes the client-supplied leftmost value.

## Required (the server refuses to start without them)

| Variable | Meaning |
|---|---|
| `MASTER_KEY` | At least 32 characters; use 32 or more **random bytes** (e.g. `openssl rand -base64 48`). It keys `accounts.db` (SQLCipher) and wraps each user's data key (HKDF-SHA256 with info `lvs-dek-wrap`, then AES-256-GCM). Losing it makes every database unreadable. |
| `JWT_SECRET` | At least 32 characters. It signs the 15-minute HS256 access tokens. |

## Storage and URLs

| Variable | Default | Meaning |
|---|---|---|
| `DATA_DIR` | `data` | Holds `accounts.db` and `users/<user_id>.db`. On Railway, put it on the volume. |
| `APP_ORIGIN` | `http://localhost:5173` | The SPA origin. It is used for CORS, email links and the Google redirect target. |
| `PUBLIC_URL` | `APP_ORIGIN` | The external base URL of this API, used for the Google callback `…/api/auth/google/callback`. |
| `FRONTEND_DIST` | `frontend/dist` | The built SPA that is served at `/`. |
| `EXTENSION_ID` | – | Enables CORS for `chrome-extension://<id>` on `/api/ingest` and `/api/ext/*` only. |
| `COOKIE_SECURE` | `true` | Keep it `true` in production. The refresh cookie is `Secure`, `HttpOnly` and `SameSite=Lax`. |
| `NATIVE_NONCE_REQUIRED` | `true` | Native and Apple-JS ID tokens must carry a nonce issued by `POST /api/auth/nonce` (single use, 10 minutes). Set it to `0` only to debug a client; a nonce that is present is always checked. |
| `TRUSTED_PROXIES` | – | Comma-separated IPs or CIDRs of reverse proxies whose `X-Forwarded-For` is trusted, or `*` to trust the single edge proxy in front of the app. **Railway: set `TRUSTED_PROXIES=*`.** Without it, the client IP is the TCP peer. Behind a proxy every client then shares the proxy's IP: the per-(email, IP) limit (5 failures per 15 minutes) becomes per-email, and the per-IP limit (`AUTH_IP_LIMIT`) applies to all users together. The server logs a warning on the first request that carries `X-Forwarded-For` while this is unset. Never set it when the app is reachable directly. |

## Mail (verification and password reset)

| Variable | Meaning |
|---|---|
| `RESEND_API_KEY`, `MAIL_FROM` | Send mail through the Resend HTTP API. |
| `MAIL_DEV_ALLOW=1` | Without Resend, the server **refuses to start** while `COOKIE_SECURE=true` unless this is set. It then uses a development console mailer that logs the link. |

## Sign-in providers

| Variable | Meaning |
|---|---|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | The web OIDC code flow with PKCE. |
| `GOOGLE_CLIENT_IDS` | Comma-separated extra audiences (native app client ids) accepted on `/api/auth/google/token`. |
| `APPLE_CLIENT_IDS` | Comma-separated audiences (bundle id and services id) accepted on `/api/auth/apple/token`. |
| `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` | Accepted but not used yet. They are only needed for Apple's code exchange; ID-token verification uses Apple's JWKS. |

## Accounts

| Variable | Meaning |
|---|---|
| `REGISTRATION` | `open` (default): anyone can create an account with email and password, or Google/Apple when configured. `invite`: sign-up needs an invite code (admins create them in Settings, or run `scripts/create_invite.py`). Sign-ups are rate limited per IP in both modes. |
| `ADMIN_EMAIL` | This account becomes admin once its email is verified, or immediately on a Google/Apple sign-in with that provider-verified email. In `invite` mode only that social path skips the invite. |
| `SEED_DEMO=1`, `DEMO_PASSWORD` | Optional, off by default; not for production. Creates two shared sample accounts (`judge1@demo.lvs`, `judge2@demo.lvs`) holding synthetic people, seeded in the background after start-up. Password change, account deletion and revoking other sessions or tokens are blocked for these accounts (403 `demo_locked`). |

## Agent

| Variable | Meaning |
|---|---|
| `GROQ_API_KEY`, `GROQ_MODEL` | Enable the agent. Without a key, the agent routes return 503 `agent_unavailable`. |

## Limits (rarely changed)

`MAX_IMPORT_BYTES` (50 MB), `MAX_INGEST_BYTES` (2 MB), `MAX_MESSAGES_IMPORT_BYTES` (2 MB), `INGEST_MSGS_PER_MIN` (10000),
`AUTH_IP_LIMIT` (60 sign-ups or failed logins per IP per 15 minutes), `USER_DB_CACHE_SIZE` (256),
`SSE_HEARTBEAT_S` (15) and `SSE_SESSION_CHECK_S` (15). An open `/api/events` stream ends within this many seconds of logout, session revocation or account deletion.

In-memory state (rate limits, OAuth state and the event bus) is per process, so run a single instance.

## Quarantine (taken-over unverified accounts)

When an unverified account is claimed by the address owner (password reset, or first Google/Apple sign-in),
its old database moves to `DATA_DIR/quarantine/<user_id>-<ts>.db`. The wrapped data key is kept in
`accounts.db`, so the data stays encrypted. Entries older than 30 days are purged at startup and daily.
To restore one, stop the server and run `python scripts/restore_quarantine.py <user_id>`. It reads
`MASTER_KEY` and `DATA_DIR` from the environment, and the database currently in place is quarantined first.
