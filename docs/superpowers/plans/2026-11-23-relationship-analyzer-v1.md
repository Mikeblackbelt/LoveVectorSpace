# Relationship Analyzer v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-user, Railway-hosted relationship analyzer. It covers validated questionnaires, explainable chat signals and a safety check, behind a web UI, a token-protected REST API and an MCP endpoint, with an optional Claude narrative.

**Architecture:** One Python package (`analyzer`) holds the engine: parsers, encrypted store, scales, signals, safety, narrate. A FastAPI app in the same process serves `/ui`, `/api` and `/mcp`. Models are ONNX int8, baked into the Docker image and loaded once. Data lives in a SQLCipher database on a Railway volume.

**Tech Stack:** Python 3.11, uv, FastAPI, Jinja2, pydantic v2, PyYAML, `sqlcipher3-binary`, `onnxruntime`, `tokenizers`, `argon2-cffi`, `pyotp`, `itsdangerous`, `mcp` (official Python SDK v2), `anthropic`, pytest. Dev-only: `optimum[onnxruntime]` for model export.

**Spec:** `docs/superpowers/specs/2026-11-23-relationship-analyzer-design.md` (read §6, §7, §10, §10a before starting). Phase 2 (§6.6, approach B) is **out of scope** here and gets its own plan once v1 runs.

## Global Constraints

- English only. Non-English messages are detected, skipped and reported (spec §3).
- Single user; no sign-up and no OAuth. `/api` and `/mcp` use a static bearer token compared with `hmac.compare_digest` (§7.2).
- No unauthenticated route except `GET /healthz` (§7.2).
- MCP over HTTP: reject a browser `Origin` that isn't the app's own domain; allow requests without an `Origin` if the token is valid (§7.3).
- Fail closed: if `DB_KEY` is missing or wrong, the app refuses to start. It never creates an unencrypted database (§7.4).
- Logs never contain message text (§7.5).
- People are stored under owner-chosen pseudonyms (§7.6).
- Real chats never enter the repo or the Docker build context; `.gitignore` already covers `data/`, `uploads/`, `*.db`, `.env` (§7.8).
- No probability-of-outcome output anywhere; every number carries an evidence tag; un-normed metrics show "no reference band" (§2, §8, §10a.2).
- The safety block is never softened: the LLM must relay category and severity unchanged (§6.3, §10a.1).
- Chat text and snippets may go to the LLM (owner override, §10a.1). `include_excerpts` defaults to false.
- Claude API: model `claude-opus-5-5`, `client.beta.messages.create` with `betas=["server-side-fallback-2026-07-01"]`, `fallbacks="default"`, `output_config={"effort": "medium"}`; check `stop_reason == "refusal"` before reading content. Narrative is off by default (§6.5).
- Secrets come from Railway variables: `DB_KEY`, `API_TOKEN`, `OWNER_PASSWORD_HASH` (argon2), `TOTP_SECRET`, `SESSION_SECRET`, `ANTHROPIC_API_KEY` (optional), `APP_ORIGIN`.
- No server names, usernames or addresses in the repo.

## Review Focus

1. **WhatsApp export variants.** US `m/d/yy, h:mm AM` vs `dd/mm/yyyy, HH:mm`, bracketed iOS format, multi-line messages, system lines ("Messages and calls are end-to-end encrypted", `<Media omitted>`), and invisible U+200E marks must all parse. Test in Task 1.
2. **Legitimate duplicate messages in the same minute.** WhatsApp has minute resolution, so "ok" sent twice in one minute must survive de-duplication. The hash includes the occurrence index. Test in Task 2.
3. **Too little data.** An empty chat, a one-speaker chat, or fewer than 20 messages must return `insufficient_data` per metric, not crash or divide by zero. Test in Task 5.
4. **Wrong or missing DB key.** Startup fails with a clear error and no new database file is created. Test in Task 2.
5. **Large uploads.** About 100k messages must finish analysis in under 2 minutes on 2 vCPU with models batched. The upload limit is 50 MB, with a 413 above it. Test in Tasks 6 and 9.

---

## File Structure

