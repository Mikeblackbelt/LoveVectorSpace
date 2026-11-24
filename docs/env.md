# Server environment variables

The server reads these from the environment (or a local `.env`, which is never committed). Start it with
`uvicorn analyzer.web.main:app --proxy-headers`.

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
| `NATIVE_NONCE_REQUIRED` | `false` | Require `nonce` on `/api/auth/google/token` and `/api/auth/apple/token`. |
| `TRUSTED_PROXIES` | – | Comma-separated IPs or CIDRs of reverse proxies whose `X-Forwarded-For` is trusted, or `*` to trust the single edge proxy in front of the app. **Railway: set `TRUSTED_PROXIES=*`.** Without it, the client IP is the TCP peer, so behind a proxy the login rate limit (5 failures per 15 minutes per email and IP) degrades to per-email. Never set it when the app is reachable directly. |

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

## Accounts and demo

| Variable | Meaning |
|---|---|
| `ADMIN_EMAIL` | This account becomes admin once its email is verified, or immediately on a Google/Apple sign-in with that provider-verified email. Only that social path skips the invite; password sign-ups always need one. |
| `SEED_DEMO=1`, `DEMO_PASSWORD` | Create `judge1@demo.lvs` and `judge2@demo.lvs` with the synthetic people Yu Cheng, Sam and Jordan. |

## Agent

| Variable | Meaning |
|---|---|
| `GROQ_API_KEY`, `GROQ_MODEL` | Enable the agent. Without a key, the agent routes return 503 `agent_unavailable`. |

## Limits (rarely changed)

`MAX_IMPORT_BYTES` (50 MB), `MAX_INGEST_BYTES` (2 MB), `MAX_MESSAGES_IMPORT_BYTES` (2 MB), `INGEST_MSGS_PER_MIN` (10000),
`AUTH_IP_LIMIT` (20 sign-ups or failed logins per IP per 15 minutes), `USER_DB_CACHE_SIZE` (256),
`SSE_HEARTBEAT_S` (15) and `SSE_SESSION_CHECK_S` (15). An open `/api/events` stream ends within this many seconds of logout, session revocation or account deletion.

In-memory state (rate limits, OAuth state and the event bus) is per process, so run a single instance.
