# Relationship Analyzer — design

*2026-11-23. Personal-use tool. Status: draft for owner approval.*

## 1. Intent

A personal tool that helps the owner think clearly about two situations:

- **Potential mode**: the owner likes someone and wants to read the signals honestly.
- **Established mode**: the owner is dating someone and wants a check on relationship health.

The owner fills in a questionnaire and can upload chat exports. Self-hosted ML models score both. An optional LLM agent explains the scores and helps the owner reflect. It runs on a hosted service so the owner can reach it from any device.

**Why this shape:** the literature review in this repo shows that relationship signal in text is real but modest. Joel et al. (2020) found almost nothing predicts how a relationship *changes* (no analysis explained more than 5% of the variance in change). An LLM reading real speed-date chats reached only r = 0.12–0.23. So the tool reports evidence-backed signals and validated scale scores. It does not issue verdicts or forecasts.

## 2. Goals, non-goals, anti-goals

**Goals**
1. Score validated questionnaires per mode, against published norms and cut-offs.
2. Analyse uploaded chats for evidence-backed signals: reciprocity, self-disclosure, style matching, emotion, hostility, trends over time.
3. Flag unhealthy dynamics (monitoring, control, aggression) clearly. The LLM can never suppress or soften these flags.
4. Expose the engine as MCP tools, so an LLM client (e.g. Claude) can act as the optional agent.
5. Keep a history, so the owner can compare snapshots over time.
6. Later (phase 2): an experimental trained predictor, built from synthetic data plus the owner's labelled history. It is shown only if it beats the simple baselines.

**Non-goals**
- Multiple users, sign-ups, distribution, app-store packaging, licence clearance for redistribution.
- Forecasts like "they will say yes: 82%" or "you will break up within 6 months".
- Real-time phone integration or automatic message syncing.

**Anti-goals (failure even if it works)**
- The other person's messages leak: a public endpoint, a git commit, logs, or a third-party API the owner did not choose.
- The tool turns into an obsession or surveillance aid, e.g. pushing the owner to monitor someone's activity.
- Confident wrong verdicts that the owner acts on.

## 3. Constraints

- **Single user**: the owner.
- **Hosted on another service.** The provider is not yet chosen (see §10). The system ships as one Docker image, so it is portable.
- **Self-hosted models.** Encoders and classifiers run inside the container; no third-party ML inference API. LLM use is optional and switchable (§6.5).
- **Internet-facing.** Authentication and encryption at rest are required. The relaxed practices only apply to licences and packaging.
- **Licences.** Personal, non-commercial use, so CC BY-NC and research-only datasets and models are allowed. A one-file provenance record (`models/PROVENANCE.md`: model → datasets) is kept anyway. It costs a minute and keeps a future public version possible.
- **CPU-first.** No assumed GPU; all encoders run as ONNX int8. The model budget is about 0.5–1 GB, to be measured.

## 4. Approaches considered

| | Approach | Trade-off | Decision |
|---|---|---|---|
| A | Validated scales + explainable chat signals, LLM as narrator | Most faithful to the evidence; fast to build; no "do they like me" classifier | **Chosen for v1** |
| B | Predictor trained on synthetic chats (hidden-trait personas, LLM judge panel, human spot labels) | A real research project; 7–17+ F1 gap from synthetic to real data expected; risk of confident errors | **Phase 2, experimental**, benchmarked against A |
| C | LLM does everything from rubric prompts | Simplest, but low accuracy (r ≈ 0.1–0.2 on real dates), documented name/gender bias, not reproducible | Rejected as the core; the LLM only narrates |

The owner picked A for v1 with B as an experiment (2026-11-23).

## 5. Architecture

```
            browser (phone/laptop)            Claude client (Desktop / Code / claude.ai connector)
                    │ HTTPS + session                         │ HTTPS + bearer/OAuth
                    ▼                                         ▼
 ┌───────────────────────── Docker container on host ─────────────────────────┐
 │  FastAPI app                                                                │
 │   ├─ /ui     questionnaire + chat upload + results pages                   │
 │   ├─ /api    JSON endpoints used by the UI                                  │
 │   └─ /mcp    MCP server (Streamable HTTP), same process                    │
 │                         │                                                   │
 │                 engine (Python package)                                     │
 │   ├─ parsers     WhatsApp / iMessage / Instagram / Discord / plain-text    │
 │   ├─ scales      questionnaire scoring, norms, cut-offs                    │
 │   ├─ signals     per-speaker chat metrics, LSM, emotion, toxicity          │
 │   ├─ safety      CDAQ items + text flags → fixed, non-overridable output   │
 │   ├─ narrate     optional LLM call (off by default)                        │
 │   └─ predict     phase-2 experimental models (hidden unless validated)     │
 │                         │                                                   │
 │   SQLite (SQLCipher-encrypted) on a mounted volume · ONNX models baked in  │
 └─────────────────────────────────────────────────────────────────────────────┘
```

