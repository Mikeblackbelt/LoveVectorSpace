# Models and Serving Stack for a Local, Distributable Relationship-Analysis App (MCP + small ML models + optional LLM agent)

Research date: 2026-11-23. Every item under "Cited Findings" links to a page that was actually opened (WebFetch) during this research; items seen only in search results are listed under Gaps. Numbers are as stated on the cited page; nothing was benchmarked locally. Lines in "Inferences" are the researcher's reasoning, not sourced facts.

## 1. Text encoders / classifiers to fine-tune on chat messages

### Takeaway
For English chat classification, ModernBERT-base (149M, Apache-2.0, 8K context) or DeBERTa-v3-base (MIT) are the strongest fine-tuning backbones; for multilingual, mmBERT (MIT, 1800+ languages, claims to beat XLM-R) or XLM-R-base (MIT). For cheap embedding features, all-MiniLM-L6-v2 (22.7M, Apache-2.0) and bge-small-en-v1.5 (33.4M, MIT) are tiny and ship ONNX; EmbeddingGemma-300M is multilingual but carries the restrictive Gemma Terms (flag).

### Cited Findings
**Fine-tuning backbones**
- ModernBERT-base: ~149M params (22 layers); ModernBERT-large ~395M (28 layers); native 8,192-token context; Apache 2.0 covering architecture, weights and training code; primarily English (+code), ~2T tokens training data; ONNX listed among the repo's format tags. — [ModernBERT-base card](https://huggingface.co/answerdotai/ModernBERT-base)
- ModernBERT vs DeBERTa-v3: base GLUE 88.4 vs 88.1 (ModernBERT slightly ahead); large GLUE 90.4 vs DeBERTa-v3-large 91.4 (DeBERTa ahead); ModernBERT far ahead on retrieval/code (e.g., BEIR DPR 41.6 vs 20.2). — [ModernBERT-base card](https://huggingface.co/answerdotai/ModernBERT-base)
- DeBERTa-v3-base: 86M backbone params + 98M embedding params (128K-token vocabulary); MIT license; example fine-tuning recipe lr 2e-5, max_seq_length 256, 3 epochs. — [deberta-v3-base card](https://huggingface.co/microsoft/deberta-v3-base)
- mmBERT-base (JHU CLSP): 307M total / 110M non-embedding params; 1800+ languages (1,833 in decay phase); 3T+ training tokens (2.3T pretrain + 600B mid-training + 100B decay); 8,192-token context; MIT license; card claims it "significantly outperforms previous generation models like XLM-R" on classification, embedding and retrieval (author claim); ONNX not mentioned; card lists `transformers>=4.21.0`, `torch>=1.9.0`. — [mmBERT-base card](https://huggingface.co/jhu-clsp/mmBERT-base)
- XLM-RoBERTa-base: ~0.3B params; pretrained on 2.5TB filtered CommonCrawl in 100 languages (Hub metadata tags 94); MIT license. — [xlm-roberta-base card](https://huggingface.co/FacebookAI/xlm-roberta-base)

**Sentence-embedding models (frozen feature extractors / few-shot heads, e.g., SetFit-style)**
- all-MiniLM-L6-v2: ~22.7M params, 384-dim, truncates at 256 word pieces, Apache-2.0, ONNX and OpenVINO exports listed; trained on >1B sentence pairs incl. Reddit comments 2015-2018. — [all-MiniLM-L6-v2 card](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2)
- bge-small-en-v1.5: 33.4M params, 384-dim, 512 tokens, MIT ("can be used for commercial purposes free of charge"), ships `onnx/model.onnx`; MTEB avg 62.17 (Classification 74.14); card points to bge-m3 for multilingual/long text. — [bge-small-en-v1.5 card](https://huggingface.co/BAAI/bge-small-en-v1.5)
- nomic-embed-text-v1.5: ~0.1B params, 768-dim with Matryoshka truncation to 512/256/128/64 (MTEB 62.28 at 768 → 56.10 at 64), 8,192 context, Apache-2.0, REQUIRES task prefixes (`classification:`, `clustering:`, `search_query:`, `search_document:`), ONNX tag. — [nomic-embed-text-v1.5 card](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5)
- EmbeddingGemma-300M: ~0.3B params, 768-dim Matryoshka (512/256/128), 2,048 context, 100+ languages, QAT checkpoints Q4_0/Q8_0/mixed; no float16 activations (use fp32/bf16); gated download — user must accept Google's Gemma license; subject to Gemma Prohibited Use Policy. ONNX not mentioned on card. — [embeddinggemma-300m card](https://huggingface.co/google/embeddinggemma-300m)
- **LICENSE FLAG (EmbeddingGemma / Gemma 1-3 family):** Gemma Terms of Use (last updated 2026-04-01) require redistributors to pass the Sec. 3.2 use restrictions through as an enforceable term, give recipients a copy of the Agreement, mark modified files, include a Notice file with exact wording, and Google "may restrict (remotely or otherwise)" use it believes violates the terms. Fine-tunes and distillations count as "Model Derivatives". Commercial use is not prohibited but is conditioned on these terms. — [Gemma Terms of Use](https://gemma.ai/resources/terms/)

**Quantization / CPU runtime**
- ONNX Runtime recommends *dynamic* quantization for transformer models (static for CNNs); S8S8 with QDQ is the default; int8 gains depend on hardware (VNNI/AVX512, Arm dot-product benefit most; older CPUs may get slower); quantization is lossy, debug with `qdq_loss_debug`; opset ≥10. — [ONNX Runtime quantization docs](https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html)
- Sentence Transformers supports three backends: PyTorch, ONNX and OpenVINO (Intel-oriented). In its CPU benchmark (text; figures only in a chart image), OpenVINO INT8 was fastest on a local i7-13700K, llama.cpp led on Hugging Face Jobs `cpu-upgrade` instances, and the various ONNX int8 configs (arm64/avx2/avx512/avx512_vnni) gave roughly equivalent speedups; quality is measured as a ratio to PyTorch FP32 on STS + NanoBEIR. CPU recommendation flowchart: small accuracy loss acceptable → `openvino-qint8`; otherwise Intel CPU → `openvino`; non-Intel → `onnx`; benchmark on your own hardware because rankings differed between machines. — [SBERT efficiency docs](https://sbert.net/docs/sentence_transformer/usage/efficiency.html)
- Example of real-world gain: the ONNX int8 version of roberta-base-go_emotions is ~75% smaller than fp32 and described as faster, especially at small batch sizes. — [SamLowe/roberta-base-go_emotions card](https://huggingface.co/SamLowe/roberta-base-go_emotions)

### Inferences
- Recommended default: fine-tune ModernBERT-base (English) or mmBERT-small/base (multilingual) for message-level labels; export to ONNX + dynamic int8 for shipping. DeBERTa-v3-base is a safe, well-understood alternative (MIT) if ModernBERT tooling is an issue.
- For a feature-extraction tier that must be tiny, all-MiniLM-L6-v2 or bge-small-en-v1.5 (both permissively licensed, ONNX available, ~23-33M params → roughly 90-130 MB fp32, ~25-35 MB int8 by the 4-bytes/param rule of thumb) is the best fit. Avoid EmbeddingGemma in a redistributed bundle unless you are willing to carry Gemma Terms pass-through obligations.
- Parameter-count-based download estimates: ModernBERT-base ~600 MB fp32 / ~150 MB int8; mmBERT-base (307M) ~1.2 GB fp32 / ~300 MB int8 (vocabulary-heavy) — these are arithmetic estimates, not measured file sizes.

### Gaps
- No primary source opened gave absolute CPU latency numbers (ms/message) or numeric speedup ratios for any of these encoders (SBERT CPU figures are only in a chart image). Must benchmark on target hardware.
- mDeBERTa-v3 and GTE (gte-small/gte-multilingual) model cards were not opened; licenses not verified here.
- mmBERT-small (140M total per search results) card not opened; an OpenVINO int8 community export of mmBERT-base (stellars/mmBERT-base-openvino-int8) appeared only in search results. Search results also cited the mmBERT GitHub README as requiring transformers>=4.48.0, conflicting with the card's >=4.21.0 — unverified.

## 2. Off-the-shelf feature extractors (emotion, sentiment, toxicity, empathy, politeness) and open lexicons as LIWC alternatives

### Takeaway
Usable permissively licensed extractors exist for emotion (SamLowe go_emotions, MIT, 28 labels, ONNX int8 available), sentiment (VADER, MIT) and toxicity (Detoxify, Apache-2.0, incl. multilingual XLM-R variant). j-hartmann's popular emotion model has no stated license (flag). NRC EmoLex is free only for non-commercial research (commercial license required — flag), LIWC-22 is commercial (flag); Empath (MIT) is the open LIWC-like option. Language Style Matching can be computed from open function-word lists using the Ireland et al. per-category formula.

### Cited Findings
**Emotion**
- SamLowe/roberta-base-go_emotions: MIT; 28 multi-label emotions (threshold ~0.5); roberta-base fine-tuned 3 epochs on GoEmotions (Reddit); at 0.5 threshold accuracy 0.474, F1 0.450; with per-label optimized thresholds macro F1 0.541, weighted F1 0.611; per-label variance huge (gratitude F1 0.919, relief/pride 0.000 at 0.5); ONNX and INT8 ONNX versions available (−75% size). Author notes labeling errors/ambiguity in GoEmotions. — [SamLowe/roberta-base-go_emotions](https://huggingface.co/SamLowe/roberta-base-go_emotions)
- j-hartmann/emotion-english-distilroberta-base: 7 classes (Ekman 6 + neutral); DistilRoBERTa-base trained on a balanced ~20k subset from 6 datasets (Crowdflower, Emotion Dataset, GoEmotions, ISEAR, MELD, SemEval-2018); 66% eval accuracy vs ~14% chance; larger `emotion-english-roberta-large` exists. **LICENSE FLAG: the page does not state a license** — redistribution rights unclear. — [j-hartmann emotion card](https://huggingface.co/j-hartmann/emotion-english-distilroberta-base)

**Toxicity**
- Detoxify (Unitary): Apache-2.0. `original` = bert-base-uncased on Jigsaw 2018 (mean AUC 98.64); `unbiased` = roberta-base on Civil Comments 2019 (bias metric 93.74; includes identity labels); `multilingual` = xlm-roberta-base (EN, FR, ES, IT, PT, TR, RU; AUC 92.11); small ALBERT variants `original-small`/`unbiased-small`. Caveat: swearing/insults flagged toxic regardless of humor/self-deprecation, may bias against vulnerable groups; intended for research/moderation assistance. ONNX not mentioned. — [Detoxify GitHub](https://github.com/unitaryai/detoxify)

**Sentiment / lexicons**
- VADER: MIT; outputs `compound` (−1..+1, typical thresholds ±0.05) plus pos/neu/neg proportions (which ignore negation/degree rules); tuned for social-media text incl. emoticons/slang; English-only; ~7,500 validated lexical features. — [vaderSentiment GitHub](https://github.com/cjhutto/vaderSentiment)
- NRC Emotion Lexicon (EmoLex): 14,182 English words; 8 emotions (anger, fear, anticipation, trust, surprise, sadness, joy, disgust) + positive/negative; machine translations into 108 languages (Aug 2022, may be inaccurate). **LICENSE FLAG: free only for "non-commercial research and educational purposes"; commercial use requires a license from Dr. Saif Mohammad (licensed to companies "for a small fee").** — [NRC EmoLex page](https://saifmohammad.com/WebPages/NRC-Emotion-Lexicon.htm)
- Empath: MIT; LIWC-like lexical categories; custom categories generated from word-embedding models (fiction, nytimes, reddit) via cosine similarity; maintenance status unclear (36 commits). — [empath-client GitHub](https://github.com/Ejhfast/empath-client)
- **LICENSE FLAG — LIWC-22:** academic license only for purely academic research/education in universities and "cannot be used for research being conducted for, on behalf of, or in conjunction with any commercial entity"; everyone else needs a commercial license via Receptiviti; redistribution/embedding of the dictionary not addressed on the purchase page (see EULA). — [LIWC buy page](https://www.liwc.app/buy)

**Politeness**
- ConvoKit `PolitenessStrategies` computes politeness-strategy features from three collections: `politeness_api` (Danescu-Niculescu-Mizil et al., "A computational approach to politeness…"), `politeness_local`, and `politeness_cscw_zh` (Chinese). License not stated on the docs page. — [ConvoKit politeness docs](https://convokit.cornell.edu/documentation/politenessStrategies.html)

**Language Style Matching (LSM)**
- LSM (Ireland et al., with Pennebaker) is computed per function-word category from each speaker's category percentage (category count / total words); per-category score compares the two speakers' percentages with 0.0001 added to the denominator to avoid empty sets; nine category scores are averaged into a composite bounded 0–1 (higher = more similar). — [Language Log summary of Ireland et al.](https://languagelog.ldc.upenn.edu/nll/?p=3164)

### Inferences
- Safe-to-ship "feature extractor" set for a commercial/redistributed app: SamLowe go_emotions (ONNX int8), Detoxify (Apache-2.0; ideally export to ONNX yourself), VADER, Empath, plus self-built function-word lists for LSM. Avoid bundling NRC EmoLex, LIWC dictionaries, or j-hartmann weights without obtaining explicit rights.
- LSM needs only per-speaker function-word category percentages, so it can be built on an open function-word list rather than the proprietary LIWC dictionaries; the exact nine categories should be taken from the primary paper (see Gaps).
- go_emotions/Detoxify are trained on Reddit/Wikipedia/Civil Comments, not intimate 1:1 chat — domain shift is expected; report per-label reliability and avoid presenting low-F1 labels (e.g., relief, pride) as findings.

### Gaps
- No empathy classifier was verified: search found only small community checkpoints (e.g., RyanDDD/empathy-mental-health-reddit-ER, dhyann2815/roberta-empathy-classifier) whose cards were not opened; licenses and quality unknown. Treat empathy as a fine-tune-it-yourself task.
- Exact nine LSM category list and verbatim formula not extracted: the Language Log page shows them only as images; the Ireland et al. 2011 PDF (https://sites.socsci.uci.edu/~lpearl/courses/readings/IrelandEtAl2011_RelationshipPrediction.pdf) downloaded but text could not be extracted here; the Springer methods paper (10.3758/s13428-018-1078-8) redirected to a login. The commonly quoted form LSM_c = 1 − |p1 − p2| / (p1 + p2 + 0.0001) is consistent with the Language Log description but is NOT verbatim-verified.
- ConvoKit license and spaCy dependency not confirmed from the opened page.

## 3. Local LLMs for the optional agent, licenses, runtimes, structured output / tool calling

### Takeaway
As of Nov 2026 the most permissively licensed laptop-class options with native tool calling are Qwen3.5 (0.8B/2B/4B/9B, Apache-2.0, 256K ctx), Gemma 4 E2B/E4B (Apache-2.0 — unlike Gemma 1-3), Ministral 3 8B (Apache-2.0) and Phi-4-mini (3.8B, MIT). Llama 4 carries attribution/naming/AUP/700M-MAU conditions (flag). Ollama and llama.cpp both support JSON-schema-constrained output and tool calling; LM Studio is an MCP host.

### Cited Findings
**Models**
- Qwen3.5-2B: Apache-2.0; 262,144-token native context; tool calling supported (vLLM/SGLang `qwen3_coder` parser); thinking + non-thinking modes (2B defaults to non-thinking; thinking mode more prone to loops); multimodal (image/video); runtimes listed: vLLM, SGLang, KTransformers, Transformers, with quantized builds for llama.cpp, Ollama, LM Studio; citation dated February 2026. — [Qwen3.5-2B card](https://huggingface.co/Qwen/Qwen3.5-2B)
- Ollama `qwen3.5` tags (tools, thinking, vision; 256K ctx): 0.8b 1.2–1.3 GB, 2b 2.7–3.1 GB, 4b 3.3–4.0 GB, 9b 6.6–7.6 GB (=latest), 27b 17–20 GB, 35b 22 GB, 122b 81 GB; MLX variants also offered (e.g., 4b-mlx 4.0 GB). — [Ollama qwen3.5](https://ollama.com/library/qwen3.5)
- Gemma 4 E4B-it: **Apache 2.0**; 4.5B effective params / 8B including per-layer embeddings; 128K context (small models); native function calling; 140+ pretraining languages, 35+ supported; family also lists E2B, 12B, 26B A4B (MoE), 31B Dense. — [gemma-4-E4B-it card](https://huggingface.co/google/gemma-4-E4B-it)
- Gemma Terms page explicitly points Gemma 4 to a separate "Gemma 4 license" (Gemma 4 not in the Gemma Terms appendix), i.e., Gemma 1–3/EmbeddingGemma remain under Gemma Terms while Gemma 4 is Apache 2.0. — [Gemma Terms of Use](https://gemma.ai/resources/terms/)
- Ollama `gemma4` tags (vision, tools, thinking; audio on E2B/E4B): e2b 4.6–7.5 GB, e4b 6.6–9.5 GB (=latest), 12b 7.7–8.0 GB, 26b 16–19 GB (MoE, "4B active"), 31b 19–20 GB; MLX variants. — [Ollama gemma4](https://ollama.com/library/gemma4)
- Ministral 3 8B: Apache 2.0; released 2025-12-02; 256k context; function calling and structured outputs supported; Instruct, Reasoning and Base variants; vision input. — [Mistral docs: Ministral 3 8B](https://docs.mistral.ai/models/ministral-3-8b-25-12.md)
- Phi-4-mini-instruct: 3.8B params; MIT; 128K context; function calling via tools JSON in system prompt between `<|tool|>` tokens (card warns it sometimes hallucinates function names/URLs); 23 listed languages; released February 2025. — [phi-4-mini-instruct card](https://huggingface.co/microsoft/phi-4-mini-instruct)
- **LICENSE FLAG — Llama 4 Community License:** entities with >700M MAU must request a license; distributors must "prominently display 'Built with Llama'", include a copy of the Agreement and a Notice file; any distributed model created/fine-tuned with Llama Materials must include "Llama" at the beginning of its name; use must follow the Acceptable Use Policy. — [Llama 4 license](https://dev.meta.ai/llama/llama4/license/)

**Runtimes, structured output, tool calling**
- Ollama structured outputs: `format` param accepts `"json"` or a JSON schema (Pydantic `model_json_schema()` / Zod `z.toJSONSchema`); also via OpenAI-compatible `response_format`; Ollama cloud does not support structured outputs; docs advise putting the schema in the prompt and validating in code. — [Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs)
- Ollama tool calling: tools (name, description, JSON schema) passed to `/api/chat`; model returns `tool_calls`; supports parallel tool calls, agent loops, streaming (accumulate thinking/content/tool_calls); Python SDK can take plain functions as tools. The page does not mention MCP. — [Ollama tool calling](https://docs.ollama.com/capabilities/tool-calling)
- llama.cpp: GBNF grammars; subset of JSON Schema converted to GBNF (`json_schema` on completion endpoints, `response_format` on `/chat/completions`); unsupported schema features are skipped silently (e.g., `prefixItems`, nested `$ref`, `patternProperties`, mixing `properties` with `anyOf/oneOf`; `uniqueItems`, `not`, conditionals unlikely to be added); additionalProperties false by default. — [llama.cpp grammars README](https://github.com/ggml-org/llama.cpp/blob/master/grammars/README.md)
- LM Studio is an MCP Host since 0.3.17, supports local and remote MCP servers via Cursor-style `mcp.json`; warns never to install servers from untrusted sources and that cloud-oriented servers can overflow small local model contexts. — [LM Studio MCP docs](https://lmstudio.ai/docs/app/mcp)

### Inferences
- Laptop default for the optional agent: Qwen3.5-4B (~3.3–4 GB download) or Gemma 4 E4B (~6.6+ GB in Ollama). UNSOURCED rule of thumb (no opened page gave RAM requirements): RAM needed ≈ download size + 1–2 GB for context, so 8 GB machines → Qwen3.5-2B or Phi-4-mini; 16 GB → Qwen3.5-9B / Ministral 3 8B. All four families are Apache-2.0/MIT, so they can be redistributed/downloaded by the app without Llama/Gemma-Terms obligations.
- Because the analytic results come from the ML tools, the LLM's job is orchestration + explanation; small models' tool-name hallucination (noted for Phi-4-mini) argues for a short, strict tool list and schema-constrained output (Ollama `format` / llama.cpp `json_schema`), with server-side validation.
- MLX is available through Ollama's `-mlx` tags for Apple Silicon (per Ollama library listings).

### Gaps
- vLLM not researched (server-GPU oriented; not suited to consumer laptops anyway).
- Llama 3.x license page and Llama 4 model sizes not opened; no laptop-class Llama 4 checkpoint verified.
- Qwen3.5 0.8B/4B/9B license verified only via the 2B card (Ollama page states no license); Gemma 4 license file text not opened directly (license taken from the E4B card).
- Ministral 3 3B and 14B (reported in search results as part of the same Apache-2.0 family) — pages not opened.
- Gemma 4 size conflict, unresolved: Google's launch blog (seen only in search results) reportedly describes "four sizes" (E2B, E4B, 26B MoE with 3.8B active, 31B), while the opened HF card and Ollama page also list a 12B, and Ollama says "4B active" for the 26B.
- No opened page gave RAM/VRAM requirements for any of these LLMs.
- No independent quality benchmarks for tool-calling reliability of these small models were consulted.

## 4. MCP: spec status, SDKs, exposing ML models as tools, transports, clients, security

### Takeaway
The current MCP spec revision is **2026-07-28**, which made the protocol stateless (no `initialize` session, no `Mcp-Session-Id`, no server-initiated JSON-RPC requests; sampling/elicitation now via Multi Round-Trip Requests). Transports are stdio and Streamable HTTP. Official Tier-1 SDKs exist for TypeScript, Python, C#, Go, Rust, Ruby; the released Python SDK line is v2 (`mcp` 2.3.0, Oct 2026), whose documented API is `MCPServer` + `@mcp.tool()` (what happened to the v1 `FastMCP` class and which spec revisions v2 speaks were not confirmed). For a local app, stdio is the recommended transport; if HTTP is used, bind to 127.0.0.1, validate `Origin`, and require a token. Claude Desktop installs one-click `.mcpb` bundles (including uv-managed Python servers).

### Cited Findings
**Spec status**
- The spec's authoritative schema is `schema/2026-07-28/schema.ts`; base protocol is JSON-RPC 2.0 with "stateless, self-contained requests" and per-request capability negotiation; server features: Resources, Prompts, Tools; client feature: Elicitation; optional extensions include Tasks (async long-running ops), Skills over MCP, and MCP Apps (inline interactive UI). — [MCP Specification (latest)](https://modelcontextprotocol.io/specification/latest)
- Spec security principles: user consent and control, data privacy (hosts must get consent before exposing user data to servers), tool safety (tools = arbitrary code execution; tool annotations untrusted unless from trusted server; hosts must obtain consent before invoking tools). — [MCP Specification (latest)](https://modelcontextprotocol.io/specification/latest)
- Transports: stdio (newline-delimited JSON-RPC over a client-launched subprocess) and Streamable HTTP (each message is an HTTP POST; reply is JSON or a request-scoped SSE stream). All metadata (protocol version, client capabilities) travels in each request's `_meta`. Earlier revisions used an `initialize` handshake and server-initiated requests; clients/servers fall back for older counterparts. — [MCP transports 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports)
- Streamable HTTP in 2026-07-28: GET stream endpoint and protocol-level sessions removed; sampling/elicitation/roots embedded in results as `InputRequiredResult` (MRTR, SEP-2322); long-lived notifications via `subscriptions/listen`; required headers `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name`; resumable SSE (`Last-Event-ID`) not supported; legacy HTTP+SSE (2024-11-05) deprecated. — [Streamable HTTP 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- Streamable HTTP security MUST/SHOULD: servers MUST validate `Origin` on all connections (403 if invalid) to prevent DNS rebinding; when local SHOULD bind only to 127.0.0.1 not 0.0.0.0; SHOULD implement authentication. — [Streamable HTTP 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)

**SDKs**
- Official SDKs: TypeScript, Python, C#, Go, Rust, Ruby (Tier 1); Java (Tier 2); Swift, PHP, Kotlin (Tier 3). SDKs adopt new protocol revisions on their own schedules. — [MCP SDKs page](https://modelcontextprotocol.io/docs/sdk)
- Python SDK on PyPI: `mcp` 2.3.0 released 2026-10-02; 2.0.0 released 2026-07-28 (after alpha/beta/rc builds), i.e., v2 is the released line; PyPI requires Python ≥3.10 (classifiers 3.10–3.14); PyPI page does not mention the `FastMCP` class or list supported protocol revisions. — [PyPI: mcp](https://pypi.org/project/mcp/)
- Python SDK README (MIT; README states Python ≥3.11 — conflicts with PyPI's ≥3.10): `from mcp.server import MCPServer`; `@mcp.tool()` with type hints as schema and docstring as description; structured tool results (`result.structured_content`); supports stdio, Streamable HTTP and SSE; `uv run mcp dev server.py` opens MCP Inspector. The README does not mention the standalone FastMCP project. — [modelcontextprotocol/python-sdk](https://github.com/modelcontextprotocol/python-sdk)

**Clients**
- MCP site names Claude, ChatGPT, VS Code (Copilot), Cursor and MCPJam among supporting clients. — [MCP intro](https://modelcontextprotocol.io/clients)
- Claude Code: `claude mcp add [options] <name> -- <command> [args...]` for stdio servers (e.g., `claude mcp add --transport stdio myserver -- python server.py`); transports stdio, http (recommended for remote), sse (deprecated), ws only via `.mcp.json`; scopes local (default, `~/.claude.json`), project (`.mcp.json`, shareable via git, requires user approval in interactive sessions), user; sets `CLAUDE_PROJECT_DIR` in server env; on Windows stops servers by closing stdin then killing the process tree after 300 ms; warns servers fetching external content can expose users to prompt injection. — [Claude Code MCP docs](https://code.claude.com/docs/en/mcp)
- LM Studio (local-model host) supports MCP since 0.3.17. — [LM Studio MCP docs](https://lmstudio.ai/docs/app/mcp)
- Ollama's tool-calling docs do not mention MCP (Ollama itself is not documented as an MCP host; an Ollama-backed agent needs its own MCP client loop or a host like LM Studio). — [Ollama tool calling](https://docs.ollama.com/capabilities/tool-calling)
- MCPB (MCP Bundles, formerly DXT): zip with local server + `manifest.json` for one-click install in Claude for macOS and Windows; CLI `@anthropic-ai/mcpb` (`mcpb init`, `mcpb pack`); Python servers can use `server.type = "uv"` with `pyproject.toml` so the host manages Python and deps (v0.4+), or bundle deps in `server/lib` (compiled deps like pydantic not portable), or ship static binaries; Apache-2.0 (new) / MIT (existing code). — [modelcontextprotocol/mcpb](https://github.com/modelcontextprotocol/mcpb)

**Security for local servers (official best-practices page)**
- "Local MCP Server Compromise": risks include malicious startup commands in client config, malicious payloads, and DNS-rebinding access to an insecure localhost server. Clients with one-click install MUST show the exact command and get explicit consent; SHOULD sandbox. Server developers SHOULD use stdio to limit access to just the MCP client, or if HTTP, require an authorization token or use Unix domain sockets/IPC with restricted access. — [MCP Security Best Practices](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices)
- Stateless MCP: servers needing cross-request state mint explicit handles; MUST NOT treat a handle as authentication; SHOULD use secure random, expiring handles bound to the authenticated user. Dynamic Client Registration deprecated as of 2026-07-28. — [MCP Security Best Practices](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices)

### Inferences
- Architecture: one Python MCP server (official SDK `MCPServer`) exposing coarse, typed tools such as `analyze_conversation(file_ref) -> {emotions, toxicity, lsm, ...}`, `score_questionnaire(responses) -> {scores, CIs}`, returning structured content with explicit uncertainty fields; keep heavy models loaded once at process start (ONNX Runtime sessions). Use stdio for Claude Desktop/Code/LM Studio; only add Streamable HTTP (127.0.0.1 + Origin check + bearer token) if the desktop app's own UI needs to call the same server.
- Because 2026-07-28 removed sessions, any "uploaded chat" state should be referenced by an unguessable handle or by local file path supplied per call — never a sequential ID.
- Privacy: tool results flow into whatever LLM the client uses (possibly a cloud API); the app should let users choose a local LLM path and should return aggregated features rather than raw message text where possible.
- Distribution to Claude Desktop users: ship an `.mcpb` with `server.type = "uv"`; for other hosts, document the `mcp.json` stanza.
- SDK revision support lags the spec ("own schedules") — pin SDK version and test against target clients, some of which may still speak 2025-11-25.

### Gaps
- No authoritative per-client feature matrix (tools/resources/prompts/elicitation support per client) was found on the opened pages.
- Standalone FastMCP (jlowin/PrefectHQ) project page and the Python SDK v2 migration guide were not opened; whether the v1 `FastMCP` class was renamed to `MCPServer`, deprecated or kept is unconfirmed, as is which spec revisions (2025-11-25 vs 2026-07-28) SDK v2 implements.
- Sampling status unresolved: the 2026-07-28 spec overview lists only Elicitation as a client feature, while the Streamable HTTP page still refers to sampling, elicitation and roots as server-to-client interactions carried via MRTR. Do not design around sampling without checking the client-features page.
- Claude Code's "MCP output limits and warnings" section (tool-result size limits) was beyond the portion read.
- TypeScript SDK README and Claude Desktop config docs not opened (only the mcpb repo).

## 5. Classical models for questionnaire data and honest uncertainty (calibration, conformal, IRT)

### Takeaway
Use logistic regression / LightGBM (MIT) for questionnaire-based predictions, calibrate with scikit-learn `CalibratedClassifierCV` (sigmoid for <~1000 samples, isotonic above; temperature for multiclass), report conformal prediction sets via MAPIE (BSD-3), and score psychometric scales with IRT (girth, MIT: Rasch/2PL/GRM/partial-credit with EAP ability estimates).

### Cited Findings
- scikit-learn 1.9.1 `CalibratedClassifierCV`: methods `"sigmoid"` (Platt; good for small samples, preserves ranking), `"isotonic"` (non-parametric; overfits small data; docs: as good or better than sigmoid "when there is enough data (greater than ~1000 samples)"), and `"temperature"` (multiclass, single parameter, preserves argmax). Pre-fit models wrapped with `FrozenEstimator`; calibration data must be disjoint from training data; evaluate with reliability diagrams (`CalibrationDisplay`), Brier score and log loss (note: lower Brier ≠ necessarily better calibration). LogisticRegression is often well calibrated if well specified; random forests show sigmoid-shaped miscalibration. — [scikit-learn calibration guide](https://scikit-learn.org/stable/modules/calibration.html)
- MAPIE: BSD-3-Clause; prediction intervals/sets for regression, classification, time series, plus risk control (multi-label etc.); "MAPIE v1 is live" (2025); 2026 features include exchangeability tests and adaptive conformal methods; requires Python ≥3.10, scikit-learn ≥1.4; guarantees under "minimal assumptions" (exchangeability implied). — [MAPIE GitHub](https://github.com/scikit-learn-contrib/MAPIE)
- LightGBM: MIT; Python package `lightgbm`; ONNX conversion only via unofficial ONNXMLTools (not endorsed by the LightGBM team). — [LightGBM GitHub](https://github.com/microsoft/LightGBM)
- girth: MIT; Rasch, 1PL, 2PL (incl. multidimensional), 3PL (minimal), Graded Response Model (JML, MML, mixed EAP/MML; multidimensional GRM), Partial Credit, Graded Unfolding; ability estimation MLE/MAP/EAP (EAP for polytomous); Bayesian MCMC/VI in separate `girth_mcmc`; recent maintenance activity not confirmed. — [girth GitHub](https://github.com/eribean/girth)

### Inferences
- For validated relationship scales (Likert items), classical sum/mean scoring with published norms is the honest default; IRT/GRM (girth) adds per-person standard errors (EAP posterior SD) that can be shown as score intervals — valuable for "report uncertainty honestly".
- With small labeled datasets typical for relationship outcomes, prefer logistic regression (often well calibrated out of the box per scikit-learn) + sigmoid calibration; per scikit-learn, isotonic calibration only becomes competitive above ~1000 calibration samples. (Choosing gradient boosting over logistic regression is a separate, data-size-dependent judgment not covered by that threshold.) Report conformal prediction sets (e.g., "{stable, uncertain}") instead of single labels; note that conformal coverage assumes exchangeability between calibration data and the user's data — likely violated for a single user's chat, so label as approximate.
- Shipping: logistic regression coefficients and LightGBM text models are tiny (KB–MB); sklearn models can stay in Python rather than ONNX.

### Gaps
- XGBoost repo/license not opened.
- py-irt (Bayesian IRT on Pyro/PyTorch) and `mirt` (Python port modeled on R's mirt, lists GRM) appeared only in search results; not verified.
- No source opened on Bayesian scoring of specific relationship scales or norms; scale licensing (many questionnaires are copyrighted) is outside this scope and should be checked by the data/questionnaire researcher.

## 6. Packaging for distribution (desktop app + Python sidecar, ONNX Runtime, size budget)

### Takeaway
Two practical routes: (a) a Tauri 2 (or Electron) app that launches a PyInstaller-built Python sidecar declared in `externalBin` and talks to it over stdio; (b) an `.mcpb` bundle with `server.type = "uv"` for Claude Desktop users, where the host manages Python and dependencies. Use ONNX Runtime with dynamic int8 for transformer models to keep the encoder tier in the low hundreds of MB; download the optional LLM (1–8 GB) separately on demand via Ollama/LM Studio.

### Cited Findings
- Tauri 2 sidecar: declare `bundle.externalBin` in `tauri.conf.json`; binary must carry a `-$TARGET_TRIPLE` suffix (`rustc --print host-tuple`); requires `tauri-plugin-shell`; spawn from Rust `app.shell().sidecar("name").spawn()` (stdout events, stdin writes) or from JS `Command.sidecar(...)` with `shell:allow-execute`/`shell:allow-spawn` capability entries and an argument allowlist/validator regex; docs cite bundling Python apps with PyInstaller as a common use case (no step-by-step). — [Tauri 2 sidecar docs](https://v2.tauri.app/develop/sidecar/)
- MCPB bundles for Claude Desktop (macOS/Windows): uv-type Python servers let the host manage Python/deps; traditional bundling can't portably include compiled deps; static binaries also supported. — [modelcontextprotocol/mcpb](https://github.com/modelcontextprotocol/mcpb)
- ONNX Runtime: dynamic int8 recommended for transformers; CPU EP supports U8U8/U8S8/S8S8; gains hardware-dependent. — [ONNX Runtime quantization](https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html)
- Concrete size data points: go_emotions INT8 ONNX ≈ 25% of fp32 size ([SamLowe card](https://huggingface.co/SamLowe/roberta-base-go_emotions)); Ollama LLM downloads: qwen3.5:2b 2.7–3.1 GB, qwen3.5:4b 3.3–4.0 GB, gemma4:e4b 6.6–9.5 GB ([Ollama qwen3.5](https://ollama.com/library/qwen3.5), [Ollama gemma4](https://ollama.com/library/gemma4)).

### Inferences
- Suggested size budget: core installer (app + Python runtime + ONNX Runtime + 3–4 int8 encoders: MiniLM/bge-small ~25–35 MB, go_emotions roberta-base int8 ~125 MB, Detoxify-multilingual XLM-R int8 ~280 MB est., fine-tuned ModernBERT int8 ~150 MB est.) ≈ 0.5–1 GB; LLM as an optional, separately downloaded 2–4 GB component (Qwen3.5-2B/4B). Estimates use ~1 byte/param for int8 and are not measured.
- Prefer ONNX Runtime over PyTorch in the shipped sidecar: avoids bundling torch (typically hundreds of MB to GBs) — keep torch only in the training pipeline.
- One sidecar binary can serve both the desktop UI and external MCP clients, but under stdio each host (Tauri UI, Claude Desktop, Claude Code, LM Studio) spawns its OWN process, so models are loaded separately per process (multiplying RAM use when several hosts are open). Options: (a) accept this — stdio needs no open port and matches MCP security guidance; or (b) run one long-lived server on Streamable HTTP bound to 127.0.0.1 with Origin validation and a bearer token, so all hosts share one loaded model set (see section 4). For a privacy-sensitive app, (a) is the simpler default.
- Code-signing/notarization of the sidecar binary on macOS/Windows will be needed for distribution (not researched here).

### Gaps
- PyInstaller, Electron, and uv documentation pages were not opened; no verified figures on PyInstaller bundle sizes for onnxruntime/tokenizers.
- No measured size for a minimal Python + ONNX Runtime + tokenizers sidecar.
- Code-signing, auto-update, and model-download integrity (hash pinning) not researched.