```
pyproject.toml                      deps, pytest config, ruff
src/analyzer/
  config.py                         Settings (pydantic-settings) from env
  parsers/{__init__,model,whatsapp,plaintext,language}.py
  store/{db,schema,repo}.py         SQLCipher connection, DDL, data access
  scales/{schema,scorer,loader}.py  YAML schema + generic scorer
  scales/defs/*.yaml                one file per scale
  signals/{evidence,sessions,counts,latency,lsm,questions,disclosure,trends,report}.py
  signals/wordlists/{function_words.yaml,disclosure.yaml}
  ml/{onnx_text,emotion,toxicity}.py
  safety/{rules,check}.py, safety/config.yaml, safety/resources/us.yaml
  service.py                        orchestration: analyze_person, history
  narrate/claude.py
  web/{app,auth,deps,routes_api,routes_ui,mcp_server}.py
  web/templates/*.html
scripts/fetch_models.py             downloads/exports ONNX models into models/
models/PROVENANCE.md
Dockerfile, railway.toml, .dockerignore
tests/... mirrors src/analyzer
```

---

### Task 1: Project skeleton, message model, parsers, language filter

**Files:**
- Create: `pyproject.toml`, `src/analyzer/__init__.py`, `src/analyzer/config.py`, `src/analyzer/parsers/{__init__,model,whatsapp,plaintext,language}.py`
- Test: `tests/parsers/test_whatsapp.py`, `tests/parsers/test_plaintext.py`, `tests/parsers/test_language.py`, fixtures in `tests/fixtures/chats/` (synthetic text only)

**Interfaces:**
- Produces:
  - `@dataclass(frozen=True) class Message: ts: datetime; speaker: str; text: str`
  - `parse_whatsapp(raw: str) -> list[Message]`
  - `parse_plaintext(raw: str) -> list[Message]` (format `YYYY-MM-DD HH:MM | speaker | text`)
  - `parse_any(raw: str, filename: str) -> list[Message]`, which dispatches on content sniffing
  - `is_english(text: str) -> bool`
  - `filter_english(msgs: list[Message]) -> tuple[list[Message], int]` (kept, skipped_count)
  - `class ParseError(ValueError)`

- [ ] **Step 1: Write failing tests**

```python
def test_us_format_multiline_and_system_lines():
    raw = (FIXTURES / "wa_us.txt").read_text(encoding="utf-8")
    msgs = parse_whatsapp(raw)
    assert [m.speaker for m in msgs[:2]] == ["Alex", "Sam"]
    assert msgs[1].text == "line one\nline two"
    assert not any("end-to-end encrypted" in m.text for m in msgs)
    assert not any(m.text == "<Media omitted>" for m in msgs)

def test_eu_24h_format(): ...          # dd/mm/yyyy, HH:mm parses; 13/02 is not read as month 13
def test_ios_bracket_format(): ...     # "[2/3/24, 9:05:11 PM] Alex: hi"
def test_strips_lrm_marks(): ...       # "‎" removed from speaker and text
def test_unparseable_raises(): ...     # pytest.raises(ParseError)
def test_is_english():
    assert is_english("are you free tonight? I was thinking we could get food")
    assert not is_english("¿estás libre esta noche? podríamos ir a cenar")
    assert is_english("haha ok 😂")    # short or emoji-only messages count as English (not skipped)
```

- [ ] **Step 2: Run** `uv run pytest tests/parsers -v`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement the parsers.** Date-order detection: if any day field is above 12, use that order for the whole file; otherwise default to month-first. A line without a timestamp prefix continues the previous message. `is_english`: messages under 4 alphabetic tokens return True; otherwise True if at least 20% of tokens are in a 150-word English stop-word list kept inline in `language.py`.
- [ ] **Step 4: Run** `uv run pytest tests/parsers -v`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat: chat parsers and English filter"`

### Task 2: Encrypted store with merge, de-duplication and deletes

**Files:**
- Create: `src/analyzer/store/{db,schema,repo}.py`
- Test: `tests/store/test_db.py`, `tests/store/test_repo.py`

