# Article summaries: predicting the relationship between two people from their conversations

As of 2026-11-23. This file is the companion to `literature-review.md`. It holds one structured summary per paper.

**Core papers** use text that the two people exchanged (dialogue, chat, email, transcribed speech or messages) as the input. **Adjacent studies** use communication metadata, network structure, self-reports, one person's posts, or narrative text. They are listed separately and are not counted as core.

Verification labels:
- **Full text**: the paper itself (PDF or HTML) was opened and the numbers were read from it.
- **Abstract only**: only the abstract or an official abstract record was read. Anything beyond the abstract is marked "not verified".
- **Bibliographic record only**: the citation exists, but neither the abstract nor the full text was read.

## Index

| # | Paper | Year | Task category | Data type |
|---|---|---|---|---|
| 1 | DDRel (Jia, Huang & Zhu) | 2021 | Relationship type, dyadic | Movie scripts (English) |
| 2 | PRIDE / FiRe (Tigunova et al.) | 2021 | Relationship type, directed multi-label | Movie and TV scripts (English) |
| 3 | MPDD (Chen, Huang & Chen) | 2020 | Relationship type, multi-party | Chinese TV scripts |
| 4 | Look Who's Talking (Welch et al.) | 2019 | Partner attributes, including relationship type | Real instant messages (one person) |
| 5 | Representing Movie Characters (Azab et al.) | 2019 | Relationship type from character embeddings | Shakespeare plays, movies |
| 6 | Interactions and Relationships (Rashid & Blanco) | 2018 | Relationship dimensions | *Friends* TV transcripts |
| 7 | Ten Social Dimensions (Choi et al.) | 2020 | Relationship dimensions | Reddit, Enron, movies, Twitter |
| 8 | DialogRE (Yu et al.) | 2020 | Dialogue relation extraction | *Friends* TV transcripts |
| 9 | SocAoG (Qiu et al.) | 2021 | Social relation inference | *Friends*, MovieGraph |
| 10 | LLMs for dialogue relation extraction (Li et al.) | 2024 | Dialogue relation extraction, LLMs | *Friends* (DialogRE) |
| 11 | SCRIPTS: lovers or friends? (Kim et al.) | 2026 | Relationship type, LLM evaluation | English and Korean movie scripts |
| 12 | Gender and race in romantic prediction (Sancheti et al.) | 2024 | Romantic vs. non-romantic, LLM bias | Movie scripts (DDRel) |
| 13 | How do I love thee? (Slatcher & Pennebaker) | 2006 | Romantic stability | Real couples' instant messages |
| 14 | Language style matching (Ireland et al.) | 2011 | Romantic interest and stability | Speed-date transcripts, couples' IMs |
| 15 | Detecting flirting (Ranganath et al.) | 2009 | Flirtation intent and perception | Speed-date speech and transcripts |
| 16 | Friendly, flirtatious, awkward, assertive (Ranganath et al.) | 2013 | Interpersonal stance in dates | Speed-date speech and transcripts |
| 17 | Making the connection (McFarland et al.) | 2013 | Romantic bonding ("clicking") | Speed-date speech and transcripts |
| 18 | Online dating first messages (Schoendienst & Dang-Xuan) | 2011 | Reply to first contact | Online dating messages |
| 19 | Breakups on Twitter (Garimella et al.) | 2014 | Breakup | Public Twitter interactions |
| 20 | Predicting first dates (Huang & Hancock) | 2022 | First date occurs | Online dating message exchanges |
| 21 | LLMs and romantic attraction (Matz et al.) | 2024 | Speed-date success, LLMs | Speed-date transcripts |
| 22 | Social power from language (Bramsen et al.) | 2011 | Power direction | Enron email |
| 23 | Echoes of power (Danescu-Niculescu-Mizil et al.) | 2012 | Status and dependence | Wikipedia talk, Supreme Court |
| 24 | Phrases that signal hierarchy (Gilbert) | 2012 | Power direction | Enron email |
| 25 | Power from a single thread (Prabhakaran & Rambow) | 2014 | Power direction | Enron email threads |
| 26 | Predicting tie strength (Gilbert & Karahalios) | 2009 | Tie strength | Facebook interactions and message text |

Adjacent studies (not counted as core): A1 Gilbert 2012 (Twitter tie strength), A2 Min et al. 2013, A3 Wiese et al. 2015, A4 Dwarakanath et al. 2016, A5 Kahanda & Neville 2009, A6 Eagle et al. 2009, A7 Backstrom & Kleinberg 2014, A8 Joel et al. 2017, A9 Seraj et al. 2021, A10 Brinberg & Ram 2021, A11 Schade et al. 2013, A12 Zhao et al. 2024.

---

## Core papers

