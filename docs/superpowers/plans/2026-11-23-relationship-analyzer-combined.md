# Relationship Analyzer (v1 + v2) Combined Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single-user, Railway-hosted relationship analyzer, made of five parts:
- an engine: validated scales, evidence-tagged chat signals, safety check, interaction log;
- a React frontend;
- a Chromium capture extension for WhatsApp Web, Discord and Instagram DMs;
- a Groq-powered agent that interviews the owner, proposes next steps and chats to plan;
- an optional MCP endpoint.

**Architecture:** A Python package `analyzer` holds the engine and a FastAPI app in one process. `/api` serves the SPA and the extension, `/mcp` is optional, and SSE pushes live updates. A SQLCipher database sits on a Railway volume. ONNX int8 models are baked into the image. The React SPA is built into the image and served at `/`. The MV3 extension is loaded unpacked and talks to `/api/ingest` and `/api/ext/*` with a scoped token.

**Tech Stack:**
- Python 3.13 and uv; FastAPI; pydantic v2; PyYAML.
- `sqlcipher3-wheels` (import `sqlcipher3`); `onnxruntime`; `tokenizers`.
- `argon2-cffi`; `pyotp`; `itsdangerous`; `sse-starlette`.
- `mcp` (official Python SDK v2); `groq` (official SDK); pytest.
- Export extra: `optimum[onnxruntime]` and torch CPU.
- Frontend: Vite, React and TypeScript, TanStack Query, Recharts, Vitest.
- Extension: TypeScript, Vite (crxjs or plain multi-entry build), Vitest with jsdom.

**Specs (read both; v2 wins on conflict):**
- `docs/superpowers/specs/2026-11-23-relationship-analyzer-design.md` (v1), especially §6, §7, §10, §10a;
- `docs/superpowers/specs/2026-11-23-relationship-analyzer-v2-design.md` (v2), all of it, especially §3, §5.5 and §7a.

**Task bodies reused from** `docs/superpowers/plans/2026-11-23-relationship-analyzer-v1.md`. Where a task below says "v1 plan Task N", the implementer reads that task's steps and applies the deltas listed here. The deltas win.

## Global Constraints

- English only; non-English messages are skipped and counted (v1 §3).
- All timestamps are stored in UTC. Each message carries `ts_precision ∈ {second, minute, approx}` (v2 §7a.3).
- Single user, no OAuth. Credentials (v2 §7):
  - session cookie, after password + TOTP;
  - `API_TOKEN`, with full API access;
  - extension token: hashed in the DB, revocable, scoped to `POST /api/ingest`, `GET /api/ext/people`, `POST /api/ext/link`, `GET /api/ext/summary`.
- No unauthenticated route except `GET /healthz`, the login endpoints and the SPA's static shell, which holds no data.
- CORS: only `chrome-extension://$EXTENSION_ID`, and only on `/api/ingest` and `/api/ext/*`.
- Fail closed if `DB_KEY` is missing or wrong; never create an unencrypted DB.
- Logs never contain message text, fact values or agent message content.
- No outcome probabilities anywhere. Every metric carries an evidence tag:
  - `moderate`, `heuristic` or `descriptive`;
  - `self-report heuristic` for interaction metrics.
- Un-normed metrics show "no reference band".
- The safety block is never softened by the LLM. Snippets may reach the LLM (owner override).
- Product focus (v2 §7b): healthy relationships and reciprocity. Unhealthy dynamics get **warnings only**:
  - no safety plans, no abuse counselling, no diagnosis of the other person;
  - resources are `action: suggestion_only`, with no `tel:` links, no auto-dial and no contact initiated by the app or agent;
  - the fixed disclaimer "This tool offers reflection and pattern warnings. It is not therapy, counselling, or a crisis service." appears in the footer, in Settings and under the safety block.
- "Agent may read message text" setting defaults on; when off, `search_messages` is not offered to the model.
- Groq:
  - `GROQ_API_KEY` and `GROQ_MODEL` come from env;
  - `GROQ_MODEL` is the strongest model on Groq's models page with tool use and at least 128k context, verified at build time and recorded in `README-deploy.md`;
  - the agent is disabled when there's no key.
- Extension behaviour:
  - no injected visible UI or styles on the sites;
  - no calls to the platforms' APIs;
  - never sends, reacts or marks as read;
  - backfill and catch-up are rate-limited and stop on anomalies (v2 §3.2 and §7a.5).
- Secrets come from env: `DB_KEY`, `API_TOKEN`, `OWNER_PASSWORD_HASH`, `TOTP_SECRET`, `SESSION_SECRET`, `GROQ_API_KEY`, `GROQ_MODEL`, `APP_ORIGIN`, `EXTENSION_ID`, `DB_PATH`.
- No server names, usernames or addresses in the repo. Real chats never enter the repo; test fixtures are synthetic.

## Review Focus

1. **Cross-source duplicate merging.**
   - The same chat arrives via extension capture (has `platform_msg_id`, browser-local times) and later via official export (no ids, file timezone); it must merge into one copy.
   - "ok" sent twice in the same minute must stay two messages.
   - Tests in Task 2a.