**Interfaces:**
- Consumes: `Message` (Task 1)
- Produces:
  - `open_db(path: Path, key: str) -> sqlite3.Connection`. Raises `DatabaseKeyError` on a missing or wrong key and never creates a file when the key is empty.
  - `class Repo(conn)` with:
    - `add_person(pseudonym: str, mode: Literal["potential","established"], me_speaker: str) -> int`
    - `list_people() -> list[Person]`
    - `add_upload(person_id: int, msgs: list[Message]) -> UploadResult(upload_id, added, duplicates)`
    - `messages(person_id: int) -> list[Message]` (sorted by ts, then occurrence)
    - `delete_upload(upload_id: int) -> int`, which removes only the messages that upload added
    - `delete_person(person_id: int) -> None`, which cascades and then runs `VACUUM`
    - `save_snapshot(person_id: int, kind: str, payload: dict) -> int`
    - `snapshots(person_id: int, kind: str) -> list[Snapshot]`
- Schema: `people`, `uploads`, `messages(id, person_id, upload_id, ts, speaker, text, msg_hash UNIQUE(person_id,msg_hash))`, `snapshots(id, person_id, kind, created_at, payload_json)`.
- `msg_hash = sha256(f"{ts.isoformat()}|{speaker}|{text}|{n}")`, where `n` is the 0-based index of identical (ts, speaker, text) messages within that upload.

- [ ] **Step 1: Write failing tests**

```python
def test_wrong_key_fails_closed(tmp_path):
    p = tmp_path / "a.db"; open_db(p, "k1").close()
    with pytest.raises(DatabaseKeyError): open_db(p, "k2")

def test_empty_key_creates_nothing(tmp_path):
    with pytest.raises(DatabaseKeyError): open_db(tmp_path / "b.db", "")
    assert not (tmp_path / "b.db").exists()

def test_file_is_not_plaintext_sqlite(tmp_path):
    p = tmp_path / "c.db"; open_db(p, "k").close()
    assert not p.read_bytes().startswith(b"SQLite format 3")

def test_overlapping_reupload_dedupes(repo, person):
    first = msgs("a","b","c"); second = msgs("a","b","c","d")
    assert repo.add_upload(person, first).added == 3
    r = repo.add_upload(person, second); assert (r.added, r.duplicates) == (1, 3)

def test_same_minute_duplicates_survive(repo, person):
    m = Message(T0, "Sam", "ok")
    assert repo.add_upload(person, [m, m]).added == 2
    assert repo.add_upload(person, [m, m]).added == 0

def test_delete_upload_removes_only_its_messages(repo, person): ...
def test_delete_person_cascades(repo, person): ...
```

- [ ] **Step 2: Run** `uv run pytest tests/store -v`. Expected: FAIL.
- [ ] **Step 3: Implement.** Use `sqlcipher3.connect`, `PRAGMA key`, then `SELECT count(*) FROM sqlite_master` to validate the key; on failure close the connection and raise.
- [ ] **Step 4: Run** `uv run pytest tests/store -v`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat: encrypted store with dedup merge"`

### Task 3: Scale schema and generic scorer

**Files:**
- Create: `src/analyzer/scales/{schema,scorer,loader}.py`
- Test: `tests/scales/test_scorer.py` (with a toy scale YAML in `tests/fixtures/scales/`)

**Interfaces:**
- Produces:
  - `class ScaleDef(BaseModel)`: `id, name, mode: list[str], items: list[Item], subscales: dict[str, Subscale], response: ResponseFormat(min, max), norms: list[Band] | None, cutoffs: list[Cutoff] | None, source: Source(citation, url), verified: bool, custom: bool, owner_approved: bool, measures: str, does_not_measure: str`
  - `Item(id, text, reverse: bool = False)`; `Subscale(items: list[str], aggregate: Literal["sum","mean"])`
  - `score(defn: ScaleDef, answers: dict[str, int]) -> ScaleResult(subscales: dict[str, float], bands: dict[str, str], cutoff_flags: dict[str, bool], status: Literal["ok","draft","unverified"], notes: list[str])`
  - `load_scales(dir: Path) -> dict[str, ScaleDef]`
- Rules:
  - reverse score = `min + max − x`;
  - an answer that is missing or out of range raises `AnswerError(item_id)`;
  - `status` is "unverified" if `verified` is false, "draft" if `custom` is true and `owner_approved` is false, and "ok" otherwise;
  - no norms gives the band "no reference band".