One process serves the UI and MCP, so models load once. The MCP SDK is the official Python SDK v2 (`mcp`, `MCPServer`, `@mcp.tool()`), on spec revision 2026-07-28 (stateless).

## 6. Components

### 6.1 Questionnaires (`engine/scales`)

Each scale is a YAML definition: items, response format, reverse-keyed items, subscales, norms, cut-offs and source citation. The scorer is generic. Output: raw score, normed band, cut-off status, and a "what this measures / doesn't" line.

**Established mode**
| Scale | Use | Notes |
|---|---|---|
| CSI-16 (Funk & Rogge 2007) | Overall satisfaction | α .98; distress cut-off 51.5 |
| Investment Model Scale — commitment subscale (Rusbult et al. 1998) | Commitment | 7 items, 0–8; α .91–.95; usable alone |
| PRQC (Fletcher et al. 2000) | 6 quality components × 3 items | 7-point |
| Joel et al. (2020) top predictors | Perceived partner commitment, appreciation, sexual satisfaction (optional), perceived partner satisfaction, conflict | No validated combined scale exists; short custom items, labelled as such |
| CDAQ-derived items (Borrajo et al. 2015) | Monitoring/control and direct aggression | Feeds `safety`; reported by frequency and impact, not as proof of abuse (monitoring is common, >70% in one sample) |

**Potential mode**
| Scale / items | Use | Notes |
|---|---|---|
| Reciprocity checklist | Who initiates, who suggests plans, follow-through | Custom items; evidence: reciprocity and reliability (Teichmann et al. 2026) |
| Self-disclosure balance | Depth and reciprocity of disclosure | Collins & Miller (1994) meta-analysis |
| Perceived Partner Responsiveness (Reis) | Does the other person respond to me? | Free for research/personal use |
| Breadcrumbing / mixed-signal items | Intermittent attention without progression | Navarro et al. (2020): breadcrumbing linked to lower life satisfaction |

**Both modes:** ECR-R (36 items) for the owner's own attachment style, taken once and re-taken occasionally. It contextualises the results: anxious attachment means wanting more messages and over-reading silence (Patel et al. 2022). Attachment is never inferred from text, since text-based inference is still at prototype level.

### 6.2 Chat signals (`engine/signals`)

**Input:** a chat export, parsed to `(timestamp, speaker, text)`, with the owner choosing which speaker is "me". Metrics are computed per speaker, per time window (weekly), and overall.

| Signal | Method | Evidence strength shown to the user |
|---|---|---|
| Language style matching | Function-word category rates per window; LSM = 1 − abs(a−b)/(a+b+0.0001), averaged across categories. Open function-word lists, not LIWC | **Moderate**: OR ≈ 2–3 for interest and stability (Ireland 2011) |
| Message share, initiation share, conversation-ending share | Counts; a session break is a gap of more than N hours | **Heuristic**: no peer-reviewed validation |
| Response latency, double-texting | Timestamp deltas | **Heuristic**, shown with a caveat |
| Questions asked to the other person | Rule-based + POS | **Heuristic**, linked to responsiveness |
| Self-disclosure | Lexicon + small classifier (phase 1.5) | **Moderate**: disclosure ↔ liking (Collins & Miller) |
| Emotion mix | `SamLowe/roberta-base-go_emotions` ONNX int8, 28 labels | **Descriptive** |
| Hostility / toxicity | Detoxify (multilingual), with a swearing-aware threshold | **Descriptive**; feeds safety |
| Trend over time | Rolling windows of all of the above; change-point flag | **Descriptive** |

Each output carries its evidence tag, so neither the UI nor the LLM can present a heuristic as a validated finding.

### 6.3 Safety (`engine/safety`)

- Inputs: CDAQ-derived answers, Detoxify scores, and keyword/pattern rules for monitoring and control (location demands, password demands, isolation, threats).
- Phase 2 adds an experimental classifier for the six UCL abuse tactics (Rules, Justify, Threat, Shame, Isolate, Surveil), trained on the UCL psychological-abuse Reddit set plus MentalManip (personal use only).
- Output: a fixed-format flag block with severity, evidence snippets and support resources. It is returned verbatim by the API and the MCP tool. The LLM system prompt forbids softening it, and the UI renders it above any narrative.

