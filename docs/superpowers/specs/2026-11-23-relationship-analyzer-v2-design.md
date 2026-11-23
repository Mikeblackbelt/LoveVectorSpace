# Relationship Analyzer v2: frontend, capture extension, Groq agent

*2026-11-23. Addendum to `2026-11-23-relationship-analyzer-design.md` (v1). Where the two conflict, this file wins. Status: draft for owner approval.*

## 1. What changes and why

The owner wants to use the tool day to day, not just upload files:

1. **A browser extension** that captures one-to-one chats from WhatsApp Web, Discord (web) and Instagram (web). It sends them to the Railway backend and shows rough stats in its popup.
2. **A frontend** where everything comes together: extension updates, manual imports, questionnaires, analysis, next steps.
3. **Groq replaces the Claude API** for all LLM work.
4. **An agent** that proposes next steps after each analysis and that the owner can chat with to plan.

Everything else in v1 still holds: the evidence-tagged signals, validated scales, non-overridable safety block, encryption, single user and Railway hosting.

## 2. Superseded v1 decisions

| v1 | v2 |
|---|---|
| §6.5 Path 2 Claude narrative, `anthropic` SDK, `claude-opus-5-5` | Replaced by the Groq agent (§5). No Anthropic dependency. |
| §6.5 Path 1 "Claude as MCP client" | The `/mcp` endpoint stays (cheap; same tool definitions as the agent), but it is optional. The primary agent runs server-side on Groq. |
| §5 server-rendered `/ui` | Replaced by a React SPA (§4). `/api` stays. |
| §6.2 input "chat export upload" | Inputs: extension capture + backfill, and manual import of WhatsApp `.txt`, Instagram JSON export, Discord data package and plain text. |
| §10 "Access: API calls" | Access is now the frontend (session login) and the extension (scoped token). Scripts may still use the API token. |

## 3. Capture extension

### 3.1 Scope
- Chromium Manifest V3, for Chrome and Edge. Loaded unpacked; not published to any store.
- Sites: `web.whatsapp.com`, `discord.com/channels/@me/*` (DMs only), `www.instagram.com/direct/*` (DMs only). Group chats and Discord server channels are out of scope.
- **Opt-in per chat.** Nothing is captured until the owner links the open chat to a person in the popup. Unlinked chats are never read beyond detecting their title for the link dialog.

### 3.2 Behaviour
- **Live capture:** a `MutationObserver` on the message list of a linked chat extracts each new message: `platform, chat_key, platform_msg_id?, ts, ts_precision, speaker_raw, text`. Messages are queued in `chrome.storage.local` and flushed to `POST /api/ingest` in batches of 200 or less, at least every 30 s. The queue is cleared after the server acknowledges.
- **Backfill (owner-chosen, option B):**
  - Started from the popup ("Backfill this chat"), never automatically.
  - The content script scrolls the message pane up step by step and extracts messages as they load.
  - Rate limit: one scroll step every 2–4 s with jitter; at most 300 steps per run; 10-minute cool-down between runs on the same platform.
  - Stops at the owner-picked "back to" date, at the start of the chat, or on any anomaly: login page, captcha or challenge element, the selector health check failing, an HTTP error banner, or the tab losing focus for more than 60 s. The popup shows the stop reason.
  - Per-platform enable switches, all on by default. Discord's switch carries a one-line note: Discord's rules prohibit automating account actions, so the account risk is the owner's.
- **No page modification.** The extension injects no visible UI or styles into the sites; everything shows in its own popup. It makes no network calls to the platforms' APIs. It never sends, reacts, marks as read or otherwise acts.

### 3.3 Site adapters
- One adapter per platform: `findMessageList()`, `extract(node) -> CapturedMessage | null`, `currentChat() -> {chat_key, title}`, `scrollStep()`, `healthCheck() -> ok | reason`.
- Selectors live in `adapters/<platform>.selectors.json`. Sites change their markup, so a failing health check disables that platform's capture and shows "update selectors" rather than capturing garbage.
- Timestamps:
  - WhatsApp: the per-message `data-pre-plain-text`-style metadata, minute precision.
  - Discord: the `<time datetime>` element, second precision.
  - Instagram: timestamps appear only between message groups, so messages get the group's timestamp with `ts_precision="approx"`.
  - Latency metrics skip messages with approximate timestamps (§6).

