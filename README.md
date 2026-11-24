# LoveVectorSpace

LoveVectorSpace helps you make sense of a relationship, or a possible one, from the conversations you actually have with that person. You bring your own chats (WhatsApp, Discord, Instagram, Tinder, Hinge, Bumble, Grindr, SMS or plain text). The app shows:

- **Communication metrics**: who starts conversations, message share, reply times, questions, opening up, language-style match and how these change week to week. Each metric is explained and tagged with its evidence level.
- **Check-ins and questionnaires**: short scales you can answer for yourself. Original items are tagged [CUSTOM]/[UNVERIFIED]; published instruments ship without their wording, which an operator adds locally.
- **Safety patterns**: monitoring, control and threatening language, shown first, with plain-text support resources. It is not a crisis service.
- **An uncalibrated estimate** of how things may go, always shown with its range and the tag "uncalibrated", never as a prediction to trust blindly.
- **Next steps** that cite the metric, fact or check-in they come from, and an optional **assistant** (Groq) that can interview you, log hangouts and answer questions using only your own data.

Every account has its own encrypted database. You can export or delete everything at any time.

It is also the research behind it: the literature review below explains what the signals mean and how reliable they are.

## Using it

1. **Create an account.** Open the app and sign up with your email and a password (12+ characters), or with Google/Apple where the server offers them. Verify your email from the link you receive. If the server runs in invite mode, you also need an invite code from its admin.
2. **Add a person.** A nickname is enough; pick "potential" (dating, getting to know someone) or "established" (a partner).
3. **Import a chat** under Sources → Import. Supported exports:
   - **WhatsApp**: in the chat, More → Export chat → Without media; upload the `.txt`.
   - **Discord**: request your data package (Settings → Data & Privacy) and upload the conversation's `messages.json`.
   - **Instagram**: Accounts Center → Your information → Download your information (JSON); upload the conversation's `message_1.json`.
   - **Tinder, Hinge, Bumble, Grindr**: "Download my data" from the app; upload the JSON and pick the match.
   - **Plain text** with `YYYY-MM-DD HH:MM | speaker | text` lines.

   Say which name is you, and the analysis runs in the background. Large chats (thousands of messages) are usable right away: the dashboard shows "scored N of M recent messages" while the language models catch up in batches.
4. **Read the dashboard**, answer a check-in under Forms, log in-person hangouts under Context, and press **Generate** on Next steps whenever you want fresh suggestions (they also refresh after each analysis or check-in, at most every 10 minutes per person).
5. **Want to look around first?** On an empty account, "Explore with a sample person" adds one clearly labelled invented person. Delete it any time.

### Browser extension (WhatsApp Web, Discord, Instagram)

Build it with `cd extension && npm ci && npm run build`, load `extension/dist` unpacked in `chrome://extensions`, create an **extension token** in Settings, and enter the server URL and token in the extension's Options. Link an open chat to a person; new messages are captured for linked chats only, and the popup shows counts, never text. Details: [extension/README.md](extension/README.md).

### Phone capture (Android and iOS apps)

The Capacitor apps add screenshot import (on-device OCR) on both platforms, and on Android sideload builds an SMS reader, a notification reader and an accessibility chat reader. Every method is opt-in and captures linked contacts only. Details: [docs/mobile-capture.md](docs/mobile-capture.md).

### Privacy

- Each account's data lives in its own SQLCipher database, encrypted with a per-account key that is itself wrapped by the server's master key.
- Logs never contain message text, facts or assistant content (only ids, counts and error names).
- The assistant sends excerpts of your data to Groq only when you use it; you can turn it off, or stop it from reading message text, in Settings. Operators should enable Groq Zero Data Retention.
- Export your data or delete your account (database file, account and tokens) from Settings → Your data. See the in-app Privacy page.

## Documentation

| Doc | What it covers |
|---|---|
| [docs/deploy.md](docs/deploy.md) | Deploying to Railway (Docker, volume, variables, extension and mobile setup) |
| [docs/env.md](docs/env.md) | Every server environment variable |
| [docs/api.md](docs/api.md) | The HTTP API contract |
| [docs/mobile-capture.md](docs/mobile-capture.md) | Capturing messages on Android and iOS |
| [docs/store-readiness.md](docs/store-readiness.md) | App store requirements and status |
| [frontend/README.md](frontend/README.md), [extension/README.md](extension/README.md) | The SPA and the capture extension |

## Local development

Backend (Python 3.13, [uv](https://docs.astral.sh/uv/)):

```bash
python scripts/gen_secrets.py            # prints MASTER_KEY and JWT_SECRET (and an optional DEMO_PASSWORD)
export MASTER_KEY=... JWT_SECRET=...     # paste the printed values
export COOKIE_SECURE=0 MAIL_DEV_ALLOW=1  # local only: plain http, and email links are logged instead of sent
python scripts/fetch_models.py           # optional: emotion model (add --export for toxicity; needs the `export` extra)
python -m uv run uvicorn analyzer.web.main:app --reload --no-proxy-headers --no-access-log
python -m uv run pytest -q -m "not models and not slow"
```

Sign up at the frontend with any email (open registration is the default; the verification link appears in the server log).

Frontend:

```bash
cd frontend && npm install
npm run dev          # http://localhost:5173, in-browser mock API with invented data, no backend needed
npm run dev:live     # the same UI against the backend on :8000
```

## Operator pre-launch checklist

1. Deploy as in [docs/deploy.md](docs/deploy.md) with `RESEND_API_KEY` and `MAIL_FROM` set, so verification and password-reset emails reach real users. `MAIL_DEV_ALLOW` is for local development only; leave it unset in production. Leave `SEED_DEMO` unset.
2. Run the smoke test against the deployed URL with the real Groq key configured on the server:
   `python -m uv run python scripts/smoke.py --base-url https://YOUR-URL --signup --agent` (it signs up a throwaway account, runs the whole pipeline and the agent, then deletes the account).
3. Check that the client IP the server sees is right: with `TRUSTED_PROXIES` set, the app uses the rightmost `X-Forwarded-For` hop, which must be the address Railway's edge saw (your own public IP), not the edge itself. Test it once: make 6 failed logins for one email from one network (the 6th gets 429), then try from another network (it must not be blocked). If both are blocked, the per-IP sign-up and login limits are keyed on the proxy; fix `TRUSTED_PROXIES`.
4. Enable Groq Zero Data Retention, back up the volume, and keep `MASTER_KEY` in a password manager.

## Research

| File | What it is |
|---|---|
| [literature-review.md](literature-review.md) | Thematic literature review: 26 core papers, 12 adjacent studies, a dataset inventory, gaps and ethics |
| [article-summaries.md](article-summaries.md) | Structured summary of every paper (citation, data, method, results, limitations, verification tier) |

**Headline finding:** relationship signal is measurable in conversation, but nearly all labelled data is movie/TV fiction, accuracy is moderate (fine-grained type classification ~0.2–0.4 macro-F1; coarse targets 60–85%), and no public corpus of real text messages labelled with the sender–recipient relationship was found.

As of 2026-11-23. Every figure was checked against the primary source to the depth stated in each summary's verification tier.