2. **Timezone mismatch.** The extension sends `America/New_York` local times and an import is made with owner timezone `America/New_York`. Both convert to the same UTC instant across DST boundaries. Tests in Tasks 1 and 2a.
3. **Selector drift.**
   - A site changes its markup and the extension's health check fails, so capture for that platform stops.
   - The popup shows "update selectors". No garbage or empty-text messages are ingested.
   - Tests in Task 18.
4. **Too little data or coverage.** An empty chat, a one-sided Discord import, or under 80% coverage gives `insufficient_data` or a "partial coverage" note, not misleading numbers. Tests in Tasks 5 and 8.
5. **Wrong or missing DB key** fails closed with no file created. Tests in Task 2a.

---

## Phase A — Engine

### Task 1: Skeleton, message model, parsers, importers, timezone

**Files:**
- Create: `pyproject.toml`, `src/analyzer/{__init__,config}.py`, `src/analyzer/parsers/{__init__,model,whatsapp,plaintext,instagram_json,discord_json,language,tz}.py`
- Test: `tests/parsers/*`, `tests/fixtures/chats/*` (synthetic)

**Interfaces:**
- Produces:
  - `Message(ts: datetime[UTC], role: Literal["me","them"] | None, speaker_raw: str, text: str, ts_precision: str, platform_msg_id: str | None, source: str)` (frozen dataclass)
  - `parse_whatsapp(raw, tz: str) -> list[Message]`, with `role=None` and `ts_precision="minute"`
  - `parse_plaintext(raw, tz) -> list[Message]`
  - `parse_instagram_json(raw: str) -> list[Message]`, which fixes Instagram's latin-1 mojibake by re-encoding `text.encode("latin-1").decode("utf-8")` when that round-trip succeeds
  - `parse_discord_json(raw: str, owner_name: str) -> tuple[list[Message], bool]`, where the bool is `one_sided`, true if every author is the owner
  - `assign_roles(msgs, me_names: set[str]) -> list[Message]`
  - `to_utc(local: datetime, tz: str) -> datetime`
  - `is_english`, `filter_english` as in v1 plan Task 1

- [ ] **Step 0: Install uv:** `python -m pip install --user uv`. Expected: `uv --version` prints a version.
- [ ] **Step 1–5: v1 plan Task 1**, plus these deltas:
  - Add tests `test_instagram_mojibake_fixed`, `test_discord_one_sided_flag`, `test_assign_roles`.
  - Add `test_to_utc_dst`: 2026-03-08 01:30 and 03:30 in America/New_York map to UTC instants 1 hour apart in wall-clock terms but correctly offset.
  - Add `test_whatsapp_local_times_converted_with_tz`.
  - Commit: `feat: parsers, importers, tz`.

### Task 2a: Store core — canonical messages, sources, de-duplication, deletes, coverage

**Files:**
- Create: `src/analyzer/store/{db,schema,messages}.py`
- Test: `tests/store/test_db.py`, `tests/store/test_messages.py`

**Interfaces:**
- Consumes: `Message` (Task 1)
- Produces:
  - `open_db(path, key) -> Connection` and `DatabaseKeyError` (v1 plan Task 2 semantics and tests: wrong key, empty key, not plaintext)
  - `class MessageStore(conn)` with:
    - `ingest(person_id, msgs: list[Message], unit_id: str) -> IngestResult(added, merged, skipped)`
    - `messages(person_id, roles_required=True) -> list[StoredMessage]` (UTC order)
    - `delete_unit(unit_id) -> int` (messages removed)
    - `units(person_id) -> list[Unit]`
    - `coverage(person_id) -> list[tuple[datetime, datetime, str]]` (start, end, source)
    - `recompute_dedupe(person_id) -> int`
- Rules: v2 §7a.1.
  - Key 1 is `(platform, platform_msg_id)`.
  - Key 2 is `(person, role, minute-UTC, normalised text, occurrence index within the batch)`.
  - `approx` messages use a fuzzy ±10-minute match on identical normalised text.
  - A matched message gets an added `message_sources` row.
  - Messages with `role=None` are stored but excluded from `messages(roles_required=True)` and from de-duplication until roles are assigned.
  - Coverage interval per unit = [min ts, max ts] of that unit's messages.
- Tables: `people`, `units`, `messages`, `message_sources`. Other tables come in Task 2b.

- [ ] **Step 1: Write failing tests:**
  - the v1 plan Task 2 DB-key tests;
  - `test_capture_then_export_merges`: extension msgs have ids; export of the same msgs has no ids; after both, the count is unchanged and each message has 2 sources;
  - `test_same_minute_duplicates_survive`;
  - `test_approx_fuzzy_merge_within_10min`;
  - `test_approx_no_merge_beyond_10min`;
  - `test_delete_unit_keeps_messages_with_other_sources`;
  - `test_delete_last_source_deletes_message`;
  - `test_unmapped_roles_excluded_until_assigned`;
  - `test_coverage_intervals`.
