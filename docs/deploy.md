# Deploying to Railway

The repository ships a multi-stage `Dockerfile` and a `railway.toml` (Dockerfile builder, `/healthz` health check, restart on failure, one replica). The server keeps rate limits, OAuth state and the event bus in memory, so **run exactly one instance**.

## What the image contains

1. `frontend` stage: `npm ci && npm run build` with `VITE_API_MODE=live` (same-origin API).
2. `models` stage: the pinned export toolchain from `scripts/export-requirements.txt` (CPU-only torch 2.9.1, transformers 4.57.6, optimum 2.1.0 + optimum-onnx 0.1.0, onnx 1.20.1, onnxruntime 1.23.2), then `scripts/fetch_models.py --export` (downloads the emotion model, exports and int8-quantizes the toxicity model). Only `/app/models` is copied forward, so the runtime image has no torch.
3. `runtime` stage: `uv sync --frozen --no-dev`, the source, the models and `frontend/dist`. It starts as root only to `chown` the volume, then drops to the unprivileged user `app` (uid 10001) through `docker-entrypoint.sh`.

The first build takes several minutes (torch download and model export). SQLCipher comes from the `sqlcipher3-wheels` manylinux wheel, so no extra apt packages are needed.

## Step by step

1. **Generate secrets** (printed to the terminal only, never written to a file):
   ```bash
   python scripts/gen_secrets.py
   # or, without the repo:
   openssl rand -base64 48        # MASTER_KEY, then again for JWT_SECRET
   ```
   Keep `MASTER_KEY` in a password manager. Losing it makes every database unreadable.
