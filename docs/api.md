# LoveVectorSpace API contract (v3)

This is the binding contract between the backend (FastAPI), the frontend (React/Capacitor) and the extension. JSON everywhere, all timestamps are ISO-8601 UTC (`Z`), and the base path is `/api`.

**Errors** use `{"error": {"code": "<snake_case>", "message": "<human text>", "field": "<optional field name>"}}` with the matching HTTP status. Codes used:
- 400 `invalid_input`;
- 401 `unauthenticated`;
- 403 `forbidden` / `invite_required` / `reauth_required` / `demo_locked` (only with `SEED_DEMO`: the shared sample accounts cannot change password, delete the account or revoke other sessions/tokens);
- 404 `not_found`;
- 409 `conflict` / `chat_not_linked`;
- 413 `too_large`;
- 422 `validation_error`;
- 429 `rate_limited`, with a `Retry-After` header;
- 503 `agent_unavailable`, and 503 `unavailable` with `Retry-After: 1` (the user's service is restarting, e.g. after a cache eviction; retry once).

## Auth model

There are four ways to authenticate:

| Client | How | Notes |
|---|---|---|
| Web | `Authorization: Bearer <access_jwt>` (kept in memory) | The refresh token is the HttpOnly cookie `lvs_rt`, and the CSRF cookie is `lvs_csrf` (readable). Cookie-authenticated POST/PUT/PATCH/DELETE calls must send `X-CSRF-Token: <lvs_csrf value>`. |
| Native (Capacitor) | `Authorization: Bearer <access_jwt>` | Refresh tokens are returned in the JSON body (send `X-Client: native`). |
| Extension | `Authorization: Bearer <extension_token>` | Scoped to `/api/ingest` and `/api/ext/*` only. |
| Scripts | `Authorization: Bearer <api_token>` | Same data access as the user, but never credential or account management (see below). |

- Access JWTs last 15 minutes. A 401 `unauthenticated` response means the client should call `/api/auth/refresh` once, then retry.
- Unauthenticated routes are `GET /healthz`, `/api/auth/*` (except `me`, `logout` and `sessions`), and the SPA's static files.

### Auth routes

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/auth/providers` | — | `{google: bool, apple: bool, registration: "open" \| "invite"}`. `google` is true when the web flow is configured (client id and secret); `apple` when Apple audiences are set. Clients show only the offered buttons and hide the invite field when `registration` is `open`. |
| POST | `/api/auth/signup` | `{email, password, invite_code?, display_name?}` | 201 `AuthResult`. Sends a verification email. The account works before it is verified, but a banner prompts the user. |
| POST | `/api/auth/login` | `{email, password}` | 200 `AuthResult` or 401 |
| POST | `/api/auth/refresh` | web: none (cookie); native: `{refresh_token}` | 200 `AuthResult` (rotated) or 401 |
| POST | `/api/auth/logout` | native: `{refresh_token}` | 204; revokes the token family and clears cookies |
| GET | `/api/auth/me` | — | `User` |
| POST | `/api/auth/verify-email` | `{token}` | 204 |
| POST | `/api/auth/verify-email/resend` | — | 204 |
| POST | `/api/auth/password/forgot` | `{email}` | 204, always, so email existence isn't leaked |
| POST | `/api/auth/password/reset` | `{token, new_password}` | 204; revokes all sessions |
| POST | `/api/auth/password/change` | `{current_password, new_password}` | 204 |
| GET | `/api/auth/google/start?redirect=/people&invite=<code>` | — | 302 to Google (PKCE, state). `invite` is optional and is used if the Google account is new. `redirect` must be a same-site path. If Google is not configured: 302 to `{APP_ORIGIN}/auth/complete#error=not_configured`. |
| GET | `/api/auth/google/callback` | — | 302 to the SPA `/auth/complete#ok` with the refresh cookie set, or `#error=<code>` |
| POST | `/api/auth/nonce` | — | `{nonce, expires_in: 600}`. Issues a single-use nonce for an ID-token sign-in. Rate-limited per IP (429). |
| POST | `/api/auth/google/token` | `{id_token, invite_code?}` (native) | `AuthResult`. The token's `nonce` claim must be a nonce from `/api/auth/nonce`, passed to Google as-is. |
| POST | `/api/auth/apple/token` | `{id_token, invite_code?, name?}` (web JS and native) | `AuthResult`. The token's `nonce` claim must be the sha256 hex of a nonce from `/api/auth/nonce` (pass `sha256(nonce)` to Apple). |
| GET | `/api/auth/sessions` | — | `[{id, device, created_at, last_used_at, current}]` |
| DELETE | `/api/auth/sessions/{id}` | — | 204 |

- **Interactive session only.** These routes need a session access JWT; api and extension tokens get 403 `forbidden`: `POST/DELETE /api/tokens`, `GET/DELETE /api/auth/sessions*`, `POST /api/auth/password/change`, `POST /api/account/export`, `DELETE /api/account`, and `/api/invites*`.
- `POST /api/auth/password/change` on an account without a password (social-only) returns 403 `reauth_required` unless the session's sign-in happened in the last 10 minutes. The client should sign in again, then retry.
- **Registration** (`REGISTRATION`, default `open`): in `open` mode anyone can sign up with email and password, or with Google/Apple when configured; no invite is needed (a valid one sent anyway is consumed). In `invite` mode password sign-ups need an invite, and `ADMIN_EMAIL` can skip it only through a Google or Apple sign-in with a provider-verified email. In both modes `ADMIN_EMAIL` becomes admin once its email is verified, and sign-ups are rate limited per IP.
- **ID-token nonces.** The issued nonce is valid for 10 minutes and works only once, as the raw value (Google) or its sha256 hex (Apple). A missing, unknown, expired or reused nonce returns 401. A `nonce` sent in the request body is ignored. The server can drop the "nonce must be present" requirement with `NATIVE_NONCE_REQUIRED=0`, but a nonce that is present is always checked.
- A password reset, or a Google/Apple sign-in that claims an unverified account with the same email, revokes all refresh sessions **and** api/extension tokens. If the account was never verified, its data is **set aside, not deleted**: the database moves to quarantine and the owner starts with a fresh, empty one. An admin can restore it for 30 days with `scripts/restore_quarantine.py <user_id>`; after that it is purged. If the data can't be moved, the request returns 503 `unavailable` and nothing changes.
- In `invite` mode, a social sign-in for a new user without a valid invite returns 403 `invite_required` (with `field: "invite_code"`).

```
AuthResult = { "access_token": str, "expires_in": 900, "refresh_token"?: str /* native only */, "user": User }
User = { "id": str, "email": str, "email_verified": bool, "display_name": str|null, "role": "admin"|"user",
         "providers": ["password"|"google"|"apple"], "created_at": str }
```

## Account, settings, tokens, invites

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET/PUT | `/api/settings` | `Settings` (partial on PUT) | `Settings` |
| GET | `/api/tokens` | — | `[TokenInfo]` |
| POST | `/api/tokens` | `{kind: "api"|"extension", label?}` | 201 `{token: "<plaintext shown once>", info: TokenInfo}` |
| DELETE | `/api/tokens/{id}` | — | 204 |
| GET | `/api/invites` (admin) | — | `[Invite]` |
| POST | `/api/invites` (admin) | `{email?, expires_days?: 14}` | 201 `Invite` |
| DELETE | `/api/invites/{code}` (admin) | — | 204 |
| POST | `/api/account/export` | `{include_messages: bool}` | 200 `application/json` download |
| DELETE | `/api/account` | `{confirm: "DELETE MY ACCOUNT", password?}` | 204. A password is required if the account has one; social-only accounts confirm with the phrase. |

```
Settings = { "theme": "signal"|"pulse"|"riso"|"blueprint"|"journal"|"matcha"|"midnight"|"inkwell"|"crt"|"auto",
             "auto_theme": {"mode": "system"|"time", "day": theme, "night": theme, "day_start": "07:00", "day_end": "19:00"},
             "reduce_motion": bool, "contrast_boost": bool, "text_size": "s"|"m"|"l",
             "owner_timezone": str|null, "agent_enabled": bool, "agent_reads_text": bool, "catchup_enabled": bool }
TokenInfo = { "id": str, "kind": "api"|"extension", "label": str|null, "created_at": str, "last_used_at": str|null, "revoked_at": str|null }
Invite = { "code": str, "email": str|null, "created_at": str, "expires_at": str, "used_by": str|null }
```

## People, sources, imports

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/api/people` | — | `[PersonSummary]` |
| POST | `/api/people` | `{pseudonym, mode: "potential"|"established", timezone?}` | 201 `Person` |
| POST | `/api/people/sample` | — | 201 `Person`. Optional: adds one synthetic, clearly labelled person ("Sample: Yu Cheng", invented chat, facts, hangouts and check-ins) and queues its analysis, so a new user can explore before importing their own data. Delete it like any person. |
| GET | `/api/people/{pid}` | — | `Person` |
| PATCH | `/api/people/{pid}` | `{pseudonym?, mode?, timezone?}` | `Person` |
| DELETE | `/api/people/{pid}` | — | 204 (cascade) |
| POST | `/api/people/{pid}/imports` | multipart: `file`, `tz`, `me_names` (repeatable), `match_id?`, `source?` (auto-detected) | 201 `ImportResult`. Over 50 MB returns 413. Missing `me_names` returns 422 with `field: "me_names"` (not required for the dating formats). For Tinder, Hinge, Grindr and Bumble exports `match_id` is required (400 `invalid_input`, `field: "match_id"` if missing or unknown) and one match becomes one unit (`import:<format>:<match_id>`). An unrecognised or malformed file returns 400 `invalid_input` (`field: "file"`) with the parser's message. |
| POST | `/api/people/{pid}/imports/preview` | multipart: `file` | Chat formats: `{format, speakers: [str], lines: int, one_sided: bool}`. Dating formats (`format` is `tinder`, `hinge`, `grindr` or `bumble`): `{format, matches: [MatchInfo], one_sided: bool}` (no `speakers`/`lines`). |
| POST | `/api/people/{pid}/imports/messages` | JSON `{source, tz, messages: [{ts_local?\|ts_utc?, ts_precision: "second"\|"minute"\|"approx", role: "me"\|"them", text}]}` | 201 `ImportResult`. `source` is `screenshot_import`, `android_sms`, `android_notify_<app>` or `android_a11y_<app>` (400 `invalid_input`, `field: "source"` otherwise). `android_notify_*` messages are forced to `them` and the import is `one_sided` unless the person has other sources. |
| GET | `/api/people/{pid}/units` | — | `[Unit]` |
| DELETE | `/api/units/{unit_id}` | — | `{removed_messages: int}` |
| GET/PUT | `/api/people/{pid}/speakers` | PUT `[{source, speaker_raw, role}]` | `[SpeakerMapping]` |
| GET | `/api/people/{pid}/coverage` | — | `[{source, start, end}]` |

```
PersonSummary = { "id": int, "pseudonym": str, "mode": str, "sources": [{"source": str, "last_sync": str|null, "health": "ok"|"stale"|"needs_update"}],
                  "success": {"percent": float|null, "low": float|null, "high": float|null, "status": "ok"|"insufficient_data"},
                  "safety": "none"|"info"|"concern"|"urgent", "updated_at": str|null }
Person = { "id": int, "pseudonym": str, "mode": str, "timezone": str|null, "created_at": str }
MatchInfo = { "match_id": str, "label": str, "first_ts": str|null, "last_ts": str|null, "message_count": int, "one_sided": bool }
ImportResult = { "unit_id": str, "added": int, "merged": int, "skipped_non_english": int, "one_sided": bool, "job_id": int }
Unit = { "unit_id": str, "source": str, "created_at": str, "message_count": int, "start_ts": str|null, "end_ts": str|null }
```

## Analysis and reports

| Method | Path | Response |
|---|---|---|
| GET | `/api/people/{pid}/overview` | `PersonOverview` (latest snapshot; 404 if none yet) |
| POST | `/api/people/{pid}/analyze` | 202 `{job_id}` |
| GET | `/api/jobs/{job_id}` | `Job` |
| GET | `/api/people/{pid}/history/{metric_id}` | `[{ts, value}]` |
| GET | `/api/metrics/{metric_id}/explain` | `MetricInfo` |

```
Metric = { "id": str, "label": str, "plain_label": str, "value": float|null, "per_speaker": {"me": float, "them": float}|null,
           "evidence": "moderate"|"heuristic"|"descriptive"|"self-report heuristic", "status": "ok"|"insufficient_data", "note": str,
           "band": str /* "no reference band" when un-normed */ }
SuccessEstimate = { "mode": str, "status": "ok"|"insufficient_data", "percent": float|null, "low": float|null, "high": float|null,
                    "tag": "uncalibrated estimate: hand-set weights, not fitted to outcomes",
                    "top_contributors": [[metric_id, signed_pp]], "definition": str,
                    "calibrated": {"status": "not_available"|"ok", "percent": float|null, "low": float|null, "high": float|null,
                                   "n_outcomes": int, "needed": 20} }
SafetyFlag = { "category": str, "severity": "info"|"concern"|"urgent", "speaker": "me"|"them"|"owner_report", "count": int,
               "first_seen": str, "last_seen": str /* ISO UTC datetimes, e.g. 2025-03-09T00:00:00Z */, "snippets": [str] }
SafetyBlock = { "flags": [SafetyFlag], "resources": [{"name","phone","text","url","description","action": "suggestion_only"}],
                "disclaimer": str }
PersonOverview = { "person": Person, "mode": str, "generated_at": str, "success": SuccessEstimate, "safety": SafetyBlock,
                   "reciprocity": [Metric] /* initiation_share, message_share, question_rate, disclosure_rate, lsm, meetup_initiation_share, plan_follow_through_rate */,
                   "metrics": [Metric], "interaction_metrics": [Metric],
                   "scales": [{"scale_id","name","status","subscales":{},"bands":{},"cutoff_flags":{},"notes":[]}],
                   "weekly": [{"week": "YYYY-MM-DD", "me": int|null, "them": int|null, "covered": bool}],
                   "coverage_ratio": float, "skipped_non_english": int,
                   "scoring": {"scored": int, "total": int, "complete": bool} | null /* model scoring of the recent window; large imports are scored up to 1,000 messages per run with follow-up runs until complete; null when no model is installed */,
                   "next_steps": [NextStep] }
Job = { "id": int, "kind": str, "status": "queued"|"running"|"done"|"error", "error": str|null, "created_at": str, "finished_at": str|null }
MetricInfo = { "id": str, "measures": str, "evidence": str, "caveats": str, "citation": str }
```

## Questionnaires

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/scales` | — | `[ScaleDef]` (the item text may be null for overlay scales; the UI shows `display_text`) |
| POST | `/api/people/{pid}/questionnaires/{scale_id}` | `{answers: {item_id: int}}` | `ScaleResult` |
| GET | `/api/people/{pid}/questionnaires` | — | `[{scale_id, submitted_at, result: ScaleResult}]` |

## Context: facts and interactions

| Method | Path | Body | Response |
|---|---|---|---|
| GET/POST | `/api/people/{pid}/facts` | POST `{key, value, confidence: "owner_sure"|"owner_unsure"}` | `[Fact]` / 201 `Fact` |
| PATCH/DELETE | `/api/facts/{id}` | `{value?, confidence?}` | `Fact` / 204 |
| GET/POST | `/api/people/{pid}/interactions` | POST `{fields: InteractionFields, notes}` | `[Interaction]` / 201 |
| PATCH/DELETE | `/api/interactions/{id}` | partial | `Interaction` / 204 |

`InteractionFields` is `{ts, place?, duration_min?, initiated_by: "me"|"them"|"mutual", activity?, closeness_1_7, comfort_1_7, responsiveness: [str], tension?, affection?, next_plan_proposed_by: "me"|"them"|"none", followed_through_prev: bool|null}`.

## Next steps

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/people/{pid}/next-steps?status=open` | — | `[NextStep]` |
| POST | `/api/people/{pid}/next-steps/generate` | — | 202 `{job_id}` (on-demand, unlimited) |
| PATCH | `/api/next-steps/{id}` | `{status: "open"|"done"|"dismissed"}` | `NextStep` |

`NextStep` is `{id, kind: "talk"|"plan"|"reflect"|"pause", title, why, evidence_refs: ["metric:lsm","scale:csi16","fact:12","interaction:7"], status, created_at}`.

## Agent (Groq)

If no key is set or the agent is disabled, these routes return 503 `agent_unavailable`.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/people/{pid}/agent/threads` | — | `[{id, kind: "chat"|"interview"|"checkin", title, created_at, updated_at}]` |
| POST | `/api/people/{pid}/agent/threads` | `{kind}` | 201 thread. `interview` and `checkin` threads begin with the agent's first question already in them. |
| GET | `/api/agent/threads/{tid}` | — | `{thread, messages: [{id, role: "user"|"assistant"|"tool", content, tool_calls?, created_at}]}` |
| POST | `/api/agent/threads/{tid}/messages` | `{text}` | `text/event-stream` of `AgentEvent` |
| GET | `/api/people/{pid}/interview/progress` | — | `{covered: [topic_id], open: [topic_id], topics: [{id, label}]}` |

`AgentEvent` (SSE `data:` lines, JSON) is one of:
- `{"type":"token","text":str}`
- `{"type":"tool_call","name":str,"args":{}}`
- `{"type":"tool_result","name":str,"ok":bool,"summary":str}`
- `{"type":"done","message_id":int|null}` (null when the turn produced no text, e.g. an empty final round: nothing is stored)
- `{"type":"error","code":str,"message":str}`

## Live events

`GET /api/events` is SSE and needs an access JWT, either as `Authorization` or as `?access_token=` because EventSource can't set headers. It emits `{"type":"snapshot"|"job"|"next_steps"|"ingest","person_id":int,...}` for the current user only.

## Extension routes (extension token)

CORS allows only `chrome-extension://$EXTENSION_ID`.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/ext/people` | — | `[{id, pseudonym}]` |
| POST | `/api/ext/link` | `{person_id, platform: "whatsapp"|"discord"|"instagram"|"tinder"|"grindr"|"bumble", chat_key}` | 204 |
| DELETE | `/api/ext/link` | `{platform, chat_key}` | 204 |
| GET | `/api/ext/summary?platform=&chat_key=` | — | `{linked, person: {id, pseudonym}|null, total, today, last7d, my_share_30d, last_captured_ts, last_captured_ids: [≤20]}` (counts only, never message text) |
| POST | `/api/ingest` | `CaptureBatch` (≤2 MB, ≤10k msgs/min) | `{added, merged, skipped}`. Returns 409 `chat_not_linked` if the chat isn't linked. |

`CaptureBatch` is `{platform: "whatsapp"|"discord"|"instagram"|"tinder"|"grindr"|"bumble", chat_key, tz, unit_id?, direction_uncertain?, messages: [{platform_msg_id?, ts_local?|ts_utc?, ts_precision: "second"|"minute"|"approx", direction: "outgoing"|"incoming", speaker_raw, text}]}`.

`unit_id` is optional. The popup's "Import this page" sets it to `capture:<platform>:<chat_key>:<YYYY-MM-DD>` on every batch of one import, so the server groups them as one import unit. Live-capture batches omit it.

`direction_uncertain` is optional. The extension sets it to `true` when at least 10 message rows were loaded and all pointed the same way. That is normal for a one-sided chat, but could also mean a changed direction marker. Capture continues; the server keeps the data and may mark the unit one-sided or direction-uncertain.

## MCP

`/mcp` uses Streamable HTTP with `Authorization: Bearer <api_token>`, scoped to that token's user. Its tools are the read tools of the agent registry, as defined in plan Task 11.

## Health

`GET /healthz` returns `{ok: true, version, seeding}` and requires no authentication. It answers as soon as the port is open; `seeding` is true while the optional demo seeding (`SEED_DEMO`) is still running in the background.

## Service lifetime (API layer contract)

Build the factory with `ServiceFactoryImpl.from_settings(settings)`. To evict a cached connection or delete an
account: `service.close()` (cancels the user's debounce timers, makes queued tasks no-ops, waits a bounded time
for running tasks; call it without holding the lock), then `with service.lock: conn.close()` using the SAME
per-user lock. `factory.close_user(user_id)` closes every service of a user and forgets its state;
`factory.shutdown()` does so for all users at process exit. Jobs left queued/running are marked `error`
("cancelled") the next time the user is opened. A `conn_opener` must raise (e.g. `open_db(path, key,
create=False)`) when the user's database no longer exists.