- [ ] **Step 2: Run** `uv run pytest tests/store -v`. Expected: FAIL.
- [ ] **Step 3: Implement.** Normalise text: NFC, lower-case, collapse whitespace, strip U+200B–U+200F and U+FEFF.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit:** `feat: canonical message store with provenance`

### Task 2b: Store — remaining tables and repositories

**Files:**
- Create: `src/analyzer/store/{people,tokens,links,facts,interactions,agent,next_steps,jobs,scores,snapshots,settings}.py`
- Test: `tests/store/test_repos.py`

**Interfaces:**
- Consumes: `open_db`, the schema migration helper (Task 2a)
- Produces repositories, each a small class over the connection with typed pydantic return models:
  - `People.add(pseudonym, mode, timezone) / list() / get(id) / delete(id)` (cascade + `VACUUM`)
  - `SpeakerMap.set(person_id, source, speaker_raw, role) / get(person_id)`
  - `Tokens.create(kind: Literal["api","extension"]) -> str` (returns the plaintext once, stores sha256), `.verify(kind, plaintext) -> bool` (constant time), `.revoke(id)`
  - `ChatLinks.link(person_id, platform, chat_key) / person_for(platform, chat_key) / unlink(...)`
  - `Facts.upsert(person_id, key, value, source, confidence) / list(person_id) / update(id, ...) / delete(id)`
  - `Interactions.add(person_id, fields: InteractionFields, notes) / list(person_id, since=None) / update / delete`
  - `InteractionFields`: `ts, place, duration_min, initiated_by: me|them|mutual, activity, closeness_1_7, comfort_1_7, responsiveness: list[str], tension: str|None, affection: str|None, next_plan_proposed_by: me|them|none, followed_through_prev: bool|None`
  - `AgentStore.new_thread(person_id, kind) / add_message(thread_id, role, content, tool_calls=None) / thread(id) / threads(person_id)`
  - `NextSteps.add(person_id, kind, title, why, evidence_refs) / list(person_id, status=None) / set_status(id, status) / recent_similar(person_id, kind, evidence_refs, days=14) -> bool`
  - `Jobs.create / update / get`
  - `Scores.get(message_ids, model) / put(model, mapping)`
  - `Snapshots.save / list / latest`
  - `Settings.get(key, default) / set(key, value)`. Keys: `owner_timezone`, `agent_reads_text` (default True), `agent_enabled` (default True), `catchup_enabled` (default True).

- [ ] **Step 1: Write failing tests**, one round-trip test per repository, plus:
  - `test_token_shown_once_and_hashed`;
  - `test_revoked_token_fails`;
  - `test_delete_person_cascades_everything`;
  - `test_recent_similar_next_step`.
- [ ] **Step 2: Run** `uv run pytest tests/store/test_repos.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit:** `feat: repositories`

### Task 3: Scale schema and scorer — v1 plan Task 3 (no deltas)

### Task 4: Scale definitions — v1 plan Task 4 (no deltas)

### Task 5: Core chat signals

v1 plan Task 5, plus these deltas:
- Signal functions take `list[StoredMessage]` with roles (no `me` argument). `per_speaker` keys are `"me"` and `"them"`.
- Latency and double-text skip `approx` messages; the note gives the count skipped.
- Add `coverage_ratio(coverage, window) -> float`. Any metric over a window with coverage under 0.8 has its note prefixed "partial coverage".
- Add tests `test_latency_skips_approx` and `test_partial_coverage_note`.

### Task 6: ONNX emotion and toxicity, plus trends

v1 plan Task 6 as written: model export stage, per-message score cache via `Scores`, benchmark. Trends shade uncovered weeks by returning `None`.

### Task 7: Safety

v1 plan Task 7, plus these deltas:
- Inputs add `facts` (the established-mode safety answers from the interview, keys prefixed `safety.`). They are mapped with the same severity rules as the CDAQ answers.
- Add test `test_interview_safety_facts_feed_flags`.

### Task 8: Interaction signals

**Files:**
- Create: `src/analyzer/signals/interactions.py`
- Test: `tests/signals/test_interactions.py`

**Interfaces:**
- Consumes: `Interactions` (Task 2b), `Metric` (Task 5)
- Produces: `interaction_metrics(interactions: list[Interaction], window_days: int = 90) -> list[Metric]` with these ids:
  - `meetups_per_month`;
  - `meetup_initiation_share` (per "me" / "them"; "mutual" counts half each);
  - `plan_follow_through_rate` (share of `followed_through_prev` true among non-null);
  - `closeness_trend` (slope of `closeness_1_7` over time; None if under 3 points);
  - `comfort_trend`;
  - `tension_rate`.

  Evidence tag `self-report heuristic` on all; note "only logged hangouts count".

- [ ] **Step 1: Write failing tests:**
  - `test_initiation_share_mutual_half`;
  - `test_follow_through_ignores_null`;
  - `test_trend_needs_three_points`;
  - `test_insufficient_when_no_interactions`.
- [ ] **Step 2: Run** `uv run pytest tests/signals/test_interactions.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit:** `feat: interaction signals`

### Task 8b: Uncalibrated "chance of success" estimate (v2 §7c)

