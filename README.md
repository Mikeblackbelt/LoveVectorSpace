# LoveVectorSpace

LoveVectorSpace is a multi-user web, Android/iOS and browser-extension app that helps you make sense of a relationship from the conversations you have with someone. You import or capture chats (WhatsApp, Discord, Instagram, dating apps, SMS), and it computes transparent communication metrics (reciprocity, responsiveness, language style), scores validated questionnaires, flags safety patterns with resources, and gives an **uncalibrated** success estimate with a range. An optional Groq-powered agent can interview you, check in and answer questions using only your data. Every account has its own encrypted database, and the estimate is never presented as a prediction you should trust blindly.

It is also the research behind it: the literature review below explains what the signals mean and how reliable they are.

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
python scripts/gen_secrets.py            # prints MASTER_KEY, JWT_SECRET, DEMO_PASSWORD
export MASTER_KEY=... JWT_SECRET=...     # paste the printed values
export COOKIE_SECURE=0 MAIL_DEV_ALLOW=1  # plain http and a console mailer for local use
export SEED_DEMO=1 DEMO_PASSWORD=...     # optional: judge1@demo.lvs with synthetic people
python scripts/fetch_models.py           # optional: emotion model (add --export for toxicity; needs the `export` extra)
python -m uv run uvicorn analyzer.web.main:app --reload
python -m uv run pytest -q -m "not models and not slow"
```

Frontend:

```bash
cd frontend && npm install
npm run dev          # http://localhost:5173, in-browser mock API, no backend needed
npm run dev:live     # same UI against the backend on :8000 (needs ADMIN/invite or the demo login)
```

Extension:

```bash
cd extension && npm install && npm run build    # load extension/dist unpacked in chrome://extensions
```

Run `python scripts/smoke.py --base-url http://localhost:8000 --email judge1@demo.lvs --password ...` to check a running server end to end.

## Hackathon demo flow for judges

1. Open the deployed URL and sign in as `judge1@demo.lvs` (the password is shared separately). The account holds three synthetic people: **Yu Cheng** (potential, a mid-range estimate), **Sam** (established, with a safety pattern and its plain-text resources) and **Jordan** (too little data, so no estimate).
2. Open Yu Cheng. Read the success estimate and its range, the "uncalibrated" tag, the top contributors, and the reciprocity metrics. Use "explain" on any metric to see what it measures and its evidence level.
3. Open Sam to see the safety block, then Jordan to see the insufficient-data state.
4. Add a person, import a chat export (any WhatsApp "export chat" file), and watch the analysis finish live.
5. Answer a questionnaire and the next steps update, each citing the metric, scale or fact it comes from.
6. Open the agent, start an interview or ask "What do you know about this person?" and watch it call tools over the data before it answers.
7. Optional: load the extension, link a WhatsApp Web chat, and see counts (never text) in its popup.

## Research

| File | What it is |
|---|---|
| [literature-review.md](literature-review.md) | Thematic literature review: 26 core papers, 12 adjacent studies, a dataset inventory, gaps and ethics |
| [article-summaries.md](article-summaries.md) | Structured summary of every paper (citation, data, method, results, limitations, verification tier) |

**Headline finding:** relationship signal is measurable in conversation, but nearly all labelled data is movie/TV fiction, accuracy is moderate (fine-grained type classification ~0.2–0.4 macro-F1; coarse targets 60–85%), and no public corpus of real text messages labelled with the sender–recipient relationship was found.

As of 2026-11-23. Every figure was checked against the primary source to the depth stated in each summary's verification tier.
