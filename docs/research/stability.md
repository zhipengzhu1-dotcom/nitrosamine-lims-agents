# Stability studies for APIs

Research for [#30](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/30), part of map [#1](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/1). Sources fetched 2026-09-29. All products, batches and numbers in the examples are fictional; the regulatory text is real.

This note builds on `docs/research/nitrosamines.md` (#4), `eu.md` (#25), `jp.md` (#27) and `iso17025.md` (#3) and does not repeat them. Where a point comes from one of those files, it says so.

## Short answer

**Which text is in force.** ICH Q1A(R2) (Step 4, 6 Feb 2003) and Q1E (Step 4, 6 Feb 2003) are still the operative stability guidelines [Q1A; Q1E]. The consolidated **ICH Q1 is still a draft**. It was endorsed at Step 2 on 11 April 2025 [Q1d], and FDA published it as a draft in June 2025 [FDA-Q1d]. The EWG work plan expects Step 4 in **November 2026** [Q1WP]. The LIMS should hold storage conditions and schedules as reference data, so the Step 4 text can be loaded without code changes. The draft's Table 3 already adds 30 °C/75 % RH as a long-term condition for zones I–IVb [Q1d §7.2].

**What the LIMS must do.** A stability program is a written, approved **protocol** [CFR166 (a); Q7 11.50; EU6 6.29]. The protocol names:

- the batches;
- the storage conditions, with tolerances;
- the time points;
- the tests, with references to the methods;
- the acceptance criteria;
- the container closure [EU6 6.30; CFR166 (a)(1)–(4)].

The LIMS turns each protocol into dated **time points** per batch and condition. Each time point is a **pull**: units come out of a chamber and become an ordinary Sample with Tests. Those Tests then go through the existing chain: result entry, review and QA release.

Chambers are qualified equipment [EU6 6.29; A15 §3–4]. They are monitored continuously. Short door-opening spikes are acceptable. An excursion beyond tolerance for more than 24 hours must be described in the study report and its effect assessed [Q1A Glossary; Q1d §7.1]. So an excursion has to be linked to every study stored in that chamber at the time.

OOS results on stability are investigated like any OOS [OOS p.3]. Out-of-trend (OOT) results need their own written procedure [EU6 6.7(iv), 6.9]. For a contract lab, Phase I (the laboratory investigation) is the lab's job, and Phase II belongs to the Customer's quality unit [OOS p.3].

**Trending and evaluation.** Every value is reported as measured at every time point [Q1E §2.2]. The shelf life or retest period is the earliest time at which the one-sided 95 % confidence bound of the regression crosses the acceptance criterion. Batches may be pooled only after tests at a significance level of 0.25 [Q1E §2.6, App. B].

**Nitrosamines on stability.** All three regions expect it, with different triggers:

- **FDA.** For an at-risk API above 10 % of the AI, test "the stability samples on the retest dates" [G p.17].
- **EMA.** Ensure the AI "is not exceeded until the end of shelf life" [EQA Q&A 4 p.10].
- **Japan.** Once a nitrosamine has been detected in a product, monitor it over time on stability, even with no specification [NPROC-QA No.4].

**Build now for the demo:** Protocol, Study, Condition, Time Point and Pull. Add chamber excursion linkage, OOS/OOT flags, and a trend chart with a simple regression projection. **Later:** Q1E poolability and shelf-life estimation, bracketing/matrixing, and live chamber-monitoring (EMS) integration.

## Sources and revisions relied on

| Key | Document | Revision / date |
|---|---|---|
| Q1A | ICH, [*Q1A(R2) Stability Testing of New Drug Substances and Products*](https://database.ich.org/sites/default/files/Q1A%28R2%29%20Guideline.pdf) | Current Step 4 version, 6 February 2003 |
| Q1E | ICH, [*Q1E Evaluation for Stability Data*](https://database.ich.org/sites/default/files/Q1E%20Guideline.pdf) | Current Step 4 version, 6 February 2003 |
| Q1d | ICH, [*Q1 Stability Testing of Drug Substances and Drug Products*, draft](https://database.ich.org/sites/default/files/ICH_Q1EWG_Step2_Draft_Guideline_2025_0411.pdf) | Step 2 draft, endorsed 11 April 2025. **Not final** |
| Q1WP | ICH, [*Q1 EWG Work Plan*](https://database.ich.org/sites/default/files/ICH52_Q1_EWG_WorkPlan_2026_0318.pdf) | 11 February 2026. Step 3 sign-off / Step 4 expected Nov 2026 |
| FDA-Q1d | FDA, [*Q1 Stability Testing of Drug Substances and Drug Products*, draft guidance page](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/q1-stability-testing-drug-substances-and-drug-products) | Draft, June 2025, docket FDA-2025-D-1106; page current as of 06/24/2025 |
| Q7 | ICH, [*Q7 Good Manufacturing Practice Guide for Active Pharmaceutical Ingredients*](https://database.ich.org/sites/default/files/Q7%20Guideline.pdf) | Current Step 4 version, 10 November 2000 |
| CFR166 | [21 CFR 211.166 Stability testing](https://www.ecfr.gov/api/renderer/v1/content/enhanced/current/title-21?part=211&section=211.166) (eCFR) | Current eCFR text; 43 FR 45077 (1978) as amended 46 FR 56412 (1981) |
| OOS | FDA, [*Investigating Out-of-Specification (OOS) Test Results for Pharmaceutical Production*](https://www.fda.gov/media/158416/download) | Revision 1, May 2022 |
| EU6 | EudraLex Vol. 4 Part I, [*Chapter 6: Quality Control*](https://health.ec.europa.eu/system/files/2016-11/2014-11_vol4_chapter_6_0.pdf) | Revision in operation 1 October 2014 |
| A15 | EudraLex Vol. 4, [*Annex 15: Qualification and Validation*](https://health.ec.europa.eu/system/files/2016-11/2015-10_annex15_0.pdf) | Revision in operation 1 October 2015 |
| PICS | PIC/S, [*GMP Guide PE 009-18 Part I*](https://picscheme.org/docview/11332) | PE 009-18, 24 September 2026. Chapter 6 §6.26–6.36 matches EU6 word for word (except "Authorised Person" for "Qualified Person") |
| EMA122 | EMA, [*CPMP/QWP/122/02 Rev 1 corr: Stability testing of existing active substances and related finished products*](https://www.ema.europa.eu/en/documents/scientific-guideline/guideline-stability-testing-stability-testing-existing-active-substances-and-related-finished-products-revision-1-corr_en.pdf) | Dated 17 December 2003; in operation March 2004 |
| G | FDA, [*Control of Nitrosamine Impurities in Human Drugs*](https://www.fda.gov/media/141720/download) | Revision 2, September 2024 (same edition as nitrosamines.md) |
| EQA | EMA, [*Q&A for MAHs on the Article 5(3) referral on nitrosamine impurities*, EMA/409815/2020 Rev.23](https://www.ema.europa.eu/en/documents/opinion-any-scientific-matter/nitrosamines-emea-h-a53-1490-questions-answers-marketing-authorisation-holders-applicants-chmp-opinion-article-53-regulation-ec-no-726-2004-referral-nitrosamine-impurities-human-medicinal-products_en.pdf) | Rev.23, 10 October 2025 (same edition as eu.md) |
| NPROC-QA | MHLW, [「ニトロソアミン類の混入リスクに関する自主点検に基づくリスク管理措置に係る薬事手続について」に関する質疑応答集](https://www.pmda.go.jp/files/000272869.pdf) | 事務連絡, 2024-12-26 (same edition as jp.md) |
| JGMP | [医薬品及び医薬部外品の製造管理及び品質管理の基準に関する省令 (GMP省令)](https://laws.e-gov.go.jp/api/1/lawdata/416M60000100179), e-Gov | Current e-Gov text as retrieved 2026-09-29 |
| OPM | Oracle, [*OPM Quality Management: Stability Studies*](https://docs.oracle.com/cd/E18727_01/doc.121/e13689/T322808T322818.htm) | E-Business Suite 12.1 documentation library (from the URL path; the page gives no release) |

Page numbers for G and EQA are printed pages; OOS page numbers are printed pages of the Rev. 1 PDF. ICH citations use section numbers.

## 1. Storage conditions

### 1.1 In force: Q1A(R2) (zones I and II)

Q1A(R2) "addresses climatic zones I and II" [Q1A §1.3]. The drug-substance conditions are in the table below. The drug-product tables are the same for the general case.

| Study | Condition | Minimum data at submission | Source |
|---|---|---|---|
| Long term (general) | 25 °C ± 2 °C / 60 % RH ± 5 % RH **or** 30 °C ± 2 °C / 65 % RH ± 5 % RH (applicant's choice) | 12 months | Q1A §2.1.7.1 |
| Intermediate | 30 °C ± 2 °C / 65 % RH ± 5 % RH. Only when long term is 25/60 and significant change occurs at accelerated | 6 months of a 12-month study | Q1A §2.1.7.1 |
| Accelerated | 40 °C ± 2 °C / 75 % RH ± 5 % RH | 6 months | Q1A §2.1.7.1 |
| Refrigerated: long term | 5 °C ± 3 °C | 12 months | Q1A §2.1.7.2 |
| Refrigerated: accelerated | 25 °C ± 2 °C / 60 % RH ± 5 % RH | 6 months | Q1A §2.1.7.2 |
| Frozen: long term | −20 °C ± 5 °C | 12 months. No accelerated condition; one batch at an elevated temperature (e.g. 5 °C or 25 °C) addresses excursions | Q1A §2.1.7.3 |
| Below −20 °C | Case by case | — | Q1A §2.1.7.4 |
| Existing APIs (EU, generic) | Same conditions | 6 months long term and accelerated, on ≥ 2 production-scale or ≥ 3 pilot-scale batches | EMA122 §2.1.3 |

"Significant change" for a **drug substance** is simply "failure to meet its specification" [Q1A §2.1.7.1]. For a drug product it means, among other things, a 5 % change in assay from initial or any degradant over its limit [Q1A §2.2.7.1].

### 1.2 Draft consolidated Q1 (Step 2, not final)

| Climatic zone | Long term | Intermediate | Accelerated |
|---|---|---|---|
| I and II | 25/60, *or* 30/65 or 30/75 | 30/65 or 30/75 (only when long term is 25/60) | 40/75 |
| III | 30/35, 30/65 or 30/75 | n/a | 40/75 |
| IVa | 30/65 or 30/75 | n/a | 40/75 |
| IVb | 30/75 | n/a | 40/75 |
| Refrigerated | 5 °C ± 3 °C | — | 25 °C ± 2 °C, humidity control "may not be needed when justified" |
| Frozen | "−20 °C or below" (no tolerance given) | — | Stress at e.g. 5, 25 or 30 °C to address excursions |

All tolerances are ± 2 °C / ± 5 % RH [Q1d §7.2 Table 3, §7.3 Table 6, §7.4 Table 7]. The draft says testing at 30/75 "could be justified as it encompasses all climate zones" [Q1d §7.2]. Other changes the LIMS needs to accommodate:

- an **OOS at accelerated within 3 months** stops the accelerated arm [Q1d Table 1 fn 3];
- for synthetic drug products, shelf life starts at the date of production. It may start at release if release is within 30 days of production [Q1d §13.1.2].

**LIMS implication.** A `StorageCondition` is reference data with these fields:

- set-points and tolerances for temperature and RH (RH may be absent);
- a kind (long-term, intermediate, accelerated, refrigerated, frozen, stress);
- applicable zones;
- a source citation.

Seed the Q1A(R2) rows and the draft's 30/75. Tolerances matter because excursion detection compares chamber readings against them.

## 2. Time points and pull windows

### 2.1 Schedules from the guidelines

| Situation | Time points | Source |
|---|---|---|
| Long term, retest period ≥ 12 months | Every 3 months in year 1, every 6 months in year 2, then annually: **0, 3, 6, 9, 12, 18, 24, 36 …** | Q1A §2.1.6; Q1d §6 |
| Long term, retest period ≤ 12 months (draft) | Monthly for the first 3 months, then 3-monthly: **0, 1, 2, 3, 6, 9, 12** | Q1d §6 |
| APIs with shelf life ≤ 1 year (ongoing program) | Monthly for 3 months, then 3-monthly; specific intervals (e.g. 9 months) may be dropped when justified | Q7 11.55 |
| Accelerated (6-month study) | At least 3 points including initial and final: **0, 3, 6**. Add a 4th point, or more samples at the final point, when significant change is expected | Q1A §2.1.6; Q1d §6 |
| Intermediate (12-month study) | At least 4 points: **0, 6, 9, 12** | Q1A §2.1.6; Q1d §6 |
| Ongoing API program | First 3 commercial batches, then ≥ 1 batch per year, "tested at least annually" | Q7 11.53–11.54; Q1d §15.2 |
| Extrapolated retest period | The protocol for commitment batches must include "a time point that corresponds to the end of the extrapolated" period | Q1E §2.3 |

The lab's example schedule (**initial, 1M, 2M, 3M, 6M**) is the draft's ≤ 12-month pattern, or an accelerated study with extra early points. The guidelines allow both. The data model must therefore allow any list of ages per condition, not a fixed ICH pattern.

### 2.2 Pull windows: no regulatory number

None of Q1A(R2), Q1E, the Q1 draft, Q7, EU Chapter 6 or EMA122 defines a pull window or grace period. A text search of each fetched document found no "window", "grace" or "pull". The window is therefore a protocol or SOP decision. Oracle OPM models it as a study-level **Notification Lead Time**, plus a **Testing Grace Period** after each scheduled date; after that, a late-time-point notification fires [OPM].

*Design judgment (proposed defaults, per protocol, editable):*

| Nominal age | Pull no earlier than | Pull no later than |
|---|---|---|
| 0 (initial) | At placement (any time before placement for release data reused as T0) | 7 days after placement |
| 1–3 M | due − 3 d | due + 3 d |
| 6–12 M | due − 7 d | due + 7 d |
| ≥ 18 M | due − 14 d | due + 14 d |

- The due date is the study's T0 date plus N calendar months.
- A pull outside its window is still allowed, but it needs a reason and opens a Deviation.
- A time point never pulled becomes **Missed**. It is not deleted: "all data" must be kept [part11.md D4].
- Keep a separate "testing started within N days of pull" check, so that samples do not sit at room temperature after removal.

## 3. What a protocol must define

The table merges three primary lists. Each row says whether the demo needs a field for it.

| Protocol element | Source | Demo field |
|---|---|---|
| Number of batches per strength and batch size | EU6 6.30(i); Q1A §2.1.3 | Batches (Customer lot IDs) |
| Test methods (physical, chemical, micro); stability-indicating, validated | EU6 6.30(ii),(iv); Q7 11.51; CFR166 (a)(3) | Method + version per test |
| Acceptance criteria | EU6 6.30(iii) | Specification + version (shelf-life spec, which may differ from release) [Q1A §2.2.5] |
| Container closure; same as, or simulating, the market container | EU6 6.30(v); Q7 11.52; CFR166 (a)(4) | Package description |
| Testing intervals (time points) | EU6 6.30(vi); CFR166 (a)(1) | Ages per condition + window rule |
| Storage conditions (ICH long-term, consistent with the label) | EU6 6.30(vii); CFR166 (a)(2); Q7 11.56 | Condition list |
| Sample size "based on statistical criteria" | CFR166 (a)(1) | Units pulled per time point + reserve units |
| Justification if it differs from the dossier protocol | EU6 6.31 | Free text |
| Significant-change criteria, and whether intermediate is triggered | Q1A §2.1.7.1 | Rule text + an "intermediate: conditional" condition |
| Reduced designs (bracketing/matrixing), if used | Q1d §3.1, Annex 1; EU6 6.32 | **Later** |
| Results formalised as a report; summary kept and periodically reviewed | EU6 6.29, 6.36 | Study report export (tabulated results) |

The protocol is a controlled, versioned document: draft → reviewed → approved with e-signature, then superseded by a new version. A Study pins the protocol version it started under. Q1d §3.1 says protocol designs "may be optimised" during the lifecycle, and a change to extend the retest period follows §15. *Design judgment:* an amendment creates a new protocol version, and the Study records the time point from which the new version applies. This needs approval, as a mid-study change. Q1A's cover note gives the model: a mid-study condition switch is acceptable when "the date of the switch [is] clearly documented" [Q1A cover note].

**How time points become Tests.** When a pull is signed, the LIMS:

1. creates a child **Sample** (in the existing sample chain) labelled with study, batch, condition and nominal age;
2. creates one **Test** per protocol test line for that time point (method, specification line, replicates);
3. tags the Tests GMP or non-GMP from the Study (map decision #28).

Tests are then assigned, entered, reviewed and released exactly like submission Tests. Oracle OPM creates stability samples automatically when the plan is approved, and forbids creating them by hand [OPM]. *Design judgment:* create the Sample at pull time instead, so the sample record is contemporaneous with the physical removal.

## 4. Chamber qualification and monitoring

| Requirement | Source | LIMS behaviour |
|---|---|---|
| Stability chambers are qualified and maintained under Chapter 3 and Annex 15 | EU6 6.29; PICS 6.29 | A chamber is an **Equipment** record of type "stability chamber" with qualification records |
| IQ: installation against specifications; calibration of instrumentation | A15 §3.8–3.9 | Qualification record type IQ, with attachments |
| OQ: tests at upper and lower operating limits / worst case | A15 §3.10–3.11 | Qualification record type OQ |
| PQ: tests under normal operating conditions across the operating range | A15 §3.13–3.14 | Qualification record type PQ. *Design judgment:* a loaded-chamber temperature/RH mapping study is the usual PQ evidence; no fetched source names mapping explicitly |
| Requalification "at an appropriate frequency", period justified | A15 §4.1–4.2 | `requalification_due` date; placement blocked after it lapses |
| Equipment can control the condition within the tolerances; actual T and RH "monitored during stability storage" | Q1A Glossary; Q1d §7.1 | Chamber readings stored per time interval (import from the data-logger/EMS file, hashed like instrument reports) |
| Door-opening spikes "accepted as unavoidable"; equipment-failure excursions addressed; excursions over tolerance for **> 24 h** described in the study report with their effect assessed | Q1A Glossary "Storage condition tolerances"; Q1d §7.1 | **Excursion** record: chamber, start/end, peak, duration. Over 24 h it is flagged "report in study" |
| Environmental data recorded to allow trend evaluation | EU6 6.9 | Chamber reading chart |
| Alarm log with acknowledgement (draft Annex 11) | eu.md, A11d §8 | Excursion alarms need acknowledgement with a comment |

**Excursion handling.** *Design judgment:* the map's standing rule is that an out-of-tolerance reading opens a Deviation that **blocks the equipment**. That rule needs one change for chambers. Blocking must stop **new placements**, not pulls. Samples already inside stay, and their pulls continue on schedule, each flagged with the open excursion.

The Deviation automatically lists every Study Condition that was in the chamber during the excursion interval. It stays open until someone records an impact assessment per study: none / assess at next pull / invalidate. That lets the stability report "describe" the excursion as Q1A requires.

A short spike under a configurable duration (e.g. 30 min) is logged, but raises no Deviation. Transfers between chambers are recorded on the Study Condition with timestamps, so the excursion overlap can be computed.

## 5. OOS and OOT on stability

### 5.1 OOS

- FDA requires an investigation "whenever an OOS test result is obtained" (§ 211.192). Rejecting the batch "does not negate the need to perform the investigation" [OOS p.3].
- "The responsibility of a contract testing laboratory in meeting these requirements is equivalent to that of a manufacturing firm." The lab conveys its data and findings to the manufacturer's QU, which runs Phase II when no clear laboratory error was found [OOS p.3].
- **Phase I.** The analyst keeps test preparations and informs the supervisor. The supervisor then:
  1. discusses the method with the analyst;
  2. examines the raw data and chromatograms;
  3. verifies the calculations;
  4. confirms instrument performance;
  5. checks standards and reagents;
  6. evaluates method performance;
  7. documents all of this [OOS pp.3–5].
- **Retests.** The number of retests is set in an SOP in advance and is not adjusted to results. The original data is kept, and averaging an OOS value with passing retests is inappropriate [OOS pp.7–10].
- A borderline low assay within specification should also raise concern. FDA quotes Q1E: a batch below 100 % at release "might fall below the lower acceptance criterion before the end of the proposed shelf life" [OOS p.14 fn 19].
- **Field Alert Report** within 3 working days for a distributed batch failing an application specification [OOS p.14]. That is the application holder's duty, not the lab's.
- EU: a "confirmed out of specification result, or significant negative trend, affecting product batches released on the market" is reported to competent authorities [EU6 6.35]. This is the MAH's duty.
- Japan: when stability monitoring shows the product fails, or may fail, its specification, the manufacturer must notify the MAH promptly and give information for a recall decision [JGMP Art. 11-2(2)].
- API OOS "should be investigated and documented according to a procedure" [Q7 11.15].

**LIMS behaviour** (reuses the existing Deviation):

- An OOS on a stability Test opens a Deviation of kind **OOS**, pre-filled with study, batch, condition and age.
- It carries a Phase I checklist (the seven supervisor steps).
- It has a retest counter capped by the method's SOP value.
- It has a "Customer notified at" timestamp: the Customer owns the Field Alert Report, the EU report and the Japanese notification.
- The original result stays visible.

### 5.2 OOT

No fetched source defines OOT numerically. The obligations are procedural:

- QC must have "a procedure for the investigation of Out of Specification and Out Of Trend results" [EU6 6.7(iv)].
- Data such as test results are recorded "in a manner permitting trend evaluation. Any out of trend or out of specification data should be addressed and subject to investigation" [EU6 6.9].
- "significant atypical trends should be investigated" [EU6 6.35].
- FDA: much of the OOS guidance "may be useful for examining results that are out of trend" [OOS p.3 fn 6].
- The draft Q1 expects the PQS to detect "confirmed changes in stability trend and out of specification results" [Q1d §13.2.9].

*Design judgment:* the OOT rules below are per protocol and per attribute. They are evaluated when a result is entered, and they only flag. A flag makes the Reviewer acknowledge it, and the Lab Manager decides whether to open an OOT Deviation, which runs the same Phase I checklist.

| Rule | When it fires | Demo? |
|---|---|---|
| Change from initial | \|result − T0\| > protocol delta (e.g. assay 2.0 % abs.) | Now |
| Step change | \|result − previous time point\| > protocol delta | Now |
| First detection | A nitrosamine ≥ LOQ where all earlier points were < LOQ. This also drives the EU "first detection" notification (eu.md N13) | Now |
| Band crossing | A nitrosamine crosses 10 %, 30 % or 100 % of its AI-derived limit | Now |
| Projected failure | Linear fit on this batch (≥ 3 points) projects crossing the limit before the retest date | Now (informational) |
| Outside prediction interval | Result outside the 95 % prediction interval of the batch's (or pooled batches') regression on earlier points | Later |

## 6. Trending and Q1E evaluation

What Q1E asks for, and what the LIMS gives:

1. **Present every attribute at every time point**, "as measured" (e.g. assay as % of label claim), in a table or graph [Q1E §2.2; Q1d §13.4]. → A study summary table (rows: attribute × condition; columns: ages) and a per-attribute chart with specification lines. Exportable.
2. **Evaluate each attribute separately.** The proposed period "should not exceed that predicted for any single attribute" [Q1E §2.1]. → Per-attribute estimates; the study-level value is the minimum.
3. **Decision tree** (Q1E App. A). Significant change at accelerated or intermediate controls how far the period can be extrapolated beyond long-term data (X):
   - no change and little variability: up to 2X, no more than X + 12 months;
   - statistics performed: up to 1.5X, no more than X + 6 months;
   - not amenable to statistics: up to X + 3 months;
   - refrigerated products get less;
   - frozen: none [Q1E §2.4–2.5].
   → Informational in the demo. The sponsor, not the lab, proposes the retest period.
4. **Regression.** Find the earliest time the one-sided 95 % confidence limit for the mean meets the acceptance criterion: the lower limit for decreasing attributes, the upper limit for increasing ones, two-sided when the direction is unknown [Q1E §2.6; Q1A §2.1.9].
5. **Poolability.** ANCOVA on slopes, then intercepts, at significance 0.25 for batch terms and 0.05 for non-batch terms. If slopes differ, use the shortest batch estimate [Q1E App. B.2–B.3; Q1d §13.3].
6. **Extrapolated periods** must be verified by later long-term data [Q1E §2.3]. Ongoing programs examine trends to confirm the retest period [Q1d §15.2; Q7 11.50].

*Design judgment:* the lab is a contract lab. Its job is complete, attributable data plus a correct trend view. The formal shelf-life claim is the Customer's. So the demo builds items 1, 2 and a per-batch linear fit with a one-sided 95 % bound (item 4, labelled "for information"). Items 3 and 5 come later, and must then be validated calculation code (iso17025.md, 7.11.6).

## 7. Nitrosamines on stability, by region

Limits, bands and jurisdictions are in nitrosamines.md, eu.md and jp.md. This section covers only the stability angle.

| Region | Expectation | Source | LIMS implication |
|---|---|---|---|
| FDA (API) | At-risk API with an impurity "above 10 percent of the recommended AI limit": test each batch on release "and the stability samples on the retest dates" | G p.17 | A protocol for such an API must include the nitrosamine Test at every long-term time point up to the retest date |
| FDA (API supplier) | Continue testing API lots "if there are variations or an upward trend of nitrosamine impurities within the API expiry period" | G p.18 | Trend view across batches of one API, not only within a study |
| FDA (drug product) | Specification needed above 10 % of AI "including in stability samples at expiry" | G p.19 | End-of-shelf-life time point is mandatory in the protocol |
| FDA (reformulation for NDSRIs) | 3 batches; 3 months accelerated (**0, 1, 2, 3 M**) and long term (**0, 3 M**) at submission; FDA "may also request 6 months of accelerated" data if an upward trend "may lead to out-of-specification results" | G p.27 | Protocol template "NDSRI reformulation" with those ages |
| FDA (multiple nitrosamines) | App. C example: a total of 46.5 % of AI at 0 months (pass) becomes 104.9 % at 3 months (fail) | G p.40 | Total-%AI computed per time point, plotted over age |
| EMA | N-nitroso API impurities can form "during storage"; MAHs "should ensure that the AI of any N-nitrosamine impurity is not exceeded until the end of shelf life" | EQA Q&A 4 (risk factor 8) p.10 | Projection to end of shelf life (§5.2 "projected failure") |
| EMA | Confirmatory testing includes "retained samples of batches still within expiry date" | EQA Q&A 8; eu.md N11 | A Study-less "retained sample" test must still record batch expiry and age at test |
| EMA | During an interim limit, "changes in shelf life and storage conditions to comply with the interim AI" come via variations "without delay" | EQA Q&A 22 p.26 | A spec's interim limit carries an effective period; the trend chart shows which limit applied at each time point |
| EU (GMP) | Confirmed OOS or significant negative trend on marketed batches → report to authorities | EU6 6.35 | Customer notification timestamp on the Deviation |
| Japan | Even without a specification limit: 「少なくともニトロソアミン類の混入が確認された品目については、安定性モニタリングにおいて経時的なニトロソアミン類の変動を測定し、有効期間を通じて限度値を超えないことを確認すべきである」 ("at least for products in which nitrosamines were detected, measure their change over time in stability monitoring and confirm the limit is not exceeded throughout the shelf life") | NPROC-QA No.4 | See the rule below |
| Japan | Risk measures cover "not forming or increasing during manufacture or storage of the drug product", not just API control | NPROC-QA No.3 | API stability data is supporting evidence for a Japanese Customer's product |
| Japan (GMP) | Stability monitoring (定義: continuous confirmation through 有効期間 **or リテスト日**) by the finished-product manufacturer: select items affected by storage, test at suitable intervals, evaluate, keep records | JGMP Art. 2(11), Art. 11-2 | The "retest date" in the definition covers APIs; the Art. 11-2 duty is worded for final products |

**Japan rule.** *Design judgment:* when a result ≥ LOQ is released for a JP-jurisdiction specification, the product gets a "nitrosamine detected (JP)" flag. The LIMS then proposes a protocol amendment adding that nitrosamine Test to every remaining time point of that product's open studies. The Customer approves or declines the amendment, and the decision is recorded.

Note: NPROC-QA No.4 is written about a drug product (製剤) specification. Applying it to an API study is an inference. It fits the Japanese GMP definition, which counts retest dates as well as expiry.

## 8. How LIMS products model this

Oracle OPM Quality Management (one vendor with public docs) models:

- a **Stability Study** with an approval workflow: New → Plan Approved → Launch Approved → In Progress → Completed, with Cancel;
- **Material Sources**: batches or lots;
- a **Storage Condition Plan**, made of a monitoring specification per condition plus a base **Test Interval Plan** of periods, with overlay plans for conditions that test at different intervals;
- **Variants**: each unique batch × storage condition × package;
- **Variant Time Points**: scheduled date = variant start + interval, actual date, samples per time point, disposition;
- sample types **Initial, Stability, Retained, Monitoring** [OPM].

Storage conditions are specifications with target, minimum and maximum temperature and RH, tied to a resource or location [OPM]. The protocol → study → condition → time point → pull shape proposed below matches that structure. The one difference is that "Variant" is split into Study (batch) and Study Condition. No other vendor's documentation was fetched.

## 9. Proposed domain model

*Design judgment throughout.* Ownership follows #28: company-owned definitions, lab-owned execution.

```
StorageCondition (company reference data)
  code "25C60RH", kind, temp_setpoint, temp_tol, rh_setpoint?, rh_tol?, zones[], source

StabilityProtocol (company-owned, versioned, e-signed)            ← Customer + material (API)
  code, version, status {draft, in_review, approved, superseded, retired}
  purpose {development, primary, commitment, ongoing, supportive, nitrosamine}
  gmp (default true), spec_id@version (shelf-life spec), jurisdiction(s)
  t0_rule, window_rule, significant_change_rule, oot_rules[], evaluation_plan
  ├─ ProtocolCondition: storage_condition, role {long_term, intermediate_conditional, accelerated, stress},
  │                     package, orientation?, duration_months
  │   └─ ProtocolTimePoint: age_months, window_before_d, window_after_d, units, reserve_units
  │       └─ ProtocolTest: method@version, spec_line, replicates
  └─ amendments = later versions

StabilityStudy (lab-owned)                                          ← one batch per Study
  lab_id, protocol_id@version (pinned), customer_lot, manufacture_date, retest_or_expiry_date,
  t0_date, status {planned, placed, active, on_hold, completed, cancelled}, gmp
  └─ StudyCondition: protocol_condition, chamber (Equipment), placed_at, units_placed, units_left,
  │                  chamber_history[] (transfers, timestamps)
  │   └─ TimePoint: age_months, due_date, window_open, window_close,
  │                 status {scheduled, due, pulled, testing, complete, missed, cancelled}
  │       └─ Pull (e-signed event): pulled_at (UTC), pulled_by, units, out_of_window + reason,
  │                                 open_excursions[] snapshot → creates Sample → Tests
  └─ T0 TimePoint belongs to the Study (shared by all conditions)

Chamber = Equipment{type: stability_chamber, condition: StorageCondition}
  ├─ Qualification {IQ, OQ, PQ/mapping, requal_due}
  ├─ ChamberReading (imported, file-hashed)
  └─ Excursion → Deviation{kind: excursion} → ImpactAssessment per StudyCondition
```

Rules the types must enforce:

- A **Study** is one batch. Q1E evaluates per batch, then pools, so one batch per Study keeps each regression's unit obvious. A multi-batch "program" view groups Studies by protocol.
- The **Time Point** is the schedule; the **Pull** is the event. They are separate so that a missed, early or late pull is visible, and not overwritten.
- **T0** is shared by all conditions of a Study. The Q1 draft even allows initial results obtained before packaging [Q1d §13.3].
- Placement is blocked when the chamber's qualification has lapsed, or when its setpoint condition doesn't match the ProtocolCondition.
- A result on a stability Test is judged against the protocol's **shelf-life** specification version, not the release specification.
- Stability data supporting a marketing authorisation gets a legal-hold retention flag (eu.md E1).

### Build now vs later

| Now (demo) | Later |
|---|---|
| StorageCondition seeded with Q1A(R2) rows + draft 30/75 | Load the Step 4 Q1 text when adopted (expected Nov 2026) |
| Protocol with conditions, ages, tests; versioned; QA e-signature | Bracketing/matrixing designs (Q1d Annex 1) |
| Study per batch; time-point generation with due dates and windows; "due this week / overdue" list | Automatic activation of the intermediate condition on significant change at accelerated |
| Pull → Sample → Tests into the existing chain; out-of-window → Deviation | Protocol amendment mid-study (demo: new version applies to future time points only) |
| Chamber as Equipment with qualification dates; reading CSV import; excursion detection; > 24 h flag; impacted-study list; placement block | Live EMS integration, alarm push notifications, mapping-study records |
| OOS on stability → Deviation with Phase I checklist + Customer-notified timestamp | Retest/resample workflow limits from method SOP |
| OOT rules: change from initial, step change, nitrosamine first detection, band crossing, simple projection | Prediction-interval OOT, cross-batch trend |
| Trend chart per attribute with spec lines and %AI; study summary table export | Q1E ANCOVA poolability, shelf-life estimate, decision-tree helper (validated code) |
| JP "nitrosamine detected" flag proposing an amendment | Photostability (Q1B/Q1d §8), in-use, short-term storage studies; unit inventory reconciliation |

## Open questions for the owner

1. **Who writes the protocol?** Does the Customer supply the stability protocol and specification, with the lab executing, or does the lab author and approve it? This decides whether "Customer approval" is a required signature on the Protocol.
2. **Chambers.** How many stability chambers or rooms does the R&D lab have, and at which set-points (25/60, 30/65, 30/75, 40/75, 5 °C, −20 °C)? Are they on a monitoring system (vendor, export format), or on data loggers? The map's equipment list has freezers but no chambers.
3. **Pull windows.** Accept the proposed defaults (±3 d up to 3M, ±7 d for 6–12M, ±14 d from 18M), or use the lab's SOP values? No regulatory number exists.
4. **T0 definition.** For an API, is T0 the placement date, the manufacture date, or the release-test date? Can release data be reused as the initial point? The draft Q1 ties drug-product shelf life to the date of production.
5. **Study granularity.** Is one Study per batch acceptable, with multi-batch programs as a grouping, or does the lab think of "a study" as all batches under one protocol?
6. **Evaluation scope.** Should the lab ever issue a Q1E shelf-life or retest-period estimate to Customers, or only data and trend charts? If it issues estimates, the statistics become validated calculation code.
7. **Excursion rule.** Confirm that an excursion blocks new placements but not scheduled pulls. Choose the spike threshold that needs no Deviation (proposed 30 min).
8. **Japan trigger.** Should the "nitrosamine detected" flag propose adding the test to open studies automatically, or only notify the Customer?