**Files:**
- Create: `src/analyzer/signals/success.py`, `src/analyzer/signals/success_weights.yaml`
- Test: `tests/signals/test_success.py`

**Interfaces:**
- Consumes: `Metric` lists from Task 5 (`core_report`), Task 8 (`interaction_metrics`), and `Fact` (Task 2b)
- Produces:
  - `SuccessEstimate(mode, status: Literal["ok","insufficient_data"], percent: float | None, low: float | None, high: float | None, tag: str, top_contributors: list[tuple[str, float]], definition: str, calibrated: CalibratedSlot)`
  - `CalibratedSlot(status: Literal["not_available","ok"], percent, low, high, n_outcomes, needed: int)`
  - `uncalibrated_success(mode, chat_metrics, interaction_metrics, facts) -> SuccessEstimate`
- Rules:
  - Weights and intercept per mode live in YAML, with a comment per weight citing the direction source.
  - Each signal is standardised to [-1, 1] around "balanced" (e.g. initiation share 0.5 → 0). Missing or insufficient signals drop out, and the range widens by 5 points per missing core signal.
  - The base range is ±15 points.
  - `insufficient_data` if fewer than 3 core signals (lsm, initiation_share, message_share, question_rate, meetup_initiation_share) are ok.
  - The tag text is exactly "uncalibrated estimate: hand-set weights, not fitted to outcomes".
  - `calibrated` is always `not_available` with `needed=20` in v1.
  - The definitions are exactly v2 §7c's.

- [ ] **Step 1: Write failing tests:**
  - `test_balanced_signals_near_intercept`;
  - `test_one_sided_initiation_lowers_estimate`;
  - `test_missing_signals_widen_range`;
  - `test_insufficient_when_few_core_signals`;
  - `test_tag_and_definition_exact`;
  - `test_calibrated_slot_not_available`;
  - `test_percent_within_0_100`.
