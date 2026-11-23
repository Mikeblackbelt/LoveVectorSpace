# Datasets and LLM work for predicting the relationship between two people from their conversations / messages

Research date: 2026-11-23. Verification levels: items without a tag were opened directly (arXiv / ACL Anthology / dataset page / README / data files). Items tagged **[snippet only]** rest on search-result snippets of the linked page and the page itself was NOT opened; items tagged **not verified** could not be confirmed at all. Directly opened: 11 datasets (DDRel, PRIDE, DialogRE, MPDD [abstract], SCRIPTS, SocialDial, SODA, SOTOPIA, CPED, CANDOR, Cornell Movie-Dialogs) and 6+ LLM papers (Kim 2026, Li 2024, Sancheti 2024, Matz 2024/25, Zhao 2024, SOTOPIA, PIVOTSBench, Love First Know Later). Numbers are as stated on the cited page; where two sources disagree, both are given.

## Key Question 1: Which datasets can be used to predict the relationship between two people from their dialogue or messages?

### Takeaway
Labeled corpora for interpersonal relation classification are almost all built from **fiction** (movie scripts, TV transcripts): DDRel (13 labels, English), PRIDE (directed, multi-label, movies + 14 TV series), DialogRE (Friends, ~17 interpersonal of 36 relation types, EN+ZH), MPDD (Chinese TV, per-utterance speaker-listener relation), SCRIPTS (EN+KO, ~50 PRIDE-derived relations, soft labels). Real human-human text with relationship ground truth is rare and restricted: Enron (workplace hierarchy), CANDOR and SpeedDate (stranger / dating outcomes, spoken), WhatsApp data-donation corpora (restricted). SMS and Reddit corpora are large but carry no pairwise relationship labels.

### Cited Findings

**A. Labeled relation-classification corpora (core)**