### 3.4 Popup ("rough data")
For the open chat:
- link status;
- the linked person;
- messages captured (total and last 7 days);
- the owner's message share over the last 30 days;
- last flush and last backfill, with its stop reason;
- the platform's health status;
- buttons: Link / Unlink, Backfill (with a date picker), Pause capture.

The numbers come from `GET /api/ext/summary?chat_key=…`, which returns counts and shares only, never message text.

### 3.5 Extension auth
- The owner pastes an **extension token** into the extension's options page; it is stored in `chrome.storage.local`.
- Its scope is limited to `POST /api/ingest`, `GET /api/ext/people` (ids and pseudonyms), `POST /api/ext/link`, `GET /api/ext/summary`. It cannot read messages, reports or agent chats.
- It is revocable from the frontend Settings page.
- CORS allows only `chrome-extension://<EXTENSION_ID>` (env `EXTENSION_ID`) on `/api/ingest` and `/api/ext/*`.

## 4. Frontend

- React + Vite + TypeScript SPA, built in the Docker image and served by FastAPI at `/`. Session auth as in v1 §7.2 (password + TOTP).
- Pages:
  1. **People:** cards with mode, sources (WhatsApp / Discord / Instagram / import icons with last-sync times), and the latest safety status.
  2. **Person dashboard:**
     - the safety block first;
     - messages per week by speaker (a chart);
     - signal table with evidence tags and "what it can't tell you" notes;
     - scale results;
     - **next-step cards** (§5.3).
  3. **Agent chat** per person, with streaming replies and saved threads. It has an "Interview" mode with a topic progress bar, and a "Log a hangout" button that starts a guided check-in (§5.5).
  3a. **Context:** facts and the interaction log, each editable and deletable, with "unsure" toggles (§5.5).
  4. **Questionnaires:** take or retake a scale; results history.
  5. **Sources and import:**
     - manual upload (WhatsApp `.txt`, Instagram `message_*.json`, Discord `messages.json`, plain text);
     - per-source status;
     - speaker mapping (which raw name is "me" and which is "them", per platform);
     - delete per source or upload.
  6. **Settings:** extension token (create, revoke), Groq on/off, a reminder that Groq zero data retention should be on, "delete everything".
- **Consolidation:** ingest marks the person dirty, and a debounced job re-runs analysis at most every 15 minutes per person (or immediately on "Refresh"). The dashboard learns about new snapshots via SSE (`GET /api/events`).

## 5. Groq agent

### 5.1 Provider
- The official `groq` Python SDK; `GROQ_API_KEY` set as a Railway variable.
- The model is configurable (`GROQ_MODEL`), chosen at build time from Groq's models page: the strongest model listed with tool use and at least 128k context.
- **The owner enables Zero Data Retention in the Groq console** (Data Controls) before first use. The Settings page links to it.
- If no key is set, the frontend hides agent features and everything else works.

### 5.2 Tools (in-process, shared with `/mcp`)

| Tool | Returns |
|---|---|
| `get_person_overview(person_id)` | Mode, sources, latest signal table with evidence tags, scale results, safety block |
| `get_history(person_id, metric)` | Time series |
| `search_messages(person_id, query, limit=20)` | Matching excerpts with dates (owner override v1 §10a.1 allows message text to reach the LLM) |
| `explain_metric(metric_id)` | Measures, evidence, caveats, citation |
| `list_next_steps(person_id)` / `propose_next_step(person_id, title, why, evidence_refs, kind)` / `update_next_step(id, status)` | Next-step cards |

### 5.3 Next steps
- After each analysis job, if anything changed, the agent writes 1–3 **next-step cards** using `propose_next_step`.
- Each card has a title, a 1–2 sentence "why", the evidence it rests on (metric ids or scale ids, so the UI links to them), and a kind: `talk`, `plan`, `reflect`, `safety` or `pause`.
- The owner can mark a card done, dismiss it, or open it in chat. Dismissed cards inform future proposals, so the agent doesn't repeat itself.