2. **Create the project.** On railway.com choose New Project, then Deploy from GitHub repo, and pick this repository (or run `railway init` and `railway up` after `railway login`). Railway reads `railway.toml` and builds the `Dockerfile`.
3. **Add a volume.** In the service, open Settings, then Volumes, and mount one at **`/data`**. Without it, every redeploy erases all accounts and data.
4. **Generate a domain** (Settings, Networking, Generate Domain). Note the URL, e.g. `https://lvs-production.up.railway.app`. Railway injects `PORT` itself.
5. **Set variables** (service, Variables). The full reference is [env.md](env.md).

   | Variable | Value |
   |---|---|
   | `MASTER_KEY` | at least 32 random bytes (from step 1) |
   | `JWT_SECRET` | at least 32 random bytes (from step 1) |
   | `APP_ORIGIN` | the public URL, e.g. `https://lvs-production.up.railway.app` |
   | `PUBLIC_URL` | the same URL |
   | `TRUSTED_PROXIES` | `*` (Railway has a single edge proxy; without it the login rate limit degrades to per-email) |
   | `COOKIE_SECURE` | `1` |
   | `RESEND_API_KEY`, `MAIL_FROM` | **required in production**: verification and password-reset emails must reach real users (a verified sender domain in Resend). Without them the server refuses to start unless `MAIL_DEV_ALLOW=1`, which only logs links and is for local development. |
   | `REGISTRATION` | `open` (the default: anyone can sign up) or `invite` (sign-up needs an invite code) |
   | `GROQ_API_KEY` | from console.groq.com |
   | `GROQ_MODEL` | `openai/gpt-oss-120b` (see below) |
   | `ADMIN_EMAIL` | your email; it becomes admin once verified (admins can create invites in Settings) |
   | `EXTENSION_ID` | the unpacked extension's ID, once you have loaded it (below) |
   | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CLIENT_IDS`, `APPLE_CLIENT_IDS` | optional sign-in providers |

   `DATA_DIR` (`/data`), `FRONTEND_DIST`, `MODELS_DIR` and `PORT` are already set in the image. Leave `SEED_DEMO` and `MAIL_DEV_ALLOW` unset in production: users sign up and bring their own data (an empty account offers an optional, labelled sample person).
6. **Deploy and check.** The health check (`/healthz`, 300 s timeout in `railway.toml`) answers as soon as the server listens. Then run the smoke test from your machine:
   ```bash
   python -m uv run python scripts/smoke.py --base-url https://YOUR-URL --signup --agent
   ```
   It signs up a throwaway account, creates a synthetic person, imports a fake WhatsApp chat, analyzes it, checks the extension routes and the security headers, and deletes the person and the account again. `--agent` also exercises the Groq agent when a key is set. With `REGISTRATION=invite`, pass `--invite CODE` instead of `--signup`.
7. **Become admin.** Sign up with `ADMIN_EMAIL` and verify the address; the account becomes admin. With `REGISTRATION=invite` you need an invite first; create one bound to `ADMIN_EMAIL` from a Railway shell in the service (it uses the same `DATA_DIR` and `MASTER_KEY` and runs as the unprivileged user):
   ```bash
   docker-entrypoint.sh python scripts/create_invite.py --admin      # prints the code
   docker-entrypoint.sh python scripts/create_invite.py --email someone@example.com --days 7
   ```
   Locally: `DATA_DIR=data MASTER_KEY=... python scripts/create_invite.py --admin`. After that, admins create invites in Settings.

### Optional: shared sample accounts

`SEED_DEMO=1` with `DEMO_PASSWORD` creates two shared accounts (`judge1@demo.lvs`, `judge2@demo.lvs`) with three invented people. Seeding runs in the background after start-up (the health check does not wait for it) and resumes after a restart. Their password, sessions, tokens and deletion are locked (403 `demo_locked`). Not for production; real users sign up and use their own data.

## Groq model

`GROQ_MODEL=openai/gpt-oss-120b`. On Groq's models page (console.groq.com/docs/models, checked 2026-11-23) it is the production-tier flagship open-weight reasoning model with a 131,072-token context window and 65,536 max completion tokens, and Groq documents tool use for it. The other production models are `llama-3.3-70b-versatile` (131k, 32k completion, a smaller fallback) and the 8B and 20B models. Preview models (for example `minimaxai/minimax-m2.7`, 196k) are not for production use. Re-check the page before the demo; if a stronger production model with tool use has appeared, change only `GROQ_MODEL`.

**Zero Data Retention.** The agent sends conversation excerpts to Groq. Before using real data, enable Zero Data Retention in the Groq console (Settings, Data Controls). Without it, Groq may keep prompts and outputs. Users bring real chats, so turn it on before launch.

## Load the browser extension against the deployed URL

1. `cd extension && npm ci && npm run build`.
2. Open `chrome://extensions`, enable Developer mode, choose Load unpacked, and pick `extension/dist`. Copy the extension ID.
3. Set `EXTENSION_ID` on Railway to that ID and let the service redeploy.
4. In the web app, open Settings and create an **extension token** (shown once).
5. In the extension's Options page, enter the deployed URL as the API base, paste the token and Save. Chrome asks for access to that origin. More detail is in `extension/README.md`.

## Point the Capacitor apps at the server

The native apps cannot use same-origin requests. Build them with the absolute API origin:

```bash
cd frontend
VITE_API_MODE=live VITE_API_BASE=https://YOUR-URL npm run cap:sync
```

Optionally also set `VITE_GOOGLE_WEB_CLIENT_ID`, `VITE_GOOGLE_IOS_CLIENT_ID`, `VITE_APPLE_CLIENT_ID` and `VITE_APPLE_REDIRECT_URI`, and list the matching native audiences in `GOOGLE_CLIENT_IDS` and `APPLE_CLIENT_IDS` on the server. See [store-readiness.md](store-readiness.md) for store requirements.

## Operations notes

- **Backups:** the volume holds `accounts.db` and `users/*.db`, all encrypted under `MASTER_KEY`. Snapshot the volume (Railway Volumes, Backups) and keep `MASTER_KEY` separately.
- **Single instance:** do not scale to more than one replica.
- **Rotating secrets:** changing `JWT_SECRET` signs everyone out. Do not change `MASTER_KEY` unless you intend to abandon the data.
- **Logs:** uvicorn's access log is off; the app logs redacted route templates, ids and counts, never message text. (With `MAIL_DEV_ALLOW=1`, local only, verification links appear in the logs.)
