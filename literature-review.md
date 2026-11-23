# Reading relationships from the words two people exchange

*A literature review of studies and datasets that predict relationship type, tie strength, power or romantic status from conversation text. As of 2026-11-23.*

## Abstract

A small but real literature predicts how two people are related from the text they exchange, and it works only moderately well. Fine-grained relationship-type classifiers trained on movie and TV dialogue reach macro-F1 of about 0.2–0.4. Humans do better, but only once they have seen many conversations from the same pair. Coarser targets are easier. Power direction in workplace email reaches 73–84% accuracy. Detecting flirtation and other stances in speed dates reaches about 68–80% accuracy. One study shows it falls to 59% for speakers the model has not seen. Simple style-matching odds ratios of about 2–3 predict whether couples stay together. Large language models (2024–2026) pick a plausible relationship for movie dialogue about 75–80% of the time in English. They still name an implausible one in a notable share of answers and show name-based gender and race bias. The binding constraint is data. Nearly every labelled corpus is fiction. Our search found no public corpus of real text messages labelled with the relationship between sender and recipient. This review synthesizes 26 core papers, 12 adjacent studies and the main datasets. Structured summaries of each paper are in the companion file `article-summaries.md`.

## Scope and method

**Inclusion criteria.** A core paper must take as input text that the two people exchanged with each other. That includes dialogue turns, chat or instant messages, email, dating messages and transcribed speech. It must also predict, classify or model one of four targets: relationship type, a relationship dimension such as intimacy, tie strength, power, or romantic interest, status or outcome. Dialogue relation-extraction work is included because it is the largest benchmark family, though its two arguments need not be the speakers.

**Adjacent studies.** Studies that rely on call or SMS metadata, network structure, self-reports, one person's posts, or narrative text are discussed separately and not counted as core.

**How sources were found.** Four research streams covered relationship-type classification, romantic outcomes, tie strength and power, and datasets and LLMs. They used general web search plus the ACL Anthology, arXiv, Europe PMC and OpenAlex. Not every stream queried every index, so the search was broad but not exhaustive. Each candidate was then checked at its primary source, to the depth recorded in its verification tier.

**Verification tiers.** *Full text* means the PDF or HTML was opened and numbers were read from it. *Abstract only* means only the official abstract was read, so anything further is marked "not verified". *Bibliographic record only* means just the citation was confirmed. Items seen only in search snippets were excluded entirely. Where secondary accounts of a paper gave conflicting figures, the primary source was re-opened. Those resolutions are noted in the text.

**Number of papers.** 26 core papers and 12 adjacent studies. Two sets of papers share samples, so the number of independent samples is smaller (see the romantic-outcomes section).

## Relationship-type classifiers top out near 0.4 macro-F1 on fiction

