# Inferring tie strength, relationship type and power between two people from communication records (SMS/calls, IM, email, social media)

How these notes were checked. Each paper below is tagged with one of these levels:
- **FULL TEXT** (8 papers: P1, P2, P3, P7, P8, P9, P10, P12): I read the PDF and took the numbers from it.
- **ABSTRACT** (4 papers: P4, P5, P6, P11): I opened the OpenAlex API record for the DOI, which carries the official abstract, title, venue and pages. Numbers quoted for these come from the abstract only; everything else is "not verified".
- Anything I did not see on a page I opened is marked "not verified".
- Per the brief, I left out the DDRel/DialogRE dialogue datasets and the psychology studies of romantic outcomes (LSM, breakups).

OpenAlex record URL pattern: `https://api.openalex.org/works/https://doi.org/<DOI>`

---

## Q1. Can tie strength between two people be predicted from their communication or interaction records?

### Takeaway
Yes, moderately well.
- On Facebook, a linear model over 74 interaction, intimacy and structural variables separates strong from weak ties with 85–87% accuracy (Gilbert & Karahalios 2009, full text).
- The same model, ported unchanged to Twitter, had an upper-bound error of 15.7%, close to the original 12–13% (Gilbert 2012, full text).
- Phone logs alone are weaker. Call/SMS frequency and duration "produced many errors in separating strong and weak ties" (Wiese et al. 2015, abstract).
- Proximity plus call logs recover 95% of mutual friendships, but precision is low: only 21 of 67 predicted friendships were real (Eagle et al. 2009, full text).

### Cited Findings