1. **DDRel** (2021). Qi Jia, Hongru Huang, Kenny Q. Zhu, "DDRel: A New Dataset for Interpersonal Relation Classification in Dyadic Dialogues," AAAI 2021 (arXiv:2012.02553). Source: movie scripts crawled from IMSDb. English. 6,300 dyadic sessions, 694 speaker pairs, 53,126 utterances — [arXiv](https://arxiv.org/abs/2012.02553); [AAAI](https://ojs.aaai.org/index.php/AAAI/article/view/17551)
   - 13 labels: Child-Parent, Child-Other Family Elder, Siblings, Spouse, Lovers, Courtship, Friends, Neighbors, Roommates, Workplace Superior-Subordinate, Colleagues/Partners, Opponents, Professional Contact. Coarser schemes: 4 classes (Family, Intimacy, Others, Official) and 6 classes — [ar5iv full text](https://ar5iv.labs.arxiv.org/html/2012.02553)
   - Split: train 5,037 sessions / 541 pairs; dev 653 / 75; test 610 / 78 — [ar5iv](https://ar5iv.labs.arxiv.org/html/2012.02553)
   - Baselines (acc / macro-F1, %): session-level 13-class BERT 39.40 / 20.40 vs human 38.50 / 40.75; pair-level 13-class BERT 39.73 / 24.07 vs human 63.45 / 54.40; 4-class pair-level BERT 58.13 / 52.00 vs human 75.65 / 73.00 — [ar5iv](https://ar5iv.labs.arxiv.org/html/2012.02553)
   - Access: public, GitHub https://github.com/JiaQiSJTU/DialogueRelationClassification — [ar5iv](https://ar5iv.labs.arxiv.org/html/2012.02553)
   - Label taxonomy follows Reis & Sprecher — [search summary of PwC/arXiv](https://paperswithcode.com/dataset/ddrel) (secondary)

2. **PRIDE datasets** (2021). Anna Tigunova, Paramita Mirza, Andrew Yates, Gerhard Weikum, "PRIDE: Predicting Relationships in Conversations," EMNLP 2021, pp. 4636–4650, doi:10.18653/v1/2021.emnlp-main.380. Releases large-scale datasets of **directed, fine-grained, multi-label** relationships of conversation participants from movie and TV screenplays; PRIDE model (BERT + Transformer + speaker/style knowledge) beats baselines on both — [ACL Anthology](https://aclanthology.org/2021.emnlp-main.380/)
   - Files: movies_relationships.json (character pairs from the Scriptbase-J corpus, https://github.com/EdinburghNLP/scriptbase), series_relationships.json, series_conversations.tar.gz (dialogue turns per pair from **14 TV series**, crawled from transcripts.foreverdreaming.org). Record format: title, pair "NAME1:::NAME2", labels (directed, e.g., "child" = NAME1 is child of NAME2) — [PRIDE README](https://pkb.mpi-inf.mpg.de/pride_data/README.txt)
   - Access: public download at https://pkb.mpi-inf.mpg.de/pride_data/ ; no license stated in README — [README](https://pkb.mpi-inf.mpg.de/pride_data/README.txt)
   - Counts computed directly from the downloaded public JSON files (2026-11-23): **movies_relationships.json = 783 labeled character pairs from 254 films, 19 distinct labels**: friend 208, lover 188, spouse 69, colleague 67, child 48, parent 41, sibling 37, employee 34, boss 29, enemy 27, medical 19, commercial 19, distant 11, classmate 10, teacher 9, student 5, engaged 5, idol 1, church 1. **series_relationships.json = 365 pairs from 14 series, 15 distinct labels**: friend 107, lover 79, colleague 67, spouse 26, employee 21, distant 17, sibling 16, parent 15, child 15, enemy 7, classmate 5, teacher 4, boss 4, student 1, commercial 1 — [PRIDE data directory](https://pkb.mpi-inf.mpg.de/pride_data/) (files movies_relationships.json, series_relationships.json). Label distribution is heavily skewed toward friend/lover. Conversation-turn counts in series_conversations.tar.gz not computed.
   - SCRIPTS (2025/26) says it adapts "about 50" relationships from PRIDE — [arXiv 2510.19028 HTML](https://arxiv.org/html/2510.19028v1); the released files above contain 19 labels, so the ~50 list presumably comes from the paper's broader taxonomy (not verified; PDF text not extractable).

3. **DialogRE** (2020). Dian Yu, Kai Sun, Claire Cardie, Dong Yu, "Dialogue-Based Relation Extraction," ACL 2020 (arXiv:2004.08056) — [arXiv](https://arxiv.org/abs/2004.08056)
   - Source: complete transcripts of the sitcom *Friends*; English and Chinese; 1,788 dialogues; 36 relation types — [dataset.org/dialogre](https://dataset.org/dialogre/). 8,119 argument pairs (as reported by Li et al. 2024) — [arXiv 2404.17802 HTML](https://arxiv.org/html/2404.17802v1)
   - Interpersonal relation types include per:spouse, per:friends, per:girl/boyfriend, per:dates, per:siblings, per:parents, per:children, per:other_family, per:roommate, per:neighbor, per:acquaintance, per:alumni, per:boss, per:subordinate, per:client, per:positive_impression, per:negative_impression — [dataset.org/dialogre](https://dataset.org/dialogre/)
   - Access: public, https://github.com/nlpdata/dialogre — [dataset.org/dialogre](https://dataset.org/dialogre/). Versions V1 and V2 (V2 corrects annotation errors) — [arXiv 2404.17802 HTML](https://arxiv.org/html/2404.17802v1)
   - Note: it is multi-party relation *extraction* over argument pairs (often named entities), not dyadic relationship classification.

4. **MPDD** (2020). Yi-Ting Chen, Hen-Hsen Huang, Hsin-Hsi Chen, "MPDD: A Multi-Party Dialogue Dataset for Analysis of Emotions and Interpersonal Relationships," LREC 2020, pp. 610–614. Chinese TV-series scripts; each utterance labeled with emotion and interpersonal relationship; 25,548 utterances in 4,142 dialogues — [ACL Anthology](https://aclanthology.org/2020.lrec-1.76/)
   - A later paper reports 4,141 dialogues / 25,546 turns (minor discrepancy) — [arXiv 2410.13727](https://arxiv.org/pdf/2410.13727) (via search snippet)
   - Labels per utterance: emotion (Ekman 7), listener, speaker-listener relationship; five TV series; hosted at http://nlg.csie.ntu.edu.tw/nlpresource/MPDD/ under CC-BY-NC — search snippets of [LREC PDF](https://www.cs.nccu.edu.tw/~hhhuang/docs/lrec2020d.pdf) and [CRECIL paper](https://napier-repository.worktribe.com/OutputFile/3134576); the hosting page returned HTTP 403 to my fetch, so current availability **not verified**
   - Number/names of relation labels: **not verified** (PDF unreadable).

5. **SCRIPTS** (2025 arXiv; ACL 2026). Eunsu Kim, Junyeong Park, Juhyun Oh, Kiwoong Park, Seyoung Song, A. Seza Doğruöz, Alice Oh, Najoung Kim. "Are they lovers or friends? Evaluating LLMs' Social Reasoning in English and Korean Dialogues," ACL 2026 (Long), pp. 23431–23451, doi:10.18653/v1/2026.acl-long.1074 — [ACL Anthology](https://aclanthology.org/2026.acl-long.1074/)
   - 60 movie scripts (28 English from IMSDb; 32 Korean from the Korean Film Archive and an online Korean script community); 1,147 dialogues (580 EN, 567 KO); ~42% have three speakers with one target pair. Soft labels per relationship: Highly Likely / Less Likely / Unlikely, over ~50 relationships adapted from PRIDE; also annotated intimacy, formality, hierarchy, age, gender. Access: https://github.com/rladmstn1714/SCRIPTS — [arXiv HTML](https://arxiv.org/html/2510.19028v1)

**B. Social-context dialogue corpora with relationship/social-factor metadata (synthetic or partly synthetic)**

6. **SocialDial** (2023). Haolan Zhan et al., "SocialDial: A Benchmark for Socially-Aware Dialogue Systems," SIGIR 2023 (arXiv:2304.12026). Chinese; 1,563 human-human multi-turn dialogues + 4,870 ChatGPT-synthesized conversations (ontology-based, quality-controlled). Labels: social relation, context, social distance, social norms (5 norm categories / 14 subcategories) — [arXiv](https://arxiv.org/abs/2304.12026)
   - Relation label inventory and download URL: **not verified** (arXiv page lists no data link).

7. **SODA** (2023). Hyunwoo Kim et al., "SODA: Million-scale Dialogue Distillation with Social Commonsense Contextualization," EMNLP 2023 (arXiv:2212.10465). Dialogues generated by an LLM from ATOMIC commonsense triples — [arXiv](https://arxiv.org/abs/2212.10465)
   - HF `allenai/soda`: ~1.49M rows (train ~1.19M / val ~146k / test ~149k); fields include head, relation, tail, literal, narrative, dialogue, speakers, PersonX/Y/Z; CC-BY-4.0 — [Hugging Face](https://huggingface.co/datasets/allenai/soda)
   - Caveat: the `relation` field holds **ATOMIC commonsense relations** (xIntent, xReact, ...), not interpersonal relationship labels; any speaker relationship (e.g., "X's friend") lives only in narrative text — [Hugging Face](https://huggingface.co/datasets/allenai/soda). The brief's claim that SODA "has relationship labels" is therefore **not supported** by the dataset card.

8. **SOTOPIA** (2023/24) scenario set. Xuhui Zhou et al., "SOTOPIA: Interactive Evaluation for Social Intelligence in Language Agents," arXiv:2310.11667 (v2 Mar 2024). 90 scenarios, 40 characters, 90 relationships, 450 tasks; character relationship types: family, friend, romantic, acquaintance, stranger — [arXiv HTML](https://arxiv.org/html/2310.11667v2). (Venue commonly cited as ICLR 2024 — not confirmed on the page I read.) Episodes are LLM-generated, so this is a simulation resource, not natural data.

9. **CPED** (2022). Yirong Chen et al., "CPED: A Large-Scale Chinese Personalized and Emotional Dialogue Dataset for Conversational AI," arXiv:2205.14727. 12K+ dialogues, 392 speakers, 40 Chinese TV shows; annotations: gender, Big Five, 13 emotions, 19 dialogue acts, 10 scenes; https://github.com/scutcyr/CPED — [arXiv](https://arxiv.org/abs/2205.14727). **No relationship labels mentioned** on the abstract page; useful only as speaker-attribute/emotion side information.

**C. Natural (non-fiction) conversation data with relationship-relevant ground truth**

10. **Enron email + organizational hierarchy gold standard** (2012) **[snippet only]**. Apoorv Agarwal, Adinoyi Omuya, Aaron Harnly, Owen Rambow, ACL 2012 (P12-2032). 1,518 employees; 13,724 dominance pairs; 2,155 immediate manager–subordinate links; applied to the Yeh & Harnly (2006) corpus version (145 core employees' mailboxes, 111,933 messages) — [ACL Anthology](https://aclanthology.org/P12-2032/). Used for power-relation prediction by later work, e.g., Power Networks (arXiv:1807.06557) — [arXiv](https://arxiv.org/pdf/1807.06557) **[snippet only]**. Label = workplace superior/subordinate only. Access terms for the corpus and hierarchy file: **not verified**.

11. **CANDOR corpus** (2023). Andrew Reece et al., "The CANDOR corpus: Insights from a large multimodal dataset of naturalistic conversation," *Science Advances* 9, eadf3197 (2023). 1,650 video-chat conversations between **strangers**, 1,454 unique participants; pre/post surveys (~200 fields) incl. i_like_you, you_like_me, in_common; speaker demographics. Access: **by request** from BetterUp (transcripts only); ConvoKit gives a conversion notebook but does not redistribute — [ConvoKit CANDOR docs](https://convokit.cornell.edu/documentation/candor.html). Use: rapport/liking prediction, not relationship type (all pairs are strangers).

12. **Stanford SpeedDate corpus** (2009) **[snippet only]**. Jurafsky, Ranganath, McFarland, "Extracting Social Meaning," NAACL 2009 — 991 four-minute speed dates (of ~1,100 recorded); participants rated partner as awkward, friendly, flirtatious, funny, assertive — [Ranganath et al. 2009 EMNLP](https://aclanthology.org/D09-1035/); [Ranganath et al. 2013, Computer Speech & Language 27(1)](https://sites.socsci.uci.edu/~lpearl/courses/readings/RanganathEtAl2013_DetectingFlirting.pdf). Spoken English (transcribed). Public access/LDC release: **not verified**.
   - Matz et al. (2024/25) analyze transcripts of 964 speed dates (source corpus not named on the abstract page) — [arXiv 2407.10989](https://arxiv.org/abs/2407.10989)

13. **WhatsApp data-donation infrastructure/corpora** **[snippet only — all sub-items]**. Julian Kohne & Christian Montag, "ChatDashboard: A Framework to collect, link, and process donated WhatsApp Chat Log Data," *Behavior Research Methods* (2024) — framework (WhatsR parser + Shiny donation app; encrypted storage), not a released corpus — [PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11133087/); [GitHub ChatDashboard](https://github.com/gesiscss/ChatDashboard); WhatsR supports German and English exports — [GitHub whatsr](https://github.com/gesiscss/whatsr)
   - Dona (Bielefeld): de-identified WhatsApp/Facebook messaging **metadata** from 78 WhatsApp donations (Aug 2022–Jun 2024) — [Zenodo 12570525](https://zenodo.org/records/12570525); a later Dona dataset (May 2026) is **restricted access** — [Zenodo 19369010](https://zenodo.org/records/19369010)
   - MoCoDa2 (German): donors pseudonymize and add metadata to WhatsApp/SMS sequences — [EuJAL 2019 PDF](https://duepublico2.uni-due.de/servlets/MCRFileNodeServlet/duepublico_derivate_00076843/eujal_2019_7_2_333-344.pdf). Whether MoCoDa2 records donor–partner relationship: **not verified**.

14. **NUS SMS Corpus** (2011–2015) **[snippet only]**. Tao Chen & Min-Yen Kan, *Language Resources and Evaluation* 47(2):299–355 (2013). GitHub mirror (Mar 9 2015 release): 55,835 English and 31,465 Chinese messages; README also states 67,093 messages (inconsistent snapshot counts); users asked to notify the maintainer on download — [GitHub WING-NUS](https://github.com/WING-NUS/nus-sms-corpus); [arXiv 1112.2468](https://arxiv.org/pdf/1112.2468). Sender–recipient relationship labels: **not verified**.

15. **Cornell Movie-Dialogs Corpus** (2011). Danescu-Niculescu-Mizil & Lee, "Chameleons in Imagined Conversations," CMCL workshop at ACL 2011. 617 movies, 10,292 character pairs, 220,579 exchanges (ConvoKit stats: 9,035 speakers, 304,713 utterances, 83,097 conversations); character metadata: name, movie, gender, credit position — **no relationship labels** — [ConvoKit movie docs](https://convokit.cornell.edu/documentation/movie.html). Public via `convokit.download("movie-corpus")`.

16. **Reddit relationship corpora.** ConvoKit offers "Reddit Corpus (all, by subreddit)" — [ConvoKit datasets](https://convokit.cornell.edu/documentation/datasets.html). **[snippet only]** HF: `yonatanko/Relationship_Advice` (<1K rows, r/dating_advice + r/relationship_advice, 2022/2024 posts, license unknown); `HuggingFaceGECLM/REDDIT_submissions|threaded|comments` include a relationship_advice subset (10M–100M entries total) — [HF yonatanko](https://huggingface.co/datasets/yonatanko/Relationship_Advice/tree/main); [HF GECLM](https://huggingface.co/datasets/HuggingFaceGECLM/REDDIT_submissions/tree/refs%2Fconvert%2Fparquet/default/relationship_advice).

17. **Speed Dating Experiment (Fisman & Iyengar; Kaggle)** **[snippet only]**. Fisman, Iyengar, Kamenica, Simonson, "Gender Differences in Mate Selection," *QJE* 2006; companion "Racial Preferences in Dating," *REStud* 2008 — [Columbia Academic Commons](https://academiccommons.columbia.edu/doi/10.7916/D8FB585Z); [CBS](https://business.columbia.edu/faculty/research/racial-preferences-dating-evidence-speed-dating-experiment). Columbia grad students, HurryDate format; data released publicly — [Gelman blog](https://statmodeling.stat.columbia.edu/2008/01/21/the_speeddating_1/). Kaggle page https://www.kaggle.com/datasets/annavictoria/speed-dating-experiment exists but its description did not render in my fetch; row count and contents **not verified** here.

18. **ConvoKit Friends Corpus** listed — [ConvoKit datasets](https://convokit.cornell.edu/documentation/datasets.html); relation metadata **not verified** (DialogRE is the Friends resource with relation labels). EmoryNLP "character relation" data: **not found/not verified**.

### Inferences
- For a dyadic, text-only relationship classifier the realistic training/eval stack is DDRel (13-class, public) + PRIDE (directed multi-label, public) + SCRIPTS (EN/KO soft labels, public) + DialogRE (Friends, EN/ZH), with MPDD for Chinese. All are scripted fiction, so a domain shift to real SMS/WhatsApp is the central validity threat.
- DDRel's human session-level accuracy (38.5%) shows single short sessions are often genuinely ambiguous; pair-level aggregation (many sessions) is far more informative (human 63.5%). This argues for modeling at the level of a whole chat history between two people.
- Real-message corpora with ground-truth relationship labels effectively require data donation (WhatsApp/Dona-style) with donor-reported relationship type, and these are restricted for privacy reasons; Enron is the only large public real-message corpus with pairwise (hierarchical) relationship ground truth.
- CANDOR/SpeedDate/Fisman support predicting *relationship outcomes* (liking, matching) rather than *relationship type*. The Fisman/Kaggle data appears, from the source papers' design (decisions/ratings), to contain no conversation text; this was not confirmed on the data page.
- Reddit r/relationship_advice-style posts are third-person narratives written by one party (often with self-declared relationship type in the title), not exchanged messages; useful for weak supervision on relationship vocabulary, not for dyadic message modeling. (Format not confirmed on a dataset card.)
- NUS SMS appears to be isolated messages rather than threads, so it likely lacks pairwise relationship labels (not confirmed).
- PRIDE's released labels (19 movie / 15 TV, dominated by friend and lover) are close to DDRel's 13 in granularity, so a harmonized ~6–8-class scheme across DDRel/PRIDE/DialogRE/SCRIPTS is feasible.
- DDRel human/BERT figures were extracted from the paper's results table by a summarizing fetch; quote them "as extracted" and double-check against the PDF table before final publication.

### Gaps
- PRIDE paper-level taxonomy (~50 relations per SCRIPTS) and PRIDE conversation-turn counts, and the MPDD relation label set, could not be confirmed (PDF text extraction failed; MPDD host returned 403). PRIDE released-file pair/label counts WERE verified (see #2).
- PersonaChat-style datasets with relation labels and EmoryNLP character-relation data were not found/searched within budget.
- SocialDial relation label set and download link not found on the arXiv page.
- No verified public corpus of real text-message threads labeled with the relationship between sender and recipient was found.
- Kaggle speed-dating page content and Stanford SpeedDate distribution terms not verified.

## Key Question 2: What recent (2022–2026) work uses LLMs to infer interpersonal relationships from dialogue or chat?

### Takeaway
Direct evidence is thin but growing: the strongest dialogue-only benchmark is SCRIPTS (ACL 2026) where the best model (GPT-4o) picks a "Highly Likely" relationship ~79% (EN) / ~69% (KO) of the time, while all models still pick an "Unlikely" relationship 10–25% of the time and CoT/thinking helps little. On DialogRE, zero-shot ChatGPT (74.2 F1) is near but below supervised SOTA, and a LoRA-tuned LLaMA-7B sets SOTA (79.0 F1). LLM relationship predictions show name-based gender/race bias (EMNLP 2024), and LLM prediction of romantic attraction from real speed-date transcripts is weak (r = 0.12–0.23).

### Cited Findings

1. **Kim et al. (2026), "Are they lovers or friends? Evaluating LLMs' Social Reasoning in English and Korean Dialogues," ACL 2026 Long, pp. 23431–23451** (arXiv:2510.19028, Oct 2025) — [ACL Anthology](https://aclanthology.org/2026.acl-long.1074/); [arXiv HTML](https://arxiv.org/html/2510.19028v1)
   - Data: SCRIPTS, 1,147 movie-script dialogues (580 EN / 567 KO). Task: infer relationship between a target speaker pair; soft labels (Highly Likely / Less Likely / Unlikely) over ~50 PRIDE-derived relations.
   - Models (9): GPT-4o, o3, Gemini-2.5-Flash, Qwen-3-8B, Qwen-3-14B, Llama-3.1-8B-Instruct, A.X-4.0-Light-7B, Kanana-8B, EXAONE-4.0.
   - Headline: ~75–80% accuracy (EN), 58–69% (KO) across models; GPT-4o best at ~79% EN / ~69% KO Highly-Likely rate, with ~11% EN / ~22% KO Unlikely rate; Unlikely responses 10–25% across models.
   - Findings: thinking models and CoT give minimal / inconsistent gains and sometimes amplify social biases; supplying gold intimacy/hierarchy/formality mostly reduces Unlikely answers, model-generated cues help less.
   - Limitations: only EN and KO; fiction source.

2. **Li, Xu, Shang, Liu, Ji, Guo (2024), "Empirical Analysis of Dialogue Relation Extraction with Large Language Models," IJCAI 2024** (arXiv:2404.17802) — [arXiv](https://arxiv.org/abs/2404.17802); [arXiv HTML](https://arxiv.org/html/2404.17802v1); [IJCAI PDF](https://www.ijcai.org/proceedings/2024/0703.pdf)
   - Data: DialogRE V1/V2 (36 relation types, 1,788 dialogues, 8,119 argument pairs).
   - Models: ChatGPT (gpt-3.5-turbo, prompting); LoRA-tuned GPT-2, BART-large, BLOOM-560M, T5-large, LLaMA-7B ("Landre" framework). GPT-4 not evaluated.
   - Headline (DialogRE V2 test): Landre-LLaMA-7B F1 79.0 / F1c 77.9 vs prior SOTA HiDialog 77.1 / 68.2; best ChatGPT zero-shot prompt F1 74.2; decomposed (indirect) prompting improves ChatGPT zero-shot F1 by >15 points; LLaMA drops only ~0.9–1.2 F1 in the partial-dialogue (conversational) setting vs 7.1–8.9 for HiDialog; >20 F1 gain from GPT-2 to LLaMA-7B.
   - Limitations: ChatGPT evaluated on random 100-dialogue subsets with budget-limited prompt search; output parsing problems; per:acquaintance has 97.8% error for LLaMA; per:negative_impression confused with friend/romantic relations.

3. **Sancheti, An, Rudinger (2024), "On the Influence of Gender and Race in Romantic Relationship Prediction from Large Language Models," EMNLP 2024** (arXiv:2410.03996) — [arXiv](https://arxiv.org/abs/2410.03996); [arXiv HTML](https://arxiv.org/html/2410.03996v1)
   - Data: DDRel test split; 327 different-gender instances (271 without explicit gender cues) with controlled name replacement.
   - Models: Llama2-7B-chat, Llama2-13B-chat, Mistral-7B-Instruct, zero-shot, temperature 0; task = choose 1 of DDRel's 13 labels (Lovers/Spouse/Courtship = romantic).
   - Headline: same-gender pairs get lower romantic recall than different-gender pairs (precision ~0.78–0.84 across races); Asian-name pairs lowest (0.68 recall for Llama2-7B when both names Asian); anonymized X/Y baseline recall 0.6887 (gender) / 0.7131 (race); name embeddings encode gender at only 53.3% for Asian names vs 80–99.9% for non-Asian.
   - Limitations: prompt sensitivity, no in-context learning; limited races/genders; no same-gender romantic dialogues in test set; privacy/consent concerns of predicting relationships from private conversations.

4. **Matz, Peters, Cerf, Grunenberg, Eastwick, Back, Finkel (2024; v2 Apr 2025), "Can Large Language Models Detect Verbal Indicators of Romantic Attraction?"** (arXiv:2407.10989; v1 titled "Do Large Language Models Understand Verbal Indicators of Romantic Attraction?") — [arXiv](https://arxiv.org/abs/2407.10989); [PsyArXiv/Sciety](https://sciety.org/articles/activity/10.31234/osf.io/fqkgn)
   - Data: transcripts of 964 real speed dates. Model: ChatGPT (version not stated on abstract page). **[snippet only]** v1 title and a mention of Claude 3 in the v1 abstract come from a catalog record — [CAS catalog](https://katalog.lib.cas.cz/KNAV/EdsRecord/edsarx,edsarx.2407.10989).
   - Headline: predicts objective and subjective date success at r = 0.12–0.23; contact-exchange (match) predictions on par with human judges and incremental over daters' own predictions; overlap with human observers r = 0.21–0.35; Brunswik lens analysis of cues used vs. valid cues.
   - Limitation: low overall predictive performance; no venue listed.

5. **Zhao, Zhu, Xu, Li, Zhou, He, Gui (2024), "Large Language Models Fall Short: Understanding Complex Relationships in Detective Narratives"** (arXiv:2402.11051) — [arXiv](https://arxiv.org/abs/2402.11051)
   - Data: Conan benchmark of character relation graphs from detective narratives, with hierarchical, perspective-dependent (public vs secret) relationships. Models: GPT-3.5, GPT-4, Llama2. Finding: LLMs are limited at inferring complex relationships and at long narratives. Headline numbers and venue not on abstract page (not verified).

6. **Zhou et al. (2023/24), "SOTOPIA: Interactive Evaluation for Social Intelligence in Language Agents"** (arXiv:2310.11667) — [arXiv](https://arxiv.org/abs/2310.11667); [HTML](https://arxiv.org/html/2310.11667v2)
   - Relevance: SOTOPIA-Eval has a Relationship (Rel) dimension scored −5..5 judging whether an interaction preserves/enhances the pre-existing relationship (family/friend/romantic/acquaintance/stranger). Finding: GPT-4 has significantly lower goal completion than humans on SOTOPIA-hard and struggles with social commonsense reasoning. Limitation for this review: tests relationship *maintenance* by agents, not *inference* of relationship type from observed text.

7. **Shi, Qiu, Xu, Sui, Lu, Yu (2023), KokoMind** **[snippet only]** (CHATS-lab, released 2023-07-05) — [GitHub](https://github.com/CHATS-lab/KokoMind); [project page](https://chats-lab.github.io/KokoMind)
   - 150 GPT-4-generated multi-party social interactions (50 per source) with free-text Q&A probing social understanding; GPT-4 tops, then Claude (per project page, via search snippet). Not relationship-specific; small and synthetic.

8. **Zhang, Yin, Song, Wu, Liu (2026), "PIVOTSBench: Evaluating Fine-Grained Interpersonal Relationship Reasoning in Multimodal Large Language Models"** (arXiv:2606.23092, v2 Sep 2026) — [arXiv](https://arxiv.org/abs/2606.23092)
   - Task: predict bidirectional, psychology-grounded interpersonal relationship dimensions from multimodal conversations (Social-IQ 2.0 + YouTube); proprietary and open MLLMs; ablations on visual modality and explicit social-role info. Finding: fine-grained relationship reasoning is largely unexplored/weak in MLLMs. Numbers, label set, model names not verified.

9. **Shang, Yan, Liu (2025), "Love First, Know Later: Persona-Based Romantic Compatibility Through LLM Text World Engines,"** NeurIPS 2025 Workshop on LLM Persona Modeling (oral), arXiv:2512.11844 — [arXiv](https://arxiv.org/abs/2512.11844). Simulates LLM-persona interactions and scores them to predict compatibility; validated on speed-dating and divorce-prediction data; no numbers on abstract page. Uses simulated, not real, conversations.

10. **Adjacent work (not LLM-on-dialogue relationship inference; do not count toward the LLM-paper total):**
   - **Tang, Dogan, Qing, Zhu, Gunes (2026), "Hierarchical Multimodal Interaction Reasoning for Dyadic Relationship Recognition"** (arXiv:2610.36249, Oct 2026, cs.CV; opened) — [arXiv](https://arxiv.org/abs/2610.36249). **Non-LLM** model (HiRe-DRR, Mixture-of-Interaction Transformer) for multimodal (face, body, audio, text) dyadic relationship recognition; outperforms image/video/multimodal baselines on three unnamed benchmarks; routing analysis suggests distant relationships rely on low-level homogeneous cues, close ones on high-level cross-participant cues. Code: GitHub tw-repository/HiRe-DRR. No numbers on abstract page.
   - **[snippet only]** SocialGPT (arXiv:2410.21411, NeurIPS 2024) — VLM-to-text + LLM reasoning for social relation recognition in **images**, competitive zero-shot on two databases — [arXiv](https://arxiv.org/abs/2410.21411).
   - **[snippet only]** SocialNLI (arXiv:2510.05458) — 243 FriendsQA transcripts on sarcasm/irony social inferences, LLM theory-of-mind evaluation — [arXiv](https://arxiv.org/html/2510.05458).

### Inferences
- Across DDRel (BERT macro-F1 ~20–24% at 13 classes), DialogRE (LLM F1 74–79) and SCRIPTS (LLM ~58–80%), the field has moved from fine-tuned encoders to prompted/fine-tuned LLMs, but evaluation is almost entirely on fiction; no verified paper applies LLMs to real couples' or friends' text-message threads to classify relationship type.
- Bias findings (Sancheti et al.; Kim et al. on CoT amplifying bias) mean any relationship-status predictor must be audited for heteronormative and name/culture-based priors; LLMs lean on names and gender cues.
- Fine-grained confusions (acquaintance, negative impression vs. romantic/friend) and language gaps (KO 10+ points below EN) suggest coarse labels (e.g., romantic vs. family vs. friend vs. work) are more realistic targets than 13–50-way schemes.
- Real-world outcome prediction from conversation (Matz et al.) is weak (r ≤ 0.23), so claims of high accuracy from short exchanges should be treated skeptically.

### Gaps
- I found no verified 2022–2026 study using LLMs on real couples' text messages to predict relationship status or quality (the search surfaced only non-LLM work such as Ireland et al. 2011 language style matching, and unverified vendor blogs, which were excluded).
- No verified GPT-4-class zero-shot result on DDRel 13-class accuracy was found.
- Headline numbers for Conan (Zhao et al. 2024), PIVOTSBench, HiRe-DRR and Love First, Know Later were not on the abstract pages and were not verified.
- SocialBench (role-playing) and SocialIQA-style relation-reasoning benchmarks were not searched within the call budget.