### 5.4 Chat
- One thread or more per person, stored encrypted. Streaming goes over SSE to the frontend.
- The system prompt carries the v1 §6.5 agent rules, plus:
  - help the owner plan honest communication (drafting messages is fine) but never manipulation tactics, pressure, or jealousy-inducing schemes;
  - refuse to help monitor, track or control the other person;
  - when the safety block has `concern` or `urgent` flags, lead with them and the resources;
  - never state outcome probabilities;
  - mark heuristic signals as heuristic.
- Context is a short summary built per turn from `get_person_overview`; details come through tools.

### 5.5 Agent interviews and in-person interaction log

The agent asks the owner detailed questions, so guidance rests on what happens offline too, not only on chats.

- **Intake interview**, offered when a person is added and resumable at any time:
  - The agent asks adaptive questions one at a time.
  - **Both modes:** how they met; how long they've known each other; how often they see each other in person and where; the owner's goals and worries; anything the owner is unsure how to read.
  - **Potential mode:** who suggests meeting up; what signals the owner has noticed, described as concrete behaviour ("what did they say or do?"); mutual friends or shared settings; what the owner wants next.
  - **Established mode:** length and stage of the relationship; living situation; what's going well; recurring disagreements and how they usually end; stressors; shared plans.
  - **Established mode, optional safety questions** worded from the CDAQ items, which feed the safety block.
  - Answers are saved as **context facts** `(person_id, key, value, source: interview|checkin|owner_edit, asked_at, confidence: owner_sure|owner_unsure)`. The full transcript is kept as an agent thread.
- **"Log a hangout"** (a dashboard button, or saying it in chat):
  - The agent asks follow-up questions:
    - when, where and how long;
    - who suggested it;
    - what they did;
    - how close and comfortable it felt (1–7 each);
    - responsiveness moments (did they ask about the owner, remember details, share something personal);
    - any tension and how it resolved;
    - affection cues (optional, skippable, never pressed);
    - whether a next meeting was proposed, and by whom;
    - whether earlier plans were followed through.
  - Saved as an `interactions` row with structured fields plus free-text notes.
- **Check-ins:** the agent proposes a short check-in in two cases:
  - 10 days with no logged interaction while chats continue;
  - a chat signal shift, e.g. "their message share dropped this week; did anything happen in person?"

  Check-ins appear as a `reflect` next-step card; the agent never pushes notifications.
- **Interaction signals** (evidence tag `self-report heuristic`):
  - meetups per month;
  - share of meetups the owner initiated;
  - plan follow-through rate;
  - closeness and comfort trends;
  - tension incidence.

  They are shown on the dashboard next to the chat signals, with coverage noted (only logged hangouts count).
- **Question rules** (in the system prompt and tool descriptions):
  - one question per turn;
  - every question skippable;
  - ask for observable behaviour before interpretation;
  - no leading questions;
  - restate ambiguous answers to confirm;
  - sensitive topics (sex, health, past abuse) only if the owner raises them or explicitly opts in;
  - never suggest the owner covertly gather information about the other person.
- **Personalised guidance:** next-step cards and chat replies draw on context facts and the interaction log alongside chat signals and scales. Each card's evidence refs may point to facts (`fact:<id>`) or interactions (`interaction:<id>`), so the owner sees what a suggestion rests on.
- **Owner control:** a Context page lists every fact and interaction, each editable and deletable. Facts the owner marks "unsure" are weighted lower and flagged in replies.

Additional agent tools (also exposed via `/mcp`):

| Tool | Purpose |
|---|---|
| `get_context(person_id)` | All current facts plus a summary of recent interactions |
| `save_context_fact(person_id, key, value, confidence)` | Record or update a fact from the conversation |
| `log_interaction(person_id, fields, notes)` / `list_interactions(person_id, since)` | In-person interaction log |
| `get_interview_progress(person_id)` | Which intake topics are covered or still open, so the interview resumes cleanly |