- [ ] **Step 1: Write failing tests:**
  - `test_reverse_key_and_sum`
  - `test_mean_aggregate`
  - `test_cutoff_flag_at_boundary`: a score equal to the cut-off counts as not distressed, matching the CSI convention "below 51.5"
  - `test_missing_answer_raises`
  - `test_out_of_range_raises`
  - `test_no_norms_band_text == "no reference band"`
  - `test_custom_unapproved_is_draft`
- [ ] **Step 2: Run** `uv run pytest tests/scales/test_scorer.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** with pydantic validation, so unknown subscale item ids fail at load time.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat: scale schema and scorer"`

### Task 4: Scale definitions from primary sources

**Files:**
- Create: `src/analyzer/scales/defs/{csi16,ims_commitment,prqc,ecr_r,joel_predictors,reciprocity,disclosure_balance,ppr,breadcrumbing,cdaq_items}.yaml`
- Test: `tests/scales/test_defs.py`

**Interfaces:**
- Consumes: `ScaleDef`, `load_scales`, `score` (Task 3)
- Produces: scale ids exactly as the file stems above, used by the API and MCP tools.

- [ ] **Step 1: Fetch item wording and scoring keys from the primary sources.** Sources: Funk & Rogge 2007 for CSI-16; Rusbult et al. 1998 appendix for IMS commitment; Fletcher et al. 2000 for PRQC; Fraley's ECR-R page for ECR-R items and reverse keys; the Reis lab measures page for PPR; Borrajo et al. 2015 for CDAQ. Set `verified: true` only where the item text and keys were read from the source. Record the URL in `source`.
- [ ] **Step 2: Draft the custom item sets** (`joel_predictors`, `reciprocity`, `disclosure_balance`, `breadcrumbing`) with `custom: true, owner_approved: false`, 4–8 items each on a 1–7 scale. Each item cites the paper that motivates it (spec §6.1).
- [ ] **Step 3: Write tests**

```python
def test_all_defs_load(): assert set(load_scales(DEFS)) >= {"csi16","ims_commitment","prqc","ecr_r","cdaq_items"}
def test_csi16_cutoff():
    d = load_scales(DEFS)["csi16"]
    assert d.cutoffs[0].value == 51.5
    assert score(d, answers_summing_to(51)).cutoff_flags["total"] is True
    assert score(d, answers_summing_to(52)).cutoff_flags["total"] is False
def test_ecr_r_has_two_subscales_of_18(): ...   # anxiety, avoidance
def test_custom_scales_are_draft(): ...
```

- [ ] **Step 4: Run** `uv run pytest tests/scales -v`. Expected: PASS. Any scale left `verified: false` is listed in the commit message.
- [ ] **Step 5: Commit:** `git commit -m "feat: scale definitions (unverified: …)"`

### Task 5: Core chat signals with evidence tags

**Files:**
- Create: `src/analyzer/signals/{evidence,sessions,counts,latency,lsm,questions,disclosure,report}.py`, `signals/wordlists/{function_words,disclosure}.yaml`
- Test: `tests/signals/test_*.py`

**Interfaces:**
- Consumes: `Message` (Task 1)
- Produces:
  - `Evidence = Literal["moderate","heuristic","descriptive"]`
  - `@dataclass class Metric: id: str; value: float | None; per_speaker: dict[str, float] | None; evidence: Evidence; status: Literal["ok","insufficient_data"]; note: str`
  - `split_sessions(msgs, gap_hours: float = 6.0) -> list[list[Message]]`
  - `count_metrics(msgs, me: str) -> list[Metric]` (message_share, initiation_share, ending_share, double_text_rate)
  - `latency_metrics(msgs, me) -> list[Metric]` (median reply latency per speaker; replies after a session break are excluded)
  - `lsm(msgs, me) -> Metric`
  - `question_rate(msgs, me) -> Metric`
  - `disclosure_rate(msgs, me) -> Metric` (lexicon-based)
  - `core_report(msgs, me) -> list[Metric]`