- [ ] **Step 2: Run** `python -m uv run pytest tests/signals/test_success.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit:** `feat: uncalibrated success estimate`

### Task 9: Service layer, ingest, re-analysis jobs, material change, events

**Files:**
- Create: `src/analyzer/service/{analyzer,ingest,jobs,events,material}.py`
- Test: `tests/service/*`

**Interfaces:**
- Consumes: Tasks 2a–8
- Produces:
  - `Analyzer` (v1 plan Task 8 API, with roles and coverage), plus `overview(person_id) -> PersonOverview(mode, sources, metrics, interaction_metrics, scales, safety, coverage, success: SuccessEstimate)`
  - `IngestService.ingest_capture(person_id, batch: CaptureBatch) -> IngestResult`
    - Converts local→UTC with `batch.tz` and sets roles from `direction`.
    - Unit id: `capture:<platform>:<YYYY-MM-DD UTC>`.
  - `IngestService.import_file(person_id, filename, raw, tz, me_names) -> IngestResult` (unit = one upload)
  - `JobRunner` with a single worker thread:
    - `schedule_reanalysis(person_id, debounce_s=900)`;
    - `run_now(person_id)`;
    - `status(job_id)`.
  - `material_change(prev: PersonOverview | None, cur: PersonOverview, last_cards_at: datetime | None) -> bool` (v2 §7a.4 rules)
  - `EventBus.publish(event: dict)` / `subscribe() -> AsyncIterator[dict]`. Event types: `snapshot`, `job`, `next_steps`, `ingest`.

- [ ] **Step 1: Write failing tests:**
  - `test_capture_batch_tz_conversion`;
  - `test_direction_sets_role`;
  - `test_reanalysis_debounced`: two ingests within the window give one job;
  - `test_run_now_bypasses_debounce`;
  - `test_material_change_rules`: band change → True, new scale result → True, 7 days since last cards → True, unchanged → False;
  - `test_events_published_on_snapshot`;
  - `test_large_capture_batch_is_chunked`: 10,000 msgs ingest without one giant transaction.
- [ ] **Step 2: Run** `uv run pytest tests/service -v`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit:** `feat: service, ingest, jobs, events`

## Phase B — API

### Task 10: FastAPI app, auth, REST, SSE, static SPA

v1 plan Task 9 auth, cookie, logging and rate-limit rules and tests, with the Jinja UI **removed**. Plus:

**Files:**
- Create: `src/analyzer/web/{app,auth,deps,cors}.py`, `src/analyzer/web/routes/{people,imports,ingest,ext,reports,jobs,questionnaires,facts,interactions,next_steps,settings,events,agent}.py`

**Interfaces:**
- Consumes: Task 9 services, Task 2b repositories
- Produces: `create_app(settings, services=None) -> FastAPI`. Routes, all JSON and session-or-API-token unless noted:
  - **people:** CRUD.
  - **imports:**
    - `POST /api/people/{id}/imports` (multipart `file`, `tz`, `me_names[]`; 50 MB cap → 413)
    - `GET /api/people/{id}/units` and `DELETE /api/units/{unit_id}`
  - **speaker map:** `GET` / `PUT /api/people/{id}/speakers`
  - **ingest** (extension token): `POST /api/ingest`. Body: `{platform, chat_key, tz, messages:[{platform_msg_id?, ts_local|ts_utc, ts_precision, direction, speaker_raw, text}]}`; 2 MB cap; 10k msgs/min rate limit; unknown `chat_key` → 409 "chat not linked".
  - **ext** (extension token):
    - `GET /api/ext/people` (ids and pseudonyms only)
    - `POST /api/ext/link {person_id, platform, chat_key}`
    - `GET /api/ext/summary?platform=&chat_key=`, returning `{linked, person, total, last7d, my_share_30d, last_captured_ts, last_captured_ids[≤20]}`. Counts only; the ids are for catch-up gap detection, no text.
  - **reports:** `GET /api/people/{id}/overview`, `GET /api/people/{id}/history/{metric}`, `POST /api/people/{id}/analyze` (202, job id)
  - **jobs:** `GET /api/jobs/{id}`
  - **questionnaires:** `GET /api/scales`, `POST /api/people/{id}/questionnaires/{scale_id}`
  - **facts:** CRUD under `/api/people/{id}/facts`
  - **interactions:** CRUD under `/api/people/{id}/interactions`
  - **next steps:** `GET /api/people/{id}/next-steps`, `PATCH /api/next-steps/{id}`
  - **settings:**
    - `GET` / `PUT /api/settings`
    - `POST /api/tokens/extension` (returns the plaintext once)
    - `DELETE /api/tokens/{id}`
    - `DELETE /api/everything` (requires the body `{"confirm": "DELETE EVERYTHING"}`)
  - **events:** `GET /api/events` (SSE, session only)
  - **static:** `/` serves `frontend/dist`, with an SPA fallback for non-`/api` paths.

- [ ] **Step 1: Write failing tests:**
  - the v1 plan Task 9 auth tests;
  - `test_extension_token_scope`: the extension token gets 403 on `/api/people/{id}/overview`;
  - `test_cors_only_extension_origin_on_ingest`;
  - `test_ingest_unlinked_chat_409`;
  - `test_ext_summary_has_no_text`;
  - `test_import_requires_me_names`;
  - `test_delete_everything_requires_confirm_phrase`;
  - `test_sse_requires_session`;
  - `test_spa_fallback_does_not_shadow_api_404`.
- [ ] **Step 2: Run** `uv run pytest tests/web -v`. Expected: FAIL.
- [ ] **Step 3: Implement.** The agent routes are stubbed here and filled in Task 12.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit:** `feat: api, auth, sse`

### Task 11: MCP endpoint

v1 plan Task 10, plus these deltas:
- The tool set is the agent tool registry from Task 12 (one shared definition), minus the write tools (`save_context_fact`, `log_interaction`, `propose_next_step`, `update_next_step`).
- Implement after Task 12. Order: 12 → 11.

## Phase C — Agent

### Task 12: Groq client, tool registry, agent loop, chat API

**Files:**
- Create: `src/analyzer/agent/{groq_client,tools,prompts,loop}.py`; fill `web/routes/agent.py`
- Test: `tests/agent/*` (a fake Groq client returning scripted tool calls)

**Interfaces:**
- Consumes: Task 9 `Analyzer`, Task 2b repositories, `Settings`
- Produces:
  - `ToolSpec(name, description, parameters: dict (JSON Schema), handler: Callable, write: bool, needs_text: bool)`
  - `build_registry(services, settings) -> list[ToolSpec]`. Tools are v2 §5.2 plus §5.5:
    - `get_person_overview`
    - `get_history`
    - `search_messages` (`needs_text=True`)
    - `explain_metric`
    - `list_next_steps`
    - `propose_next_step`
    - `update_next_step`
    - `get_context`
    - `save_context_fact`
    - `log_interaction`
    - `list_interactions`
    - `get_interview_progress`
  - `class GroqClient(api_key, model)` with `.chat(messages, tools, stream: bool)`. It uses the `groq` SDK `client.chat.completions.create(model=..., messages=..., tools=[{"type": "function", "function": {...}}], tool_choice="auto", stream=...)`; confirm the parameter names against Groq's tool-use docs before writing.
  - `run_agent(thread_id, user_text, mode: Literal["chat","interview","checkin"]) -> AsyncIterator[AgentEvent]` (`token`, `tool_call`, `tool_result`, `done`, `error`)
    - At most 8 tool rounds per turn.
    - Tool errors return `{"error": ...}` to the model.
    - Persists all messages.
  - `SYSTEM_PROMPT` (in `prompts.py`) encodes v1 §6.5, v2 §5.4 and v2 §7b rules. When the safety block has flags, the agent mentions them once in neutral words, points to the dashboard warning and resources, and suggests talking to someone trusted or a professional. It never counsels on abuse, plans confrontations or exits, escalates, or claims to be a therapist or crisis service. Its focus is reciprocity, communication and healthy-relationship skills.
  - `INTERVIEW_RULES` encodes v2 §5.5 question rules: one question per turn, skippable, behaviour before interpretation, no leading questions, sensitive topics opt-in, no covert information-gathering.
  - Routes:
    - `POST /api/people/{id}/agent/threads {kind}`
    - `POST /api/agent/threads/{tid}/messages {text}`, which streams SSE `AgentEvent`s
    - `GET /api/agent/threads/{tid}`
- Rules:
  - `needs_text` tools are excluded when `agent_reads_text` is false.
  - Agent routes return 404 when there's no `GROQ_API_KEY` or `agent_enabled` is false.

- [ ] **Step 1: Write failing tests:**
  - `test_tool_round_trip`: the fake model calls `get_person_overview`, the result is fed back, and the final text streams;
  - `test_search_messages_hidden_when_setting_off`;
  - `test_max_tool_rounds`;
  - `test_tool_error_returned_to_model`;
  - `test_messages_persisted`;
  - `test_agent_disabled_without_key_404`;
  - `test_system_prompt_contains_rules`: asserts the key phrases are present, including the §7b warnings-only rule and the disclaimer.
- [ ] **Step 2: Run** `uv run pytest tests/agent -v`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit:** `feat: groq agent loop and chat api`

### Task 13: Next steps, interviews, hangout check-ins, check-in triggers

**Files:**
- Create: `src/analyzer/agent/{next_steps,interview,checkins}.py`
- Test: `tests/agent/test_next_steps.py`, `test_interview.py`, `test_checkins.py`

**Interfaces:**
- Consumes: Task 12 `run_agent` and registry; Task 9 `material_change` and `JobRunner`; `NextSteps`, `Facts`, `Interactions`
- Produces:
  - `generate_next_steps(person_id, on_demand: bool) -> list[NextStep]`
    - Called by `JobRunner` after re-analysis when `material_change(...)` is true. At most one auto-run per person per day; on-demand runs are unlimited.
    - Runs the agent in a background mode that may only call read tools plus `propose_next_step`.
    - Drops cards for which `NextSteps.recent_similar(...)` is true.
    - Publishes a `next_steps` event.
  - `INTERVIEW_TOPICS: dict[mode, list[TopicId]]` (v2 §5.5 lists, **excluding** the safety questions removed by v2 §7b).
  - Next-step card kinds are only `talk`, `plan`, `reflect` and `pause` (no `safety` kind, v2 §7b). A proposed card of any other kind is rejected.
    - `interview_progress(person_id) -> {covered, open}`, judged from fact keys prefixed with a topic id, e.g. `met.how`.
    - `POST /api/people/{id}/interview` creates an `interview` thread whose first agent turn asks the first open topic.
  - `start_hangout_checkin(person_id) -> thread_id`: a `checkin` thread. The agent asks the §5.5 follow-up questions, then calls `log_interaction` with structured fields.
  - `checkin_triggers(person_id, now) -> list[NextStepDraft]`: no interaction logged for 10 days while messages continue, or a `message_share` band change. Produces `reflect` cards.

- [ ] **Step 1: Write failing tests** (fake Groq):
  - `test_auto_next_steps_only_on_material_change`;
  - `test_daily_cap`;
  - `test_duplicate_cards_dropped`;
  - `test_background_mode_cannot_write_facts`;
  - `test_interview_resumes_at_first_open_topic`;
  - `test_hangout_checkin_logs_interaction_fields`;
  - `test_checkin_trigger_after_10_days`;
  - `test_no_safety_kind_cards`;
  - `test_interview_has_no_safety_topics`.
- [ ] **Step 2: Run** `uv run pytest tests/agent -v`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit:** `feat: next steps, interviews, check-ins`

## Phase D — Frontend (`frontend/`)

### Task 14: SPA scaffold, auth, API client, People, Settings

**Files:**
- Create: `frontend/` (Vite React TS), `frontend/src/{api/client.ts, api/types.ts, routes/*, components/*}`
- Test: `frontend/src/**/*.test.tsx` (Vitest + Testing Library, with fetch mocked)

**Interfaces:**
- Consumes: the Task 10 REST shapes
- Produces:
  - `api` client functions typed against the Task 10 routes;
  - router routes `/login`, `/people`, `/people/:id`, `/people/:id/chat/:tid?`, `/people/:id/context`, `/people/:id/questionnaires`, `/people/:id/sources`, `/settings`;
  - `useEvents()` hook (EventSource on `/api/events`).
- Settings page:
  - owner timezone, prefilled from `Intl.DateTimeFormat().resolvedOptions().timeZone`;
  - agent on/off; "Agent may read message text"; catch-up on/off;
  - create or revoke the extension token, shown once with a copy button;
  - a link to the Groq Data Controls with a ZDR reminder;
  - the v2 §7b disclaimer (also in a global footer);
  - Delete everything, behind a typed confirmation.

- [ ] **Step 1: Write failing tests:**
  - `login flow posts password+totp`;
  - `people list renders sources and safety status`;
  - `extension token shown once`;
  - `delete everything requires phrase`.
- [ ] **Step 2: Run** `cd frontend && npm test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run build`. Expected: PASS, and `dist/` built.
- [ ] **Step 5: Commit:** `feat(frontend): scaffold, auth, people, settings`

### Task 15: Person dashboard

**Files:**
- Create: `frontend/src/routes/PersonDashboard.tsx`, `components/{SafetyBlock,SignalTable,WeeklyChart,ScaleResults,NextStepCards,InteractionSignals}.tsx`

**Interfaces:**
- Consumes: `GET /overview`, `/history`, `/next-steps`; `useEvents()`
- Rules:
  - `SafetyBlock` renders first and is never collapsed when `concern` or `urgent`.
    - Resources are shown as plain text (name, number, text code, website). No `tel:`/`sms:` links and no action buttons.
    - The disclaimer sits under the block.
  - A "Reciprocity at a glance" panel comes next. It shows initiation share, message share, question rate, disclosure balance, LSM, meetup initiation share and plan follow-through, with evidence tags, no single score and no probability (v2 §7b.6). In potential mode it is the lead panel.
  - `WeeklyChart` shows messages per week by me and them, with uncovered weeks shaded.
  - `SignalTable` shows value, evidence tag, band or "no reference band", and the "can't tell you" note.
  - `NextStepCards` shows each card with links to its evidence refs (`metric:`, `scale:`, `fact:`, `interaction:`) and Done / Dismiss / Discuss buttons. Discuss opens a chat seeded with the card.
  - The dashboard refetches on `snapshot` and `next_steps` events.

- [ ] **Steps 1–5:** Write the tests first:
  - `safety block first`;
  - `resources have no tel or sms links`;
  - `reciprocity panel second`;
  - `uncovered weeks shaded`;
  - `no reference band text`;
  - `card evidence links`;
  - `refetch on event`.

  Then implement, run `npm test`, and commit: `feat(frontend): dashboard`.

### Task 16: Agent chat, interview, hangout, Context, Questionnaires, Sources

**Files:**
- Create: `frontend/src/routes/{AgentChat,Context,Questionnaires,Sources}.tsx`, `components/{InterviewProgress,HangoutButton,ImportDialog,SpeakerMapper,UnitList}.tsx`

**Interfaces:**
- Consumes: the Task 10, 12 and 13 routes
- Rules:
  - Chat streams tokens from SSE `AgentEvent`s and shows tool calls as collapsible chips.
  - Interview mode shows `InterviewProgress`; `HangoutButton` starts a check-in thread.
  - Context lists facts and interactions with edit, delete and an "unsure" toggle.
  - Questionnaires renders a scale from `GET /api/scales` (draft and unverified badges) and posts the answers.
  - `ImportDialog` takes a file plus timezone (defaults to owner timezone) plus a "which name is you?" choice from detected speaker names. It shows a warning for one-sided Discord imports.
  - `UnitList` shows each unit with its source, count, date range and delete.

- [ ] **Steps 1–5:** Write the tests first:
  - `streams tokens`;
  - `tool chip collapsible`;
  - `interview progress`;
  - `import requires me name`;
  - `one-sided discord warning`;
  - `fact edit + unsure toggle`.

  Then implement, run `npm test && npm run build`, and commit: `feat(frontend): chat, context, questionnaires, sources`.

## Phase E — Extension (`extension/`)

### Task 17: Extension core — manifest, options, queue, background, popup

**Files:**
- Create: `extension/{manifest.json, src/background.ts, src/options.ts, src/popup/*, src/content/main.ts, src/adapters/types.ts, src/queue.ts, src/api.ts, src/ratelimit.ts}`
- Test: `extension/src/**/*.test.ts` (Vitest + jsdom, with `chrome.*` mocked)

**Interfaces:**
- Produces:
  - `interface SiteAdapter { platform; matches(url): boolean; currentChat(): {chat_key, title} | null; findMessageList(): Element | null; extract(node: Element): CapturedMessage | null; scrollStep(): Promise<boolean>; healthCheck(): {ok: true} | {ok: false, reason: string} }`
  - `CapturedMessage { platform_msg_id?, ts_local?: string, ts_utc?: string, ts_precision, direction: "outgoing"|"incoming", speaker_raw, text }`
  - `Queue` (in `chrome.storage.local`, capped at 5,000; pauses capture and flags the popup when full); `flush()` batches ≤ 200 every 30 s or more
  - `api.ts`: `ingest`, `extPeople`, `extLink`, `extSummary`, with the bearer extension token from options
  - `RateLimiter(minMs=2000, maxMs=4000)` with `.wait()` (jittered); `RunGuard(maxSteps, cooldownMs)`
- Manifest:
  - MV3; host permissions only for `https://web.whatsapp.com/*`, `https://discord.com/*`, `https://www.instagram.com/*`, and `APP_ORIGIN`;
  - permissions `storage`, `alarms`;
  - no `scripting` injection of UI.
- Popup (v2 §3.4):
  - link / unlink (person picker from `extPeople`);
  - summary numbers;
  - Backfill with a "back to" date picker;
  - Pause;
  - health status;
  - per-platform enable toggles (Discord note text);
  - catch-up toggle.

- [ ] **Step 1: Write failing tests:**
  - `queue caps and pauses`;
  - `flush batches of 200`;
  - `flush clears only acked`;
  - `ratelimiter jitter within bounds`;
  - `runguard stops at max steps`;
  - `popup shows summary without text`;
  - `unlinked chat never extracted`.
- [ ] **Step 2: Run** `cd extension && npm test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run build`. Expected: PASS, with `dist/` loadable as an unpacked extension.
- [ ] **Step 5: Commit:** `feat(extension): core, queue, popup`

### Task 18: Site adapters, live capture, backfill, catch-up

**Files:**
- Create: `extension/src/adapters/{whatsapp,discord,instagram}.ts`, `extension/src/adapters/{whatsapp,discord,instagram}.selectors.json`, `extension/src/capture/{live,backfill,catchup}.ts`, `extension/test/fixtures/{whatsapp,discord,instagram}/*.html` (synthetic DOM snapshots shaped like each site), `extension/SELECTORS.md` (a manual verification checklist)

**Interfaces:**
- Consumes: Task 17 `SiteAdapter`, `Queue`, `RateLimiter`, `RunGuard`, `api.extSummary`
- Produces:
  - `startLiveCapture(adapter, queue)`: a `MutationObserver` that extracts new nodes in linked chats only. A failed `healthCheck` disables capture for that platform and flags the popup.
  - `runBackfill(adapter, untilDate, limiter, guard)`: up to 300 steps, 10-minute cool-down. Stops on: `untilDate` reached; chat start (`scrollStep` returns false); login, captcha or challenge selector present; `healthCheck` failure; error banner; tab hidden for more than 60 s. It returns the stop reason.
  - `runCatchup(adapter, lastCapturedIds, limiter)`: at most 50 steps, stopping when any `lastCapturedIds` element is visible.
- Adapter specifics (v2 §3.3):
  - WhatsApp: per-message metadata (minute precision), with `direction` from the outgoing-message marker.
  - Discord: `<time datetime>` (second precision); message id from the element id; `direction` by comparing the author with the logged-in user's name from the page.
  - Instagram: group timestamps (`approx`), with `direction` from the outgoing alignment marker.
  - Selectors live only in the JSON files.

- [ ] **Step 1: Write failing tests** against the fixtures:
  - `extract text/direction/ts per platform`;
  - `system and media lines skipped`;
  - `healthCheck fails on changed fixture → capture disabled, nothing queued`;
  - `backfill stops at untilDate`;
  - `backfill stops on captcha element`;
  - `backfill respects max steps`;
  - `catchup stops at known id`;
  - `no DOM mutation by extension`: snapshot the fixture before and after capture and assert it's identical apart from scroll position.
- [ ] **Step 2: Run** `cd extension && npm test`. Expected: FAIL.
- [ ] **Step 3: Implement.** Write `SELECTORS.md`, the steps the owner follows in a logged-in browser to confirm each selector, with a "last verified" date per platform.
- [ ] **Step 4: Run** `npm test && npm run build`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(extension): adapters, live capture, backfill, catch-up`

## Phase F — Deploy

### Task 19: Docker, Railway, smoke test

v1 plan Task 12, plus these deltas:
- The Dockerfile gets a `frontend` stage (`node:22-slim`, `npm ci && npm run build`) whose `dist` is copied to `/app/frontend/dist`.
- Remove the Anthropic and MCP-connector smoke steps.
- `smoke.py` adds:
  - create an extension token;
  - `POST /api/ext/link`, then `POST /api/ingest` with a synthetic batch;
  - `GET /api/ext/summary` (counts, no text);
  - `--agent`: if `GROQ_API_KEY` is set on the server, create a thread and send "List what you know about this person"; it passes if a `tool_call` event for `get_person_overview` arrives, followed by `done`.
- `README-deploy.md` adds how to load `extension/dist` unpacked, set `EXTENSION_ID`, paste the token, and run `SELECTORS.md` verification. It also records the chosen `GROQ_MODEL`.

---

## Execution order and parallelism

Order: 1 → 2a → 2b → 3 → 4 → 5 → 6 → 7 → 8 → 8b → 9 → 10 → 12 → 11 → 13 → 14 → 15 → 16 → 17 → 18 → 19.

Once Task 10's route shapes are committed, the frontend (14–16) and the extension (17–18) touch only their own folders. They may run in parallel with Tasks 12–13, in separate worktrees.

## Self-review notes

- v2 coverage:
  - §3 → Tasks 17–18
  - §4 → Tasks 14–16
  - §5.1–5.4 → Tasks 12–13
  - §5.5 → Tasks 2b, 8, 13, 16
  - §6 and §7a → Tasks 1, 2a, 2b, 5, 9
  - §7 → Tasks 10 and 17
- The v1 sections still covered via the reused v1 tasks.
- Phase 2 predictor: separate plan.
- Names shared across tasks:
  - `Message` / `StoredMessage`
  - `Metric`
  - `PersonOverview`
  - `CaptureBatch`
  - `ToolSpec`
  - `AgentEvent`
  - `SiteAdapter` / `CapturedMessage`