### 6.4 MCP tools (`/mcp`)

| Tool | Input | Output |
|---|---|---|
| `list_people` | — | People the owner has set up (pseudonyms), mode, last snapshot |
| `score_questionnaire` | person_id, scale_id, answers | Scores, bands, cut-offs, evidence notes |
| `analyze_chat` | person_id, upload_id (or raw text), window | Signal table with evidence tags, trend summary |
| `safety_check` | person_id | Safety flag block (verbatim) |
| `get_history` | person_id, metric | Time series of snapshots |
| `explain_metric` | metric_id | What it measures, evidence, caveats, citation |

Resources: scale definitions and the evidence notes (from `research/`). Tool outputs are numbers and short text, never the whole chat. That keeps the other person's messages out of the LLM's context unless the owner pastes them in.

### 6.5 Optional LLM agent

- **Default: off in the web UI.** The UI shows scores and templated explanations without any LLM.
- **Path 1 (recommended): Claude as the MCP client.** The owner connects Claude Desktop, Claude Code or a claude.ai custom connector to `/mcp`. Claude calls the tools and coaches. The server holds no LLM API key, and only tool outputs (metrics) reach the LLM.
- **Path 2: server-side narrative.** A per-request toggle sends the metrics (not the raw chat) to the Claude API for a written summary. The key is stored as a host secret.
- **Path 3: self-hosted small LLM.** Only if the host has a GPU or 16 GB+ RAM. Candidates: Qwen3.5-4B / Gemma 4 E4B / Ministral 3 8B via Ollama.
- **Agent rules (system prompt / tool descriptions):** cite evidence tags; no probability-of-outcome claims; never override the safety block; suggest talking to the person or a professional where relevant; refuse to help monitor the other person's activity.

### 6.6 Phase 2: experimental predictor (`engine/predict`, approach B)

1. **Owner's labelled history.** Import past chats with known outcomes (became a relationship / didn't; stayed / ended), labelled by the owner. This is the only real evaluation set; expect tens of threads, not thousands.
2. **Synthetic generation.** Sample hidden trait sheets: interest level, attachment style, conflict style, reciprocity. Decouple traits from names and demographics. Simulate two-agent chats where each agent sees only its own sheet (SOTOPIA-style). Seed with real style examples from the owner's history to shrink the realism gap.
3. **Filter and judge.** Rule filters, then a panel of 3 judges from model families different from the generator (PoLL-style). The judges score label fidelity and realism. A bag-of-words leakage check flags chats that state their hidden traits outright.
4. **Human check.** The owner labels about 200 synthetic chats to measure judge agreement (κ). If κ is too low, fix the rubric before training.
5. **Train.** ModernBERT-base fine-tune (Apache-2.0, 8K context), export to ONNX int8.
6. **Gate.** Show in the UI only if, on the owner's held-out real threads, it beats the A-signal baseline (logistic regression on LSM + reciprocity features). Report the synthetic-to-real gap. Otherwise it stays hidden in a lab page.

**Personal-use auxiliary data** (CC BY-NC / research-only allowed): DailyDialog, EmpatheticDialogues, ESConv, MentalManip, Unhealthy Comments Corpus, GoEmotions, UCL abuse set, flirty_or_not, Speed Dating Experiment (OpenML 40536; tabular, for questionnaire calibration only), openpsychometrics ECR raw data (norms), plus fiction relationship sets (DDRel, PRIDE, SCRIPTS) for pre-training experiments. Every model records its datasets in `models/PROVENANCE.md`.

## 7. Data handling and security (kept even though personal)

1. **HTTPS only**, using the host's TLS.
2. **Auth on everything.** Web UI: single-user password plus TOTP, or a passkey, with an HTTP-only session cookie. MCP: bearer token in a host secret, or OAuth if the Claude connector requires it. No unauthenticated route except `/healthz`.
3. **MCP over HTTP:** validate the `Origin` header and reject unknown origins, as the spec requires.
4. **Encryption at rest.** SQLCipher database and encrypted uploads; key in a host secret, never in the image or repo.
5. **Logs contain no message text**: IDs, timings and metric names only.
6. **People are stored under pseudonyms** chosen by the owner.
7. **Delete button** per person and per upload; deletion is a hard delete, plus a vacuum.
8. **Repo hygiene.** `.gitignore` covers `data/`, `uploads/`, `*.db`, `.env`. Real chats never enter the repo or the Docker build context.
9. **Backups** are encrypted volume snapshots via the host, if offered.