- Constants:
  - `MIN_MESSAGES = 20`; below it every metric has status `insufficient_data` and value `None`.
  - LSM uses 9 categories: personal pronouns, impersonal pronouns, articles, conjunctions, prepositions, auxiliary verbs, high-frequency adverbs, negations, quantifiers.
  - Per category: `1 − abs(a − b) / (a + b + 0.0001)`; overall LSM is the category mean.
- Evidence tags (spec §6.2): lsm and disclosure are moderate; counts, latency and questions are heuristic.

- [ ] **Step 1: Write failing tests**

```python
def test_lsm_identical_text_near_one():
    m = alternating("I think that we should go to the park", n=30)
    assert lsm(m, "A").value == pytest.approx(1.0, abs=0.01)
def test_initiation_one_sided():
    m = sessions_all_started_by("A", sessions=5)
    assert by_id(count_metrics(m, "A"), "initiation_share").per_speaker["A"] == 1.0
def test_insufficient_data_empty_and_one_speaker():
    for m in ([], only_speaker("A", 50), alternating("hi", n=5)):
        assert all(x.status == "insufficient_data" for x in core_report(m, "A"))
def test_latency_excludes_session_breaks(): ...
def test_every_metric_has_evidence_tag(): ...
```

- [ ] **Step 2: Run** `uv run pytest tests/signals -v`. Expected: FAIL.
- [ ] **Step 3: Implement.** Word lists are hand-built open lists in YAML (spec §11). Tokenize with a regex `\b[\w']+\b`, lower-cased.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat: core chat signals"`

### Task 6: ONNX emotion and toxicity, plus trends

**Files:**
- Create: `scripts/fetch_models.py`, `models/PROVENANCE.md`, `src/analyzer/ml/{onnx_text,emotion,toxicity}.py`, `src/analyzer/signals/trends.py`
- Test: `tests/ml/test_emotion_toxicity.py` (unit tests with a fake session; real-model tests marked `@pytest.mark.models`), `tests/signals/test_trends.py`, `tests/perf/test_large_upload.py` (marked `slow`)

**Interfaces:**
- Consumes: `Message`, `Metric` (Tasks 1 and 5)
- Produces:
  - `class OnnxTextClassifier(model_dir: Path, labels: list[str], batch_size: int = 64)` with `.predict(texts: list[str]) -> np.ndarray` (sigmoid probabilities)
  - `emotion_metrics(msgs, me, clf) -> list[Metric]` (top-6 emotion share per speaker, descriptive)
  - `toxicity_scores(msgs, clf) -> list[float]`, aligned with msgs
  - `toxicity_metric(msgs, me, clf) -> Metric`
  - `weekly_trends(msgs, me, metric_fns) -> dict[str, list[tuple[date, float | None]]]`
  - `change_points(series, z: float = 2.0) -> list[date]`
- Models:
  - `SamLowe/roberta-base-go_emotions-onnx` (int8 file), 28 labels, MIT.
  - Detoxify `original` exported to ONNX int8 via optimum in `fetch_models.py`, Apache-2.0.
  - Record both in `models/PROVENANCE.md`.
  - No torch at runtime.

- [ ] **Step 1: Write failing tests:**
  - `test_classifier_batches` (fake session records batch sizes ≤ 64)
  - `test_emotion_metric_shape`
  - `test_toxicity_alignment`
  - `test_weekly_trends_gaps_are_none`
  - `test_change_point_detects_step`
  - `models`: `test_real_toxicity_ranks_insult_above_greeting`
  - `slow`: `test_100k_messages_under_120s`
- [ ] **Step 2: Run** `uv run pytest tests/ml tests/signals/test_trends.py -v -m "not models and not slow"`. Expected: FAIL.
- [ ] **Step 3: Implement.** Write `fetch_models.py` to download and export into `models/{emotion,toxicity}/` with `model.onnx`, `tokenizer.json` and `labels.json`. Then implement the classes.
- [ ] **Step 4: Run** `uv run python scripts/fetch_models.py && uv run pytest tests/ml tests/signals -v -m "not slow"`. Expected: PASS. Then run `uv run pytest -m slow` once and record the timing in the commit message.
- [ ] **Step 5: Commit:** `git commit -m "feat: onnx emotion/toxicity and trends"`