**[P1] Gilbert, E., & Karahalios, K. (2009). Predicting tie strength with social media. *Proc. CHI 2009* (ACM). DOI: 10.1145/1518701.1518736.** FULL TEXT: [PDF](https://collablab.northwestern.edu/CollabolabDistro/nucmc/GilbertKarahalios-PredictingTieStrength-CHI09.pdf); [DOI](https://www.doi.org/10.1145/1518701.1518736)
- **Data:** 35 participants, mostly students and staff, rated a random subset of their Facebook friends in one 30-minute lab session. They averaged 62.4 friends each, giving 2,184 rated friendships — [PDF](https://collablab.northwestern.edu/CollabolabDistro/nucmc/GilbertKarahalios-PredictingTieStrength-CHI09.pdf)
- **Target:** five slider questions on tie strength, scaled 0–1. The main one was "How strong is your relationship with this person?" — [PDF](https://collablab.northwestern.edu/CollabolabDistro/nucmc/GilbertKarahalios-PredictingTieStrength-CHI09.pdf)
- **Features:** 74 Facebook variables grouped into 7 theory-driven dimensions: Intensity, Intimacy, Duration, Reciprocal Services, Structural, Emotional Support and Social Distance. Examples are wall words exchanged, inbox messages exchanged, inbox thread depth, days since last communication, intimacy words in wall and inbox text, and appearances together in photos. The features are mostly interaction metadata plus some content (intimacy-word counts) — [PDF](https://collablab.northwestern.edu/CollabolabDistro/nucmc/GilbertKarahalios-PredictingTieStrength-CHI09.pdf)
- **Method:** linear model with dimension interaction terms. Degrees of freedom were halved to roughly correct for non-independence within each participant — [PDF](https://collablab.northwestern.edu/CollabolabDistro/nucmc/GilbertKarahalios-PredictingTieStrength-CHI09.pdf)
- **Headline results:**
  - On "How strong?": Adj. R² = 0.534, p < 0.001; mean absolute error 0.0994 on the 0–1 scale.
  - Strong vs. weak classification (threshold at the participant's mean): 87.2% accuracy, against a baseline χ²(1, N = 4368) = 700.9, p < 0.001.
  - The abstract reports "over 85% accuracy".
  - The authors say cross-validation was not needed because the model is highly constrained and the threshold is not learned.
  - Source: [PDF](https://collablab.northwestern.edu/CollabolabDistro/nucmc/GilbertKarahalios-PredictingTieStrength-CHI09.pdf)
- **Key finding:** no single dimension dominates. Predictive power follows a power law: the top 15 variables carry over half the information. Structural features matter mainly through interactions, e.g. Intimacy × Structural, F(1,971) = 12.37 — [PDF](https://collablab.northwestern.edu/CollabolabDistro/nucmc/GilbertKarahalios-PredictingTieStrength-CHI09.pdf)
- **Limitations:**
  - Friendships carried on outside Facebook (IM, email, phone) are invisible to the model, which the follow-up interviews showed; the authors call this "confounding the medium".
  - The model fit the later tie-strength questions worse, possibly because of participant fatigue.
  - Small, university-based sample.
  - Source: [PDF](https://collablab.northwestern.edu/CollabolabDistro/nucmc/GilbertKarahalios-PredictingTieStrength-CHI09.pdf)
- **Data availability:** data was collected in the lab to protect participants' privacy, and no release is mentioned — [PDF](https://collablab.northwestern.edu/CollabolabDistro/nucmc/GilbertKarahalios-PredictingTieStrength-CHI09.pdf)

**[P2] Gilbert, E. (2012). Predicting tie strength in a new medium. *Proc. CSCW 2012* (ACM), Seattle, Feb 11–15, 2012. The DOI 10.1145/2145204.2145360 is inferred from the hosted file name and is not verified.** FULL TEXT: [PDF](https://courses.cs.umbc.edu/graduate/691/spring21/pdf/2145204.2145360.pdf)
- **Data:** "We Meddle", a public Twitter application, estimated tie strengths for more than 200,000 Twitter relationships. It had 2,114 users from 52 countries — [PDF](https://courses.cs.umbc.edu/graduate/691/spring21/pdf/2145204.2145360.pdf)
- **Target:** strong vs. weak tie, used to build "Inner Circle"-type Twitter lists. Users could only remove people from those lists, not add them — [PDF](https://courses.cs.umbc.edu/graduate/691/spring21/pdf/2145204.2145360.pdf)
- **Features and method:** the coefficients of the 2009 Facebook model were reused directly on Twitter analogs of its predictors, with no retraining. For example, @-replies stand in for Facebook wall interaction, and follower difference substitutes for education difference — [PDF](https://courses.cs.umbc.edu/graduate/691/spring21/pdf/2145204.2145360.pdf)
- **Headline results:**
  - 236 users made at least one correction and one list. Across their 27,529 relationships, users corrected 1,105 of the 14,075 they had a chance to correct, i.e. 7.85%.
  - Users could not add ties the model missed, and the model is as likely to underestimate tie strength as to overestimate it. The author therefore doubles the rate to an upper-bound error of 15.7%, against the Facebook model's 12–13%.
  - The paper also notes that a heuristic like "strong if they message each other at least N times" reaches at most 61% accuracy.
  - Source: [PDF](https://courses.cs.umbc.edu/graduate/691/spring21/pdf/2145204.2145360.pdf)
- **Key finding:** the Facebook tie-strength model "largely generalizes to Twitter" — [PDF](https://courses.cs.umbc.edu/graduate/691/spring21/pdf/2145204.2145360.pdf)
- **Limitations:** only the 236 users who made corrections were analysed. Missed ties are only estimated, not observed. Some predictors had no clean Twitter analog, so the author accepts some loss of precision — [PDF](https://courses.cs.umbc.edu/graduate/691/spring21/pdf/2145204.2145360.pdf)

**[P3] Eagle, N., Pentland, A. (S.), & Lazer, D. (2009). Inferring friendship network structure by using mobile phone data. *PNAS*, 106(36), 15274–15278. DOI: 10.1073/pnas.0900282106.** FULL TEXT via PMC: [PMC2741241](https://pmc.ncbi.nlm.nih.gov/articles/PMC2741241)
- **Data:** 94 subjects (100 Nokia 6600 phones deployed) from two programs at one research institution, over 9 months. Data streams were call logs, Bluetooth proximity scans every 5 minutes (about 5 m range), cell-tower IDs and app usage. SMS is not mentioned — [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC2741241)
- **Target:** self-reported friendship, mutual or one-way — [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC2741241)
- **Features and method:** metadata only. A factor analysis (promax rotation) produced an "in-role" factor (work-hour proximity) and an "extra-role" factor (evening/weekend/off-campus proximity plus phone calls). Dyadic models used MRQAP — [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC2741241)
- **Headline results:**
  - From the abstract: "it is possible to accurately infer 95% of friendships based on the observational data alone."
  - In detail: 21 of 22 mutual friendships (95%) and 901 of 935 mutual non-friends (96%) were separated by an extra-role score threshold of 5. Only 21 of the 67 predicted mutual friendships were real survey friendships, so precision is low. Non-friend pairs outnumber friend pairs about 50:1.
  - Source: [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC2741241)
- **Self-report vs. observed behaviour:**
  - About 69% of observed proximity was reported as no proximity.
  - When proximity was reported, it was overestimated: 87 min/day reported vs. 33 min/day observed.
  - Reported and observed proximity correlated at r = .412 for friends and r = .155 for non-friend coworkers.
  - Source: [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC2741241)
- **Outcome prediction:** a model of job satisfaction built on inferred friendships fit slightly better (adj. R² = .180) than one built on self-reported friendships (.161) — [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC2741241)
- **Limitations:** a single institution and small N. The authors call the work "a necessary first step" and acknowledge privacy concerns — [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC2741241)

**[P4] Wiese, J., Min, J.-K., Hong, J. I., & Zimmerman, J. (2015). "You never call, you never write": Call and SMS logs do not always indicate tie strength. *Proc. CSCW 2015* (ACM), pp. 765–774. DOI: 10.1145/2675133.2675143.** ABSTRACT: OpenAlex record for the DOI; [Utah index page](https://pedel.cs.utah.edu/publications/558-you-never-call-you-never-write-call-and-sms-logs-do-not-always-indicate-tie-strength)
- **Data:** "We collected call and SMS logs and ground truth relationship data from 36 participants," plus follow-up interviews — [OpenAlex](https://api.openalex.org/works/https://doi.org/10.1145/2675133.2675143)
- **Target:** tie strength, strong vs. weak — [OpenAlex](https://api.openalex.org/works/https://doi.org/10.1145/2675133.2675143)
- **Features:** call/SMS metadata (frequency and duration) — [OpenAlex](https://api.openalex.org/works/https://doi.org/10.1145/2675133.2675143)
- **Findings (abstract):**
  - "frequent or long-duration communication likely indicates a strong tie".
  - But logs "produced many errors in separating strong and weak ties, suggesting this approach is incomplete".
  - The interviews "indicate fundamental challenges for inferring tie strength from communication logs".
  - The paper notes that using communication as a direct proxy for tie strength "has not been validated".
  - Source: [OpenAlex](https://api.openalex.org/works/https://doi.org/10.1145/2675133.2675143)
- **Method, error rates and data availability:** not verified; full text not opened.

**[P5] Kahanda, I., & Neville, J. (2009). Using transactional information to predict link strength in online social networks. *Proc. ICWSM 2009* (AAAI), vol. 3(1), pp. 74–81. DOI: 10.1609/icwsm.v3i1.13957.** ABSTRACT: OpenAlex record for the DOI. The AAAI page itself was bot-blocked.
- **Data:** "public data from the Purdue Facebook network" — [OpenAlex](https://api.openalex.org/works/https://doi.org/10.1609/icwsm.v3i1.13957)
- **Target:** link strength (strong relationships), framed as link prediction — [OpenAlex](https://api.openalex.org/works/https://doi.org/10.1609/icwsm.v3i1.13957)
- **Features:** compares attribute-based, topological and transactional features. Transactional events include communication and file transfers — [OpenAlex](https://api.openalex.org/works/https://doi.org/10.1609/icwsm.v3i1.13957)
- **Method:** supervised learning — [OpenAlex](https://api.openalex.org/works/https://doi.org/10.1609/icwsm.v3i1.13957)
- **Finding:** "we can accurately predict strong relationships" and "transactional-network features are the most influential features for this task" — [OpenAlex](https://api.openalex.org/works/https://doi.org/10.1609/icwsm.v3i1.13957)
- **Numbers and data size:** not verified; full text not opened.

### Inferences
- Interaction volume is a useful but noisy proxy. Theory-driven multi-feature models (P1, P2) do much better than message-count heuristics (≤ 61%, per P2). Phone-log volume alone misses many ties (P4), consistent with P1's interview finding that close ties are often maintained through other channels.
- Ground truth is almost always ego-centric self-report on small samples (35 in P1, 36 in P4, 94 in P3). Reported accuracies are therefore within-sample. Only P2 tests transfer to a new platform.

### Gaps
- Exact accuracy and misclassification figures for P4 and P5: full text not opened (ACM DL closed; CMU KiltHub and AAAI pages returned 403 or a bot check).
- Whether data was released for P2, P3 and P4: not verified. P3 is commonly associated with the MIT "Reality Mining" dataset, but I did not open a page confirming that.

---

## Q2. Can relationship *type* (family / work / social, romantic partner) be inferred from communication records?

### Takeaway
Yes, with metadata alone.
- Call/SMS logs classify a contact's life facet (family / work / social) with "up to 90.5% accuracy" across 40 users (Min et al. 2013, abstract only).
- Logs that include instant messaging reach 77% on social circle (κ = 0.33) and 76% on strong vs. weak (κ = 0.42), but in only 8 analysed participants (Dwarakanath et al. 2016, full text).
- On Facebook, network "dispersion" alone ranks a married user's spouse first more than 60% of the time. Combining interaction and structural features with boosted trees reaches 70.5% (Backstrom & Kleinberg 2014, full text).

### Cited Findings

**[P6] Min, J.-K., Wiese, J., Hong, J. I., & Zimmerman, J. (2013). Mining smartphone data to classify life-facets of social relationships. *Proc. CSCW 2013* (ACM), pp. 285–294. DOI: 10.1145/2441776.2441810.** ABSTRACT: OpenAlex record for the DOI; [Utah index page](https://pedel.cs.utah.edu/publications/556-mining-smartphone-data-to-classify-life-facets-of-social-relationships)
- **Data:** "call and text message logs from mobile phones"; "experimental results on 40 users" — [OpenAlex](https://api.openalex.org/works/https://doi.org/10.1145/2441776.2441810)
- **Target:** classify each contact by life facet: family, work or social — [OpenAlex](https://api.openalex.org/works/https://doi.org/10.1145/2441776.2441810)
- **Features:** metadata only — "communication intensity, regularity, medium, and temporal tendency" — [OpenAlex](https://api.openalex.org/works/https://doi.org/10.1145/2441776.2441810)
- **Method:** "machine-learning techniques"; the specific algorithm is not verified — [OpenAlex](https://api.openalex.org/works/https://doi.org/10.1145/2441776.2441810)
- **Result:** "up to 90.5% accuracy". "The most relevant features include call duration, channel selection, and time of day" — [OpenAlex](https://api.openalex.org/works/https://doi.org/10.1145/2441776.2441810)
- **Not verified:** per-class results, baseline, evaluation protocol, and whether 90.5% is the best of several settings (the phrase "up to" suggests so).
- **Motivation (abstract):** online services reduce most contacts to "friend". A richer model would help with privacy settings and organizing communications — [OpenAlex](https://api.openalex.org/works/https://doi.org/10.1145/2441776.2441810)

**[P7] Dwarakanath, R., Charrier, J., Englert, F., Hans, R., Stingl, D., & Steinmetz, R. (2016). Analyzing the influence of instant messaging on user relationship estimation. *2016 IEEE International Conference on Mobile Services (MS)*. ISBN 978-1-5090-2625-8.** FULL TEXT: [PDF (TU Darmstadt)](https://www.kom.tu-darmstadt.de/papers/DCE+16-1.pdf)
- **Data:**
  - An Android app logged calls, SMS and IM metadata, including WhatsApp, in July 2015.
  - 12 participants were recruited. Two were dropped for using the app under 10 days, and two for giving default answers, so 8 participants were analysed.
  - Those 8 participants assessed 249 contact instances, about 31 contacts each on average (min 4, max 58).
  - The dataset holds 7,191 communication events: 680 calls, 246 SMS and 6,265 IM messages.
  - Source: [PDF](https://www.kom.tu-darmstadt.de/papers/DCE+16-1.pdf)
- **Target:** social circle (family, friend, work, hobby; more than one label allowed) and strong vs. weak tie. Tie strength came from the linear sum of questionnaire items, such as closeness and lending money — [PDF](https://www.kom.tu-darmstadt.de/papers/DCE+16-1.pdf)
- **Features:** metadata, e.g. call, SMS and IM counts and durations by weekday and time, channel shares, home/work location, emoticon counts and % read. No message content beyond emoticons — [PDF](https://www.kom.tu-darmstadt.de/papers/DCE+16-1.pdf)
- **Method:** Random Forest, chosen after comparing algorithms. Evaluated with accuracy and Cohen's kappa — [PDF](https://www.kom.tu-darmstadt.de/papers/DCE+16-1.pdf)
- **Headline results:** 77% accuracy (κ = 0.33) for social circle and 76% (κ = 0.42) for strong vs. weak — [PDF](https://www.kom.tu-darmstadt.de/papers/DCE+16-1.pdf)
- **Key finding:** friends and hobby contacts communicate more by IM, while family and work contacts use calls more — [PDF](https://www.kom.tu-darmstadt.de/papers/DCE+16-1.pdf)
- **Limitations:** a very small sample that the authors say covers only "a small section of smartphones users". Content analysis beyond emoticons is left for future work — [PDF](https://www.kom.tu-darmstadt.de/papers/DCE+16-1.pdf)

**[P8] Backstrom, L., & Kleinberg, J. (2014). Romantic partnerships and the dispersion of social ties: A network analysis of relationship status on Facebook. *Proc. CSCW 2014* (ACM), Baltimore, pp. 831–841. DOI: 10.1145/2531602.2531642. arXiv:1310.6753.** FULL TEXT: [arXiv](https://arxiv.org/abs/1310.6753). DOI and pages are from the [OpenAlex record](https://api.openalex.org/works/https://doi.org/10.1145/2531602.2531642).
- **Data:** network neighbourhoods of about 1.3 million Facebook users who list a spouse or partner. Users were sampled uniformly from those aged 20+ with 50–2,000 friends. Neighbourhoods average 291 nodes and 6,652 links, about 379M nodes and 8.6B links in total — [arXiv](https://arxiv.org/abs/1310.6753)
- **Target:** identify which friend is the declared romantic partner (precision at rank 1) — [arXiv](https://arxiv.org/abs/1310.6753)
- **Features:**
  - Structural: embeddedness, and the new "dispersion" measure, i.e. how far apart the mutual friends of u and v are in u's network.
  - Interaction: messaging, commenting, profile viewing, co-presence at events and in photos.
  - No message content is used.
  - Source: [arXiv](https://arxiv.org/abs/1310.6753)
- **Headline results, by measure:**
  - Embeddedness: 24.7%.
  - Normalized dispersion: 48.0%; its tuned variant reaches 50.5%.
  - Recursive dispersion: 50.6% for all users and 60.7% for married users. For married male US users, the highest-ranked friend is the spouse 76.9% of the time. A random guess would score at most about 2%.
  - Source: [arXiv](https://arxiv.org/abs/1310.6753)
- **Machine learning (boosted decision trees):**
  - 48 structural features: 53.1% (up from 50.8% for the best single feature).
  - Interaction features: 56.0%.
  - For married users, structural features do much better than interaction features (62.4% vs. 52.6%).
  - All features combined: the top predicted friend is the partner 70.5% of the time.
  - Source: [arXiv](https://arxiv.org/abs/1310.6753)
- **Related result, single vs. in a relationship:** on about 129,000 users, accuracy is 59.8–68.3% for single vs. any relationship and 56.6–79.0% for single vs. married, depending on the feature set — [arXiv](https://arxiv.org/abs/1310.6753)
- **Key finding:** when recursive dispersion fails to identify the partner, the couple is significantly more likely to switch to "single" within 60 days. For relationships up to 12 months old, that probability is roughly 50% higher — [arXiv](https://arxiv.org/abs/1310.6753)
- **Limitations:** relies on self-declared relationship status. The authors note informal use of the "married" status. The data is Facebook-internal, from an author employed by Facebook — [arXiv](https://arxiv.org/abs/1310.6753)

### Inferences
- Communication metadata — which channel, what time of day, how long — carries substantial relationship-type signal even with no content (P6, P7). Romantic partners are best identified by network structure plus interaction, not interaction volume alone (P8).
- The small samples (40 and 8 users) in the phone-log studies make the accuracy figures fragile. P8 is the only large-N study, and its data is proprietary.

### Gaps
- I found no verified 2018–2025 peer-reviewed paper that classifies relationship type or tie strength from the *content* of donated WhatsApp/WeChat/SMS messages.
  - Search surfaced a ResearchGate item titled "Messaging Matters: Investigating Differences in WhatsApp Communication Patterns across different Relationship Constellations". A search summary claims it predicts gender pairing and relationship type, but not closeness, from chat behaviour. I could not open it or confirm authors, venue or numbers, so it is not verified and should not be cited without checking.
  - A 2025 *Social Network Analysis and Mining* paper on donated WhatsApp data from the Dutch LISS panel ([Springer link](https://link.springer.com/article/10.1007/s13278-025-01550-8)) reportedly says assessing tie strength at scale from such donations is not yet feasible. This is from a search summary; not opened.
  - Data-donation tools such as ChatDashboard (PMC11133087) and Dona (PMC11828832) appeared in search results. They are infrastructure, not prediction studies; not opened.
- P6 (Min 2013): the classifier, baseline and per-class results are not verified (full text closed).

---

## Q3. Can power / hierarchy between two people be inferred from the language of their messages (e.g., Enron email)?

### Takeaway
Yes, above chance but well below ceiling.
- On Enron email, n-gram SVMs label superior/subordinate direction at 78–84% (Bramsen et al. 2011, full text).
- Predicting who has power over whom from a single email thread reaches 73.0% against a 55.0% majority baseline (Prabhakaran & Rambow 2014, full text).
- Specific phrases are strong predictors of hierarchy direction, e.g. "thought you would" upward and "let's discuss" downward (Gilbert 2012, abstract).
- Function-word style coordination reveals power, and it is the only text feature set that generalizes across domains: 55–57% cross-domain against a 50% baseline (Danescu-Niculescu-Mizil et al. 2012, full text).

### Cited Findings

**[P9] Bramsen, P., Escobar-Molano, M., Patel, A., & Alonso, R. (2011). Extracting social power relationships from natural language. *Proc. ACL-HLT 2011*, Portland, OR, pp. 773–782.** FULL TEXT: [ACL Anthology](https://aclanthology.org/P11-1078/); [PDF](https://aclanthology.org/P11-1078.pdf)
- **Data:**
  - Enron email (CALO version): 245K emails, about 90M words, after removing duplicates and unusable messages.
  - Only emails between two people in a known superior/subordinate relation were used. Corporate roles (CEO, Manager, Employee, ...) define the label.
  - Author-partitioned split (Table 1):
    - Training: 431 UpSpeak links (136K words) and 328 DownSpeak links (63K words).
    - Test: 232 UpSpeak links (74K words) and 148 DownSpeak links (27K words).
  - A separate subset of links with at least 500 words had 142 links, 40% held out for test.
  - Source: [PDF](https://aclanthology.org/P11-1078.pdf)
- **Target:** UpSpeak (to a superior) vs. DownSpeak (to a subordinate), a task the authors call "social power lect modeling" — [PDF](https://aclanthology.org/P11-1078.pdf)
- **Features:** content — word n-grams, POS-tag n-grams, "binned n-grams" grouped by how much more frequent they are in one class, and polite-imperative features. Train and test were partitioned by author because classifiers otherwise pick up idiolect and scores inflate — [PDF](https://aclanthology.org/P11-1078.pdf)
- **Method:** SVM with cost-sensitive instance weighting to balance the classes — [PDF](https://aclanthology.org/P11-1078.pdf)
- **Headline results (Table 2):**
  - Binned n-grams plus polite imperatives: 83.9% 10-fold CV accuracy (F = .839) and 78.9% on the unweighted test set (F = .797).
  - Best weighted-test accuracy: 78.1% (binned n-grams).
  - Word unigrams alone: 55.4% CV, 62.1% weighted test, 78.9% unweighted test.
  - Baselines: 50% for weighted test and CV, 74% (majority class) for the unweighted test.
  - Source: [PDF](https://aclanthology.org/P11-1078.pdf)
- **Limitations:**
  - A few hundred links from a single corporation.
  - Links aggregate many emails.
  - Unweighted-test accuracies sit only about 5 points above the 74% majority baseline.
  - Source: [PDF](https://aclanthology.org/P11-1078.pdf)
- **Data availability:** the Enron (CALO) corpus is public. Release of their role annotations is not verified — [PDF](https://aclanthology.org/P11-1078.pdf)

**[P10] Prabhakaran, V., & Rambow, O. (2014). Predicting power relations between participants in written dialog from a single thread. *Proc. 52nd ACL (Short Papers)*, pp. 339–344.** FULL TEXT: [PDF](https://aclanthology.org/P14-2056.pdf)
- **Data:**
  - The Yeh & Harnly (2006) threaded Enron corpus: 36,615 threads, of which 36,196 were used after excluding 419 previously annotated threads. Threads average about 3 messages.
  - Gold hierarchy: "the Enron gold organizational hierarchy released by Agarwal et al. (2012)", which captures dominance relations between 13,724 pairs.
  - 15,048 related interacting participant pairs in total.
  - Split: train 50%, dev 25%, test 25%.
  - Source: [PDF](https://aclanthology.org/P14-2056.pdf)
- **Target:** which member of an interacting pair is the superior — [PDF](https://aclanthology.org/P14-2056.pdf)
- **Features:**
  - Lexical n-grams (LEX, content).
  - New dialog-structure features (THRNew), e.g. whether a person sent the first message ("Initiate") and message and token counts, computed at both thread and pair level.
  - Feature sets from earlier work: THRPR, and DIAPR (dialog-act percentages such as ReqAction%, ReqInform%, Inform%, Conventional%, plus ODP%, the rate of overt displays of power).
  - Source: [PDF](https://aclanthology.org/P14-2056.pdf)
- **Headline results (blind test):**
  - Majority baseline ("always superior"): 55.0%.
  - Word unigram + bigram baseline: 68.3%.
  - LEX: 68.1%.
  - Best system (LEX + THRNew): 73.0%, the same as on dev, and significant over LEX by McNemar's test on dev.
  - Dev ablation: dropping the features about the second person gives 72.1%.
  - Source: [PDF](https://aclanthology.org/P14-2056.pdf)
- **Key finding:** dialog structure adds power signal beyond lexical content, even from a single short thread. In threads that include a hierarchically related pair, the thread "is likely to be initiated by the superior", who also tends to contribute more. This contrasts with the authors' 2013 finding, made under a different setup, that people with power rarely initiate threads — [PDF](https://aclanthology.org/P14-2056.pdf)
- **Limitations:** binary direction only, assuming the pair is already in a power relation. Three-way classification including "no power relation" is left to future work. Single organization — [PDF](https://aclanthology.org/P14-2056.pdf)

**[P11] Gilbert, E. (2012). Phrases that signal workplace hierarchy. *Proc. CSCW 2012* (ACM), pp. 1037–1046. DOI: 10.1145/2145204.2145359.** ABSTRACT: OpenAlex record for the DOI. Full text not opened; the author's PDF URL did not resolve.
- **Data:** "Using the Enron corpus as a dataset, we perform a close study of the words and phrases people send to those above them in the corporate hierarchy versus those at the same level or lower" — [OpenAlex](https://api.openalex.org/works/https://doi.org/10.1145/2145204.2145359)
- **Target:** whether the recipient outranks the sender — [OpenAlex](https://api.openalex.org/works/https://doi.org/10.1145/2145204.2145359)
- **Features:** content (words and phrases) — [OpenAlex](https://api.openalex.org/works/https://doi.org/10.1145/2145204.2145359)
- **Findings (abstract):**
  - "certain words and phrases are strong predictors". For example, "thought you would" strongly suggests the recipient outranks the sender, while "let's discuss" implies the opposite.
  - Phrases written to bosses "do not demonstrate cognitive processes as often" as those written to others.
  - The predictive phrases were released "as a public dataset".
  - Source: [OpenAlex](https://api.openalex.org/works/https://doi.org/10.1145/2145204.2145359)
- **Press coverage (secondary source):** reports the probability of the results arising by chance as "less than 1 in 1,000", and gives example phrases. Upward: "the ability to", "I took", "voicemail", "okay", "weekend". Downward: "have you been", "you gave", "we are in", "need in" — [EHS Today](https://www.ehstoday.com/ehs-outloud-blog/article/21918468/what-do-your-emails-say-about-your-place-on-the-company-totem-pole)
- **Caveat:** the same article's "500,000 emails" from "150 former Enron employees" most likely describes the whole Enron corpus, not the subset analysed — [EHS Today](https://www.ehstoday.com/ehs-outloud-blog/article/21918468/what-do-your-emails-say-about-your-place-on-the-company-totem-pole)
- **Not verified:** the model, the number of messages used, and the accuracy.

**[P12] Danescu-Niculescu-Mizil, C., Lee, L., Pang, B., & Kleinberg, J. (2012). Echoes of power: Language effects and power differences in social interaction. *Proc. WWW 2012*. arXiv:1112.3670.** FULL TEXT: [arXiv](https://arxiv.org/abs/1112.3670); [PDF](https://www.cs.cornell.edu/~cristian/Echoes_of_power_files/echoes_of_power.pdf)
- **Data:**
  - Wikipedia talk pages: 240,436 conversational exchanges, plus about 32,000 conversations from Requests for Adminship (RfA) discussions.
  - US Supreme Court oral arguments: 50,389 verbal exchanges across 204 cases, involving 11 Justices and 311 lawyers.
  - Source: [PDF](https://www.cs.cornell.edu/~cristian/Echoes_of_power_files/echoes_of_power.pdf)
- **Target — power, in two forms:**
  - Status: admins vs. non-admins; Justices vs. lawyers.
  - Dependence: lawyers toward favourable vs. unfavourable Justices; RfA voters on opposite sides.
  - Source: [PDF](https://www.cs.cornell.edu/~cristian/Echoes_of_power_files/echoes_of_power.pdf)
- **Features:** linguistic style coordination on 8 LIWC function-word classes (451 lexemes), i.e. how much a person echoes the style of the person they reply to. This is stylistic content, not topical content — [PDF](https://www.cs.cornell.edu/~cristian/Echoes_of_power_files/echoes_of_power.pdf)
- **Headline results:**
  - People coordinate more toward higher-power targets.
  - Wikipedians' coordination behaviour changes after promotion to admin.
  - Lawyers coordinate more toward unfavourable Justices, and unfavourable Justices coordinate less toward lawyers.
  - Source: [PDF](https://www.cs.cornell.edu/~cristian/Echoes_of_power_files/echoes_of_power.pdf)
- **Pairwise "who has higher status" SVM (Table 2, 50% baseline):**
  - Coordination features: 57.7% in-domain on wiki and 70.4% on court; cross-domain 57.1% and 55.0%.
  - Bag of words: 99.5% in-domain on court (driven by cues such as "Your honor"), but 45.2% and 40.1% cross-domain, i.e. below chance.
  - Coordination was the only feature set significantly above chance in both in-domain tasks and in the cross-domain settings.
  - Two human annotators reached only about 70% on Wikipedia, with 80% agreement.
  - Source: [PDF](https://www.cs.cornell.edu/~cristian/Echoes_of_power_files/echoes_of_power.pdf)
- **Limitations:** the authors frame the prediction task as a test of cross-domain generalization, not a standalone system. Effects interact with each person's baseline coordination level (their Hypothesis B). The data is group discussion, not private messaging — [PDF](https://www.cs.cornell.edu/~cristian/Echoes_of_power_files/echoes_of_power.pdf)

### Inferences
- Content-based power detection reaches roughly 70–84% in favourable settings. Lexical models overfit domain-specific cues (P12: 99.5% in-domain vs. below-chance cross-domain), so style and dialog-structure features (P10, P12) are the more transferable signals.
- Nearly all of this work uses the Enron corpus, which caps external validity for personal SMS or chat.

### Gaps
- Gilbert 2012 (P11): no quantitative accuracy is verified; I saw only the abstract and press coverage.
- Whether the P12 corpora and P10 code are publicly released: not verified on a page I opened.
- I did not open Prabhakaran & Rambow's earlier work (2013), which I know of only from P10's citations.