### 1. DDRel (Jia, Huang & Zhu, 2021)
- **Citation:** Jia, Q., Huang, H., & Zhu, K. Q. (2021). DDRel: A new dataset for interpersonal relation classification in dyadic dialogues. *Proceedings of AAAI 2021* (accepted per arXiv comments; proceedings DOI and pages not verified). arXiv:2012.02553. https://arxiv.org/abs/2012.02553
- **Question:** Can a model identify the relationship between two speakers from their dialogue alone?
- **Data:** 6,300 two-person dialogue sessions from 694 speaker pairs in 300 movies, with 53,126 utterances. Scripts came from IMSDb. Sessions average 8.4 turns. The split is 5,037 / 653 / 610 sessions (541 / 75 / 78 pairs) for train, dev and test.
- **Method:** 13 relationship classes drawn from Reis & Sprecher's *Encyclopedia of Human Relationships*: Child-Parent, Child-Other Family Elder, Siblings, Spouse, Lovers, Courtship, Friends, Neighbors, Roommates, Workplace Superior-Subordinate, Colleague/Partners, Opponents, Professional Contact. These are also merged into 6-class and 4-class schemes (the 4 classes are Family, Intimacy, Others, Official). One annotator assigned labels and a second verified them. Baselines: random, majority, LSTM, CNN and fine-tuned BERT-base, plus a human ceiling. Session-level uses one dialogue. Pair-level pools every session of a pair.
- **Key results:** Accuracy / macro-F1 (%), from Table 3:

  | Level | Classes | BERT | Human |
  |---|---|---|---|
  | Session | 4 | 47.10 / 44.53 | 56.00 / 55.20 |
  | Session | 6 | 41.87 / 39.40 | 50.00 / 53.00 |
  | Session | 13 | 39.40 / 20.40 | 38.50 / 40.75 |
  | Pair | 4 | 58.13 / 52.00 | 75.65 / 73.00 |
  | Pair | 6 | 42.33 / 38.00 | 72.40 / 73.55 |
  | Pair | 13 | 39.73 / 24.07 | 63.45 / 54.40 |

  The 13-class majority baseline reaches 26.0% accuracy but only 3.2 macro-F1. Human agreement (Cohen's κ) is 0.429 / 0.336 / 0.301 at session level and 0.698 / 0.687 / 0.614 at pair level, for 4 / 6 / 13 classes.
- **Takeaway for relationship prediction:** Pooling many exchanges between the same pair helps humans most, and models somewhat. A single short exchange is often ambiguous, even for people.
- **Limitations:** Movie relationships are cleaner than real ones. The authors say the taxonomy does not cover everything. Labels come from one annotator plus a checker. Models lack commonsense knowledge.
- **Data/code availability:** Public at https://github.com/JiaQiSJTU/DialogueRelationClassification
- **Verification:** Full text (arXiv PDF and ar5iv HTML). Table 3 was re-read from the paper on 2026-11-23.

### 2. PRIDE / FiRe (Tigunova, Mirza, Yates & Weikum, 2021)
- **Citation:** Tigunova, A., Mirza, P., Yates, A., & Weikum, G. (2021). PRIDE: Predicting relationships in conversations. *Proceedings of EMNLP 2021*, 4636–4650. https://doi.org/10.18653/v1/2021.emnlp-main.380
- **Question:** Can a model predict directed, fine-grained and possibly multiple relationships between two characters from their conversations?
- **Data:** FiRe has 783 character pairs from 254 films. Six MTurk workers labelled each pair, and a label was kept when 4 of 6 agreed (Fleiss' κ = 0.45). A Series set has 365 pairs from TV transcripts (κ = 0.33). Pairs average 1,087 words in FiRe and 6,562 in Series.
- **Method:** The paper's annotation taxonomy (Table 2) lists about 21 candidate labels in family, social and professional groups. Labels with fewer than 20 samples were dropped, leaving 12 directed labels for experiments: parent, child, sibling, (ex-)spouse, friend, enemy, (ex-)lover, colleague, boss, employee, doctor/patient, client/seller. The model encodes utterances with BERT and the conversation with a Transformer. It adds speaker age-difference bins (actor ages from IMDb) and "interpersonal dimension" embeddings trained on Rashid & Blanco's data. Names and movie-specific words are removed, and folds are movie-disjoint.
- **Key results:** Macro multi-label F1 / P / R on FiRe (5-fold CV): PRIDE 0.38 / 0.42 / 0.37. Baselines: BERT-conv 0.27, HAM 0.23, a DDRel-style BERT 0.20, RNN 0.11. Training on FiRe and testing on Series gives 0.30 / 0.43 / 0.29. On a human-annotated subset, PRIDE scores 0.33 F1 against 0.84 for humans. Performance peaks at about 40 utterances per pair. Accepting either direction for asymmetric pairs (e.g. parent/child) cuts false positives for those classes by 34%.
- **Takeaway for relationship prediction:** Speaker modelling, direction and side knowledge (age, interpersonal dimensions) all help. Common labels (friend, lover) absorb many errors, and spouse is often confused with lover.
- **Limitations:** Fiction only, a small labelled set, and moderate-to-low agreement. Relationships that changed during a film were discarded.
- **Data/code availability:** Public at https://pkb.mpi-inf.mpg.de/pride/ (data directory https://pkb.mpi-inf.mpg.de/pride_data/). The released JSON files keep the raw labels, including rare ones: 19 distinct labels across 783 movie pairs and 15 across 365 pairs from 14 series. Friend and lover dominate both. No licence is stated in the README.
- **Verification:** Full text (EMNLP PDF). The label counts for the released files were computed from the public files.

### 3. MPDD (Chen, Huang & Chen, 2020)
- **Citation:** Chen, Y.-T., Huang, H.-H., & Chen, H.-H. (2020). MPDD: A multi-party dialogue dataset for analysis of emotions and interpersonal relationships. *Proceedings of LREC 2020*, 610–614. https://aclanthology.org/2020.lrec-1.76
- **Question:** Can emotion and the speaker–listener relationship be classified in Chinese multi-party dialogue, and do the two tasks inform each other?
- **Data:** 4,142 dialogues and 25,548 utterances from five Chinese TV series scripts. Dialogues average 6.168 turns and 2.338 participants. Each utterance carries an emotion (Ekman's seven), its targeted listener(s), and the speaker–listener relation, labelled from the listener's perspective. Three annotators labelled each utterance, with majority vote.
- **Method:** The paper states 24 relation types, grouped by social field (family, school, company, others) and by seniority (elder, peer, junior). Table 1 as extracted lists 25 names, including "unknown", which looks like a catch-all rather than a relation (an inference). Friend is the most common relation at 25.44%. CNN and BERT classifiers with 5-fold cross-validation.
- **Key results:** BERT seniority (3-class) accuracy is .7259 for the baseline, .7494 with the previous utterance, and .7632 with the responded-to utterance. The responded-to utterance also helps social-field and fine-grained 24-way classification. Per-cell results for fine-grained classification and for the emotion-feature table: not verified.
- **Takeaway for relationship prediction:** Knowing which utterance a line answers helps relationship classification. Coarse dimensions such as seniority are learnable from short context.
- **Limitations:** Scripted TV dialogue from only five series. Results are per utterance, not per pair.
- **Data/code availability:** The paper gives http://nlg.csie.ntu.edu.tw/nlpresource/MPDD/. The host refused automated access, so current availability is not verified.
- **Verification:** Full text (LREC PDF), opened on 2026-11-23 to confirm the label count.

### 4. Look Who's Talking (Welch, Pérez-Rosas, Kummerfeld & Mihalcea, 2019)
- **Citation:** Welch, C., Pérez-Rosas, V., Kummerfeld, J. K., & Mihalcea, R. (2019). Look who's talking: Inferring speaker attributes from personal longitudinal dialog. *CICLing 2019*. arXiv:1904.11610. https://arxiv.org/abs/1904.11610
- **Question:** Can attributes of a chat partner, including the kind of relationship, be inferred from years of real messages?
- **Data:** About half a million instant messages over five years between one author and 104 partners, across several platforms.
- **Method:** Seven binary partner attributes: family member, romantic partner, classmate, co-worker, relative age, gender, same childhood country. A BiLSTM over 5-message windows is combined with time, LIWC, style-mirroring, frequency and graph (who-mentions-whom) features and joint decoders. Evaluation is leave-one-speaker-out.
- **Key results:** The full feature set gives "gains of 9–14%" over message text alone (abstract). Graph features add up to 6.7% at speaker level and up to 7% at window level. Majority baselines reach 94.2% and 91.3% on the most imbalanced attributes. In the readable rows, embedding models only matched those baselines. Per-attribute accuracies for the full and joint models: not verified.
- **Takeaway for relationship prediction:** This is one of very few studies on real personal messages. Non-text signals (timing, mention graph) add value beyond the words.
- **Limitations:** One person's ego network and heavy class imbalance. PRIDE's authors note the attribute list and sample are small.
- **Data/code availability:** Code at https://github.com/cfwelch/longitudinal_dialog. The messages are private.
- **Verification:** Full text (arXiv PDF); some tables were misaligned and are marked not verified.

### 5. Representing movie characters (Azab, Kojima, Deng & Mihalcea, 2019)
- **Citation:** Azab, M., Kojima, N., Deng, J., & Mihalcea, R. (2019). Representing movie characters in dialogues. *Proceedings of CoNLL 2019*, 99–109. https://aclanthology.org/K19-1010/
- **Question:** Do character embeddings learned from dialogue capture how characters relate?
- **Data:** Relationship labels come from Massey et al. (2015) for 31 Shakespeare plays (605 character pairs). Labels: 18 fine-grained classes (e.g. sister, father, friend, enemy), 4 coarse classes and 3 sentiment classes. A separate relatedness set covers 4,761 character pairs from 18 movies.
- **Method:** Character embeddings trained on dialogue turns, fed to logistic regression with leave-one-play-out cross-validation.
- **Key results:** The authors report that their embeddings "consistently outperform" Word2Vec, Doc2Vec and ELMo baselines on weighted F. Exact scores are not verified because the tables were misaligned. Fine-grained scores appear to be at or below 0.2 weighted F (not verified).
- **Takeaway for relationship prediction:** Representing each speaker from their whole dialogue history is a workable route to relationship labels.
- **Limitations:** Early-modern dramatic text, small label set per class, and no verified numbers.
- **Data/code availability:** The relatedness dataset is at http://lit.eecs.umich.edu/downloads.html
- **Verification:** Full text (ACL PDF); result values not verified.

### 6. Characterizing interactions and relationships (Rashid & Blanco, 2018)
- **Citation:** Rashid, F., & Blanco, E. (2018). Characterizing interactions and relationships between people. *Proceedings of EMNLP 2018*, 4395–4404. https://doi.org/10.18653/v1/D18-1470
- **Question:** Can dimensions of a relationship, rather than a type label, be inferred from dialogue?
- **Data:** *Friends* Season 1: 24 episodes, 9,168 turns and 42 characters with at least 100 turns. Built on the Chen & Choi (2016) character-mining corpus. An interaction is a turn in which one person refers to another.
- **Method:** Nine binary dimensions with an "unknown" option. Interaction dimensions: cooperative/competitive, active/passive, concurrent/non-concurrent, spatially near/distant. Relationship dimensions: equal/hierarchical, intense/superficial, pleasure/task-oriented, intimate/unintimate, temporary/enduring. Agreement is κ 0.77–0.89. One RBF-SVM per dimension; train on episodes 1–20, test on 21–24. Features include bag-of-words, sentiment lexica and words from the same pair's previous conversation.
- **Key results:** Average weighted F1 is 0.72, against 0.62 for the majority baseline. Relationship dimensions are harder: intense 0.57, intimate 0.49, temporary 0.57, equal 0.79. LSTMs did worse than SVMs.
- **Takeaway for relationship prediction:** Dimensions such as intimacy and hierarchy are a useful middle layer. Context from earlier conversations of the same pair helps.
- **Limitations:** One TV show. Label distributions would differ in other sources.
- **Data/code availability:** Annotations via the author's site (http://www.cse.unt.edu/~blanco/). Base corpus at https://github.com/emorynlp/character-mining
- **Verification:** Full text (EMNLP PDF).

### 7. Ten social dimensions (Choi, Aiello, Varga & Quercia, 2020)
- **Citation:** Choi, M., Aiello, L. M., Varga, K. Z., & Quercia, D. (2020). Ten social dimensions of conversations and relationships. *Proceedings of The Web Conference 2020*. https://doi.org/10.1145/3366423.3380224 (arXiv:2001.09954)
- **Question:** Can social dimensions of a relationship be detected in everyday online text?
- **Data:** About 9,000 crowd-annotated sentences from Reddit (7,855), Enron email (436) and movie dialogue (400). Plus 5,000 Twitter relationships labelled by the users themselves through a game. Models were then run on 160M Reddit messages, 290k Enron emails and 300k movie lines.
- **Method:** Ten dimensions: knowledge, power, status, trust, support, romance, similarity, identity, fun, conflict. Models: XGBoost on 343 features, embedding similarity, LSTM with GloVe, and BERT.
- **Key results:** Sentence-level average AUC is 0.85, with a maximum of 0.98. For Twitter pairs, the dominant dimension is predicted by majority vote over per-message LSTM outputs. AUC plateaus after about 20 exchanged messages. Conflict and status exceed 0.8 AUC; power, support and romance exceed 0.7.
- **Takeaway for relationship prediction:** Real messages carry detectable relational signal, and about 20 messages from a pair is enough for the score to level off.
- **Limitations:** Training text is mostly US Reddit. Models ignore direction and context. The ten dimensions are not exhaustive, and about 40% of samples could not be clearly labelled.
- **Data/code availability:** Code and crowd data at https://social-dynamics.net/projects/social_dimensions
- **Verification:** Full text (arXiv PDF).

### 8. DialogRE (Yu, Sun, Cardie & Yu, 2020)
- **Citation:** Yu, D., Sun, K., Cardie, C., & Yu, D. (2020). Dialogue-based relation extraction. *Proceedings of ACL 2020*, 4927–4940. https://doi.org/10.18653/v1/2020.acl-main.444
- **Question:** Can relations between arguments mentioned in a multi-party dialogue be extracted?
- **Data:** 1,788 dialogues from the full *Friends* transcripts, with 10,168 relational triples. Each triple has a minimal trigger span. English and Chinese versions exist.
- **Method:** 36 relation types, mostly from TAC-KBP slot filling. Interpersonal types include girl/boyfriend, friends, siblings, spouse, parents, children, other family, boss, subordinate, neighbor, roommate, acquaintance, alumni and dates. SocAoG later counts 17 of the 36 as interpersonal. Baselines: majority, CNN, LSTM, BiLSTM, BERT and a speaker-aware BERT (BERTS). The paper also introduces F1c, a metric for partial (in-progress) conversations.
- **Key results:** Test F1 / F1c: majority 35.8 / 35.8; CNN 48.0 / 45.0; LSTM 47.4 / 44.9; BiLSTM 48.6 / 45.0; BERT 58.5 / 53.2; BERTS 61.2 / 55.4. Adding gold triggers lifts F1 to 74.9.
- **Takeaway for relationship prediction:** Tracking who is speaking adds 2.7 F1. Asymmetric inverse relations are a common error.
- **Limitations:** One sitcom only. The two arguments need not be the speakers, so this is not dyadic relationship classification. The pilot annotation by one author may add bias.
- **Data/code availability:** Public at https://dataset.org/dialogre/ and https://github.com/nlpdata/dialogre. V2 corrects annotation errors in V1.
- **Verification:** Full text (ACL PDF).

### 9. SocAoG (Qiu et al., 2021)
- **Citation:** Qiu, L., Liang, Y., Zhao, Y., Lu, P., Peng, B., Yu, Z., Wu, Y. N., & Zhu, S.-C. (2021). SocAoG: Incremental graph parsing for social relation inference in dialogues. *Proceedings of ACL-IJCNLP 2021*, 658–670. https://doi.org/10.18653/v1/2021.acl-long.54
- **Question:** Does modelling the whole group's social network improve relation inference between pairs?
- **Data:** DialogRE V2 with added speaker attributes (gender, age, profession, ethnicity). MovieGraph, using 40 of 51 movies that have full transcripts.
- **Method:** The group is an attributed And-Or graph that enforces consistency, such as inferring a couple who never talk to each other directly. The graph is parsed incrementally with MCMC, so beliefs update as the dialogue unfolds.
- **Key results:** DialogRE test F1: 69.1 for SocAoG and 68.6 without attributes. The reduced model beats the earlier best (SimpleRE) by 1.9 F1 and 2.1 F1c. MovieGraph test F1: 64.1 vs. 63.2. Gains are larger on MovieGraph's longer dialogues. The paper labels the MovieGraph gain inconsistently as F1 or F1c.
- **Takeaway for relationship prediction:** Relationships constrain one another. Group-level consistency helps when a pair rarely speaks directly.
- **Limitations:** Fiction only; relies on added speaker attributes. F1c values in Table 2 not verified.
- **Data/code availability:** Code at https://github.com/Liang-Qiu/SocAoG-dialogues
- **Verification:** Full text (ACL PDF).

### 10. LLMs for dialogue relation extraction (Li et al., 2024)
- **Citation:** Li, G., Xu, Z., Shang, Z., Liu, J., Ji, K., & Guo, Y. (2024). Empirical analysis of dialogue relation extraction with large language models. *Proceedings of IJCAI 2024*. arXiv:2404.17802. https://arxiv.org/abs/2404.17802 (IJCAI PDF: https://www.ijcai.org/proceedings/2024/0703.pdf)
- **Question:** How well do prompted and fine-tuned LLMs extract relations from multi-turn dialogue?
- **Data:** DialogRE V1 and V2 (36 relation types, 1,788 dialogues, 8,119 argument pairs as reported by the authors).
- **Method:** ChatGPT (gpt-3.5-turbo) with vanilla, restrictive, yes-no and open-ended prompts. To limit cost, ChatGPT ran on 100 randomly sampled dialogues from the dev and test sets. "Landre" LoRA-tunes GPT-2, BART-large, BLOOM-560M, T5-large and LLaMA-7B. GPT-4 was not tested.
- **Key results:** Test F1 / F1c from Table 2 (averaged over three runs):

  | Model | V1 test | V2 test |
  |---|---|---|
  | BERT | 58.5 / 53.2 | 57.9 / 53.1 |
  | BERTS | 61.2 / 55.4 | 59.5 / 54.2 |
  | HiDialog (prior best) | 77.7 / 69.0 | 77.1 / 68.2 |
  | GPT-3.5 vanilla, zero-shot | 59.5 / 57.0 | 58.9 / 56.3 |
  | GPT-3.5 restrictive, zero-shot | 74.2 / 70.3 | 74.9 / 70.8 |
  | Landre-LLaMA-7B | 79.4 / 78.5 | 79.0 / 77.9 |

  LLaMA loses only about 0.9–1.2 F1 on partial dialogues, against 7.1–8.9 for HiDialog. Moving from GPT-2 to LLaMA-7B gains more than 20 F1. LLaMA errs on 97.8% of per:acquaintance cases, and negative impression is confused with friend or romantic relations.
- **Takeaway for relationship prediction:** A small fine-tuned LLM beats the best supervised encoder, mainly on F1c, so it handles unfinished conversations well. Zero-shot prompting is close but below.
- **Limitations:** ChatGPT figures come from 100-dialogue subsets with limited prompt search. Output parsing problems. Weak on inverse relations.
- **Data/code availability:** No code link found on the abstract page.
- **Verification:** Full text (arXiv HTML). Table 2 was re-read on 2026-11-23.

### 11. SCRIPTS: "Are they lovers or friends?" (Kim et al., 2026)
- **Citation:** Kim, E., Park, J., Oh, J., Park, K., Song, S., Doğruöz, A. S., Oh, A., & Kim, N. (2026). Are they lovers or friends? Evaluating LLMs' social reasoning in English and Korean dialogues. *Proceedings of ACL 2026 (Long Papers)*, 23431–23451. https://doi.org/10.18653/v1/2026.acl-long.1074 (arXiv:2510.19028)
- **Question:** Can current LLMs infer the relationship between two speakers in movie dialogue, in English and Korean?
- **Data:** 1,147 dialogues (580 English, 567 Korean) from 60 movie scripts (28 English from IMSDb, 32 Korean). Scenes were filtered from about 23,000 down to those with 2–3 speakers and at least 3 turns. More than 230 unique relationship types appear. Auxiliary labels cover age, gender, formality, hierarchy and intimacy.
- **Method:** Labels are three-tier and uncertainty-aware: Highly Likely (open-ended, from three annotators), Less Likely and Unlikely. The paper describes starting from a list of about 50 relationships from PRIDE. Its Table 9 lists 27 predefined types in six groups. The paper does not reconcile the two numbers. Nine models were tested, including GPT-4o, o3, Gemini-2.5-Flash, Qwen-3-8B/14B, Llama-3.1-8B-Instruct and three Korean models. Output is free text, with a majority over 5 runs.
- **Key results:** The abstract reports about 75–80% accuracy in English and 58–69% in Korean across models. GPT-4o is best, with a Highly Likely rate of 79% (English) and 69% (Korean). The abstract says models pick an Unlikely relationship in 10–25% of responses. The results section gives 10.8–31.9%, rising by a further 7.2–16.5 percentage points in Korean. Chain-of-thought and "thinking" modes add little or nothing and sometimes amplify social bias. 19% of static movie-level labels were judged irrelevant to a given dialogue.
- **Takeaway for relationship prediction:** Strong LLMs usually pick a plausible relationship but still make socially implausible guesses. Labels should be per dialogue and allow uncertainty.
- **Limitations:** Fiction only; two languages. The two Unlikely ranges differ between abstract and body.
- **Data/code availability:** https://huggingface.co/datasets/EunsuKim/SCRIPTS and https://github.com/rladmstn1714/SCRIPTS
- **Verification:** Full text (ACL PDF and arXiv HTML). Headline figures re-checked on 2026-11-23.

### 12. Gender and race in romantic relationship prediction (Sancheti, An & Rudinger, 2024)
- **Citation:** Sancheti, A., An, H., & Rudinger, R. (2024). On the influence of gender and race in romantic relationship prediction from large language models. *Proceedings of EMNLP 2024*. arXiv:2410.03996. https://arxiv.org/abs/2410.03996
- **Question:** Do LLMs' guesses about whether two speakers are romantic depend on the speakers' names?
- **Data:** DDRel test split. 327 different-gender instances, 271 of them without explicit gender cues. Character names were replaced in a controlled way.
- **Method:** Llama2-7B-chat, Llama2-13B-chat and Mistral-7B-Instruct, zero-shot at temperature 0. The model picks one of DDRel's 13 labels; Lovers, Spouse and Courtship count as romantic.
- **Key results:** Same-gender name pairs get lower romantic recall than different-gender pairs. Precision is about 0.78–0.84 across races. Pairs with two Asian names score lowest (0.68 recall for Llama2-7B). Anonymized X/Y names give recall of 0.6887 (gender setting) and 0.7131 (race setting). Name embeddings encode gender only 53.3% of the time for Asian names, against 80–99.9% for other names.
- **Takeaway for relationship prediction:** LLMs lean on names and heteronormative priors. Any romantic-status classifier needs a bias audit.
- **Limitations:** Prompt sensitivity, no in-context examples, few races and genders, and no same-gender romantic dialogues in the test set. The authors raise consent and privacy concerns.
- **Data/code availability:** Not verified.
- **Verification:** Full text (arXiv HTML).

### 13. How do I love thee? (Slatcher & Pennebaker, 2006)
- **Citation:** Slatcher, R. B., & Pennebaker, J. W. (2006). How do I love thee? Let me count the words: The social effects of expressive writing. *Psychological Science*, 17, 660–664. https://doi.org/10.1111/j.1467-9280.2006.01762.x
- **Question:** Does writing about one's relationship change couples' messages and their chance of staying together?
- **Data:** 86 dating couples. One partner wrote for 3 days about the relationship or about daily activities (control). The couples' instant messages were collected before and after.
- **Method:** Randomized writing task, LIWC-style word counts of the IMs, and mediation analysis. The outcome is still dating 3 months later.
- **Key results:** Relationship writers were "significantly more likely" to still be dating at 3 months. Both partners used more positive- and negative-emotion words in IMs afterwards. Rising positive-emotion words partly mediated the effect. Exact percentages and effect sizes: not verified.
- **Takeaway for relationship prediction:** Emotion words in couples' messages track later stability.
- **Limitations:** Small sample. Language is a mediator of an experiment, not a stand-alone predictor. Probably the same 86 couples as Ireland et al. 2011 Study 2 (see #14).
- **Data/code availability:** Not verified.
- **Verification:** Abstract only.

### 14. Language style matching (Ireland et al., 2011)
- **Citation:** Ireland, M. E., Slatcher, R. B., Eastwick, P. W., Scissors, L. E., Finkel, E. J., & Pennebaker, J. W. (2011). Language style matching predicts relationship initiation and stability. *Psychological Science*, 22, 39–44. https://doi.org/10.1177/0956797610392928
- **Question:** Does similarity in function-word use between two people predict romantic interest and staying together?
- **Data:** Study 1: transcripts of 40 speed dates. Study 2: instant messages from 86 dating couples.
- **Method:** Language style matching (LSM) as a predictor of binary outcomes, reported as odds ratios. That LIWC and logistic models were used is an inference, not verified.
- **Key results:** Study 1: LSM predicted mutual interest, OR = 3.05. 33.3% of above-median pairs wanted contact, against 9.1% of the rest. Study 2: LSM predicted still dating at 3 months, OR = 1.95. 76.7% of above-median couples were still together, against 53.5%.
- **Takeaway for relationship prediction:** One cheap stylistic feature of the exchange carries real signal for romantic outcomes.
- **Limitations:** Small samples, a single feature, and no out-of-sample test. Study 2 very likely reuses the 86-couple IM sample of Slatcher & Pennebaker 2006 (both report 86 couples, IMs and a 3-month follow-up). The abstract does not state the overlap, so treat it as inferred and not as an independent replication.
- **Data/code availability:** Not verified.
- **Verification:** Abstract only.

### 15. Detecting flirting in speed dates (Ranganath, Jurafsky & McFarland, 2009)
- **Citation:** Ranganath, R., Jurafsky, D., & McFarland, D. (2009). It's not you, it's me: Detecting flirting and its misperception in speed-dates. *Proceedings of EMNLP 2009*, 334–342. https://aclanthology.org/D09-1035/
- **Question:** Can intended and perceived flirting be detected from what is said in a date?
- **Data:** The Stanford SpeedDate corpus: about 1,100 four-minute dates from three 2005 sessions with graduate students. 991 dates are in the corpus and 946 had complete audio, transcripts and surveys. Both people rated the speaker's flirtatiousness.
- **Method:** Prosodic, dialogue and lexical features. An autoencoder compresses sparse lexical features into 30 features. RBF-kernel SVM. Binary classification of each side of the conversation, with chance at 50%.
- **Key results:** Flirt intention: 69.0% accuracy for men and 71.5% for women. Flirt perception: 79.5% for men and 68.0% for women, up from 71% and 60% in earlier work. The system beat the human partners, who tended to project their own intent onto the other person.
- **Takeaway for relationship prediction:** Conversation features beat the partner's own judgement of romantic intent.
- **Limitations:** Small training set. Labels are self and partner ratings, not relationship formation.
- **Data/code availability:** Not verified.
- **Verification:** Full text (ACL PDF).

### 16. Friendly, flirtatious, awkward and assertive speech (Ranganath, Jurafsky & McFarland, 2013)
- **Citation:** Ranganath, R., Jurafsky, D., & McFarland, D. A. (2013). Detecting friendly, flirtatious, awkward, and assertive speech in speed-dates. *Computer Speech & Language*, 27(1), 89–115. https://doi.org/10.1016/j.csl.2012.01.005
- **Question:** Which interpersonal stances in a date can be detected from speech and words, and do models generalize to new people?
- **Data:** The same SpeedDate corpus: about 60 hours of speech and about 800,000 words. 946 clean dates averaging 812 words and 93 turns. Self and partner ratings on a 1–10 scale.
- **Method:** Top 10% vs. bottom 10% of each stance, self- and partner-labelled. SVM and L1 logistic regression with 30 runs of 5-fold CV. A speaker-independent test trains on two events and tests on the third.
- **Key results:** Up to 75% accuracy on seen speakers (50% baseline) and up to 59% on new speakers (48% baseline). Mean SVM accuracy is 0.69 for deciles and 0.62 for quartiles. Flirtation links to joint focus on the woman; awkwardness links to low involvement.
- **Takeaway for relationship prediction:** Accuracy drops sharply for unseen speakers, which is the realistic case.
- **Limitations:** One elite-university, heterosexual sample from 2005. Extreme-group labels inflate accuracy.
- **Data/code availability:** No public release statement seen.
- **Verification:** Full text (author-hosted PDF).

### 17. Making the connection (McFarland, Jurafsky & Rawlings, 2013)
- **Citation:** McFarland, D. A., Jurafsky, D., & Rawlings, C. (2013). Making the connection: Social bonding in courtship situations. *American Journal of Sociology*, 118(6), 1596–1649 (volume, issue and pages not verified). JSTOR stable identifier 10.1086/670240. Author-hosted copy: https://sites.socsci.uci.edu/~lpearl/courses/readings/McFarlandEyAl2013_SocialBonding.pdf
- **Question:** What conversational behaviour makes two people feel they "clicked"?
- **Data:** The SpeedDate corpus, 947 dates with audio and transcripts. Missing ratings were multiply imputed.
- **Method:** Actor–partner interdependence models. Features: 6 prosodic factors, laughter, mimicry of 193 function words, appreciations, sympathy, interruptions, questions and hedges, with trait and homophily controls. Outcome: each person's 1–10 "clicked" rating, plus willingness to date.
- **Key results:** Bonding occurs when the woman is the focus and engaged, and the man shows alignment and understanding. The authors call this a "reciprocal asymmetrical performance". Coefficients and variance explained: not verified.
- **Takeaway for relationship prediction:** Who talks about whom, and how partners align, matters more than raw volume.
- **Limitations:** Associational, not out-of-sample. Same sample as #15 and #16.
- **Data/code availability:** Not verified.
- **Verification:** Full text, partially read (abstract and methods; no coefficients extracted).

### 18. First-contact messages in online dating (Schoendienst & Dang-Xuan, 2011)
- **Citation:** Schoendienst, V., & Dang-Xuan, L. (2011). The role of linguistic properties in online dating communication: A large-scale study of contact initiation messages. *PACIS 2011 Proceedings*, paper 169. https://aisel.aisnet.org/pacis2011/169
- **Question:** Do linguistic properties of a first message predict whether the recipient replies?
- **Data:** 167,276 first messages from an unnamed online dating platform.
- **Method:** LIWC features and regression.
- **Key results:** The abstract gives no direction of effects or coefficients. Not verified.
- **Takeaway for relationship prediction:** Included as a large-scale test of message language against a romantic-initiation outcome. Caveat: it models only one side of the exchange.
- **Limitations:** One message, one platform, conference paper, full text unavailable.
- **Data/code availability:** Not verified.
- **Verification:** Abstract only.

### 19. Breakups on Twitter (Garimella, Weber & Dal Cin, 2014)
- **Citation:** Garimella, K., Weber, I., & Dal Cin, S. (2014). From "I love you babe" to "leave me alone": Romantic relationship breakups on Twitter. *Proceedings of SocInfo 2014*. arXiv:1409.5980. https://arxiv.org/abs/1409.5980
- **Question:** How do couples' public interactions change before and after a breakup?
- **Data:** Public Twitter data for 661 couples who broke up. Couples were found through profile mentions such as "@user2 is the best boyfriend ever".
- **Method:** Analysis of interaction and language before and after the breakup.
- **Key results:** Closeness before predicts closeness after. "Stonewalling", meaning ignoring the partner's messages, signals a pending breakup. Post-breakup depression shows in tweets. Batch unfriending causes sudden drops of 15–20 followers and friends. No prediction accuracy in the abstract.
- **Takeaway for relationship prediction:** Changes in how partners address each other carry an early breakup signal. Caveat: the signal mixes language and reply behaviour.
- **Limitations:** Public tweets only, self-identified couples, and descriptive rather than predictive as far as the abstract shows.
- **Data/code availability:** Not verified.
- **Verification:** Abstract only.

### 20. Predicting first dates from messages (Huang & Hancock, 2022)
- **Citation:** Huang, S. A., & Hancock, J. T. (2022). Will you go on a date with me? Predicting first dates from linguistic traces in online dating messages. *Journal of Language and Social Psychology*, 41(4), 371–395. https://doi.org/10.1177/0261927X211066612
- **Question:** Can the language two people exchange on a dating app predict whether they meet?
- **Data:** Online dating message exchanges in two studies; the second is a new hold-out set. Platform and sample sizes: not verified.
- **Method:** Language features grouped into interpersonal processes, then tested on the hold-out study. Details beyond the abstract (e.g. LIWC features, logistic regression) come from a secondary source and are not verified.
- **Key results:** Study 1 found five processes linked to first dates: investment, interdependence, emotional dynamics, decision-making and coordination. Study 2 confirmed prediction "above chance". Accuracy or AUC: not verified.
- **Takeaway for relationship prediction:** The closest modern analogue to predicting a romantic outcome from a two-person text thread.
- **Limitations:** Numbers and platform not verified; paywalled.
- **Data/code availability:** SAGE hosts a figshare collection for the article; its contents are not verified.
- **Verification:** Abstract only.

### 21. LLMs and verbal indicators of romantic attraction (Matz et al., 2024)
- **Citation:** Matz, S. C., Peters, H., Cerf, M., Grunenberg, E., Eastwick, P. W., Back, M. D., & Finkel, E. J. (2024; v2 2025). Can large language models detect verbal indicators of romantic attraction? arXiv:2407.10989. https://arxiv.org/abs/2407.10989
- **Question:** Can an LLM judge from a transcript whether a speed date went well?
- **Data:** Transcripts of 964 real speed dates. The source corpus is not named on the abstract page.
- **Method:** ChatGPT (version not stated on the abstract page) rated the dates. A Brunswik lens analysis compared the cues it used with valid cues.
- **Key results:** Predictions correlate with objective and subjective date success at r = 0.12–0.23. Match predictions are on par with human judges and add to the daters' own predictions. Overlap with human observers is r = 0.21–0.35.
- **Takeaway for relationship prediction:** LLMs extract some real signal, but correlations are low. Strong claims from short exchanges deserve scepticism.
- **Limitations:** Low predictive performance; no venue listed; abstract-level detail only.
- **Data/code availability:** Not verified.
- **Verification:** Abstract only.

### 22. Extracting social power relationships (Bramsen et al., 2011)
- **Citation:** Bramsen, P., Escobar-Molano, M., Patel, A., & Alonso, R. (2011). Extracting social power relationships from natural language. *Proceedings of ACL-HLT 2011*, 773–782. https://aclanthology.org/P11-1078/
- **Question:** Can the direction of power (writing up vs. down) be read from email text?
- **Data:** Enron email (CALO version), 245K emails and about 90M words. Only emails between two people in a known superior/subordinate relation were used. Train: 431 upward and 328 downward links. Test: 232 upward and 148 downward links. Train and test are split by author.
- **Method:** SVM with class weighting. Word n-grams, POS n-grams, "binned" n-grams and polite-imperative features.
- **Key results:** Binned n-grams plus polite imperatives: 83.9% 10-fold CV accuracy and 78.9% on the unweighted test set. Best weighted-test accuracy: 78.1%. Unigrams alone: 55.4% CV and 62.1% weighted test. Baselines: 50% (weighted, CV) and 74% majority (unweighted test).
- **Takeaway for relationship prediction:** Splitting by author matters; otherwise models learn idiolect and scores inflate.
- **Limitations:** A few hundred links in one company. The unweighted result is only about 5 points over majority.
- **Data/code availability:** Enron is public; release of their role labels not verified.
- **Verification:** Full text (ACL PDF).

### 23. Echoes of power (Danescu-Niculescu-Mizil, Lee, Pang & Kleinberg, 2012)
- **Citation:** Danescu-Niculescu-Mizil, C., Lee, L., Pang, B., & Kleinberg, J. (2012). Echoes of power: Language effects and power differences in social interaction. *Proceedings of WWW 2012*. arXiv:1112.3670. https://arxiv.org/abs/1112.3670
- **Question:** Do people echo the language style of those with more power?
- **Data:** Wikipedia talk pages (240,436 exchanges plus about 32,000 adminship-vote conversations). US Supreme Court oral arguments (50,389 exchanges, 204 cases, 11 Justices, 311 lawyers).
- **Method:** Style coordination on 8 LIWC function-word classes. Pairwise SVM for "who has higher status".
- **Key results:** People coordinate more toward higher-power targets, and behaviour shifts after promotion to admin. Coordination features: 57.7% (wiki) and 70.4% (court) in-domain; 57.1% and 55.0% cross-domain (50% baseline). Bag of words: 99.5% in-domain on court but 45.2% and 40.1% cross-domain. Two humans reached only about 70% on Wikipedia.
- **Takeaway for relationship prediction:** Style features transfer across settings; topical words overfit badly.
- **Limitations:** Group discussions, not private messages. Framed as a generalization test, not a system.
- **Data/code availability:** Not verified.
- **Verification:** Full text (arXiv and author PDF).

### 24. Phrases that signal workplace hierarchy (Gilbert, 2012)
- **Citation:** Gilbert, E. (2012). Phrases that signal workplace hierarchy. *Proceedings of CSCW 2012*, 1037–1046. https://doi.org/10.1145/2145204.2145359
- **Question:** Which words and phrases mark email sent to a superior?
- **Data:** Enron email; size of the subset used not verified.
- **Method:** Phrase-level analysis of messages sent up vs. at the same level or down. Model details not verified.
- **Key results:** Some phrases are strong predictors. "thought you would" suggests the recipient outranks the sender; "let's discuss" suggests the reverse. Messages to bosses show cognitive-process words less often. Accuracy not verified.
- **Takeaway for relationship prediction:** Short phrases carry hierarchy cues that a classifier can use.
- **Limitations:** One company; no verified accuracy.
- **Data/code availability:** The abstract says the predictive phrases were released as a public dataset.
- **Verification:** Abstract only.

### 25. Power from a single thread (Prabhakaran & Rambow, 2014)
- **Citation:** Prabhakaran, V., & Rambow, O. (2014). Predicting power relations between participants in written dialog from a single thread. *Proceedings of ACL 2014 (Short Papers)*, 339–344. https://aclanthology.org/P14-2056/
- **Question:** Can one short email thread reveal who is the superior?
- **Data:** 36,196 Enron threads (about 3 messages each). Gold hierarchy from Agarwal et al. (2012), with 13,724 dominance pairs. 15,048 related interacting pairs, split 50/25/25.
- **Method:** Lexical n-grams plus dialogue-structure features (who initiated, message and token counts) and dialogue-act rates.
- **Key results:** Blind test: majority 55.0%, n-gram baseline 68.3%, lexical 68.1%, best (lexical + structure) 73.0%. Superiors tend to start threads and contribute more.
- **Takeaway for relationship prediction:** Conversation structure adds signal beyond words, even in a few messages.
- **Limitations:** Assumes a power relation exists; direction only; one company.
- **Data/code availability:** Not verified.
- **Verification:** Full text (ACL PDF).

### 26. Predicting tie strength with social media (Gilbert & Karahalios, 2009)
- **Citation:** Gilbert, E., & Karahalios, K. (2009). Predicting tie strength with social media. *Proceedings of CHI 2009*. https://doi.org/10.1145/1518701.1518736
- **Question:** Can the strength of a friendship be predicted from social media interaction?
- **Data:** 35 participants rated 2,184 Facebook friendships in a lab session.
- **Method:** 74 variables in seven dimensions (intensity, intimacy, duration, reciprocal services, structural, emotional support, social distance). They mix metadata with content, such as words exchanged and intimacy words in wall and inbox text. Linear model with interaction terms.
- **Key results:** Adjusted R² = 0.534 and mean absolute error 0.0994 on a 0–1 scale. Strong vs. weak accuracy is 87.2% (abstract: "over 85%"). The top 15 variables carry over half the information. No cross-validation, which the authors justify by the constrained model.
- **Takeaway for relationship prediction:** Many weak signals combined beat any single one. Included as core with a caveat: text content is only part of the feature set.
- **Limitations:** Small university sample. Ties kept up through other channels are invisible.
- **Data/code availability:** No release; data stayed in the lab for privacy.
- **Verification:** Full text (author PDF).

---

## Adjacent studies (metadata, self-report, or non-dialogue input; not counted as core)

### A1. Predicting tie strength in a new medium (Gilbert, 2012)
- **Citation:** Gilbert, E. (2012). Predicting tie strength in a new medium. *Proceedings of CSCW 2012*. DOI 10.1145/2145204.2145360 inferred from the file name, not verified. PDF: https://courses.cs.umbc.edu/graduate/691/spring21/pdf/2145204.2145360.pdf
- **Question:** Does the Facebook tie-strength model transfer to Twitter unchanged?
- **Data:** A public Twitter app estimated more than 200,000 relationships for 2,114 users in 52 countries.
- **Method:** The 2009 coefficients were applied to Twitter analogues, e.g. @-replies for wall posts. No retraining. Whether text-content features were used on Twitter is not verified.
- **Key results:** 236 users corrected 1,105 of 14,075 eligible relationships (7.85%). Doubling for missed ties gives an upper-bound error of 15.7%, against 12–13% on Facebook. A "message at least N times" rule reaches at most 61%.
- **Takeaway for relationship prediction:** A theory-driven model can transfer across platforms.
- **Limitations:** Only correcting users analysed; missed ties estimated.
- **Data/code availability:** Not verified.
- **Verification:** Full text.

### A2. Life facets from smartphone logs (Min, Wiese, Hong & Zimmerman, 2013)
- **Citation:** Min, J.-K., Wiese, J., Hong, J. I., & Zimmerman, J. (2013). Mining smartphone data to classify life-facets of social relationships. *Proceedings of CSCW 2013*, 285–294. https://doi.org/10.1145/2441776.2441810
- **Question:** Can call and SMS logs tell family, work and social contacts apart?
- **Data:** Call and text logs from 40 users.
- **Method:** Machine learning on intensity, regularity, medium and timing. Algorithm not verified.
- **Key results:** "Up to 90.5% accuracy". Key features: call duration, channel choice and time of day. Baseline and protocol not verified.
- **Takeaway for relationship prediction:** Metadata alone carries relationship-type signal.
- **Limitations:** Small sample; "up to" suggests a best case.
- **Data/code availability:** Not verified.
- **Verification:** Abstract only.

### A3. Call and SMS logs do not always indicate tie strength (Wiese, Min, Hong & Zimmerman, 2015)
- **Citation:** Wiese, J., Min, J.-K., Hong, J. I., & Zimmerman, J. (2015). "You never call, you never write": Call and SMS logs do not always indicate tie strength. *Proceedings of CSCW 2015*, 765–774. https://doi.org/10.1145/2675133.2675143
- **Question:** How well does communication volume track tie strength?
- **Data:** Call and SMS logs plus ground truth from 36 participants, with interviews.
- **Method:** Frequency and duration features; details not verified.
- **Key results:** Frequent or long contact likely means a strong tie, but logs "produced many errors" separating strong and weak ties. Error rates not verified.
- **Takeaway for relationship prediction:** Volume alone misses close ties kept up elsewhere.
- **Limitations:** Small sample.
- **Data/code availability:** Not verified.
- **Verification:** Abstract only.

### A4. Instant messaging and relationship estimation (Dwarakanath et al., 2016)
- **Citation:** Dwarakanath, R., Charrier, J., Englert, F., Hans, R., Stingl, D., & Steinmetz, R. (2016). Analyzing the influence of instant messaging on user relationship estimation. *IEEE International Conference on Mobile Services 2016*. PDF: https://www.kom.tu-darmstadt.de/papers/DCE+16-1.pdf
- **Question:** Does adding IM metadata improve estimates of social circle and tie strength?
- **Data:** 8 analysed participants, 249 contacts, 7,191 events (680 calls, 246 SMS, 6,265 IM messages).
- **Method:** Random forest on counts, timing, channel share, location, emoticon counts and read rates. No content beyond emoticons.
- **Key results:** 77% accuracy (κ = 0.33) for social circle and 76% (κ = 0.42) for strong vs. weak. Friends and hobby contacts use IM more; family and work use calls more.
- **Takeaway for relationship prediction:** Channel choice differs by relationship type.
- **Limitations:** Very small sample.
- **Data/code availability:** Not verified.
- **Verification:** Full text.

### A5. Transactional information and link strength (Kahanda & Neville, 2009)
- **Citation:** Kahanda, I., & Neville, J. (2009). Using transactional information to predict link strength in online social networks. *Proceedings of ICWSM 2009*, 74–81. https://doi.org/10.1609/icwsm.v3i1.13957
- **Question:** Which features best predict strong links on Facebook?
- **Data:** Public data from the Purdue Facebook network.
- **Method:** Supervised learning comparing attribute, network and transactional features.
- **Key results:** Strong relationships can be "accurately" predicted; transactional features are most influential. Numbers not verified.
- **Takeaway for relationship prediction:** Interaction events beat profile attributes.
- **Limitations:** No verified figures.
- **Data/code availability:** Not verified.
- **Verification:** Abstract only.

### A6. Friendship from mobile phone data (Eagle, Pentland & Lazer, 2009)
- **Citation:** Eagle, N., Pentland, A., & Lazer, D. (2009). Inferring friendship network structure by using mobile phone data. *PNAS*, 106(36), 15274–15278. https://doi.org/10.1073/pnas.0900282106
- **Question:** Can phone-sensed behaviour recover self-reported friendships?
- **Data:** 94 people at one institution over 9 months: call logs, Bluetooth proximity, cell towers and app use.
- **Method:** Factor analysis into in-role and extra-role factors; MRQAP models.
- **Key results:** 95% of mutual friendships recovered (21 of 22) and 96% of non-friends (901 of 935). Only 21 of 67 predicted friendships were real. Inferred friendships predicted job satisfaction slightly better than self-reports (adj. R² .180 vs. .161).
- **Takeaway for relationship prediction:** High recall can hide low precision when non-friends vastly outnumber friends.
- **Limitations:** One institution, small N, privacy concerns.
- **Data/code availability:** Not verified.
- **Verification:** Full text.

### A7. Romantic partners and dispersion (Backstrom & Kleinberg, 2014)
- **Citation:** Backstrom, L., & Kleinberg, J. (2014). Romantic partnerships and the dispersion of social ties. *Proceedings of CSCW 2014*, 831–841. https://doi.org/10.1145/2531602.2531642 (arXiv:1310.6753)
- **Question:** Can a user's romantic partner be identified from network structure and interaction?
- **Data:** About 1.3 million Facebook users who list a partner.
- **Method:** Embeddedness, a new "dispersion" measure and interaction features, combined with boosted trees. No message content.
- **Key results:** Top-1 precision: embeddedness 24.7%, recursive dispersion 50.6% (60.7% for married users), all features 70.5%. When dispersion fails, the couple is more likely to switch to single within 60 days.
- **Takeaway for relationship prediction:** Network structure identifies partners well without reading any messages.
- **Limitations:** Proprietary data; self-declared status.
- **Data/code availability:** Facebook-internal.
- **Verification:** Full text.

### A8. Is romantic desire predictable? (Joel, Eastwick & Finkel, 2017)
- **Citation:** Joel, S., Eastwick, P. W., & Finkel, E. J. (2017). Is romantic desire predictable? Machine learning applied to initial romantic attraction. *Psychological Science*, 28, 1478–1489. https://doi.org/10.1177/0956797617714580
- **Question:** Can pre-date self-reports predict who will desire whom?
- **Data:** Two speed-dating studies with more than 100 self-report measures per person.
- **Method:** Random forests.
- **Key results:** 4–18% of actor variance and 7–27% of partner variance predicted, but no dyad-specific variance.
- **Takeaway for relationship prediction:** Traits measured beforehand cannot predict the specific match, which motivates using the conversation itself.
- **Limitations:** No language data.
- **Data/code availability:** Not verified.
- **Verification:** Abstract only.

### A9. Language left behind after a breakup (Seraj, Blackburn & Pennebaker, 2021)
- **Citation:** Seraj, S., Blackburn, K. G., & Pennebaker, J. W. (2021). Language left behind on social media exposes the emotional and cognitive costs of a romantic breakup. *PNAS*, 118, e2017154118. https://doi.org/10.1073/pnas.2017154118
- **Question:** Does a person's language change around a breakup?
- **Data:** 1,027,541 posts from 6,803 Reddit users across two years; replications on divorce and other upheavals.
- **Method:** LIWC time series.
- **Key results:** Markers appear 3 months before the breakup, peak that week, and return to baseline about 6 months later. I-words, we-words and cognitive words rise; analytic thinking falls.
- **Takeaway for relationship prediction:** Breakups leave a lead signal in text, even outside relationship forums.
- **Limitations:** One person's posts, not an exchange; self-disclosed breakups; no classifier.
- **Data/code availability:** Not verified.
- **Verification:** Abstract only.

### A10. Language convergence in new couples' texts (Brinberg & Ram, 2021)
- **Citation:** Brinberg, M., & Ram, N. (2021). Do new romantic couples use more similar language over time? Evidence from intensive longitudinal text messages. *Journal of Communication*, 71(3), 454–477. https://doi.org/10.1093/joc/jqab012
- **Question:** Do couples' messages become more alike as the relationship forms?
- **Data:** 41 college couples donated iMessage histories: 1,045,340 messages, 1,001,454 analysed.
- **Method:** Daily LSM, LSA and cosine similarity with nonlinear growth models.
- **Key results:** Alignment rose toward an asymptote on all three measures (p < .001), mostly before couples said they became a couple. No outcome was predicted.
- **Takeaway for relationship prediction:** A template for data-donation studies that could support outcome prediction. Classed as adjacent because it is descriptive.
- **Limitations:** Convenience sample; no outcome test.
- **Data/code availability:** Private; kept on secure servers.
- **Verification:** Full text.

### A11. Technology use in romantic relationships (Schade et al., 2013)
- **Citation:** Schade, L. C., Sandberg, J., Bean, R., Busby, D., & Coyne, S. (2013). Using technology to connect in romantic relationships: Effects on attachment, relationship satisfaction, and stability in emerging adults. *Journal of Couple & Relationship Therapy*, 12(4), 314–338. https://doi.org/10.1080/15332691.2013.836051
- **Question:** How does self-reported texting relate to attachment, satisfaction and stability?
- **Data:** Self-reported texting behaviour, not actual messages. Sample size not verified.
- **Method:** Correlational survey analysis.
- **Key results:** Not verified; no abstract or full text was read.
- **Takeaway for relationship prediction:** Shows the self-report tradition that message-content studies aim to replace.
- **Limitations:** Self-report only; no text analysis.
- **Data/code availability:** Not verified.
- **Verification:** Bibliographic record only.

### A12. LLMs and relationships in detective narratives (Zhao et al., 2024)
- **Citation:** Zhao, R., Zhu, Q., Xu, H., Li, J., Zhou, Y., He, Y., & Gui, L. (2024). Large language models fall short: Understanding complex relationships in detective narratives. arXiv:2402.11051. https://arxiv.org/abs/2402.11051
- **Question:** Can LLMs recover complex, perspective-dependent character relationships from narratives?
- **Data:** The Conan benchmark of relation graphs from detective stories, including public and secret relationships.
- **Method:** GPT-3.5, GPT-4 and Llama2.
- **Key results:** LLMs struggle with complex relationships and long narratives. Numbers and venue not verified.
- **Takeaway for relationship prediction:** Hidden relationships are hard even for strong models.
- **Limitations:** Narrative text, not exchanged messages.
- **Data/code availability:** Not verified.
- **Verification:** Abstract only.