### Task 7: Safety module

**Files:**
- Create: `src/analyzer/safety/{rules,check}.py`, `safety/config.yaml`, `safety/resources/us.yaml`, `tests/fixtures/safety/*.yaml`
- Test: `tests/safety/test_check.py`

**Interfaces:**
- Consumes: `Message`, `toxicity_scores` (Task 6), `ScaleResult` for `cdaq_items` (Tasks 3 and 4)
- Produces:
  - `@dataclass class SafetyFlag: category: Literal["monitoring","control","isolation","threat","hostility","self_harm"]; severity: Literal["info","concern","urgent"]; speaker: str; count: int; first_seen: date; last_seen: date; snippets: list[str]`
  - `safety_check(msgs, me, tox: list[float] | None, cdaq: ScaleResult | None) -> SafetyBlock(flags: list[SafetyFlag], resources: list[Resource], disclaimer: str)`
- Rules:
  - Both speakers are scanned.
  - *urgent* = any threat or self-harm or violence pattern.
  - *concern* = 3 or more monitoring/control/isolation hits within 30 days, or 3 or more messages with toxicity ≥ 0.8.
  - *info* = a single mild hit.
  - Thresholds live in `config.yaml`.
  - Snippets are at most 3 per flag, 200 characters each.
  - Both modes.

- [ ] **Step 1: Write the fixture set** (synthetic lines), at least 8 per category including urgent cases, plus 30 benign lines with swearing and banter.
- [ ] **Step 2: Write failing tests**

```python
def test_urgent_recall_is_total():
    for case in load_fixtures("urgent"):
        assert any(f.severity == "urgent" for f in safety_check(case.msgs, "me", None, None).flags), case.id
def test_owner_messages_are_flagged_too(): ...
def test_repeated_monitoring_is_concern(): ...
def test_benign_swearing_not_urgent(): ...
def test_resources_present_when_any_flag(): ...
```

- [ ] **Step 3: Run** `uv run pytest tests/safety -v`. Expected: FAIL.
- [ ] **Step 4: Implement** regex and phrase rules in `rules.py`.
- [ ] **Step 5: Run** the same command. Expected: PASS, with zero urgent misses.
- [ ] **Step 6: Commit:** `git commit -m "feat: safety check"`

### Task 8: Service layer

**Files:**
- Create: `src/analyzer/service.py`
- Test: `tests/test_service.py`

**Interfaces:**
- Consumes: `Repo` (Task 2), `load_scales`/`score` (Tasks 3 and 4), `core_report` (Task 5), ML functions and `weekly_trends` (Task 6), `safety_check` (Task 7)
- Produces:
  - `class Analyzer(repo, scales, emotion_clf, tox_clf)` with:
    - `analyze_chat(person_id, include_excerpts: bool = False) -> ChatReport(metrics, trends, skipped_non_english, excerpts | None)`, which saves a snapshot of kind "chat"
    - `score_questionnaire(person_id, scale_id, answers) -> ScaleResult`, which saves a snapshot of kind `f"scale:{scale_id}"`
    - `safety(person_id) -> SafetyBlock`
    - `history(person_id, metric_id) -> list[tuple[datetime, float | None]]`
    - `explain(metric_id) -> MetricInfo(measures, evidence, caveats, citation)`
  - All return types are pydantic models (JSON-serialisable for API and MCP).

- [ ] **Step 1: Write failing tests:**
  - `test_analyze_chat_saves_snapshot`
  - `test_non_english_skipped_count_reported`
  - `test_excerpts_only_when_requested`
  - `test_history_orders_snapshots`
  - `test_explain_known_metric`
  - `test_unknown_scale_raises`

  Use fake classifiers.
- [ ] **Step 2: Run** `uv run pytest tests/test_service.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat: analyzer service"`

### Task 9: Web app with auth, REST API and UI

**Files:**
- Create: `src/analyzer/web/{app,auth,deps,routes_api,routes_ui}.py`, `web/templates/{base,login,people,person,questionnaire,results}.html`
- Test: `tests/web/test_auth.py`, `tests/web/test_api.py`, `tests/web/test_ui.py`

