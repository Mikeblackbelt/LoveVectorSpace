# Classifying the TYPE of interpersonal relationship between two people from their conversation text (NLP/ML literature)

Verification note: every paper below was opened (landing page plus full PDF/HTML text), and the numbers were read from the paper's own tables or prose. Where a table could not be read cleanly from the PDF, the number is marked "not verified". Three task families are mixed in this literature, and the report writer should keep them apart:
- **(A) Speaker-pair relationship-type classification.** Label the relationship between the two interlocutors: DDRel, PRIDE/FiRe, MPDD, SCRIPTS, Welch et al.
- **(B) Dialogue relation extraction between argument pairs.** The two people need not be the speakers, and only some of the 36 types are interpersonal: DialogRE, SocAoG, Li et al. 2024 (LLMs).
- **(C) Relationship *dimensions* rather than discrete types**, e.g. equal/hierarchical, intimate, romance, power: Rashid & Blanco 2018, Choi et al. 2020. Azab et al. 2019 is a type-classification task on Shakespeare plays.

## Key question 1: Which verified studies predict relationship type from dialogue text, and what data, labels, methods and results do they report?

### Takeaway
At least 11 real, verifiable papers (2018–2026) tackle this problem. Almost all use **scripted dialogue** (movie scripts, TV transcripts such as *Friends*, Chinese TV series, Shakespeare). The exceptions are Welch et al. 2019 (one person's real instant messages) and Choi et al. 2020 (Reddit, Enron and Twitter). Performance on fine-grained types from a single conversation is modest:
- DDRel 13-class session-level: BERT macro-F1 20.4%.
- PRIDE: macro-F1 0.38 on 12 labels.
- Aggregating many sessions per pair helps both models and humans.
- Recent LLM evaluations (SCRIPTS, ACL 2026) reach about 75–80% "highly likely" accuracy in English, but still produce socially implausible relationships in a notable share of responses.

### Cited Findings

#### 1. DDRel (Jia, Huang & Zhu, AAAI 2021). Type (A), dyadic.
- **Citation and venue.** Qi Jia, Hongru Huang, Kenny Q. Zhu. "DDRel: A New Dataset for Interpersonal Relation Classification in Dyadic Dialogues." arXiv:2012.02553, submitted 4 Dec 2020. The arXiv comments say it was accepted to AAAI 2021 — [arXiv](https://arxiv.org/abs/2012.02553). The authors are at Shanghai Jiao Tong University. The AAAI proceedings DOI and page numbers were not verified. All numbers below come from arXiv v1 — [arXiv PDF](https://arxiv.org/pdf/2012.02553).
- **Dataset.** 6,300 dyadic dialogue sessions between 694 speaker pairs across 300 movies, with 53,126 utterances. The movie scripts were crawled from IMSDb. The average dialogue has 8.4 turns — [arXiv](https://arxiv.org/abs/2012.02553); [arXiv PDF](https://arxiv.org/pdf/2012.02553).
- **Labels.** 13 classes, based on Reis & Sprecher's *Encyclopedia of Human Relationships*: Child-Parent, Child-Other Family Elder, Siblings, Spouse, Lovers, Courtship, Friends, Neighbors, Roommates, Workplace Superior-Subordinate, Colleague/Partners, Opponents, Professional Contact. The 13 classes are also clustered into 6-class and 4-class versions "considering the social field, the seniority and the closeness between two speakers." Lovers, Friends and Colleague/Partners together make up about half the data — [arXiv PDF](https://arxiv.org/pdf/2012.02553).
- **Annotation.** Labels come from one ground-truth annotator who had the movie synopsis and internet access, verified by a second annotator — [arXiv PDF](https://arxiv.org/pdf/2012.02553).
- **Methods.** Random, Majority, LSTM, CNN and fine-tuned BERT-base (uncased), plus a human upper bound. Session-level is one dialogue; pair-level aggregates all sessions of a pair by averaging per-class MRR — [arXiv PDF](https://arxiv.org/pdf/2012.02553).
- **Results** (Table 3, mean of 3 seeds, Acc / macro-F1 %):
  - Session-level, 4-class: BERT 47.10 / 44.53; human 56.00 / 55.20.
  - Session-level, 6-class: BERT 41.87 / 39.40; human 50.00 / 53.00.
  - Session-level, 13-class: BERT 39.40 / 20.40; human 38.50 / 40.75. Majority gets 26.0 accuracy but only 3.2 F1. LSTM and CNN 13-class F1 are 4.63 and 9.20 (also stated in the prose).
  - Pair-level (rows assigned by table order; prose confirms BERT>CNN>LSTM and higher human scores): 4-class BERT 58.13 / 52.00 vs human 75.65 / 73.00; 13-class BERT 39.73 / 24.07 vs human 63.45 / 54.40 — [arXiv PDF](https://arxiv.org/pdf/2012.02553).
- **Human agreement (Cohen's κ).** Session-level 0.429 / 0.336 / 0.301 and pair-level 0.698 / 0.687 / 0.614 for 4 / 6 / 13 classes. Even humans struggle to identify a relationship from a single session — [arXiv PDF](https://arxiv.org/pdf/2012.02553).
- **Key finding and limitations.** Granularity drives difficulty, and multiple sessions per pair help substantially. The authors name lack of commonsense knowledge as a limitation of current models. Movie relationships are "more clear-cut" than real life, and the taxonomy is "not an all-round coverage" — [arXiv PDF](https://arxiv.org/pdf/2012.02553).
- **Data and code.** Public at https://github.com/JiaQiSJTU/DialogueRelationClassification — [arXiv PDF](https://arxiv.org/pdf/2012.02553).

#### 2. DialogRE (Yu, Sun, Cardie & Yu, ACL 2020). Type (B).
- **Citation.** Dian Yu, Kai Sun, Claire Cardie, Dong Yu. "Dialogue-Based Relation Extraction." ACL 2020, pp. 4927–4940. DOI 10.18653/v1/2020.acl-main.444 — [ACL Anthology](https://aclanthology.org/2020.acl-main.444/).
- **Dataset.** 36 relation types annotated over 1,788 dialogues from the complete *Friends* transcripts, giving 10,168 relational triples, each with a minimal "trigger" span. Table 7 lists 1,788 dialogues — [ACL PDF](https://aclanthology.org/2020.acl-main.444.pdf).
- **Labels.** Mostly TAC-KBP slot-filling relations plus new ones. The interpersonal subset includes per:girl/boyfriend, per:friends, per:siblings, per:spouse, per:parents, per:children, per:other_family, per:boss, per:subordinate, per:neighbor, per:roommate, per:acquaintance, per:alumni, per:dates — [ACL PDF](https://aclanthology.org/2020.acl-main.444.pdf). SocAoG later states that 17 of the 36 types are interpersonal — [SocAoG, ACL Anthology](https://aclanthology.org/2021.acl-long.54).
- **Methods and results** (Table 5, test F1 / F1c, where F1c is a new conversational metric):
  - Majority 35.8 / 35.8.
  - CNN 48.0 / 45.0, LSTM 47.4 / 44.9, BiLSTM 48.6 / 45.0.
  - BERT 58.5 / 53.2.
  - Speaker-aware BERTS 61.2 / 55.4, i.e. +2.7 F1 and +2.2 F1c. This shows "the importance of tracking speakers."
  - Appending ground-truth triggers raises F1 to 74.9%.
  — [ACL PDF](https://aclanthology.org/2020.acl-main.444.pdf)
- **Limitations (stated).** All transcripts are from *Friends*, "which may limit the diversity of scenarios." BERT errs more on asymmetric inverse relations. Pilot annotation by one author may introduce bias — [ACL PDF](https://aclanthology.org/2020.acl-main.444.pdf).
- **Data.** Public at https://dataset.org/dialogre/ — [ACL Anthology](https://aclanthology.org/2020.acl-main.444/). There is also a GitHub mirror, github.com/nlpdata/dialogre, cited in the SocAoG paper — [SocAoG PDF](https://aclanthology.org/2021.acl-long.54.pdf).

#### 3. MPDD (Chen, Huang & Chen, LREC 2020). Type (A), multi-party, Chinese.
- **Citation.** Yi-Ting Chen, Hen-Hsen Huang, Hsin-Hsi Chen. "MPDD: A Multi-Party Dialogue Dataset for Analysis of Emotions and Interpersonal Relationships." Proceedings of LREC 2020, pp. 610–614 — [ACL Anthology](https://aclanthology.org/2020.lrec-1.76); [author PDF](https://www.cs.nccu.edu.tw/~hhhuang/docs/lrec2020d.pdf).
- **Dataset.** 4,142 dialogues and 25,548 utterances crawled from five Chinese TV series scripts, with an average of 2.338 participants per dialogue. Each utterance carries an emotion label (Ekman's 7), its targeted listener(s), and the speaker–listener relationship, chosen from the listener's perspective. There were three annotators per utterance with a majority vote — [author PDF](https://www.cs.nccu.edu.tw/~hhhuang/docs/lrec2020d.pdf).
- **Labels.** 24 relation types, also grouped by social field (family / school / company / others) and seniority (elder / peer / junior). Extracted Table 1 labels:
  - Family: parent, parent-in-law, grandparent, other superior, spouse, brothers and sisters, other peer, child, son/daughter-in-law, grandchild, other inferior.
  - School: teacher, classmate, student.
  - Company: boss, colleague, partner, subordinate.
  - Others: couple, friend, enemy, consignor, consignee, stranger, unknown.
  - Friend is the most common type at 25.44%.
  — [author PDF](https://www.cs.nccu.edu.tw/~hhhuang/docs/lrec2020d.pdf)
- **Methods and results.** CNN and BERT classifiers with 5-fold CV and accuracy. BERT seniority (3-class) accuracy is .7259 baseline, .7494 with the previous utterance, and .7632 with the responded utterance (Table 5). Adding the responded utterance also helped social-field classification. Per-cell values of Table 8 (relation classification with emotion features) and fine-grained 24-way results were not verified — [author PDF](https://www.cs.nccu.edu.tw/~hhhuang/docs/lrec2020d.pdf).
- **Data.** http://nlg.csie.ntu.edu.tw/nlpresource/MPDD/ (URL as given in the paper; not opened) — [author PDF](https://www.cs.nccu.edu.tw/~hhhuang/docs/lrec2020d.pdf).

#### 4. PRIDE / FiRe (Tigunova, Mirza, Yates & Weikum, EMNLP 2021). Type (A), multi-label, directed.
- **Citation.** Anna Tigunova, Paramita Mirza, Andrew Yates, Gerhard Weikum. "PRIDE: Predicting Relationships in Conversations." EMNLP 2021, pp. 4636–4650. DOI 10.18653/v1/2021.emnlp-main.380 — [ACL Anthology](https://aclanthology.org/2021.emnlp-main.380/).
- **Datasets.**
  - FiRe (Film Relationship): 783 character pairs from 254 films (Jinni movie-script corpus), crowd-labelled on MTurk with 6 annotators per pair, keeping labels that 4 of 6 agreed on. Fleiss' κ = 0.45.
  - Series: 365 pairs from TV transcripts (foreverdreaming.org), κ = 0.33. Pairs average about 4x more utterances than in FiRe.
  - Words per pair average 1,087 (FiRe) vs 6,562 (Series).
  — [EMNLP PDF](https://aclanthology.org/2021.emnlp-main.380.pdf)
- **Labels.** 12 directed labels: parent, child, sibling, (ex-)spouse, friend, enemy, (ex-)love interest/lover, colleague/co-worker, boss/employer, employee/servant, doctor/patient, client/seller. Labels with fewer than 20 samples (e.g. engaged, classmate, teacher, fan) were dropped — [EMNLP PDF](https://aclanthology.org/2021.emnlp-main.380.pdf).
- **Method.** A BERT utterance encoder plus a Transformer over the conversation, using dialogue structure. It adds speaker age-difference bins (actor ages from IMDb) and "interpersonal dimension" embeddings from BERT classifiers trained on Rashid & Blanco's (2018) data. Personal names and movie-specific words are removed to curb overfitting. Folds are movie-disjoint — [EMNLP PDF](https://aclanthology.org/2021.emnlp-main.380.pdf).
- **Results** (macro-averaged multi-label F1 / P / R):
  - FiRe 5-fold CV: PRIDE 0.38 / 0.42 / 0.37, vs BERT-conv 0.27, HAM 0.23, BERT-DDRel-style 0.20, RNN 0.11.
  - Transfer (train FiRe, test Series): PRIDE 0.30 / 0.43 / 0.29.
  - On a human-annotated FiRe subset: PRIDE 0.33 vs humans 0.84 F1.
  - Best scores are significant by McNemar's test, p<0.05.
  — [EMNLP PDF](https://aclanthology.org/2021.emnlp-main.380.pdf)
- **Key findings.** Speaker embeddings and interpersonal dimensions matter (ablation). Confusion between asymmetric pairs (parent↔child) is common: accepting either direction cuts false positives for such classes by 34% — [EMNLP PDF](https://aclanthology.org/2021.emnlp-main.380.pdf).
- **Limitations.** Fictional screenplays, a small labelled set, and moderate or low annotator agreement. Changing relationships were discarded in annotation — [EMNLP PDF](https://aclanthology.org/2021.emnlp-main.380.pdf).
- **Data and code.** https://pkb.mpi-inf.mpg.de/pride/ — [EMNLP PDF](https://aclanthology.org/2021.emnlp-main.380.pdf).

#### 5. Rashid & Blanco (EMNLP 2018). Type (C), dimensions.
- **Citation.** Farzana Rashid, Eduardo Blanco. "Characterizing Interactions and Relationships between People." EMNLP 2018, pp. 4395–4404. DOI 10.18653/v1/D18-1470 — [ACL Anthology](https://aclanthology.org/D18-1470/).
- **Data.** *Friends* Season 1 (24 episodes; 9,168 conversation turns; 42 characters with ≥100 turns), building on the Chen & Choi (2016) character-mining corpus. An "interaction" is a turn in which one person refers to another. A "relationship" is the sequence of such interactions — [EMNLP PDF](https://aclanthology.org/D18-1470.pdf).
- **Labels.** Nine binary dimensions, each with an "unknown" option:
  - Interaction dimensions: cooperative/competitive, active/passive, concurrent/non-concurrent, spatially near/distant.
  - Relationship dimensions: equal/hierarchical, intense/superficial, pleasure/task-oriented, intimate/unintimate, temporary/enduring.
  - Agreement: Cohen's κ 0.77–0.89.
  — [EMNLP PDF](https://aclanthology.org/D18-1470.pdf)
- **Method and results.** RBF-SVMs, one per dimension, trained on episodes 1–20 and tested on 21–24. Features: first word, bag-of-words, sentiment lexica, and BOW of the previous conversation of the same pair. Average weighted F1 is 0.72 for the best system vs 0.62 for the majority baseline. Relationship dimensions are harder than interaction dimensions: all-label weighted F1 is intense 0.57, intimate 0.49, temporary 0.57, equal 0.79. LSTMs were tried but underperformed SVMs — [EMNLP PDF](https://aclanthology.org/D18-1470.pdf).
- **Limitations.** A single TV show; label distributions would differ with other dialogue sources (authors' note) — [EMNLP PDF](https://aclanthology.org/D18-1470.pdf).
- **Data.** Annotations released as stand-alone files via the author's site (http://www.cse.unt.edu/~blanco/). The base corpus is at https://github.com/emorynlp/character-mining — [EMNLP PDF](https://aclanthology.org/D18-1470.pdf).

#### 6. Choi, Aiello, Varga & Quercia (WWW 2020). Type (C), real online text.
- **Citation.** Minje Choi, Luca Maria Aiello, Krisztián Zsolt Varga, Daniele Quercia. "Ten Social Dimensions of Conversations and Relationships." Proceedings of The Web Conference 2020 (WWW '20). DOI 10.1145/3366423.3380224. arXiv:2001.09954 — [arXiv](https://arxiv.org/abs/2001.09954).
- **Data.** About 9k crowd-annotated sentences from Reddit (7,855), Enron emails (436) and Cornell movie dialogs (400), plus 5k Twitter relationships labelled at relationship level by the users themselves via the Tinghy.org game. Models were then applied to 160M Reddit messages, 290k Enron emails and 300k movie lines — [arXiv PDF](https://arxiv.org/pdf/2001.09954).
- **Labels.** Ten dimensions from Deri et al.: knowledge, power, status, trust, support, romance, similarity, identity, fun, conflict — [arXiv PDF](https://arxiv.org/pdf/2001.09954).
- **Methods.** XGBoost with 343 interpretable features, embedding similarity, LSTM (GloVe), and BERT — [arXiv PDF](https://arxiv.org/pdf/2001.09954).
- **Results.**
  - Sentence-level: average AUC 0.85 across dimensions, maximum 0.98.
  - Relationship level: a Twitter pair's dominant dimension is predicted by majority vote over per-message LSTM predictions. AUC plateaus after about 20 exchanged messages. Conflict and status reach AUC > 0.8; power, support and romance reach AUC > 0.7.
  — [arXiv PDF](https://arxiv.org/pdf/2001.09954)
- **Limitations (stated).** Training data come from a single source (US Reddit). Models ignore directionality and surrounding context. The ten dimensions are not exhaustive, and about 40% of samples could not be clearly labelled — [arXiv PDF](https://arxiv.org/pdf/2001.09954).
- **Data.** Code and crowdsourced data at https://social-dynamics.net/projects/social_dimensions — [arXiv PDF](https://arxiv.org/pdf/2001.09954).

#### 7. Welch, Pérez-Rosas, Kummerfeld & Mihalcea (CICLing 2019). Type (A), real instant messages.
- **Citation.** Charles Welch, Verónica Pérez-Rosas, Jonathan K. Kummerfeld, Rada Mihalcea. "Look Who's Talking: Inferring Speaker Attributes from Personal Longitudinal Dialog." CICLing 2019. arXiv:1904.11610 — [arXiv](https://arxiv.org/abs/1904.11610).
- **Data.** About half a million instant messages over five years between one author and 104 conversation partners, across several platforms — [arXiv](https://arxiv.org/abs/1904.11610); [arXiv PDF](https://arxiv.org/pdf/1904.11610).
- **Labels.** Seven binary partner attributes, several of them relationship types: family member, romantic partner, classmate (school), co-worker (work), relative age, gender, same childhood country — [arXiv](https://arxiv.org/abs/1904.11610).
- **Method.** A BiLSTM over 5-message context windows, combined with time, LIWC, style/mirroring, frequency, graph (who-mentions-whom) features and joint decoders. Evaluation is leave-one-speaker-out — [arXiv PDF](https://arxiv.org/pdf/1904.11610).
- **Results.** The abstract reports "gains of 9–14% over using message text only" for the full feature set (attributes as a group) — [arXiv](https://arxiv.org/abs/1904.11610). The paper notes graph features gave up to 6.7% speaker-level and up to 7% context-window-level gains — [arXiv PDF](https://arxiv.org/pdf/1904.11610).
  - The speaker-level table has majority-class baselines as high as 94.2% and 91.3% on the most imbalanced attributes. In the rows that could be read, embedding-based models only matched those baselines. Column-to-attribute mapping and the "all features / joint" rows were not verified.
- **Limitations.** A single ego network (one person) and heavy class imbalance. PRIDE's authors note "the list of predicted relationships is limited as well as the size of the input samples" — [PRIDE PDF](https://aclanthology.org/2021.emnlp-main.380.pdf).
- **Code.** https://github.com/cfwelch/longitudinal_dialog. The data itself is private — [arXiv PDF](https://arxiv.org/pdf/1904.11610).

#### 8. Azab, Kojima, Deng & Mihalcea (CoNLL 2019). Type (A) on plays.
- **Citation.** Mahmoud Azab, Noriyuki Kojima, Jia Deng, Rada Mihalcea. "Representing Movie Characters in Dialogues." CoNLL 2019, pp. 99–109 — [ACL PDF](https://aclanthology.org/K19-1010.pdf).
- **Data and labels.** Character embeddings are trained on dialogue turns. Relation classification uses the Massey et al. (2015) literary annotations for 31 Shakespeare plays (605 character-pair relationships): 18 fine-grained classes (e.g. sister/father/friend/enemy), 4 coarse classes, and 3 sentiment classes. Logistic regression with leave-one-play-out CV. A separate relatedness dataset covers 4,761 character pairs from 18 movies — [ACL PDF](https://aclanthology.org/K19-1010.pdf).
- **Results.** The authors report that their character embeddings "consistently outperform" Word2Vec/Doc2Vec/ELMo baselines (weighted F). Exact per-model F-scores were not verified because of table misalignment. Fine-grained scores appear to be ≤0.2 weighted F, but treat that as not verified — [ACL PDF](https://aclanthology.org/K19-1010.pdf).
- **Data.** Relatedness dataset at http://lit.eecs.umich.edu/downloads.html — [ACL PDF](https://aclanthology.org/K19-1010.pdf).

#### 9. SocAoG (Qiu et al., ACL-IJCNLP 2021). Type (B), social relation inference.
- **Citation.** Liang Qiu, Yuan Liang, Yizhou Zhao, Pan Lu, Baolin Peng, Zhou Yu, Ying Nian Wu, Song-Chun Zhu. "SocAoG: Incremental Graph Parsing for Social Relation Inference in Dialogues." ACL-IJCNLP 2021, pp. 658–670. DOI 10.18653/v1/2021.acl-long.54. arXiv:2106.01006 — [arXiv](https://arxiv.org/abs/2106.01006); [ACL Anthology](https://aclanthology.org/2021.acl-long.54).
- **Data.** DialogRE V2, with added speaker attributes (gender, age, profession, ethnicity), and MovieGraph (40 of 51 movies with full transcripts) — [ACL PDF](https://aclanthology.org/2021.acl-long.54.pdf).
- **Method.** The group's social network is modelled as an attributed And-Or graph, which enforces relation consistency across the group (e.g. inferring a couple who never talk directly). It is parsed incrementally per utterance with MCMC (α-β-γ processes), so relational beliefs update as the dialogue unfolds — [ACL PDF](https://aclanthology.org/2021.acl-long.54.pdf).
- **Results.**
  - DialogRE test F1: SocAoG 69.1 vs SocAoG-reduced (no attributes) 68.6. SocAoG-reduced beats the previous SOTA, SimpleRE, by 1.9 F1 / 2.1 F1c.
  - MovieGraph test F1: 64.1 vs 63.2. Gains over SimpleRE are larger on MovieGraph, attributed to its longer dialogues. The paper's F1 vs F1c labelling for the MovieGraph gain is inconsistent between passages; flagged.
  — [ACL PDF](https://aclanthology.org/2021.acl-long.54.pdf)
- **Code.** https://github.com/Liang-Qiu/SocAoG-dialogues — [ACL PDF](https://aclanthology.org/2021.acl-long.54.pdf).

#### 10. Li et al. (IJCAI 2024). Type (B), LLMs on DialogRE.
- **Citation.** Guozheng Li, Zijie Xu, Ziyu Shang, Jiajun Liu, Ke Ji, Yikai Guo. "Empirical Analysis of Dialogue Relation Extraction with Large Language Models." IJCAI 2024 (per arXiv comments). arXiv:2404.17802 — [arXiv](https://arxiv.org/abs/2404.17802).
- **Methods.** ChatGPT (GPT-3.5), prompted with vanilla, restrictive, yes-no and open-ended prompts. ChatGPT was evaluated on only 100 randomly sampled dialogues to control API cost. "Landre" LoRA-tunes open models (GPT-2, BART, BLOOM, T5, LLaMA-7B) — [arXiv HTML](https://arxiv.org/html/2404.17802v1).
- **Results** (DialogRE V1 test F1 / F1c):
  - BERT 58.5 / 53.2; BERTs 61.2 / 55.4; HiDialog 77.7 / 69.0.
  - GPT-3.5 vanilla zero-shot 59.5 / 57.0; restrictive zero-shot 74.2 / 70.3; 5-shot vanilla 62.9 / 60.4.
  - Landre-LLaMA-7B 79.4 / 78.5 (V2 test: 79.0 / 77.9).
  — [arXiv HTML](https://arxiv.org/html/2404.17802v1)
- **Key finding.** Larger models capture long, sparse multi-turn evidence better and are robust on partial dialogues. LLMs are only modest on inverse/asymmetric relations — [arXiv](https://arxiv.org/abs/2404.17802).
- **Code.** No code link found on the abstract page.

#### 11. SCRIPTS (Kim et al., ACL 2026). Type (A), LLM evaluation, English and Korean.
- **Citation.** Eunsu Kim, Junyeong Park, Juhyun Oh, Kiwoong Park, Seyoung Song, A. Seza Doğruöz, Alice Oh, Najoung Kim. "Are they lovers or friends? Evaluating LLMs' Social Reasoning in English and Korean Dialogues." ACL 2026 (Long), pp. 23431–23451. DOI 10.18653/v1/2026.acl-long.1074 — [ACL Anthology](https://aclanthology.org/2026.acl-long.1074/).
- **Data.** 1,147 dialogues (580 English, 567 Korean) from 60 movies, filtered from 23k scenes to 2–3 participants and at least 3 turns. More than 230 unique relationship types. Labels are three-tier and uncertainty-aware: HIGHLY LIKELY (open-ended, by 3 annotators), LESS LIKELY, and UNLIKELY (chosen from a predefined 27-type set compiled from prior work). Auxiliary labels cover age, gender, formality, hierarchy and intimacy — [ACL PDF](https://aclanthology.org/2026.acl-long.1074.pdf).
- **Key finding on label granularity.** 19% of static movie-level labels were judged irrelevant for a given dialogue, which argues for dialogue-level labelling — [ACL PDF](https://aclanthology.org/2026.acl-long.1074.pdf).
- **Models.** GPT-4o, o3, Gemini-2.5-Flash, Qwen-3-8B/14B, Llama-3.1-8B-Instruct, and three Korean-specialized models. Answers are free-form generation, with the majority answer over 5 runs — [ACL PDF](https://aclanthology.org/2026.acl-long.1074.pdf).
- **Results.**
  - Abstract: about 75–80% (English) and 58–69% (Korean); models predict an UNLIKELY relationship in 10–25% of responses — [ACL Anthology](https://aclanthology.org/2026.acl-long.1074/).
  - Body text: GPT-4o is best, with a HIGHLY LIKELY rate of 79% (EN) and 69% (KO). UNLIKELY errors range 10.8–31.9% across five multilingual models, rising by a further 7.2–16.5 percentage points in Korean.
  - Chain-of-thought and "thinking" give minimal or inconsistent benefit and sometimes amplify social biases.
  — [ACL PDF](https://aclanthology.org/2026.acl-long.1074.pdf)
- **Data and code.** huggingface.co/datasets/EunsuKim/SCRIPTS; github.com/rladmstn1714/SCRIPTS — [ACL PDF](https://aclanthology.org/2026.acl-long.1074.pdf).

#### Negative or clarifying finding: CPED
- CPED (Chen et al., arXiv:2205.14727, 2022) has more than 12K dialogues from 40 Chinese TV shows. Its abstract lists gender, Big Five, 13 emotions, 19 dialogue acts and 10 scenes, and **no speaker-relationship labels**. It should not be cited as a relation-classification dataset — [arXiv](https://arxiv.org/abs/2205.14727).

### Inferences
- **Benchmarks.** DDRel (dyadic, 13 classes, movie scripts) and PRIDE/FiRe (multi-label, directed, 12 classes) are the most direct benchmarks for "relationship type between two speakers." DialogRE is larger and more widely used, but it is relation extraction between mentioned arguments, of which only part is interpersonal. Results on DialogRE (F1 ≈ 60–79) are therefore not comparable to DDRel or PRIDE macro-F1 (≈ 0.2–0.5).
- **More conversation helps.** Pooling evidence across many exchanges improves accuracy consistently: DDRel pair-level beats session-level, Choi's AUC plateaus at about 20 messages, and Rashid & Blanco's previous-conversation features help. This supports the user's framing that accumulated text messages between two people make relationship type more predictable than a single exchange.
- **Two extra signals help.**
  - Speaker-aware modelling and asymmetric/directed labels: BERTS, PRIDE's parent/child confusion, Li et al.'s inverse-relation weakness.
  - Relational context and consistency: SocAoG's group graph, PRIDE's age and interpersonal dimensions.
- **Domain gap.** Nearly all labelled data are fictional scripts. Only Welch et al. (one person's IMs) and Choi et al. (Reddit/Enron/Twitter dimensions) use real messages, and neither offers a large public, real-world, multi-class relationship-type corpus. Transfer to real text-message data is therefore largely untested.
- **Human ceilings are also low on single sessions.** DDRel 13-class session κ is 0.30. This implies an irreducible ambiguity floor for short exchanges, which SCRIPTS addresses with probabilistic labels.

### Gaps
- **DDRel.** The AAAI 2021 proceedings page, DOI and page numbers were not opened, so the venue is confirmed only via the arXiv comment. Pair-level row assignment in Table 3 was inferred from table order.
- **DialogRE.** The train/dev/test dialogue split was not verified in the opened text.
- **MPDD.** Fine-grained (24-way) relation classification results and the per-cell Table 8 values were not extracted cleanly. The dataset URL was not opened.
- **Welch et al. 2019.** Per-attribute accuracies for family, romantic, co-worker and classmate under the full or joint models were not verified, because of PDF table misalignment.
- **Azab et al. 2019.** Exact per-model weighted-F scores were not verified.
- **SocAoG.** F1c values in its Table 2 were not read.
- **Leads not opened, so not verified.** These should not be cited without checking:
  - TUCORE-GCN (Lee & Choi 2021), SimpleRE and GDPNet (Xue et al.), HiDialog (Liu et al. 2023): DialogRE models; only their scores as reported in Li et al.'s table were seen.
  - Massey et al. 2015 (literary character relationships) and Qamar et al. 2021 (interpersonal dimensions in *Friends*, cited by PRIDE).
  - Tigunova et al. 2019 "Listening between the lines" (WWW 2019; personal attributes, not relationships).
  - SI-Bench, SIV-Bench (video), RESCUE-BENCH (couple/family interviews), and DialogBench (contains a relation-classification task over GPT-4-generated dialogues). These surfaced in search snippets only.
- **Relation labels in other datasets.** I did not find a verified "Friends-TV relation dataset" beyond DialogRE and Rashid & Blanco. I found no verified CPED relation labels.
- **Real text messages.** No verified large, public, real-world (non-scripted) SMS/chat dataset labelled with multi-class relationship type was found. This appears to be a genuine gap in the literature, not just in this search.