## 6. Data model and signal changes
- `messages` gains `source` (`whatsapp_ext`, `discord_ext`, `instagram_ext`, `whatsapp_import`, `instagram_import`, `discord_import`, `plaintext`), `platform_msg_id` (nullable) and `ts_precision` (`second`, `minute` or `approx`).
- New tables: `speaker_map(person_id, source, speaker_raw, role: me|them)`, `chat_links(person_id, platform, chat_key)`, `agent_threads(kind: chat|interview|checkin)`, `agent_messages`, `next_steps`, `context_facts`, `interactions`, `tokens(kind, hash, created_at, revoked_at)`.
- **Cross-source de-duplication:**
  - Key 1: `(platform, platform_msg_id)` when present.
  - Otherwise key 2: `(person, role, ts rounded to the minute, normalised text, occurrence index)`. Normalising means lower-casing, collapsing whitespace and stripping zero-width characters.
  - For approximate-timestamp messages, the key uses the timestamp ±10 minutes and identical text.
  - This merges an extension capture with a later export of the same chat.
- Latency and double-text metrics skip `approx` messages and say so.
- **Discord import caveat:** Discord's data package is believed to contain only the owner's own messages. The importer must check this. If true, it marks the import "one-sided" and signals that need both speakers are not computed from it alone.

## 7. Security deltas
- Three credentials: session (frontend), API token (scripts, full), extension token (scoped, §3.5). Tokens are stored hashed (sha256) and shown once.
- `/api/ingest` limits: 2 MB per request, 10,000 messages per minute; payloads are validated against a schema.
- The SSE endpoint requires a session.
- The extension never stores message text beyond the unsent queue, which is capped at 5,000 messages. When the cap is reached, capture pauses with a popup warning.

## 7a. Decisions settled after builder review (designer's calls — owner may override)

1. **Message identity and provenance.** There is one canonical `messages` row per real message, plus `message_sources(message_id, source, unit_id, platform_msg_id)`. Units are what can be deleted: an import upload, or an extension capture day (`capture:<platform>:<YYYY-MM-DD>`).
   - Matching on insert: key 1 `(platform, platform_msg_id)`, then key 2 `(person, role, minute-UTC, normalised text, occurrence index)`. For `approx` timestamps, a fuzzy ±10-minute match on identical normalised text (not a unique key; checked in code).
   - A match adds a `message_sources` row instead of a new message. When a unit is deleted, its source rows go, and a message is deleted only when it has no sources left.
   - This replaces the v1 `msg_hash`.
2. **Role is known at ingest.**
   - The extension sends `direction: outgoing|incoming`, read from the page (outgoing messages are marked differently on all three sites; the adapter's `extract` must return it). `speaker_raw` is still stored.
   - Imports ask "which name is you?" in the import dialog before ingest; a Discord data package is all outgoing.
   - Changing a speaker mapping re-runs de-duplication for that person.
3. **Time.** All timestamps are stored in UTC.
   - The extension sends the browser's IANA timezone with each batch; local wall-clock times on a page are converted with it.
   - Imports use an owner-wide timezone setting (filled in at first login from the browser), which each upload can override.
   - Absolute sources (Discord `<time datetime>`, export epoch-ms fields) are used as-is.
4. **Automatic next steps.**
   - Auto-run only on a material change: a signal's band or a trend change-point, a safety status change, a new scale result, or 7 days since the last cards.
   - At most one auto-run per person per day; on-demand runs from the dashboard are unlimited.
   - The agent is on by default when `GROQ_API_KEY` is set.
   - A setting "Agent may read message text" (default on, per owner override v1 §10a.1) controls whether `search_messages` is available, both in chat and in background runs. Off means metrics only.
   - New cards that duplicate an open or dismissed card (same kind and same evidence refs within 14 days) are dropped.
5. **Coverage and gaps.**
   - The server keeps coverage intervals per person and source.
   - When a linked chat is opened, the extension compares the newest messages on screen with the server's last captured message (via `/api/ext/summary`). If there's a gap, it runs a bounded catch-up scroll: at most 50 steps, same rate limit as backfill, own toggle, default on.
   - Signals are computed only over covered intervals. Charts shade the uncovered spans, and metrics note "partial coverage" when under 80% of the window is covered.
6. **Plan.** Nothing is built yet, so the v1 plan is replaced by one combined v1+v2 plan. The v1 tasks for the Jinja UI and the Anthropic narrative are dropped.

## 8. Out of scope
- Mobile app capture.
- Group chats.
- Sending messages.
- Store-published extension.
- Phase 2 predictor (unchanged; separate plan).

## 9. Left to the builder
- Visual design.
- Chart library.
- Exact selectors (they will need maintenance).
- Popup layout.
- SSE vs WebSocket details (SSE preferred).
