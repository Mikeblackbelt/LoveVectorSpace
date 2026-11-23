# Datasets for a distributable, locally-run relationship-analysis app (beyond DDRel, PRIDE, DialogRE, MPDD, SCRIPTS, SocialDial, SOTOPIA, CANDOR, Cornell Movie-Dialogs, SODA, CPED, Enron, NUS SMS, Stanford SpeedDate)

## Q1. Real romantic/dating conversations (dating chats, flirting, couples conflict/therapy, Reddit relationship corpora, data donation)

### Takeaway
No openly licensed corpus of *real* dating-app chats or couples' conflict transcripts turned up. Real couples-interaction corpora (couples therapy, Swiss couples conflict, cancer couples) appear only in papers, with no public release found. What is open falls into three groups: small Reddit-derived relationship-advice sets with unknown or unusable licenses, a tiny unlicensed "flirty or not" classifier set, and therapist Q&A (CounselChat). CounselChat carries an MIT license on its card and repo, but the text is scraped from a third-party website, and the repo describes itself as code. That gives it the same CAUTION rating as other permissively labelled sets built on third-party text.

### Cited Findings

Method note (applies to the whole file): every dataset below had its page, card, API metadata or LICENSE file opened during this session (2026-11-23). Hugging Face (HF) license values come from the HF Hub API `cardData.license` field and the dataset cards. GitHub license values come from the GitHub repo API and the raw LICENSE/README files. "License not stated" means no license was found on the opened page. "Not captured" means the field was not visible on what I opened. Nothing here is legal advice.

Ship-safety legend: **SAFE** = permissive or public-domain license, so commercial use and redistribution are allowed (attribution may be required). **CAUTION** = permissive label but there is a provenance, copyleft or terms problem. **NC/RESEARCH** = non-commercial or research-only, so it must not go into a shipped product or into the training data of shipped weights. **RESTRICTED** = DUA, gating or no open release.