## 8. Evaluation and honesty

- Scales: scored to published keys, with unit tests against hand-scored examples.
- Signals: unit tests on synthetic fixtures (e.g. identical texts → LSM ≈ 1; one-sided chat → initiation share ≈ 1).
- Display rules: no single "score out of 100"; every number has a band, an evidence tag and a "what it can't tell you" line.
- Phase 2 models: metrics on the owner's real held-out threads only, with confidence intervals; calibrated with scikit-learn `CalibratedClassifierCV` (sigmoid, given small data).

## 9. Delivery order

1. Engine: parsers, scales (CSI-16, IMS commitment, ECR-R, potential-mode items), signals (counts, latency, LSM), with tests.
2. FastAPI + auth + encrypted storage + minimal UI.
3. Emotion and toxicity ONNX models; safety module.
4. MCP endpoint + Claude connection.
5. Docker image + deploy to host.
6. Phase 2: labelled-history import → synthetic pipeline → judge panel → train → gate.

## 10. Open items

- **Host (owner's call).** It decides whether path 3 (self-hosted LLM) is possible and how secrets and TLS are set up. The default assumption is a CPU container host with a persistent volume, 2–4 GB RAM and secrets support.
- Exact chat export formats the owner uses (first parsers: WhatsApp `.txt` and plain text).

## 10a. Decisions settled after builder review (designer's calls — owner may override)

1. **What the LLM sees from safety.** `safety_check` over MCP, and any Path 2 narrative, returns categories, counts, severity and dates only. Evidence snippets (the other person's words) appear only in the authenticated web UI. "Verbatim" means the LLM must relay the category and severity unchanged. `analyze_chat` accepts raw text only when the owner deliberately pastes it into a Claude conversation; the server never sends chat text to an LLM on its own.
2. **Bands.** Only scales with published norms or cut-offs get bands (e.g. CSI-16 distress cut-off 51.5). Un-normed metrics (message share, latency, initiation, custom checklists, the Joel-predictor items) show "no reference band". They are reported descriptively and against the owner's own history. The builder fetches and verifies item wording and scoring keys from the primary sources: IMS commitment aggregation, the ECR-R reverse-keyed items, CDAQ item text. Anything unverifiable is left out, not guessed. The builder drafts the custom item wording and the owner approves it before it ships.
3. **v1 scope by step.** Step 1 covers all §6.1 scales and items (CSI-16, IMS commitment, PRQC, ECR-R, Joel-predictor items, reciprocity, self-disclosure balance, PPR, breadcrumbing items, CDAQ-derived items). The self-disclosure classifier moves to phase 2; v1 uses a lexicon. Path 2 narrative (Claude API) ships in step 4, off by default. Path 3 (self-hosted LLM) is deferred until a host with enough RAM or a GPU is chosen.
4. **Safety behaviour.**
   - Both speakers are scanned, so the owner's own monitoring or controlling messages are flagged too, in line with the anti-surveillance goal.
   - CDAQ-derived items cover both directions (experienced and done), as the CDAQ does.
   - Text flags run in both modes.
   - Severity: *info* (single mild instance), *concern* (repeated monitoring/control or hostility), *urgent* (threats, coercion, self-harm or violence language). Thresholds live in a config file the builder documents.
   - Support resources come from a configurable region file, default US.
   - Tests: a hand-written fixture set per category, with thresholds tuned for high recall. A false negative on *urgent* fails the build; false positives are acceptable.
5. **Phase 2 output.** A model that passes the gate shows a band (lower / similar / higher than the owner's own baseline) plus the features driving it. It never shows a probability, consistent with the §2 non-goals.
6. **Phase 2 data flow.** Real chats are never sent to generator or judge models. Style seeds use only the owner's own messages, anonymised. Generation uses the Claude API; judges are open-weight models from other families run on a rented GPU or Colab. Fine-tuning runs there too. The shared research servers the owner has access to for other projects are not used.
7. **Re-uploads.** Uploads are merged into one thread per person, de-duplicated by a hash of (timestamp, speaker, text). Each upload records which messages it added, so "delete upload" removes only those. Trends are computed on the merged thread.

## 11. Left to the builder

The web UI look, the function-word list source, the session-break threshold, TOTP vs passkey, YAML schema details, and the choice between Alembic and hand-rolled migrations.

## Sources

Evidence for every claim above is in `literature-review.md`, `article-summaries.md` and `research/app-notes/` (datasets and licences, synthetic data and LLM judges, models and MCP stack, relationship science and scales).