**Interfaces:**
- Consumes: `Analyzer` (Task 8), `Settings` (Task 1)
- Produces:
  - `create_app(settings: Settings, analyzer: Analyzer | None = None) -> FastAPI`
  - Routes:
    - `GET /healthz`
    - `POST /login` (password + TOTP) and `POST /logout`
    - `GET /ui/...` (session cookie)
    - `/api/people` (GET/POST)
    - `/api/people/{id}/uploads` (POST multipart, 50 MB cap → 413)
    - `/api/people/{id}/questionnaires/{scale_id}` (POST)
    - `/api/people/{id}/chat-report` (GET, `?include_excerpts=`)
    - `/api/people/{id}/safety` (GET)
    - `/api/people/{id}/history/{metric}` (GET)
    - `DELETE /api/uploads/{id}` and `DELETE /api/people/{id}`
  - `require_token` dependency (bearer, `hmac.compare_digest`) and `require_session` dependency.
- Rules:
  - Session cookie is HttpOnly, Secure and SameSite=Strict, signed with `SESSION_SECRET`, with a 12 h lifetime.
  - Login is rate-limited to 5 failures per 15 minutes per IP (in-memory).
  - The results page renders the safety block above everything else.
  - Request logging uses IDs and paths only.

- [ ] **Step 1: Write failing tests**

```python
def test_healthz_is_only_public_route(client):
    for path in public_candidates(app): assert client.get(path).status_code in (401, 303) or path == "/healthz"
def test_api_requires_bearer(client): assert client.get("/api/people").status_code == 401
def test_wrong_token_rejected(client): ...
def test_login_requires_totp(client): ...
def test_login_rate_limited(client): ...
def test_upload_too_large_413(client, token): ...
def test_upload_then_report_roundtrip(client, token): ...
def test_logs_contain_no_message_text(client, token, caplog): ...
def test_results_page_safety_block_first(client, session): ...
```

- [ ] **Step 2: Run** `uv run pytest tests/web -v`. Expected: FAIL.
- [ ] **Step 3: Implement.** Use plain server-rendered templates; the look is the builder's call (§11).
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat: web app, auth, api, ui"`

### Task 10: MCP endpoint

**Files:**
- Create: `src/analyzer/web/mcp_server.py`; modify `src/analyzer/web/app.py` (mount at `/mcp`)
- Test: `tests/web/test_mcp.py`

**Interfaces:**
- Consumes: `Analyzer` (Task 8), `require_token` (Task 9)
- Produces: MCP tools that each wrap one `Analyzer` call and return its pydantic model as JSON:
  - `list_people`
  - `score_questionnaire(person_id, scale_id, answers)`
  - `analyze_chat(person_id, include_excerpts=False)`
  - `safety_check(person_id)`
  - `get_history(person_id, metric)`
  - `explain_metric(metric_id)`
- Tool descriptions carry the agent rules from spec §6.5: cite evidence tags, no outcome probabilities, relay safety category and severity unchanged, refuse to help monitor the other person.
- Use the official SDK v2 (`mcp` 2.x, `MCPServer`, `@mcp.tool()`) with Streamable HTTP. Confirm the import path and the ASGI mounting call from the SDK README before writing.
- Origin middleware: reject if `Origin` is present and not equal to `APP_ORIGIN`.

- [ ] **Step 1: Write failing tests:**
  - `test_mcp_requires_token`
  - `test_mcp_rejects_foreign_origin`
  - `test_mcp_allows_no_origin_with_token`
  - `test_list_tools_names`: exactly the 6 tools above
  - `test_safety_tool_returns_block_verbatim`
  - `test_analyze_chat_tool_matches_api`

  Call the endpoint through the SDK's in-process or HTTP test client.
- [ ] **Step 2: Run** `uv run pytest tests/web/test_mcp.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat: mcp endpoint"`

### Task 11: Optional Claude narrative (Path 2)

**Files:**
- Create: `src/analyzer/narrate/claude.py`; modify `routes_api.py` and `routes_ui.py` (toggle and endpoint `POST /api/people/{id}/narrative`)
- Test: `tests/narrate/test_claude.py`