**1. CounselChat (nbertagnolli/counsel-chat)** — 2020 (scraped 2022-04-01). **CAUTION (MIT label; text scraped from counselchat.com; GitHub repo describes itself as "code for working with data from counselchat.com")**
- What: a scrape of the counselchat.com forum. Licensed US counselors answer questions posted by anonymous individuals. Fields: questionID, questionTitle, questionText, questionLink, topic, therapistInfo, therapistURL, answerText, upvotes, split. "The dataset was scraped on 20220401 from counselchat.com." — [HF card](https://huggingface.co/datasets/nbertagnolli/counsel-chat)
- Size: HF size tag is 1K<n<10K rows — [HF API](https://huggingface.co/api/datasets/nbertagnolli/counsel-chat)
- Labels relevant to the app: `topic` (the forum category the question was posted under) and upvotes as a helpfulness signal. I did not verify which topic names exist (e.g. relationships, marriage, intimacy); check the data before relying on them.
- Language: English.
- License: the card's Licensing Information section says "MIT", and the GitHub repo license is MIT — [HF card](https://huggingface.co/datasets/nbertagnolli/counsel-chat); [GitHub API / repo](https://github.com/nbertagnolli/counsel-chat)
- Citation: Bertagnolli, N. (2020) "Counsel Chat: Bootstrapping High-Quality Therapy Data" (Towards Data Science) — [HF card](https://huggingface.co/datasets/nbertagnolli/counsel-chat)
- Access: https://huggingface.co/datasets/nbertagnolli/counsel-chat

**2. Amod/mental_health_counseling_conversations** — created 2023-06-22, updated 2025-11-25. **RESTRICTED/CAUTION**
- What: described as "a compilation of high-quality, real one-on-one mental health counseling conversations between individuals and licensed professionals", structured as question–answer pairs — [HF API](https://huggingface.co/api/datasets/Amod/mental_health_counseling_conversations)
- Size: 1K<n<10K; a single `combined_dataset.json`.
- License: `other`, license_name `rail-d`, with a `LICENSE-RAIL-D.txt` file. I did not open that file, so its specific terms are not verified. The dataset is **gated (manual approval)** — [HF API](https://huggingface.co/api/datasets/Amod/mental_health_counseling_conversations)
- Language: English. Relationship labels: none stated. Year: created 2023. Citation: not captured.

**3. Relationship Advice (yonatanko/Relationship_Advice)** — Reddit r/dating_advice + r/relationship_advice. **NC/RESEARCH in practice (license "unknown" + Reddit terms)**
- What: an English compilation of posts and comments "concerning dating and human romantic relationships" from r/dating_advice and r/relationship_advice — [HF card](https://huggingface.co/datasets/yonatanko/Relationship_Advice)
- Size: 400 examples (train 210 / dev 40 / test 150). Each example is a post, two comments, two comment labels from one of 6 classes (classes chosen for "the emotional needs expressed by the writer") and a "which comment is more helpful" label — [HF card](https://huggingface.co/datasets/yonatanko/Relationship_Advice)
- License: `unknown` — [HF API](https://huggingface.co/api/datasets/yonatanko/Relationship_Advice)

**4. janldeboer/reddit-relationships** — 2023-07-06. **DO NOT USE (empty)**
- The card lists `license: cc-by-4.0`, but the repo holds only `.gitattributes` and `README.md`. The HF datasets-server reports "The dataset is empty… doesn't contain any data files" — [HF card](https://huggingface.co/datasets/janldeboer/reddit-relationships); [datasets-server](https://datasets-server.huggingface.co/size?dataset=janldeboer/reddit-relationships)

**5. flirty_or_not (ieuniversity/flirty_or_not)** — 2023-04-10. **license not stated → treat as not shippable**
- What: short texts with a binary label (0 = neutral, 1 = flirty). Splits: train 1,584 / test 318 / validation 212. The card body says only "More Information needed" (no provenance, no license) — [HF card](https://huggingface.co/datasets/ieuniversity/flirty_or_not)
- Relevance: the only directly "romantic-interest"-labeled text set found. It is tiny and has unknown provenance.

**6. ironarmor/real_dating_chatlog** — 2024-06-24. **UNVERIFIED (gated)**
- The HF search lists `license: apache-2.0` and gated = manual. The repo holds `liker-conv.7z` and `us-chat-log.7z`. The card could not be read without authentication ("Access to dataset … is restricted") — [HF API](https://huggingface.co/api/datasets/ironarmor/real_dating_chatlog). Provenance and consent of "real" dating chats are unknown, so don't use it until the card is reviewed.

**7. Dona data-donation dataset (Bielefeld)** — 2024-06-27. **RESTRICTED; metadata only (no message text)**
- What: "de-identified messaging meta-data from 78 WhatsApp and 7 Facebook data donations", collected Aug 2022–Jun 2024. Message tables contain conversation_id, sender_id, datetime and word_count (no text), plus survey responses. Zenodo `access_right: restricted`; no license field — [Zenodo API record 12570525](https://zenodo.org/records/12570525)
- Use: only for timing and reciprocity features (response latency, word-count balance), and only via a research request.

**8. Real couples-interaction corpora seen only in papers (no open release found)**: the Couples Therapy corpus (audio/video and transcripts of 134 couples in marital therapy), an 85-couple advanced-cancer dyadic dataset, a 368 Swiss-German couples conflict-discussion study (Univ. Zurich), and the KODIS dispute corpus (non-commercial only). A simulated "PersonaConflicts" corpus (~5,772 simulated conflict dialogues among partners, friends and family) is described as GitHub-linked. These come from search-result snippets only; I did not open the dataset pages — [search snippets: arXiv 2505.21451](https://arxiv.org/html/2505.21451v2); [Papers with Code couples-therapy](https://www.paperswithcode.com/dataset/couples-therapy); [KODIS arXiv 2504.12723](https://arxiv.org/pdf/2504.12723). They are **not** counted in the inventory.

**Reddit status (affects 3, 4, GoEmotions, UCL abuse set):** Reddit's Data API Terms (Effective June 19, 2023; Last Revised July 20, 2026) say no rights are granted "including any right to use User Content for other purposes, such as for training a machine learning or AI model, without the express permission of rightsholders". Commercial use "will need to enter into a separate agreement with Reddit" — [Reddit Data API Terms](https://redditinc.com/policies/data-api-terms) (fetched via curl). Secondary reports say redistributing Reddit data is barred even for research — [r/pushshift thread (secondary)](https://lr.sudovanilla.org/r/pushshift/comments/12r04q9/an_update_regarding_reddits_api); [Search Engine Journal](https://www.searchenginejournal.com/reddit-paid-api/485172/). According to a search-result snippet (page not opened), the Pushshift access page says users "must comply with all the commercial use and other restrictions set forth in the Reddit API Terms" — [pushshift.io](https://pushshift.io/)

### Inferences
- For "potential" mode (gauging interest) there is no shippable, real-chat training set. Realistic routes: (a) synthetic data generated with a permissively licensed LLM, (b) weak labels from CounselChat topics, or (c) a user-consented data-donation program. flirty_or_not could serve as an internal sanity check only.
- Reddit-derived relationship corpora should be treated as research-only for a distributed product. The Reddit terms reach ML training on Reddit content no matter what license a dataset uploader attached.

### Gaps
- No dating-app message corpus (Tinder, Hinge, Bumble etc.) with an open license was found. I found no reliable public release.
- The Couples Therapy corpus access terms were not checked (page not opened).
- CounselChat topic list and row count not verified from the data itself.

## Q2. Questionnaire / psychometric raw data with romantic-relationship measures

### Takeaway
The best questionnaire calibration data is openpsychometrics' ECR raw data (N = 51,492, item-level attachment anxiety/avoidance). It has no explicit license. Speed Dating (Fisman & Iyengar, OpenML) gives real interest/decision labels from 8,378 dates. HCMST 2017 has a DUA (no fee on redistribution, no re-identification; commercial use not addressed). The Joel et al. 2020 43-dataset project shares only codebook and meta-analytic results, not raw couple data.

### Cited Findings

**9. Experiences in Close Relationships (ECR) raw data — openpsychometrics.org** — posted 2018-03-01 (page date 1/3/2018). **CAUTION (license not stated)**
- Size: N = 51,492 — [openpsychometrics raw data page](https://openpsychometrics.org/_rawdata/)
- What: responses to an interactive version of the ECR by Brennan, Clark & Shaver. Items are rated 1–5 (-1 if missed), e.g. Q1 "I prefer not to show a partner how I feel deep down.", Q2 "I worry about being abandoned.". Only users who said their answers were accurate and usable for research are included. The zip holds `codebook.html` and `data.csv` (~4.1 MB) — [ECR zip codebook](https://openpsychometrics.org/_rawdata/ECR-data-1March2018.zip)
- Labels: items Q1–Q36 (36 ECR items, confirmed in the codebook) plus `age`, `gender` (1 Male / 2 Female / 3 Other) and `country` (from IP). The items score attachment anxiety and avoidance; the standard scoring keys are not in the codebook — [ECR zip codebook](https://openpsychometrics.org/_rawdata/ECR-data-1March2018.zip)
- License: **license not stated**. The page says only "For general public edification the data collected through the personality tests on this website is dumped here." and "All data is anonymous." — [openpsychometrics](https://openpsychometrics.org/_rawdata/)
- Language: English items.

**10. Speed Dating Experiment (Fisman & Iyengar) — OpenML 40536** — data from 2002–2004, uploaded 2016-11-16. **CAUTION ("Public" label, not a standard license)**
- Not the excluded Stanford SpeedDate corpus: this is the separate Columbia Business School experiment (Fisman & Iyengar) with tabular ratings and decisions, not audio or transcripts.
- What: speed-dating events where attendees had a four-minute "first date" with every other participant of the opposite sex, were asked whether they'd like to see the date again, and rated the date on six attributes (Attractiveness, Sincerity, Intelligence, Fun, …). Source given as Columbia Business School (http://www.stat.columbia.edu/~gelman/arm/examples/speed.dating/) — [OpenML API data/40536](https://www.openml.org/api/v1/json/data/40536)
- Size: 8,378 instances, 121 features; default target `match` — [OpenML qualities](https://www.openml.org/api/v1/json/data/qualities/40536)
- Labels: per-date decision (would see again), attribute ratings, `match`. These are directly useful for "potential" mode questionnaire weighting.
- License: OpenML `licence: Public`; "Please cite: None" — [OpenML](https://www.openml.org/api/v1/json/data/40536). The Kaggle mirror page (annavictoria/speed-dating-experiment) rendered without content, so its license could not be verified — [Kaggle](https://www.kaggle.com/datasets/annavictoria/speed-dating-experiment)

**11. How Couples Meet and Stay Together 2017 (HCMST 2017), Stanford SSDS** — waves 2017/2020/2022. **RESTRICTED-ish (DUA; commercial use not addressed)**
- Size: 2017: 3,510 respondents (2,862 with current partner, 541 with past partner only; LGB oversample). 2020 follow-up: 2,107. 2022 follow-up: 1,722. Response rates 52/87/83% — [Stanford HCMST 2017](https://data.stanford.edu/hcmst2017)
- What/labels: nationally representative US survey (Ipsos) with "the usual HCMST relationship questions" across waves, so you can follow relationship status and breakups longitudinally. Open-text answers and sub-region geography are withheld from public files — [Stanford HCMST 2017](https://data.stanford.edu/hcmst2017)
- License: no named license. The DUA says: do not identify individuals, do not charge a fee when distributing, inform the contact person, and cite the data. Commercial use is not addressed; contact mrosenfe@stanford.edu — [Stanford HCMST 2017](https://data.stanford.edu/hcmst2017)
- Access: Stata/SPSS/R files at https://data.stanford.edu/hcmst2017

**12. Relationship Prediction Project (Joel et al. 2020, PNAS) — OSF** — 2020. **NOT A RAW DATASET**
- Paper: "Machine learning uncovers the most robust self-report predictors of relationship quality across 43 longitudinal couples studies", PNAS, DOI 10.1073/pnas.1917036117. 43 datasets, 11,196 couples. Top relationship predictors: perceived-partner commitment, appreciation, sexual satisfaction, perceived-partner satisfaction, conflict — [search summary citing PNAS/PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC7431040) (PMC page itself blocked by bot check)
- OSF main project https://osf.io/d6ykr/ has children Results (4pbfh), Meta-Data (v5e34), Accepted manuscript and Resources for Collaborators. No license is set on the node — [OSF API d6ykr](https://osf.io/d6ykr/)
- Files found in the nodes I checked:
  - Meta-Data (v5e34): "Master Codebook With Theoretical Categorization, Final.xlsx", "SatisfactionMetaAnalyses.csv", "CommitmentMetaAnalyses.csv" and a preregistration-changes doc — [OSF API v5e34](https://osf.io/v5e34/)
  - Resources for Collaborators (27c3w): an example codebook plus codebook and dataset specification docs — [OSF 27c3w](https://osf.io/27c3w/)
  - Results (4pbfh): no files listed at the osfstorage root — [OSF 4pbfh](https://osf.io/4pbfh/)
  - Main node: an overview .docx.
- No couple-level raw data in any of the nodes checked. I did not open sub-folders or nested components.
- Use: the predictor ranking and codebook are useful for **designing the questionnaire** (which items to ask), not for training.

### Inferences
- The ECR items and Joel et al.'s top predictors give a defensible questionnaire core. A shipped scoring model could be fit on ECR + Speed Dating, but both have only informal or no licenses, so the safest path is to use them for internal calibration and ship hand-set weights.
- HCMST's "no fee" clause suggests that bundling HCMST-derived data in a paid app is problematic. Shipping only derived coefficients is lower-risk but should be cleared with the contact.

### Gaps
- Add Health romantic-relationship modules (ICPSR) were not opened, so access terms are not verified (ICPSR pages are JS-heavy and were not fetched).
- No open dyadic daily-diary couples dataset with raw data was found within budget.
- Copyright/permission status of the ECR item wording itself was not checked.
- The Columbia original speed-dating page was not opened.

## Q3. General dialogue datasets with emotion / empathy / support labels (auxiliary training)

### Takeaway
Only GoEmotions (Apache-2.0) is permissively licensed among the major emotion sets. Even it is Reddit-derived. DailyDialog, EmpatheticDialogues and ESConv are CC BY-NC(-SA), so research-only. MELD is GPL-3.0 on Friends transcripts. EmoryNLP has no license.

### Cited Findings

**13. GoEmotions (google-research-datasets/go_emotions)** — year not captured on opened page. **CAUTION (Apache-2.0, but Reddit text)**
- 58k curated Reddit comments labeled for 27 emotion categories or Neutral. The `raw` config has 211,225 rows; `simplified` has 43,410/5,426/5,427 — [HF card](https://huggingface.co/datasets/google-research-datasets/go_emotions)
- License: apache-2.0 — [HF API](https://huggingface.co/api/datasets/google-research-datasets/go_emotions). Language: English.
- Note: see the Reddit Data API Terms on ML training (Q1). The Apache label covers Google's annotations; the comment text is Reddit user content.

**14. DailyDialog (li2017dailydialog/daily_dialog)** — 2017. **NC/RESEARCH (CC BY-NC-SA 4.0)**
- Splits 11,118 / 1,000 / 1,000 dialogues. Per-utterance emotion (no emotion, anger, disgust, fear, happiness, sadness, surprise) and dialogue acts. Human-written daily-life dialogues — [HF card](https://huggingface.co/datasets/li2017dailydialog/daily_dialog)
- License: cc-by-nc-sa-4.0 — [HF API](https://huggingface.co/api/datasets/li2017dailydialog/daily_dialog)
- The "Relationship" topic label (from the original paper) is not exposed in the HF card fields I read. Unverified here.

**15. EmpatheticDialogues (facebook/empathetic_dialogues)** — 2019 (arXiv 1811.00207). **NC/RESEARCH (CC BY-NC 4.0)**
- Splits: train 76,673 / validation 12,030 / test 10,943 rows. Conversations grounded in an emotion situation — [HF card](https://huggingface.co/datasets/facebook/empathetic_dialogues)
- License: cc-by-nc-4.0 — [HF API](https://huggingface.co/api/datasets/facebook/empathetic_dialogues)

**16. ESConv — Emotional Support Conversation (thu-coai)** — ACL 2021. **NC/RESEARCH (CC BY-NC 4.0)**
- "Data and codes for ACL 2021 paper: Towards Emotional Support Dialog Systems". HF size 1K<n<10K. LICENSE file is "Attribution-NonCommercial 4.0 International" — [GitHub repo + LICENSE](https://github.com/thu-coai/Emotional-Support-Conversation); [HF API](https://huggingface.co/api/datasets/thu-coai/esconv)
- (Support-strategy and problem-type labels are known from the paper but were not read on the opened page.)

**17. MELD (declare-lab/MELD)** — ACL 2019. **CAUTION (GPL-3.0, Friends TV transcripts)**
- More than 1,400 dialogues and 13,000 utterances from Friends. Each utterance has one of 7 emotions (Anger, Disgust, Sadness, Joy, Neutral, Surprise, Fear) plus sentiment; multimodal — [GitHub README](https://github.com/declare-lab/MELD)
- License: GPL-3.0 (GitHub and HF) — [GitHub API](https://github.com/declare-lab/MELD); [HF API](https://huggingface.co/api/datasets/declare-lab/MELD). Copyleft on data, and the transcripts come from a copyrighted show. Not advisable for a closed product.

**18. EmoryNLP Emotion Detection (emorynlp/emotion-detection)** — Friends multiparty. **license not stated**
- 97 episodes, 897 scenes, 12,606 utterances. 7 Feeling-Wheel emotions: sad, mad, scared, powerful, peaceful, joyful, neutral — [GitHub README](https://github.com/emorynlp/emotion-detection)
- License: GitHub reports NOASSERTION and `LICENSE` returned 404, so **license not stated** — [GitHub](https://github.com/emorynlp/emotion-detection)

**19. AnnoMI (uccollab/AnnoMI)** — ICASSP 2022; full version released 2023-03-14. **license not stated**
- 133 transcribed, expert-annotated demonstrations of high- and low-quality motivational interviewing. Utterance-level fields include mi_quality (high/low), topic, video_url and timestamp — [GitHub README](https://github.com/uccollab/AnnoMI)
- License: no LICENSE in repo (GitHub API license null), so **license not stated** — [GitHub](https://github.com/uccollab/AnnoMI)

### Inferences
- For a shippable emotion head, GoEmotions is the only option, and only if the team accepts the Reddit-provenance risk. The cleaner route is to use NC sets for evaluation only, or to train on synthetic data.
- Research-only sets can still be used for internal benchmarking that never ships.

### Gaps
- DailyDialog "Relationship" topic labels not verified from an opened page.
- ESConv label taxonomy not read on an opened page.

## Q4. Safety-relevant data (abuse, coercive control, gaslighting, manipulation, toxicity)

### Takeaway
There are good permissive options for general toxicity (Civil Comments CC0; Jigsaw CC0 per HF, with a conflicting CC BY-SA mirror) and for psychological abuse in relationships (UCL expert-annotated Reddit posts, CC BY 4.0 but Reddit-sourced). The manipulation and gaslighting-specific sets are non-commercial (MentalManip CC BY-NC 4.0; UCC CC BY-NC-SA 4.0) or Apache-labelled with a research-only use statement (gaslighting).

### Cited Findings

**20. Expert-Annotated Reddit Posts on Six Classes of Psychological Abuse (UCL)** — published 2026 (posts from 2021). **CAUTION (CC BY 4.0, but Reddit via Pushshift)**
- Authors: Tanczer, Neubauer, Mariconti, Perez Ortiz, Ashkenazi (UCL Gender and Tech Research Lab). DOI https://doi.org/10.5522/04/31587925.v1 — [B2FIND record](https://b2find.eudat.eu/dataset/03aec334-19a0-553d-800c-47d0559964d2)
- What: 2021 posts from r/abusiverelationships, r/domesticviolence and r/emotionalabuse, collected with the Pushshift API. Each is labeled by four experts across six non-mutually-exclusive psychological-abuse categories. Includes per-annotator files (a1–a4_full.csv) and aggregate.xlsx with OR/AND labels. Anonymised — [Figshare API 31587925](https://api.figshare.com/v2/articles/31587925)
- License: CC BY 4.0 — [Figshare API](https://api.figshare.com/v2/articles/31587925)
- Size and classes: I downloaded the annotator file a2_full.csv. It has 1,000 rows and the columns `id`, `sampled_text`, `1_Rules`, `2_Justify`, `3_Threat`, `4_Shame`, `5_Isolate`, `6_Surveil`. These six classes map closely onto coercive-control behaviours (rule-setting, justification, threats, shaming, isolation, surveillance). Row counts of the other annotator files and of aggregate.xlsx were not checked; a1_full.csv is about twice the byte size of the others — [Figshare files](https://api.figshare.com/v2/articles/31587925). A related UCL thesis mentions ~2,000 posts (search snippet only) — [UCL thesis](https://discovery.ucl.ac.uk/10188930/2/Neubauer_10188930_%20Thesis_Redacted.pdf)
- Most directly relevant set for "established" mode red flags.

**21. MentalManip** — ACL 2024 (Wang, Yang, Hassanpour, Vosoughi). **NC/RESEARCH (CC BY-NC 4.0)**
- 4,000 annotated movie dialogues. Tasks: manipulation detection, technique classification, vulnerability classification — [GitHub](https://github.com/audreycs/MentalManip)
- LICENSE file: "Attribution-NonCommercial 4.0 International" — [LICENSE](https://raw.githubusercontent.com/audreycs/MentalManip/main/LICENSE)

**22. Gaslighting / anti-gaslighting conversations (Maxwe11y/gaslighting)** — 2024 (arXiv 2410.09181). **CAUTION → effectively RESEARCH (Apache-2.0 label but card says research only)**
- Two LLM-generated conversation sets (gaslighting vs anti-gaslighting assistant). Train 1,752 / val 124 / test 124 conversations. Utterance category is safe or gaslighting, with speaker internal-thought fields — [HF card](https://huggingface.co/datasets/Maxwe11y/gaslighting)
- License: apache-2.0, **but** the card states "The gaslighting conversation dataset is intended solely for research purposes and may not be used for any other applications". Conflicting signals — [HF card](https://huggingface.co/datasets/Maxwe11y/gaslighting). The GitHub repo (Maxwe11y/gaslightingLLM) shows no license — [GitHub](https://github.com/Maxwe11y/gaslightingLLM)
- Caveat: user↔assistant framing, not partner↔partner.

**23. Unhealthy Comments Corpus (UCC)** — 2020 (ALW workshop). **NC/RESEARCH (CC BY-NC-SA 4.0)**
- 44,355 comments (Globe and Mail via the SFU SOCC corpus). Labels: healthy/unhealthy plus binary hostile; antagonistic/insulting/provocative/trolling; dismissive; condescending/patronising; sarcastic; unfair generalisation, each with confidence scores — [GitHub README](https://github.com/conversationai/unhealthy-conversations)
- License line: "This work is licensed under a Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License." — [GitHub README](https://github.com/conversationai/unhealthy-conversations)
- Labels like dismissive and condescending map well onto contempt-style relationship red flags.

**24. Civil Comments (google/civil_comments)** — comments from 2015–2017. **SAFE (CC0 1.0)**
- What: an archive of the Civil Comments platform. The comments were created 2015–2017 on about 50 English-language news sites and released when Civil Comments shut down in 2017. Homepage is the Kaggle Jigsaw Unintended Bias in Toxicity Classification competition — [HF card](https://huggingface.co/datasets/google/civil_comments)
- Labels: toxicity, severe_toxicity, threat, insult (plus others not captured in my excerpt) — [HF card](https://huggingface.co/datasets/google/civil_comments)
- Size: HF size tag 1M<n<10M — [HF API](https://huggingface.co/api/datasets/google/civil_comments)
- License: cc0-1.0 — [HF card/API](https://huggingface.co/datasets/google/civil_comments). English.

**25. Jigsaw Toxic Comment Classification** — **CAUTION (conflicting licenses)**
- What: "a large number of Wikipedia comments which have been labeled by human raters for toxic behavior". Labels include threat and insult, each 0/1 (other toxicity columns not captured in my excerpt). Homepage is the Kaggle Jigsaw Toxic Comment Classification Challenge — [HF card google/jigsaw_toxicity_pred](https://huggingface.co/datasets/google/jigsaw_toxicity_pred)
- License conflict: `google/jigsaw_toxicity_pred` lists cc0-1.0 — [HF API](https://huggingface.co/api/datasets/google/jigsaw_toxicity_pred). The mirror `thesofakillers/jigsaw-toxic-comment-classification-challenge` lists cc-by-sa-3.0 — [HF API](https://huggingface.co/api/datasets/thesofakillers/jigsaw-toxic-comment-classification-challenge). Because the text is Wikipedia comments, assume CC BY-SA attribution and share-alike obligations (this is my inference, not a stated term).
- Size and year: not captured.

**26. Conversations Gone Awry (ConvoKit, CGA-WIKI)** — ACL 2018 / EMNLP 2019. **license not stated (ConvoKit code is MIT)**
- 4,188 conversations, 30,021 comments, 8,069 speakers from Wikipedia talk pages. `comment_has_personal_attack` and `conversation_has_personal_attack` labels (3 crowd annotators), for forecasting conversational derailment. CMV (Reddit) variants exist — [ConvoKit docs](https://convokit.cornell.edu/documentation/awry.html)
- The dataset page states no license. The ConvoKit toolkit repo is MIT — [GitHub API](https://github.com/CornellNLP/ConvoKit)

**27. RealToxicityPrompts (allenai/real-toxicity-prompts)** — paper arXiv 2009.11462. **SAFE label (Apache-2.0)**
- What: "100k sentence snippets from the web" with Perspective-style scores per prompt (toxicity, severe_toxicity, threat, insult, …), built for studying toxic degeneration in language models. Low relevance to the app — [HF card](https://huggingface.co/datasets/allenai/real-toxicity-prompts)
- License: apache-2.0 — [HF API](https://huggingface.co/api/datasets/allenai/real-toxicity-prompts)

### Inferences
- A shippable "unhealthy dynamics" flagger can be built from Civil Comments (CC0) for hostility and toxicity. The UCL set (CC BY 4.0) covers relationship-specific psychological-abuse categories, but its Reddit provenance means the Reddit-terms risk should be assessed before the training data or weights ship.
- Coercive control, gaslighting and manipulation detection specifically has no clean commercial dataset. MentalManip and UCC can benchmark a model internally. Shipped training data would likely need to be synthetic, written to a taxonomy drawn from those papers and from the UCL classes.

### Gaps
- Apart from the UCL set, whose classes (Rules, Justify, Threat, Shame, Isolate, Surveil) resemble coercive-control tactics, I found no public dataset labelled for **coercive control** in partner-to-partner messages. The Emory IPV Reddit work (300 posts) appears not to release data (search snippet only).
- Total UCL post count across files not verified (one annotator file = 1,000 rows).

### Ship-safety summary table (all questions)

| # | Dataset | License (as found) | Commercial + redistribution? | Verdict |
|---|---|---|---|---|
| 1 | CounselChat | MIT | Yes by label; scraped site text | CAUTION |
| 2 | Amod mental_health_counseling | RAIL-D (other), gated | Use-restricted | RESTRICTED |
| 3 | yonatanko Relationship_Advice | unknown | No basis | Do not ship |
| 4 | janldeboer reddit-relationships | cc-by-4.0 (empty repo) | n/a | Empty |
| 5 | flirty_or_not | license not stated | No basis | Do not ship |
| 6 | real_dating_chatlog | apache-2.0 listed, gated | Unverified | Unverified |
| 7 | Dona data donation | no license, restricted | No | RESTRICTED |
| 9 | ECR raw (openpsychometrics) | license not stated | Unclear | CAUTION |
| 10 | Speed Dating (OpenML) | "Public" | Unclear | CAUTION |
| 11 | HCMST 2017 | DUA (no fee, no re-ID) | Commercial not addressed | RESTRICTED-ish |
| 12 | Joel et al. RPP (OSF) | none set; no raw data | n/a | Design input only |
| 13 | GoEmotions | Apache-2.0 | Yes by label; Reddit text | CAUTION |
| 14 | DailyDialog | CC BY-NC-SA 4.0 | No | NC/RESEARCH |
| 15 | EmpatheticDialogues | CC BY-NC 4.0 | No | NC/RESEARCH |
| 16 | ESConv | CC BY-NC 4.0 | No | NC/RESEARCH |
| 17 | MELD | GPL-3.0 | Copyleft; TV text | CAUTION |
| 18 | EmoryNLP | license not stated | No basis | Do not ship |
| 19 | AnnoMI | license not stated | No basis | Do not ship |
| 20 | UCL Psychological Abuse Reddit | CC BY 4.0 | Yes by label; Reddit text | CAUTION |
| 21 | MentalManip | CC BY-NC 4.0 | No | NC/RESEARCH |
| 22 | Gaslighting (Maxwe11y) | Apache-2.0 + "research only" | Conflicting | Treat as RESEARCH |
| 23 | UCC | CC BY-NC-SA 4.0 | No | NC/RESEARCH |
| 24 | Civil Comments | CC0 1.0 | Yes | SAFE |
| 25 | Jigsaw Toxic | CC0 (HF) vs CC BY-SA 3.0 (mirror) | Yes with attribution/SA | CAUTION |
| 26 | Conversations Gone Awry | license not stated | No basis | Do not ship |
| 27 | RealToxicityPrompts | Apache-2.0 | Yes | SAFE (low relevance) |

Withdrawn/removed flags: janldeboer/reddit-relationships is empty. Pushshift-era Reddit collection is now governed by Reddit's Data API Terms (2023, revised 2026-07-20), which bar ML training without rightsholder permission. No other takedowns were observed on the opened pages.
