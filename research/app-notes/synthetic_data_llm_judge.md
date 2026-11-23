# Synthetic conversation data with LLMs and validation with LLM-as-a-judge, for a relationship-analysis model

Scope note: "opened" means the arXiv abstract page or the full HTML/licence page was fetched in this session. Where only the abstract was opened, these notes say so, and they don't report numbers the abstract lacks. Items seen only in search-result snippets are marked "(search snippet only, not verified)".

## Q1. Synthetic social dialogue generation methods and what worked

### Takeaway
The approaches that worked best share one pattern. They ground each dialogue in an explicit structured seed (a commonsense triple, a persona/intake form, or a scenario with private goals), generate with a strong LLM, then filter heavily. SODA (1.5M dialogues) and CACTUS (31.6k counselling dialogues) both trained small models that beat baselines. The work closest to this domain (LLM-simulated dates: "Love First, Know Later") reached only modest real-world predictive accuracy on speed dating.

### Cited Findings
**SODA / COSMO (Kim et al., EMNLP 2023), full HTML opened**
- Pipeline ("CO3"): Atomic10x social-commonsense triples (xIntent, xWant, xReact, xAttr, xNeed) are turned into template sentences with common US names. GPT-3.5 (text-davinci-002) rewrites each one as a 2-3 sentence narrative, then infers the second speaker, then writes a multi-turn conversation grounded in the narrative. — [SODA, arXiv 2212.10465 (HTML)](https://arxiv.org/html/2212.10465)
- Scale: 1,486,896 conversations, more than 11M utterances, about 300M tokens, 7.6 turns per conversation on average. Lexical diversity (MTLD) 68.0, vs 63.0 DailyDialog, 43.6 PersonaChat, 64.2 BlendedSkillTalk. — [SODA HTML](https://arxiv.org/html/2212.10465)
- Filtering kept only about 68.9% of about 2.2M raw conversations:
  - bad speaker prefixes: 6.3% removed
  - fewer than 4 or more than 20 turns: 5.7%
  - more than two speakers: 11.3%
  - non-human speakers: 5.6%
  - Canary safety classifier: 4.3%
  - toxicity (Rewire API, threshold 0.5): about 1%
  - a GPT-3.5 commonsense check confirmed the head event in 95% of what remained, but only 66% contained the full triple
  — [SODA HTML](https://arxiv.org/html/2212.10465)
- Human evaluation (300 dialogues per dataset, head-to-head): SODA was preferred to DailyDialog and BlendedSkillTalk on all six criteria, except context dependence vs BlendedSkillTalk. Inter-annotator Krippendorff's alpha was only 0.25 ("fair"). — [SODA HTML](https://arxiv.org/html/2212.10465)
- Head-to-head wins for COSMO-3B (trained only on SODA) on DailyDialog:
  - vs BlenderBot-3B 72%, GODEL 86%, Koala-7B 71%, Vicuna-7B 58%
  - vs the original human ground-truth responses 55% (57% on naturalness, n=200)
  - but on BlendedSkillTalk, BlenderBot-3B (which was trained on it) beat COSMO 64% to 36%
  — [SODA HTML](https://arxiv.org/html/2212.10465)
- Limitations stated by the authors: two-party only; the dialogue types reflect GPT-3.5; using common names may misrepresent marginalised groups; no safety filter is perfect. — [SODA HTML](https://arxiv.org/html/2212.10465)

**SOTOPIA (Zhou et al., ICLR 2024), full HTML opened.** This is the closest template for "agents with hidden traits".
- GPT-4 generated 40 characters, each with name, age, occupation, pronouns, Big Five traits, moral values, Schwartz values, decision-making style, and both secret and public background. — [SOTOPIA HTML](https://arxiv.org/html/2310.11667v2)
- Relationship types: family, friend, romantic, acquaintance, stranger. A rule-based mechanism controls what each agent sees of the other's profile:
  - romantic, family and friend partners see everything except secrets
  - acquaintances see name, occupation, pronouns and public info
  - strangers see nothing
  — [SOTOPIA HTML](https://arxiv.org/html/2310.11667v2)
- 90 GPT-4-generated scenarios, each with a shared context, a private goal per agent and relationship constraints. The authors validated them by hand and removed about 10%. — [SOTOPIA HTML](https://arxiv.org/html/2310.11667v2)
- On SOTOPIA-hard, GPT-4 completes social goals at a significantly lower rate than humans. — [SOTOPIA abstract](https://arxiv.org/abs/2310.11667)

**CACTUS / Camel (Lee et al., EMNLP 2024 Findings), full HTML opened**
- Client seeds: personas, negative thoughts and thought patterns come from PatternReframe. GPT-3.5 fills out an intake form. Each client gets one of three attitudes toward counselling (positive, neutral or negative). — [CACTUS HTML](https://arxiv.org/html/2407.03103v2)
- Counsellor side: the counsellor picks the top 3 of 12 CBT techniques, GPT-3.5 writes a session plan, and GPT-4o generates the dialogue in "script mode". — [CACTUS HTML](https://arxiv.org/html/2407.03103v2)
- Scale: 31,577 dialogues and about 995,512 utterances, 16.6 turns on average. The paper also states 31,564 in another place, an internal inconsistency. A quality filter based on CTRS (the Cognitive Therapy Rating Scale) kept 86.31%. — [CACTUS HTML](https://arxiv.org/html/2407.03103v2)
- Camel-llama3 scores on 0-6 CTRS-based criteria vs Psych8k-llama3 and SmileChat-llama3:

  | Criterion | Camel-llama3 | Psych8k-llama3 | SmileChat-llama3 |
  |---|---|---|---|
  | Understanding | 4.42 | 3.96 | 3.97 |
  | Interpersonal effectiveness | 5.97 | 4.97 | 4.54 |
  | Collaboration | 4.81 | 3.69 | 3.54 |
  | Guided discovery | 4.40 | 2.90 | 2.35 |
  | Focus | 4.11 | 3.90 | 3.89 |
  | Strategy | 5.11 | 4.03 | 3.75 |

  However, in expert head-to-head comparison with Psych8k-llama3 the win rate was only 50%, and experts said neither model met professional standards. — [CACTUS HTML](https://arxiv.org/html/2407.03103v2)
- Realism problems the authors themselves report: AI clients state the provided information explicitly, use psychological jargon, and stay overly positive. Sessions are far shorter than real ones. — [CACTUS HTML](https://arxiv.org/html/2407.03103v2)

**SMILE (Qiu et al., EMNLP 2024 Findings), abstract only**
- ChatGPT rewrites public single-turn Q&A into multi-turn conversations: SMILECHAT, 55k dialogues.
- Diversity was analysed (lexical, semantic, topic), and a small real anonymised counselling set was collected for comparison.
- The MeChat model trained on it showed "significant improvements". The abstract gives no numbers.
— [SMILE abstract](https://arxiv.org/abs/2305.00450)

**PLACES (Chen et al., 2023), abstract only**
- Few-shot prompting with a small set of expert-written conversations generates a social conversation dataset. It was evaluated against human-collected conversations; the abstract gives no scores.
- Synthetic multi-party conversations were "rated more favorably across all measured dimensions" than excerpts from a human-collected multi-party dataset.
— [PLACES abstract](https://arxiv.org/abs/2302.03269)

**CAMEL (Li et al., NeurIPS 2023), abstract only**
- A "role-playing" framework with "inception prompting" that keeps two chat agents on task and generates conversational data for studying cooperation. The abstract does not describe the agent roles or failure modes (role flipping, loops); those are not verified here. — [CAMEL abstract](https://arxiv.org/abs/2303.17760)

**Persona Hub (Ge et al., 2024), abstract only**
- 1 billion personas "automatically curated from web data", used to diversify synthetic data. Labelled "work in progress"; the abstract discusses no risks. — [Persona Hub abstract](https://arxiv.org/abs/2406.20094)

**"Love First, Know Later" (Shang, Yan, Liu; NeurIPS 2025 workshop on LLM Persona Modeling, oral), full HTML opened**
- Setup: Gemini 2.5 Flash Lite generates personas, and Mistral-Nemo (temperature 0.6) simulates each person's behaviour. An LLM "world engine" generates topics and emotional transitions; in the divorce task it only describes external circumstances. A "love observer" LLM produces each partner's rating (r1, r2) and an external compatibility rating (r3). A linear combination of the three is fit to real match decisions. — [arXiv 2512.11844 HTML](https://arxiv.org/html/2512.11844v2); [NeurIPS listing](https://neurips.cc/virtual/2025/129956)
- Results on Columbia speed dating (8,378 dates, 552 participants):

  | Stage | LLM Love Observer F1 / AUC | Logistic regression F1 / AUC |
  |---|---|---|
  | Stage 1, pre-date information only | 0.67 / 0.60 | 0.66 / 0.61 |
  | Stage 2, adds during-date signals | 0.67 / 0.56 | 0.61 / 0.60 |

  — [arXiv 2512.11844 HTML](https://arxiv.org/html/2512.11844v2)
- Divorce prediction (170 couples, 54 Likert items): LLM observer F1 0.90 / AUC 0.92, vs logistic regression 0.95 / 1.00. — [arXiv 2512.11844 HTML](https://arxiv.org/html/2512.11844v2)
- Limitations stated by the authors: speed-dating performance is "modest overall". Without calibration the observer is "overly negative", fixed with 10 in-context examples. The convergence theorem rests on unverified assumptions. — [arXiv 2512.11844 HTML](https://arxiv.org/html/2512.11844v2)

**Related relationship work**
- Simulating relationship commitment with persona agents plus a "turning-point" Scene Master (exclusivity talks, conflict-and-repair, relocation). Validated on 71 couples with two-year follow-up; simulation-aware predictions beat a personas-only baseline. Only the abstract was opened, so there are no effect sizes. — [arXiv 2510.00414](https://arxiv.org/abs/2510.00414)
- On real speed-date conversations (964 dates), ChatGPT's predictions of dating success correlated r = 0.12-0.23 with outcomes: "relatively low", but on par with human judges for matching, and they added information beyond the daters' own predictions. Agreement with human observers was r = 0.21-0.35. — [Matz et al., arXiv 2407.10989](https://arxiv.org/abs/2407.10989)

### Inferences
- The strongest blueprint for this app is SOTOPIA-style agents (a trait sheet plus a secret per agent, with controlled visibility), combined with CACTUS-style attitude variants and SODA-style multi-stage filtering. The structured seed is the ground-truth label.
- Real attraction signal in text is weak: r ≈ 0.12-0.23 in Matz et al., and speed-dating AUC ≈ 0.56-0.61 in Love First Know Later. Expect a ceiling on real-data accuracy for "interest" prediction. Synthetic data with crisp, strongly expressed labels will likely make the problem look far easier than it is.

### Gaps
- Psych8k was not opened; it is known only through CACTUS's baseline table.
- The PLACES and SMILE numbers need the full papers.
- CAMEL's failure modes were not verified.

## Q2. Controlling latent variables during generation, and avoiding label leakage and stereotyping

### Takeaway
Control latent variables by sampling them first and conditioning each agent separately on its own hidden sheet. SOTOPIA's visibility rules and CACTUS's attitude assignment are concrete precedents. The main risks are (a) synthetic agents stating their hidden information outright (label leakage, seen in CACTUS) and (b) persona-conditioned LLMs producing stereotyped portrayals.

### Cited Findings
- SOTOPIA implements hidden traits through per-agent private goals and secrets, plus a rule-based visibility mechanism by relationship type. Romantic partners see everything except secrets. — [SOTOPIA HTML](https://arxiv.org/html/2310.11667v2)
- CACTUS assigns each client a discrete attitude (positive, neutral or negative) with behaviours drawn from prior literature. It still found that AI clients "state provided information explicitly" and use jargon, which is the form label leakage takes in dialogue. — [CACTUS HTML](https://arxiv.org/html/2407.03103v2)
- "Love First, Know Later" keeps the environment engine from speaking for either spouse, to separate scenario control from agent behaviour. — [arXiv 2512.11844 HTML](https://arxiv.org/html/2512.11844v2)
- Stereotyping: GPT-3.5 and GPT-4 personas show "higher rates of racial stereotypes than human-written portrayals". Words that distinguish marked groups reflect othering and exoticising, with tropes such as hypersexualisation of minoritised women. Detection method: compare the words in marked-group personas with those in unmarked default personas. — [Marked Personas, Cheng et al., ACL 2023](https://arxiv.org/abs/2305.18189)
- SODA's authors flag that using common US names may misrepresent marginalised groups. — [SODA HTML](https://arxiv.org/html/2212.10465)
- SOTOPIA's authors note that GPT-4 evaluation may carry social stereotypes. — [SOTOPIA HTML](https://arxiv.org/html/2310.11667v2)

### Inferences
- Recommended design:
  - Sample latent variables (interest 0-4, attachment style, conflict style, reciprocity) independently of demographics.
  - Give each agent only its own sheet.
  - Forbid naming the trait ("I have anxious attachment") through prompt rules plus a post-hoc leakage filter: a lexical or LLM check that the label word or close synonyms don't appear.
  - Check for label leakage by training a trivial bag-of-words baseline. If it scores near-perfectly, the labels are leaking through vocabulary.
- Run a Marked-Personas-style audit: compare word distributions across demographic attributes in the generated personas and chats. Also check that model predictions don't vary with demographic attributes when latent variables are held fixed.

### Gaps
- No opened paper directly measures label-leakage rates in persona-conditioned dialogue. This is an inference from CACTUS's qualitative observation.

## Q3. The realism gap: do models trained on synthetic dialogue transfer to real data?

### Takeaway
Transfer is good for objective tasks but degrades sharply for subjective, social and affective ones, which is exactly this use case. LLM dialogue stays detectably different from human dialogue, especially in affective tone. Synthetic data should be accumulated alongside real data, not substituted for it, to avoid collapse.

### Cited Findings
**Synthetic vs real data for classification (Li et al., EMNLP 2023), full HTML opened**
- Setup: classifiers trained on GPT-3.5-Turbo synthetic data vs real data.
- RoBERTa average gap, real minus zero-shot synthetic: 16.9 macro-F1 points. Real minus few-shot synthetic: 6.7 points.
- Few-shot generation (seeding with real examples) improves over zero-shot by about 10 F1 points.
- BERT zero-shot vs real on the six most subjective tasks: -27.4 macro-F1.
— [Li et al., arXiv 2310.07849 HTML](https://arxiv.org/html/2310.07849)
- The most subjective tasks show big gaps. Tweet emotions: BERT real 77.7 vs zero-shot 58.1 vs few-shot 64.6 F1. Sarcasm: 89.9 / 51.1 / 63.6. Reddit emotion: 93.7 / 72.7 / 81.9. Low-subjectivity tasks such as AG News show small gaps (95.3 / 89.3 / 91.5). — [Li et al. HTML](https://arxiv.org/html/2310.07849)
- Diversity ranks real > few-shot > zero-shot (Remote Clique, Chamfer distance). The diversity loss is significantly larger for high-subjectivity tasks (p < 0.01). Subjectivity at both task and instance level is negatively associated with synthetic-trained performance. — [Li et al. HTML](https://arxiv.org/html/2310.07849)

**Realism of simulated dialogue**
- 100,000 paired LLM-LLM and human-LLM dialogues from WildChat show "relatively low alignment between simulations and human interactions", with systematic divergence in style and content. Alignment is better when the human writes more like the LLM. — [Real or Robotic?, arXiv 2409.08330](https://arxiv.org/abs/2409.08330)
- Computational Turing test (nine open-weight LLMs, five calibration strategies including fine-tuning, stylistic prompting and retrieval; X, Bluesky and Reddit data):
  - outputs remain "clearly distinguishable from human text", most of all in affective tone and emotional expression
  - instruction-tuned models are less human-like than their base versions
  - scaling doesn't help
  - realism trades off against semantic fidelity
  — [arXiv 2511.04195 abstract](https://arxiv.org/abs/2511.04195). The 70-80% detection-accuracy figure is from a search snippet only, not verified.
- Collective Turing Test (search snippet only, not verified): LLM-generated Reddit threads were mistaken for human 39% of the time. — [arXiv 2511.08592](https://arxiv.org/html/2511.08592)
- LLM vs Switchboard phone transcripts (search snippet only, not verified): exaggerated alignment, odd use of coordination markers, unnatural openings and closings. — [PMC12401190](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12401190/)

**Model collapse**
- Training recursively on model outputs causes "model collapse": first the tails of the distribution are lost, then the model converges to something unlike the original. Search snippet and abstract level only; full text not opened. — [Shumailov et al., Nature 631, 2024](https://www.nature.com/articles/s41586-024-07566-y)
- Replacing real data with each generation's synthetic data leads to collapse. Accumulating synthetic data alongside the original real data avoids it, across model sizes, architectures and hyperparameters; in a linear model, test error stays bounded. — [Gerstgrasser et al., arXiv 2404.01413](https://arxiv.org/abs/2404.01413)
- Agreement with gold labels is low even on real data. ChatGPT reaches r = 0.12-0.23 against real speed-dating outcomes. — [arXiv 2407.10989](https://arxiv.org/abs/2407.10989)

### Inferences
- Romantic interest, attachment and conflict style are high-subjectivity, affect-heavy constructs. Li et al. suggest expecting double-digit F1 drops when transferring zero-shot synthetic data to real chats. Few-shot seeding with real (consented, anonymised) examples is the most evidence-backed mitigation.
- A real held-out test set is required. Synthetic-only validation will overstate accuracy.
- Track diversity metrics (MTLD as in SODA; Remote Clique and Chamfer as in Li et al.) and compare against a real reference set.

### Gaps
- No opened study measures synthetic-to-real transfer specifically for romantic or relationship-health classification.
- The full Nature text was not opened.

## Q4. LLM-as-a-judge: validity, known biases, rubric design, multi-judge panels, calibration

### Takeaway
Strong judges reach roughly human-level agreement on general chat preference (more than 80% for GPT-4). Agreement is task-dependent, though, and much weaker on nuanced social dimensions (SOTOPIA: Pearson r 0.22-0.71 by dimension). Known biases are position, verbosity, self-preference and favouring LLM-written text. Mitigations with evidence: swap positions, use panels of judges from different model families, use rubric and chain-of-thought form-filling, and validate against a small human-labelled set.

### Cited Findings
**Overall validity and bias catalogue**
- GPT-4 as judge reaches "over 80% agreement" with controlled and crowdsourced human preferences, the same level as human-human agreement. Identified biases: position, verbosity, self-enhancement, and limited reasoning. — [Zheng et al., MT-Bench / Chatbot Arena, arXiv 2306.05685](https://arxiv.org/abs/2306.05685)
- G-Eval uses chain-of-thought plus form-filling. With GPT-4 it reaches Spearman 0.514 with humans on summarisation. The authors warn that LLM evaluators may favour LLM-generated text. — [G-Eval, arXiv 2303.16634](https://arxiv.org/abs/2303.16634)

**Position bias**
- Reordering the candidates alone let Vicuna-13B "beat" ChatGPT on 66 of 80 queries under a ChatGPT judge. Proposed fixes:
  - Multiple Evidence Calibration (reasons before the score)
  - Balanced Position Calibration (average over both orders)
  - Human-in-the-Loop Calibration, triggered by a "balanced position diversity entropy"
  — [Wang et al., "LLMs are not Fair Evaluators", arXiv 2305.17926](https://arxiv.org/abs/2305.17926)

**Self-preference**
- LLM judges (GPT-4, Llama 2) recognise their own outputs with non-trivial accuracy and score them higher, even when humans rate quality as equal. The strength of self-preference correlates linearly with self-recognition ability. — [Panickssery et al., NeurIPS 2024, arXiv 2404.13076](https://arxiv.org/abs/2404.13076)
- A follow-up finds that much of the self-preference in stronger models tracks real quality, but harmful self-preference persists where the judge is wrong as a generator. Search snippet only, not verified. — [arXiv 2504.03846](https://arxiv.org/html/2504.03846v3)

**Task dependence**
- JUDGE-BENCH (20 human-annotated NLP datasets, 11 LLMs): reliability varies substantially by model, dataset, the property judged, the human judges' expertise, and whether the text is human- or model-written. Conclusion: "LLMs should be carefully validated against human judgments before being used as evaluators." — [Bavaresco et al., arXiv 2406.18403](https://arxiv.org/abs/2406.18403)

**Panels of judges**
- PoLL panel: Command R, Claude 3 Haiku and GPT-3.5.
- Cohen's κ with humans, PoLL vs GPT-4 alone: NQ 0.763 vs 0.627; TQA 0.906 vs 0.841; HotpotQA 0.867 vs 0.830.
- Rank correlation with the Chatbot Arena leaderboard: Pearson 0.917 vs 0.817.
- GPT-4 is prompt-sensitive: κ on NQ ranges from 0.518 to 0.725 across prompt variants.
- PoLL is about 7-8x cheaper.
— [Verga et al., "Replacing Judges with Juries", arXiv 2404.18796 HTML](https://arxiv.org/html/2404.18796v2)

**Social and therapy domains**
- SOTOPIA: GPT-4 judge vs human Pearson r by dimension (on model episodes):

  | Dimension | r |
  |---|---|
  | Goal completion | 0.71 |
  | Financial and material benefits | 0.62 |
  | Relationship | 0.56 |
  | Believability | 0.45 |
  | Social rules | 0.33 |
  | Knowledge | 0.33 |
  | Secret | 0.22 |

  On human episodes, Knowledge was not significant (0.19). GPT-4 tended to rate higher than humans. Human-human agreement was only moderate (Randolph κ = 0.503). Other models could not produce meaningful evaluations. — [SOTOPIA HTML](https://arxiv.org/html/2310.11667v2)
- CACTUS: correlation with expert ratings on 100 instances:
  - GPT-4o (G-Eval): Pearson 0.60 on general skills, 0.65 on CBT-specific skills
  - non-experts: 0.51 general, 0.09 CBT-specific
  - but GPT-4o's rank correlations on general skills were low (Spearman 0.19, Kendall 0.16)
  — [CACTUS HTML](https://arxiv.org/html/2407.03103v2)
- "Love First, Know Later": the LLM observer was systematically over-negative until calibrated with 10 in-context examples. — [arXiv 2512.11844 HTML](https://arxiv.org/html/2512.11844v2)

### Inferences
- For this app the judge has two jobs:
  1. Fidelity: does the chat actually express the sampled latent variable (e.g., interest = 4)? Treat this as a classification check. Report κ against a human-labelled calibration set of a few hundred chats.
  2. Realism and safety: is it natural, non-stereotyped and non-leaky?
- Use a 3-model panel from different families. Use a different family from the generator, to limit self-preference.
- Score each dimension separately with a rubric (G-Eval style). Randomise or swap order in any pairwise comparison.
- Expect judge-human agreement on subtle relational dimensions near SOTOPIA's Relationship and Believability levels (r ≈ 0.45-0.56), not MT-Bench's 80%.

### Gaps
- MT-Bench's exact mitigation results and G-Eval's dialogue-specific correlations were not in the opened abstracts.
- No opened study validates LLM judges specifically on romantic-interest or attachment-style labelling.

## Q5. Recommended pipeline patterns, with quantitative results

### Takeaway
The proven pattern is generate from structured seeds, then automatic filtering (rules, safety, an LLM fidelity check), then a human/expert spot check, then training a small model, then evaluation outside the training distribution. SODA, CACTUS and Love First Know Later each implement parts of it with numbers attached. Calibrating against real outcomes is the step that keeps the results honest.

### Cited Findings
- SODA: rule filters plus safety plus toxicity plus an LLM commonsense-consistency check kept about 68.9% of 2.2M dialogues. The resulting 3B model beat larger chatbots on an out-of-domain set (DailyDialog) and matched human gold responses 55% of the time. — [SODA HTML](https://arxiv.org/html/2212.10465)
- CACTUS: an LLM judge with a CTRS-based rubric was first validated against experts (r ≈ 0.60-0.65), then used both as a data filter (kept 86.31%) and as the benchmark (CounselingEval, 450 instances). The trained model beat other synthetic-data models on all six criteria, but experts rated it only 50% vs a baseline. — [CACTUS HTML](https://arxiv.org/html/2407.03103v2)
- Love First Know Later: simulation, then LLM observer ratings, then a linear model fit to real outcomes (Columbia speed-dating, divorce data). It reports F1/AUC against real labels and needed few-shot calibration of the observer. — [arXiv 2512.11844 HTML](https://arxiv.org/html/2512.11844v2)
- Few-shot seeding with real examples narrowed the synthetic-to-real gap from 16.9 to 6.7 macro-F1 (RoBERTa average). — [Li et al. HTML](https://arxiv.org/html/2310.07849)
- Keep real data in the training mix (accumulate rather than replace) to avoid collapse. — [Gerstgrasser et al.](https://arxiv.org/abs/2404.01413)
- Validate judges against humans before relying on them. — [JUDGE-BENCH](https://arxiv.org/abs/2406.18403)

### Inferences
- Suggested pipeline for the app:
  1. Sample latent variables plus personas, balanced and decoupled from demographics.
  2. Two-agent simulation, each agent with a private sheet, plus a scenario engine for potential vs established relationship stages (turning points as in arXiv 2510.00414).
  3. Rule filters (length, speaker count, label words) and a safety filter.
  4. A panel of judges checks label fidelity and realism; drop disagreements.
  5. Human spot check of about 200-500 chats to compute judge κ.
  6. Train a small classifier or regressor.
  7. Evaluate on real held-out data (e.g., consented user chats, or public speed-dating transcripts if available). Report the synthetic-to-real gap and run a bag-of-words leakage baseline.
- Questionnaire answers should be generated from the same latent sheet. Check consistency between chat and questionnaire as an extra fidelity filter.

### Gaps
- No single opened paper reports the full pipeline end to end with real held-out relationship data.

## Q6. Licensing and terms of service for using model outputs to train a distributed model

### Takeaway
Open-weight models mostly allow training on their outputs, but some add naming or attribution strings. Llama requires the "Llama" name prefix. Qwen's custom licence requires "Built with Qwen". Gemma treats a model trained on Gemma's synthetic outputs as a "Model Derivative" that carries its use restrictions with it. Apache-2.0 models (recent Mistral, reportedly Qwen3) are the cleanest. The OpenAI and Anthropic API terms bar using outputs or the services to build competing models; whether a niche relationship classifier counts as "competing" is a legal question to check.

### Cited Findings
- **Llama 3.3 Community License**
  - Using "any outputs or results of the Llama Materials to create, train, fine tune, or otherwise improve an AI model" that is distributed requires including "Llama" at the beginning of that model's name.
  - Distribution requires displaying "Built with Llama".
  - Services above 700M monthly active users need a separate licence.
  - The Acceptable Use Policy is incorporated.
  — [Llama 3.3 license](https://dev.meta.ai/llama/llama3_3/license)
- **Gemma Terms of Use**
  - "Model Derivatives" explicitly include models created through "methods based on the generation of synthetic data Outputs by Gemma for training that model", and distillation.
  - Outputs themselves are not derivatives, and "Google claims no rights in Outputs".
  - Distributing a derivative requires passing on the Section 3.2 use restrictions (the Prohibited Use Policy), giving recipients a copy of the terms, and including a Notice file.
  — [Gemma terms](https://gemma.ai/resources/terms/)
- **Qwen licence (Tongyi Qianwen, e.g., Qwen2.5-72B-Instruct)**
  - Using the Materials or their outputs to train or improve a model requires prominently displaying "Built with Qwen" or "Improved using Qwen" in the product documentation.
  - Commercial use above 100M monthly active users needs a licence from Alibaba Cloud.
  — [Qwen2.5-72B LICENSE](https://huggingface.co/Qwen/Qwen2.5-72B-Instruct/blob/main/LICENSE)
  - Qwen3 and the smaller Qwen2.5 models are reported to be Apache 2.0. Search snippet only, not verified: check each checkpoint's LICENSE. — [HF discussion](https://huggingface.co/Qwen/Qwen2.5-72B-Instruct/discussions/18)
- **Mistral**
  - The Mistral 3 family (Large 3, Ministral 3): "All models are released under the Apache 2.0 license." — [Mistral 3 announcement](https://mistral.ai/news/mistral-3)
  - Mistral Small 3 and 3.1 are Apache 2.0 per Mistral's pages (search snippet only). Some older models were under the Mistral Research License, which restricts commercial use (search snippet only). — [Mistral Small 3](https://mistral.ai/news/mistral-small-3/)
- **OpenAI terms of use**
  - You "own the Output", but you may not "Use Output to develop models that compete with OpenAI". — [OpenAI Terms of Use](https://openai.com/policies/row-terms-of-use/)
- **Anthropic**
  - Commercial terms: Customer "owns its Outputs", but may not "build a competing product or service, including to train competing AI models" without approval. — [Anthropic Commercial Terms](https://www.anthropic.com/legal/commercial-terms)
  - Consumer terms prohibit using the Services "to develop any products or services that compete with our Services, including to develop or train any artificial intelligence or machine learning algorithms or models". — [Anthropic Consumer Terms](https://www.anthropic.com/legal/consumer-terms)

### Inferences
- Lowest-friction choice for a distributed model: generate with Apache-2.0 open-weight models (Mistral 3; Qwen3 if its Apache licence is confirmed). If Llama is used, the distributed model's name must begin with "Llama". If Gemma is used, the trained model inherits Gemma's terms and restrictions.
- API-model outputs (OpenAI, Anthropic) are owned by the user but carry non-compete clauses. A small relationship classifier is arguably not a competing general model, but this is not settled; get legal review.
- Using API models only as judges, not generators, reduces but does not eliminate this concern.
- Note also that all of this is licence/ToS analysis, not legal advice.

### Gaps
- The exact text of the Mistral Research License, Qwen3's licence and Llama 4's licence was not opened.
- The Google Gemini API and OpenAI business terms were not checked.