**Interfaces:**
- Consumes: `ChatReport`, `ScaleResult`, `SafetyBlock` (Tasks 7 and 8)
- Produces: `narrate(report: ChatReport, scales: list[ScaleResult], safety: SafetyBlock, client: anthropic.Anthropic | None = None) -> Narrative(text: str, model: str, refused: bool)`
- Call: `client.beta.messages.create(model="claude-opus-5-5", max_tokens=4000, betas=["server-side-fallback-2026-07-01"], fallbacks="default", output_config={"effort": "medium"}, system=SYSTEM_PROMPT, messages=[{"role": "user", "content": json_payload}])`
  - If `stop_reason == "refusal"`, return `refused=True` with the text "Narrative unavailable."
  - Catch errors most-specific first: `anthropic.RateLimitError`, then `anthropic.APIStatusError`, then `anthropic.APIConnectionError`.
- `SYSTEM_PROMPT` encodes the §6.5 agent rules. The safety block goes into the prompt first, and the UI renders it separately above the narrative, never through the narrative.
- The endpoint returns 404 unless the per-request toggle `enable_narrative=true` is sent **and** `ANTHROPIC_API_KEY` is set.

- [ ] **Step 1: Write failing tests** (fake client):
  - `test_request_shape` asserts model, betas, fallbacks and effort.
  - `test_refusal_handled`
  - `test_disabled_without_key_404`
  - `test_safety_rendered_outside_narrative`
- [ ] **Step 2: Run** `uv run pytest tests/narrate -v`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat: optional claude narrative"`

### Task 12: Docker, Railway deploy and smoke test

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `railway.toml`, `scripts/smoke.py`, `README-deploy.md`
- Test: `scripts/smoke.py` run against the local container and then the Railway URL

**Interfaces:**
- Consumes: `create_app` (Task 9), `fetch_models.py` (Task 6)
- Image:
  - Multi-stage, based on `python:3.11-slim`.
  - `uv sync --frozen --no-dev`.
  - Models fetched at build time into `/app/models`.
  - `.dockerignore` excludes `data/ uploads/ *.db .env tests/fixtures/chats/ research/`.
  - Runs as a non-root user.
  - `CMD uvicorn analyzer.web.app:app --host 0.0.0.0 --port $PORT --workers 1`.
- Railway:
  - One service.
  - Volume mounted at `/data`, with `DB_PATH=/data/analyzer.db`.
  - Variables as listed in Global Constraints.
  - Healthcheck path `/healthz`.
- `smoke.py`:
  - `/healthz` returns 200.
  - `/api/people` without a token returns 401.
  - With the token, create a person, upload a synthetic fixture, then get the chat report and safety block.
  - Delete the person.

- [ ] **Step 1: Build:** `docker build -t analyzer .`. Expected: success. Record the image size in `README-deploy.md`.
- [ ] **Step 2: Run locally:** `docker run --rm -e DB_KEY=test -e API_TOKEN=t ... -p 8000:8000 analyzer`, then `uv run python scripts/smoke.py http://localhost:8000 t`. Expected: all checks PASS.
- [ ] **Step 3: Check fail-closed behaviour:** run without `DB_KEY`. Expected: the container exits non-zero with "DB_KEY missing".
- [ ] **Step 4: Deploy:** `railway up` (owner logs in with `railway login`). Set the variables and the volume, then `uv run python scripts/smoke.py https://<app>.up.railway.app $API_TOKEN`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "chore: docker + railway deploy"`

---

## Self-review notes

- Spec coverage:
  - §6.1 → Tasks 3–4
  - §6.2 → Tasks 5–6
  - §6.3 → Task 7
  - §6.4 → Task 10
  - §6.5 → Tasks 10–11 (Path 3 out of scope per §10)
  - §7 → Tasks 2, 9, 10, 12
  - §8 → tests throughout
  - §9 steps 1–5 → Tasks 1–12
  - §10a.7 re-uploads → Task 2
  - §6.6 / step 6 → separate phase-2 plan
- Types: `Metric`, `ChatReport`, `ScaleResult` and `SafetyBlock` are defined once (Tasks 5, 8, 3, 7) and consumed by name afterwards.