The most direct benchmarks label the relationship between two speakers in scripted dialogue. **DDRel** collects 6,300 two-person sessions from 694 pairs in 300 movies, labelled with 13 classes such as Lovers, Spouse, Siblings and Workplace Superior-Subordinate ([Jia et al., 2021](https://arxiv.org/abs/2012.02553)). On a single session, fine-tuned BERT reaches 39.4% accuracy but only **20.4 macro-F1** at 13 classes. Humans score 38.5% accuracy and 40.75 macro-F1. Pooling every session of a pair changes the picture for humans more than for models. At pair level, 13-class human accuracy rises to **63.45%** while BERT stays at 39.73%. At 4 classes, pair-level BERT reaches 58.13 / 52.00 (accuracy / macro-F1) against **75.65 / 73.00** for humans. Both pair-level figure pairs are often quoted without their granularity. Table 3 shows that 39.7 vs. 63.5 is 13-class accuracy, and 58.1/52.0 vs. 75.7/73.0 is the 4-class result.

**PRIDE** reframes the task as directed, multi-label prediction ([Tigunova et al., 2021](https://doi.org/10.18653/v1/2021.emnlp-main.380)). Its FiRe set has 783 crowd-labelled character pairs from 254 films, and a Series set adds 365 TV pairs. Label counts look inconsistent across sources, and the reason is filtering. The paper's annotation taxonomy lists about 21 candidate labels. Labels with fewer than 20 samples were dropped, leaving **12 directed labels** for experiments. The publicly released files keep the raw labels, so they contain 19 distinct labels for movies and 15 for TV. PRIDE adds speaker age gaps and interpersonal-dimension embeddings to a BERT-plus-Transformer encoder. It reaches **0.38 macro-F1**, against 0.27 for a conversational BERT baseline and 0.20 for a DDRel-style model. Humans score 0.84 on a subset where PRIDE scores 0.33. Performance peaks at about 40 utterances per pair.

**MPDD** brings the task to Chinese multi-party dialogue ([Chen et al., 2020](https://aclanthology.org/2020.lrec-1.76)). It labels each utterance in 4,142 dialogues from five TV series with an emotion and a speaker–listener relation. The paper confirms **24 relation types**, grouped by social field and by seniority (elder, peer, junior). Friend is the most common at 25.44%. BERT seniority accuracy rises from .7259 to .7632 when the utterance being answered is added.

Two studies use dimensions instead of discrete types. **Rashid and Blanco** annotate nine binary dimensions in *Friends*, such as equal/hierarchical and intimate/unintimate ([Rashid & Blanco, 2018](https://doi.org/10.18653/v1/D18-1470)). SVMs reach 0.72 weighted F1 against a 0.62 baseline, but intimacy alone is only 0.49. **Choi and colleagues** detect ten social dimensions, including power, romance and conflict, in Reddit, Enron and Twitter text ([Choi et al., 2020](https://doi.org/10.1145/3366423.3380224)). Sentence-level AUC averages 0.85. For Twitter pairs, the relationship-level AUC **plateaus after about 20 exchanged messages**.

Only one type-classification study uses real private messages. **Welch and colleagues** model about half a million instant messages between one author and 104 partners ([Welch et al., 2019](https://arxiv.org/abs/1904.11610)). They predict whether a partner is family, a romantic partner, a classmate or a co-worker, among other attributes. Their full feature set gains 9–14% over message text alone. Graph and timing features help. But majority baselines run as high as 94.2% on the most imbalanced attributes, and per-attribute results could not be verified. **Azab and colleagues** learn character embeddings from Shakespeare and movie dialogue and classify 605 play relationships ([Azab et al., 2019](https://aclanthology.org/K19-1010/)). They report gains over standard embeddings, but exact scores were not verifiable.

## Dialogue relation extraction rewards speaker tracking

**DialogRE** annotates 36 relation types over 1,788 *Friends* dialogues, of which 17 are interpersonal by SocAoG's count ([Yu et al., 2020](https://doi.org/10.18653/v1/2020.acl-main.444)). It is the largest benchmark in this space. Its results are not comparable to DDRel or PRIDE, because the two arguments can be any people mentioned, not the speakers. BERT reaches 58.5 F1 and a speaker-aware variant 61.2, a gain of 2.7 from tracking who speaks. **SocAoG** models the whole group as a graph that keeps relations consistent, for example inferring a couple who never address each other ([Qiu et al., 2021](https://doi.org/10.18653/v1/2021.acl-long.54)). It reaches 69.1 F1 on DialogRE and 64.1 on MovieGraph.

**Li and colleagues** test LLMs on DialogRE ([Li et al., 2024](https://arxiv.org/abs/2404.17802)). Their headline number is quoted two ways, because DialogRE has two versions. On the V1 test set, LoRA-tuned LLaMA-7B scores **79.4 F1** against 77.7 for the prior best, HiDialog. On V2, which corrects annotation errors, it scores **79.0** against HiDialog's 77.1. The bigger gain is on F1c, a metric for unfinished conversations: 78.5 vs. 69.0 on V1. Zero-shot ChatGPT with a restrictive prompt reaches 74.2 (V1) and 74.9 (V2), measured on 100-dialogue subsets. LLaMA fails on 97.8% of acquaintance cases.

## Romantic outcomes leave modest traces in conversation

The romantic-outcome literature is older, smaller and grounded in psychology. **Language style matching** (similar use of function words) predicted mutual interest after 40 speed dates, with an odds ratio of 3.05 ([Ireland et al., 2011](https://doi.org/10.1177/0956797610392928)). In instant messages from 86 dating couples, it predicted still dating three months later (OR = 1.95). 76.7% of above-median couples stayed together, against 53.5% of the rest. An earlier study of **probably the same 86 couples** found that expressive writing raised emotion words in their IMs, and positive-emotion words partly mediated staying together ([Slatcher & Pennebaker, 2006](https://doi.org/10.1111/j.1467-9280.2006.01762.x)). Both papers report 86 dating couples, IM collection and a three-month follow-up. The overlap is not stated in either abstract, so it is inferred, but the two should not be read as independent replications.

The Stanford **SpeedDate corpus** of about 1,100 four-minute dates underlies three papers. They are therefore one sample, not three. Classifiers detected intended flirting with 69.0% (men) and 71.5% (women) accuracy, and perceived flirting with 79.5% and 68.0%, against a 50% baseline ([Ranganath et al., 2009](https://aclanthology.org/D09-1035/)). They beat the human partners, who projected their own intent onto the other person. A follow-up on four stances reached up to 75% on seen speakers but only **59% on new speakers**, against a 48% baseline ([Ranganath et al., 2013](https://doi.org/10.1016/j.csl.2012.01.005)). A sociological analysis of the same dates found that "clicking" happens when the woman is the focus and the man shows alignment and understanding ([McFarland et al., 2013](https://sites.socsci.uci.edu/~lpearl/courses/readings/McFarlandEyAl2013_SocialBonding.pdf)).

Online dating supplies larger samples but thinner verification. Huang and Hancock show that message exchanges predict whether a first date happens "above chance" on a hold-out study. They name five processes: investment, interdependence, emotional dynamics, decision-making and coordination ([Huang & Hancock, 2022](https://doi.org/10.1177/0261927X211066612)). Their accuracy figures were not verified. Schoendienst and Dang-Xuan model replies to 167,276 first messages, but only one side of the exchange ([Schoendienst & Dang-Xuan, 2011](https://aisel.aisnet.org/pacis2011/169)). On Twitter, "stonewalling", or ignoring a partner's messages, foreshadowed breakups among 661 couples ([Garimella et al., 2014](https://arxiv.org/abs/1409.5980)). Matz and colleagues asked ChatGPT to rate 964 real speed-date transcripts ([Matz et al., 2024](https://arxiv.org/abs/2407.10989)). Its predictions correlated with date success at only **r = 0.12–0.23**. Its match predictions were on par with human judges.

## Power and hierarchy are the most learnable target

Workplace email gives this field its only large real-message corpus with pairwise ground truth. Bramsen and colleagues split Enron email by author. Their SVMs label whether a message goes up or down the hierarchy with 83.9% cross-validated accuracy and 78.9% on the test set ([Bramsen et al., 2011](https://aclanthology.org/P11-1078/)). The test majority baseline is 74%, so the real margin is small. Splitting by author matters, because otherwise models learn each writer's idiolect. From a single short thread, word features plus dialogue structure identify the superior with **73.0%** accuracy against a 55.0% majority ([Prabhakaran & Rambow, 2014](https://aclanthology.org/P14-2056/)). Superiors tend to start threads and write more. Specific phrases also carry the signal: "thought you would" suggests writing up, and "let's discuss" writing down ([Gilbert, 2012a](https://doi.org/10.1145/2145204.2145359)).

The most transferable result comes from style. People echo the function-word style of higher-power partners on Wikipedia and in the US Supreme Court ([Danescu-Niculescu-Mizil et al., 2012](https://arxiv.org/abs/1112.3670)). Bag-of-words features hit 99.5% in-domain on court data, by learning cues like "Your honor". Cross-domain, they fall below chance (45.2% and 40.1%). Coordination features stay above chance at 57.1% and 55.0%.

## Tie strength mixes words with metadata

Tie strength studies mostly use interaction metadata, so most of them sit in the adjacent category. The core exception is **Gilbert and Karahalios**, whose 74 Facebook variables include words exchanged and intimacy words in wall and inbox text ([Gilbert & Karahalios, 2009](https://doi.org/10.1145/1518701.1518736)). Their linear model separates strong from weak ties with **87.2%** accuracy on 2,184 friendships rated by 35 people. No single dimension dominates; the top 15 variables carry over half the information.

The metadata-only studies (adjacent) frame what text adds. Ported unchanged to Twitter, the same model had an upper-bound error of 15.7%, while a rule like "messaged at least N times" reached at most 61% ([Gilbert, 2012b](https://courses.cs.umbc.edu/graduate/691/spring21/pdf/2145204.2145360.pdf)). Call and SMS logs classified family, work and social contacts with "up to 90.5%" accuracy for 40 users ([Min et al., 2013](https://doi.org/10.1145/2441776.2441810)). Yet the same group found that log volume "produced many errors" in separating strong from weak ties ([Wiese et al., 2015](https://doi.org/10.1145/2675133.2675143)). Adding instant-messaging metadata gave 77% for social circle and 76% for tie strength, but for only 8 people ([Dwarakanath et al., 2016](https://www.kom.tu-darmstadt.de/papers/DCE+16-1.pdf)). Transactional events beat profile attributes for predicting strong Facebook links ([Kahanda & Neville, 2009](https://doi.org/10.1609/icwsm.v3i1.13957)).

## LLMs (2024–2026) are fluent but biased and still tested on fiction

**SCRIPTS** is the strongest LLM benchmark for speaker-pair relationships ([Kim et al., 2026](https://doi.org/10.18653/v1/2026.acl-long.1074)). It covers 1,147 English and Korean movie dialogues with uncertainty-aware labels: Highly Likely, Less Likely and Unlikely. The abstract reports about **75–80% accuracy in English and 58–69% in Korean** across nine models. GPT-4o is best, at 79% and 69%. The paper itself gives two rates for implausible answers. The abstract says models pick an Unlikely relationship in 10–25% of responses. The results section gives 10.8–31.9%, rising a further 7.2–16.5 points in Korean. The paper also gives two sizes for its predefined label set: a starting list of about 50 relationships from PRIDE, and a 27-type table. Chain-of-thought helps little and sometimes amplifies bias. Notably, 19% of movie-level labels did not fit a given scene.

Bias is now documented directly. On DDRel dialogues, Llama 2 and Mistral recalled romance less often for same-gender name pairs, and least often for pairs with two Asian names ([Sancheti et al., 2024](https://arxiv.org/abs/2410.03996)). Anonymized X/Y names gave recall near 0.69–0.71. Real-data LLM evidence is limited to Matz's speed dates, with weak correlations. Other LLM work is less direct. It covers detective-story relation graphs where models fall short ([Zhao et al., 2024](https://arxiv.org/abs/2402.11051)), relationship maintenance by simulated agents ([Zhou et al., 2024](https://arxiv.org/abs/2310.11667)), and multimodal relationship reasoning ([Zhang et al., 2026](https://arxiv.org/abs/2606.23092)). It also includes compatibility scored from simulated persona conversations ([Shang et al., 2025](https://arxiv.org/abs/2512.11844)). None of these classifies real people's exchanged messages.

## Cross-cutting findings

Four patterns recur across the 26 core papers.

**More exchanges help.** DDRel's pair-level human accuracy is far above session level. PRIDE peaks at about 40 utterances, Choi's AUC levels off after about 20 messages, and Rashid and Blanco gain from the pair's earlier conversations.

**Speaker and direction matter.** Speaker-aware BERT gains 2.7 F1 on DialogRE. Directed labels and asymmetric confusions (parent/child, boss/employee) are a common error in PRIDE, DialogRE and Li et al. Answer-to context helps MPDD.

**Unseen people are much harder.** Accuracy drops from 75% to 59% for new speed daters. Enron results inflate without author-disjoint splits. Lexical models collapse across domains.

**Human ceilings are low on short text.** Human κ on a single DDRel session is only 0.30 at 13 classes. Two humans reached about 70% on Wikipedia power. SCRIPTS answers this with graded labels rather than one gold label.

These patterns point the same way. Model a whole message history between two people, keep track of who said what, and predict coarse or graded labels.

## Datasets: fiction everywhere, real messages nowhere public

**Key finding: nearly all labelled data are fiction (movie and TV scripts). Our search found no public corpus of real text messages labelled with the relationship between sender and recipient.** Enron email is the only large public real-message corpus with pairwise labels, and those labels cover workplace hierarchy only. Real couples' message data exist but stay private.

| Name | Year | Text source | Language | Size | Relationship labels | Access |
|---|---|---|---|---|---|---|
| DDRel [1] | 2021 | Movie scripts (IMSDb) | English | 6,300 sessions, 694 pairs, 53,126 utterances | 13 classes, plus 6- and 4-class groupings | Public: [GitHub](https://github.com/JiaQiSJTU/DialogueRelationClassification) |
| PRIDE FiRe [2] | 2021 | Movie scripts | English | 783 pairs, 254 films | 12 directed labels in the paper; 19 raw labels in released files | Public: [PRIDE data](https://pkb.mpi-inf.mpg.de/pride_data/) (no licence stated) |
| PRIDE Series [2] | 2021 | TV transcripts, 14 series | English | 365 pairs | Directed; 15 raw labels in released files | Public: [PRIDE data](https://pkb.mpi-inf.mpg.de/pride_data/) |
| MPDD [3] | 2020 | Chinese TV scripts, 5 series | Chinese | 4,142 dialogues, 25,548 utterances | 24 speaker–listener relation types; field and seniority groups | [Host page](http://nlg.csie.ntu.edu.tw/nlpresource/MPDD/); availability not verified |
| SCRIPTS [11] | 2026 | Movie scripts, 60 films | English, Korean | 1,147 dialogues | Graded labels (Highly / Less / Unlikely); 230+ unique types; intimacy, hierarchy, formality | Public: [Hugging Face](https://huggingface.co/datasets/EunsuKim/SCRIPTS), [GitHub](https://github.com/rladmstn1714/SCRIPTS) |
| DialogRE [8] | 2020 | *Friends* transcripts | English, Chinese | 1,788 dialogues, 10,168 triples | 36 relation types, 17 interpersonal; V1 and V2 | Public: [dataset.org](https://dataset.org/dialogre/), [GitHub](https://github.com/nlpdata/dialogre) |
| Friends dimensions [6] | 2018 | *Friends* Season 1 | English | 24 episodes, 9,168 turns | 9 binary interaction and relationship dimensions | Via author site; base corpus on [GitHub](https://github.com/emorynlp/character-mining) |
| Social dimensions [7] | 2020 | Reddit, Enron, movies; Twitter pairs | English | ~9,000 sentences; 5,000 Twitter relationships | 10 dimensions (power, romance, conflict, etc.) | Public: [project page](https://social-dynamics.net/projects/social_dimensions) |
| Longitudinal IM [4] | 2019 | Real instant messages, one person | English | ~500,000 messages, 104 partners | Family, romantic, classmate, co-worker and more | Private data; code on [GitHub](https://github.com/cfwelch/longitudinal_dialog) |
| SpeedDate corpus [15][16] | 2009 | Recorded speed dates (transcribed speech) | English | ~1,100 dates; 946 clean | Self and partner stance ratings; interest | Public release not verified |
| Enron email + hierarchy [22][25] | 2011–2014 | Real workplace email | English | 245K emails (CALO); 36,196 threads; 13,724 dominance pairs | Superior / subordinate | Enron public; label release not verified |
| CANDOR [43] | 2023 | Video calls between strangers (transcripts) | English | 1,650 conversations, 1,454 people | None (all strangers); liking ratings | By request ([ConvoKit notes](https://convokit.cornell.edu/documentation/candor.html)) |
| SocialDial [40] | 2023 | Human and ChatGPT-generated dialogues | Chinese | 1,563 human + 4,870 synthetic | Social relation, distance, norms (inventory not verified) | Download not verified |
| SOTOPIA [39] | 2024 | LLM simulation scenarios | English | 90 scenarios, 90 relationships | Family, friend, romantic, acquaintance, stranger | Public ([arXiv](https://arxiv.org/abs/2310.11667)); simulated, not natural text |
| Couples' iMessages [36] | 2021 | Donated real texts, 41 couples | English | 1,045,340 messages | All romantic; no type labels | Private |

**Corrections.** Three popular corpora are sometimes described as relationship datasets, but they are not. **SODA** has a `relation` field, but it holds ATOMIC commonsense relations such as xIntent and xReact, not interpersonal labels ([Kim et al., 2023](https://huggingface.co/datasets/allenai/soda)). **CPED** annotates gender, Big Five, emotions, dialogue acts and scenes, but not speaker relationships ([Chen et al., 2022](https://arxiv.org/abs/2205.14727)). The **Cornell Movie-Dialogs** corpus has 10,292 character pairs but only name, gender and credit metadata ([ConvoKit](https://convokit.cornell.edu/documentation/movie.html)).

The practical training stack for a text-only classifier is DDRel, PRIDE, SCRIPTS and DialogRE, with MPDD for Chinese. All are scripted fiction. Transfer to real SMS or WhatsApp threads is the central untested assumption.

## Adjacent and contrast work (not counted as core)

These studies predict relationships without the exchanged text, or study one person's text. They frame what message content adds.

**Network and phone metadata.** Phone-sensed proximity and calls recovered 95% of mutual friendships among 94 people ([Eagle et al., 2009](https://doi.org/10.1073/pnas.0900282106)). Precision was low: only 21 of 67 predicted friendships were real. On 1.3 million Facebook users, network "dispersion" plus interaction features ranked the declared partner first **70.5%** of the time, with no message content at all ([Backstrom & Kleinberg, 2014](https://doi.org/10.1145/2531602.2531642)). The metadata tie-strength studies above (Gilbert 2012b, Min, Wiese, Dwarakanath, Kahanda & Neville) also belong here.

**Self-report baselines.** Over 100 pre-date self-report measures could not predict dyad-specific romantic desire at all, though they explained some individual variance ([Joel et al., 2017](https://doi.org/10.1177/0956797617714580)). This negative result is the strongest argument for using the conversation itself. Survey work has studied self-reported texting in relation to attachment, satisfaction and stability; its findings were not verified for this review ([Schade et al., 2013](https://doi.org/10.1080/15332691.2013.836051)).

**One person's text, and descriptive message studies.** Reddit users' language shifted 3 months before a breakup and returned to baseline about 6 months after ([Seraj et al., 2021](https://doi.org/10.1073/pnas.2017154118)). These are one person's posts, not an exchange. Donated iMessage histories from 41 new couples showed language converging, mostly before they called themselves a couple ([Brinberg & Ram, 2021](https://doi.org/10.1093/joc/jqab012)). No outcome was predicted. Data-donation designs like this are the most promising route to real labelled data.

## Gaps, ethics and research opportunities

**Gaps in the evidence.** Our search found no verified study that applies modern ML or LLMs to real, donated chat logs between couples or friends. None predicts relationship type, satisfaction or breakup out of sample. Targeted searches were limited, so such work may exist. The romantic-outcome core is small, old and partly overlapping (one 86-couple sample, one SpeedDate corpus). Several key numbers remain unverified: Huang and Hancock's accuracy, Welch's per-attribute results, MPDD's fine-grained scores, and Gilbert's phrase-model accuracy. Reported accuracies across task families are not comparable. DialogRE F1 near 60–79 measures argument relation extraction. DDRel and PRIDE macro-F1 near 0.2–0.5 measure speaker-pair classification.

**Ethics and privacy.** Inferring a relationship from private messages raises consent problems for the person who did not donate. Romantic and sexual relationships are sensitive categories. Wrong or unwanted inferences can out people, expose affairs or enable control. The authors of the bias study raise these concerns directly ([Sancheti et al., 2024](https://arxiv.org/abs/2410.03996)). Bias is documented. Models under-predict romance for same-gender and Asian-name pairs, and chain-of-thought can amplify social bias ([Kim et al., 2026](https://doi.org/10.18653/v1/2026.acl-long.1074)). Several data sources also show selection bias, such as self-declared couples on Twitter and elite-university speed daters. Eagle and colleagues flagged privacy risks of phone sensing as early as 2009.

**Research opportunities.**

1. Build a consented data-donation corpus of real message threads, with both parties' relationship labels and follow-up outcomes. Brinberg and Ram's design is a template.
2. Harmonize DDRel, PRIDE, DialogRE and SCRIPTS into a shared coarse scheme of about 6–8 classes. Test transfer from fiction to real messages.
3. Model the whole thread with speaker identity and direction. Report learning curves by number of messages.
4. Use graded or uncertainty-aware labels instead of one gold class, following SCRIPTS.
5. Evaluate on unseen people and platforms, and audit by name, gender, culture and orientation before any deployment.
6. Combine text with timing and channel metadata, which carry independent signal in the adjacent studies.

## Conclusion

The field has shown that relationship signal lives in conversation, but mostly in conversations that screenwriters wrote. Real relationships are messier, change over time and rarely announce themselves. The most consistent lesson is that the unit of analysis should be the pair's whole history, not one exchange. Short snippets cap even human judges. The next real advance is unlikely to come from a bigger model. It will more likely come from a consented corpus of real message threads, labelled by both people and followed over time. Models should then be tested on people they have never seen.

## References

**Core papers**

1. Jia, Q., Huang, H., & Zhu, K. Q. (2021). DDRel: A new dataset for interpersonal relation classification in dyadic dialogues. *AAAI 2021* (per arXiv comments). https://arxiv.org/abs/2012.02553
2. Tigunova, A., Mirza, P., Yates, A., & Weikum, G. (2021). PRIDE: Predicting relationships in conversations. *EMNLP 2021*, 4636–4650. https://doi.org/10.18653/v1/2021.emnlp-main.380
3. Chen, Y.-T., Huang, H.-H., & Chen, H.-H. (2020). MPDD: A multi-party dialogue dataset for analysis of emotions and interpersonal relationships. *LREC 2020*, 610–614. https://aclanthology.org/2020.lrec-1.76
4. Welch, C., Pérez-Rosas, V., Kummerfeld, J. K., & Mihalcea, R. (2019). Look who's talking: Inferring speaker attributes from personal longitudinal dialog. *CICLing 2019*. https://arxiv.org/abs/1904.11610
5. Azab, M., Kojima, N., Deng, J., & Mihalcea, R. (2019). Representing movie characters in dialogues. *CoNLL 2019*, 99–109. https://aclanthology.org/K19-1010/
6. Rashid, F., & Blanco, E. (2018). Characterizing interactions and relationships between people. *EMNLP 2018*, 4395–4404. https://doi.org/10.18653/v1/D18-1470
7. Choi, M., Aiello, L. M., Varga, K. Z., & Quercia, D. (2020). Ten social dimensions of conversations and relationships. *The Web Conference 2020*. https://doi.org/10.1145/3366423.3380224
8. Yu, D., Sun, K., Cardie, C., & Yu, D. (2020). Dialogue-based relation extraction. *ACL 2020*, 4927–4940. https://doi.org/10.18653/v1/2020.acl-main.444
9. Qiu, L., Liang, Y., Zhao, Y., Lu, P., Peng, B., Yu, Z., Wu, Y. N., & Zhu, S.-C. (2021). SocAoG: Incremental graph parsing for social relation inference in dialogues. *ACL-IJCNLP 2021*, 658–670. https://doi.org/10.18653/v1/2021.acl-long.54
10. Li, G., Xu, Z., Shang, Z., Liu, J., Ji, K., & Guo, Y. (2024). Empirical analysis of dialogue relation extraction with large language models. *IJCAI 2024*. https://arxiv.org/abs/2404.17802
11. Kim, E., Park, J., Oh, J., Park, K., Song, S., Doğruöz, A. S., Oh, A., & Kim, N. (2026). Are they lovers or friends? Evaluating LLMs' social reasoning in English and Korean dialogues. *ACL 2026*, 23431–23451. https://doi.org/10.18653/v1/2026.acl-long.1074
12. Sancheti, A., An, H., & Rudinger, R. (2024). On the influence of gender and race in romantic relationship prediction from large language models. *EMNLP 2024*. https://arxiv.org/abs/2410.03996
13. Slatcher, R. B., & Pennebaker, J. W. (2006). How do I love thee? Let me count the words: The social effects of expressive writing. *Psychological Science*, 17, 660–664. https://doi.org/10.1111/j.1467-9280.2006.01762.x
14. Ireland, M. E., Slatcher, R. B., Eastwick, P. W., Scissors, L. E., Finkel, E. J., & Pennebaker, J. W. (2011). Language style matching predicts relationship initiation and stability. *Psychological Science*, 22, 39–44. https://doi.org/10.1177/0956797610392928
15. Ranganath, R., Jurafsky, D., & McFarland, D. (2009). It's not you, it's me: Detecting flirting and its misperception in speed-dates. *EMNLP 2009*, 334–342. https://aclanthology.org/D09-1035/
16. Ranganath, R., Jurafsky, D., & McFarland, D. A. (2013). Detecting friendly, flirtatious, awkward, and assertive speech in speed-dates. *Computer Speech & Language*, 27(1), 89–115. https://doi.org/10.1016/j.csl.2012.01.005
17. McFarland, D. A., Jurafsky, D., & Rawlings, C. (2013). Making the connection: Social bonding in courtship situations. *American Journal of Sociology*, 118(6), 1596–1649 (volume, issue and pages not verified). JSTOR stable identifier 10.1086/670240. https://sites.socsci.uci.edu/~lpearl/courses/readings/McFarlandEyAl2013_SocialBonding.pdf
18. Schoendienst, V., & Dang-Xuan, L. (2011). The role of linguistic properties in online dating communication: A large-scale study of contact initiation messages. *PACIS 2011*, paper 169. https://aisel.aisnet.org/pacis2011/169
19. Garimella, K., Weber, I., & Dal Cin, S. (2014). From "I love you babe" to "leave me alone": Romantic relationship breakups on Twitter. *SocInfo 2014*. https://arxiv.org/abs/1409.5980
20. Huang, S. A., & Hancock, J. T. (2022). Will you go on a date with me? Predicting first dates from linguistic traces in online dating messages. *Journal of Language and Social Psychology*, 41(4), 371–395. https://doi.org/10.1177/0261927X211066612
21. Matz, S. C., Peters, H., Cerf, M., Grunenberg, E., Eastwick, P. W., Back, M. D., & Finkel, E. J. (2024; v2 2025). Can large language models detect verbal indicators of romantic attraction? arXiv:2407.10989. https://arxiv.org/abs/2407.10989
22. Bramsen, P., Escobar-Molano, M., Patel, A., & Alonso, R. (2011). Extracting social power relationships from natural language. *ACL-HLT 2011*, 773–782. https://aclanthology.org/P11-1078/
23. Danescu-Niculescu-Mizil, C., Lee, L., Pang, B., & Kleinberg, J. (2012). Echoes of power: Language effects and power differences in social interaction. *WWW 2012*. https://arxiv.org/abs/1112.3670
24. Gilbert, E. (2012a). Phrases that signal workplace hierarchy. *CSCW 2012*, 1037–1046. https://doi.org/10.1145/2145204.2145359
25. Prabhakaran, V., & Rambow, O. (2014). Predicting power relations between participants in written dialog from a single thread. *ACL 2014 (Short Papers)*, 339–344. https://aclanthology.org/P14-2056/
26. Gilbert, E., & Karahalios, K. (2009). Predicting tie strength with social media. *CHI 2009*. https://doi.org/10.1145/1518701.1518736

**Adjacent studies**

27. Gilbert, E. (2012b). Predicting tie strength in a new medium. *CSCW 2012* (DOI not verified). https://courses.cs.umbc.edu/graduate/691/spring21/pdf/2145204.2145360.pdf
28. Min, J.-K., Wiese, J., Hong, J. I., & Zimmerman, J. (2013). Mining smartphone data to classify life-facets of social relationships. *CSCW 2013*, 285–294. https://doi.org/10.1145/2441776.2441810
29. Wiese, J., Min, J.-K., Hong, J. I., & Zimmerman, J. (2015). "You never call, you never write": Call and SMS logs do not always indicate tie strength. *CSCW 2015*, 765–774. https://doi.org/10.1145/2675133.2675143
30. Dwarakanath, R., Charrier, J., Englert, F., Hans, R., Stingl, D., & Steinmetz, R. (2016). Analyzing the influence of instant messaging on user relationship estimation. *IEEE International Conference on Mobile Services*. https://www.kom.tu-darmstadt.de/papers/DCE+16-1.pdf
31. Kahanda, I., & Neville, J. (2009). Using transactional information to predict link strength in online social networks. *ICWSM 2009*, 74–81. https://doi.org/10.1609/icwsm.v3i1.13957
32. Eagle, N., Pentland, A., & Lazer, D. (2009). Inferring friendship network structure by using mobile phone data. *PNAS*, 106(36), 15274–15278. https://doi.org/10.1073/pnas.0900282106
33. Backstrom, L., & Kleinberg, J. (2014). Romantic partnerships and the dispersion of social ties: A network analysis of relationship status on Facebook. *CSCW 2014*, 831–841. https://doi.org/10.1145/2531602.2531642
34. Joel, S., Eastwick, P. W., & Finkel, E. J. (2017). Is romantic desire predictable? Machine learning applied to initial romantic attraction. *Psychological Science*, 28, 1478–1489. https://doi.org/10.1177/0956797617714580
35. Seraj, S., Blackburn, K. G., & Pennebaker, J. W. (2021). Language left behind on social media exposes the emotional and cognitive costs of a romantic breakup. *PNAS*, 118, e2017154118. https://doi.org/10.1073/pnas.2017154118
36. Brinberg, M., & Ram, N. (2021). Do new romantic couples use more similar language over time? Evidence from intensive longitudinal text messages. *Journal of Communication*, 71(3), 454–477. https://doi.org/10.1093/joc/jqab012
37. Schade, L. C., Sandberg, J., Bean, R., Busby, D., & Coyne, S. (2013). Using technology to connect in romantic relationships: Effects on attachment, relationship satisfaction, and stability in emerging adults. *Journal of Couple & Relationship Therapy*, 12(4), 314–338. https://doi.org/10.1080/15332691.2013.836051
38. Zhao, R., Zhu, Q., Xu, H., Li, J., Zhou, Y., He, Y., & Gui, L. (2024). Large language models fall short: Understanding complex relationships in detective narratives. arXiv:2402.11051. https://arxiv.org/abs/2402.11051

**Datasets and other resources cited**

39. Zhou, X., et al. (2024). SOTOPIA: Interactive evaluation for social intelligence in language agents. arXiv:2310.11667. https://arxiv.org/abs/2310.11667
40. Zhan, H., et al. (2023). SocialDial: A benchmark for socially-aware dialogue systems. *SIGIR 2023*. https://arxiv.org/abs/2304.12026
41. Kim, H., et al. (2023). SODA: Million-scale dialogue distillation with social commonsense contextualization. *EMNLP 2023*. https://arxiv.org/abs/2212.10465 (dataset card: https://huggingface.co/datasets/allenai/soda)
42. Chen, Y., et al. (2022). CPED: A large-scale Chinese personalized and emotional dialogue dataset for conversational AI. arXiv:2205.14727. https://arxiv.org/abs/2205.14727
43. Reece, A., et al. (2023). The CANDOR corpus: Insights from a large multimodal dataset of naturalistic conversation. *Science Advances*, 9, eadf3197. Access notes: https://convokit.cornell.edu/documentation/candor.html
44. Danescu-Niculescu-Mizil, C., & Lee, L. (2011). Chameleons in imagined conversations (Cornell Movie-Dialogs Corpus). *CMCL Workshop at ACL 2011*. https://convokit.cornell.edu/documentation/movie.html
45. Zhang, S., Yin, Y., Song, W., Wu, Y., & Liu, M. (2026). PIVOTSBench: Evaluating fine-grained interpersonal relationship reasoning in multimodal large language models. arXiv:2606.23092. https://arxiv.org/abs/2606.23092
46. Shang, H., Yan, Z., & Liu, X. (2025). Love first, know later: Persona-based romantic compatibility through LLM text world engines. *NeurIPS 2025 Workshop on LLM Persona Modeling*. https://arxiv.org/abs/2512.11844
