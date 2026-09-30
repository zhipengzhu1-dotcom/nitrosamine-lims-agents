# EU requirements beyond the FDA baseline

Research for [#25](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/25), part of map [#1](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/1). Sources fetched 2026-09-29. All products, batches and numbers in the examples are fictional; the regulatory text is real.

The baseline is `docs/research/part11.md` (branch `research/part11`, issue #2) and `docs/research/nitrosamines.md` (branch `research/nitrosamines`, issue #4). This file lists only what the EU adds, tightens or does differently. The Part 11 baseline already has a section on Annex 11 (2011) and the main draft Annex 11 (2025) identity, audit-trail and signature rules; those are not repeated here.

## Short answer

**Computerized systems and records.** The texts in force are still Chapter 4 (January 2011) and Annex 11 (revision January 2011). The EudraLex Volume 4 page lists both as current [EUDRA]. The 2025 drafts of Chapter 4, Annex 11 and a new Annex 22 (AI) went to consultation from 7 July to 7 October 2025. The consultation page says "Closed" and gives no adoption date [CONS]. Beyond the baseline, the EU asks the LIMS for:

1. **A concrete retention rule.** Batch documentation is kept for 1 year after batch expiry or 5 years after QP certification, whichever is longer. Raw data supporting a marketing authorisation (validation, stability) is kept while the authorisation is in force [CH4 §4.11–4.12]. This answers the baseline's open question 3 for EU work.
2. **Raw-data designation, controlled disposal and read-only archive.** Each record type is flagged as raw data or not [CH4 Principle]. Disposal is a separate, access-controlled process [CH4d §4.79]. After release, data and audit trails are read-only [A11d §17.1].
3. **Operational controls the FDA baseline does not name** (draft Annex 11):
   - an alarm log with acknowledgement comments [A11d §8]
   - regular penetration testing of internet-facing systems [A11d §15.19]
   - timely patching [A11d §15.13]
   - a disaster-recovery plan with an RTO [A11d §15.7]
   - backups kept physically and logically apart from the server [A11d §16.3–16.4]
   - service contracts that include an exit strategy [A11d §7.5]
4. **ALCOA++.** This adds *Traceable* to ALCOA+, and *Consistent* explicitly covers units, rounding and significant digits [CH4d Table 1].
5. **Access for contract givers.** A contract lab must give customers access to their source data and metadata during audits, and tell them about data-integrity failures [PICS §10.3.2–10.3.3]. QA audit-trail review should be both random and targeted [PICS §9.8].

**Nitrosamines.** The formula is the same: ppm = AI ÷ MDD. EMA's rules differ from FDA's in six ways the LIMS must model:

1. **Lower CPCA category 1 limit.** It is 18 ng/day, not 26.5 [APP2]. Several named NDSRIs are therefore stricter in the EU (table below).
2. **No lifetime adjustment for specifications.** Less-than-lifetime (LTL) factors may not be used to set limits. They are used only as temporary interim limits while corrective and preventive actions (CAPA) are carried out: 13.3× or 6.7× the AI, capped at 1.5 µg/day [QA Q&A 10, 22].
3. **Numeric LoQ rules.** The LoQ must be ≤ the limit for routine testing, ≤ 30 % to justify skip testing, and ≤ 10 % to justify omitting the test. Decisions are made on the LoQ [QA Q&A 9].
4. **Different multiple-nitrosamine options.** There are three:
   - Option 1: a total limit set by the most potent nitrosamine.
   - Option 2 fixed: preset percentages of each AI that add up to no more than 100 %.
   - Option 2 flexible: each nitrosamine at its own AI, plus a percent-sum limit of 100 %.

   Nitrosamines below 10 % of their AI are left out of the calculation, and no three-nitrosamine cap is stated [QA Q&A 10].
5. **MDD basis.** The MDD comes from the SmPC and is expressed per active moiety when the control point is the finished product. It is calculated for each Member State when SmPCs differ [QA Q&A 10–11].
6. **Limits not based on an AI.** Some nitrosamines are controlled under ICH Q3A/B. Examples are non-mutagenic impurities (NMIs) such as N-nitroso-ciprofloxacin, and products in ICH S9 scope [QA Q&A 10; APP1].

Ph. Eur. 2.5.42 is a toolbox of three procedures (GC-MS, LC-MS/MS and GC-MS/MS) for seven small nitrosamines. Two of the procedures are validated as **limit tests at 30 ppb**, and none is validated outside tetrazole sartans without further validation [EDQM-NEW]. So the LIMS needs a pass/fail limit-test result type as well as quantitative ppm.

## Sources and revisions relied on

| Key | Document | Revision / date |
|---|---|---|
| EUDRA | European Commission, [EudraLex Volume 4](https://health.ec.europa.eu/medicinal-products/eudralex/eudralex-volume-4_en) page | Lists "Chapter 4 - Documentation (January 2011)" and "Computerised Systems (revision January 2011)" as current; no Annex 22 listed |
| CH4 | [EU GMP Chapter 4: Documentation](https://health.ec.europa.eu/document/download/104b3eb8-81a7-4858-9419-cb06562adb66_en?filename=chapter4_01-2011_en.pdf) | Revision 1; came into operation 30 June 2011 |
| CH4d | [Draft revised Chapter 4](https://health.ec.europa.eu/document/download/fa336a6e-753b-46fc-b53b-9178bacd8878_en?filename=mp_vol4_chap4_consultation_guideline_en.pdf) | Consultation draft, 7 Jul – 7 Oct 2025. **Not in force** |
| A11 | [EU GMP Annex 11: Computerised Systems](https://health.ec.europa.eu/document/download/8d305550-dd22-4dad-8463-2ddb4a1345f1_en?filename=annex11_01-2011_en.pdf) | Revision January 2011 (in operation 30 June 2011) |
| A11d | [Draft revised Annex 11](https://health.ec.europa.eu/document/download/40231f18-e564-4043-94de-c031f813d38b_en?filename=mp_vol4_chap4_annex11_consultation_guideline_en.pdf) | Consultation draft, 7 Jul – 7 Oct 2025. **Not in force** |
| CONS | [Stakeholders' consultation on Chapter 4, Annex 11 and Annex 22](https://health.ec.europa.eu/consultations/stakeholders-consultation-eudralex-volume-4-good-manufacturing-practice-guidelines-chapter-4-annex_en) | Status "Closed"; no adoption date stated |
| PICS | PIC/S [PI 041-1, *Good Practices for Data Management and Integrity in Regulated GMP/GDP Environments*](https://picscheme.org/docview/4234) | 1 July 2021 |
| EMA-DI | EMA, [GMP/GDP Questions and answers](https://www.ema.europa.eu/en/human-regulatory-overview/research-development/compliance-research-development/good-manufacturing-practice/guidance-good-manufacturing-practice-good-distribution-practice-questions-answers), "Data integrity" section | No revision date shown for that section on the page |
| QA | EMA, *Questions and answers for MAHs/applicants on the CHMP Opinion for the Article 5(3) … referral on nitrosamine impurities*, [EMA/409815/2020 Rev.23](https://www.ema.europa.eu/en/documents/opinion-any-scientific-matter/nitrosamines-emea-h-a53-1490-questions-answers-marketing-authorisation-holders-applicants-chmp-opinion-article-53-regulation-ec-no-726-2004-referral-nitrosamine-impurities-human-medicinal-products_en.pdf) ([guidance page](https://www.ema.europa.eu/en/human-regulatory-overview/post-authorisation/pharmacovigilance-post-authorisation/referral-procedures-human-medicines/nitrosamine-impurities/nitrosamine-impurities-guidance-marketing-authorisation-holders)) | Rev.23, 10 October 2025 |
| APP1 | EMA, [Appendix 1: Acceptable intakes established for N-nitrosamines](https://www.ema.europa.eu/en/documents/other/appendix-1-acceptable-intakes-established-n-nitrosamines_en.xlsx) (XLSX, Non-clinical Working Party) | EMA/42261/2025 Rev. 13, dated 1 June 2026; page "last updated 24/06/2026". 244 entries on the N-nitrosamines sheet |
| APP2 | EMA, [Appendix 2: Carcinogenic Potency Categorisation Approach for N-nitrosamines](https://www.ema.europa.eu/en/documents/other/appendix-2-carcinogenic-potency-categorisation-approach-n-nitrosamines_en.pdf) | EMA/451665/2023, 12 October 2023 |
| EDQM-NEW | EDQM, *Ph. Eur. Commission adopts a new general chapter for the analysis of N-nitrosamine impurities* | 07/12/2020 |
| EDQM-2542 | EDQM, *General chapter 2.5.42. N-Nitrosamines in active substances and revised sartan monographs* | 17/03/2021 |
| EDQM-2034 | EDQM, *Ph. Eur. Commission adopts revised general monographs 2034 and 2619 …* | 06/01/2023 (implemented 1 January 2024) |
| EDQM-STRAT | EDQM, *N-nitrosamine impurities in Ph. Eur. monographs: update on approach* | 24/07/2023. The strategy was approved at the 177th session, November 2023, per EDQM-BRIEF |
| EDQM-BRIEF | EDQM, *N-nitrosamine contamination in brief* | Snapshot of 18 May 2026 |
| FDA-W | FDA, [CDER Nitrosamine Impurity Acceptable Intake Limits](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/cder-nitrosamine-impurity-acceptable-intake-limits) (re-fetched for the comparison table) | Content current as of 09/24/2026, revision 30 |

**EDQM access note.** edqm.eu returned HTTP 403 to every automated fetch. The EDQM pages were read from Internet Archive snapshots of the original URLs:

- [EDQM-NEW](https://web.archive.org/web/20250215182416/https://www.edqm.eu/en/w/ph-eur-commission-adopts-a-new-general-chapter-for-the-analysis-of-n-nitrosamine-impurities)
- [EDQM-2542](https://web.archive.org/web/20260419182652/https://www.edqm.eu/en/-/general-chapter-2-5-42-n-nitrosamines-in-active-substances-and-revised-sartan-monographs)
- [EDQM-2034](https://web.archive.org/web/20260207131214/https://www.edqm.eu/en/-/ph.-eur.-commission-adopts-revised-general-monographs-2034-and-2619-after-inclusion-of-new-paragraph-on-control-of-n-nitrosamines)
- [EDQM-STRAT](https://web.archive.org/web/20260211132737/https://www.edqm.eu/en/-/n-nitrosamine-impurities-in-ph.-eur.-monographs-update-on-approach)
- [EDQM-BRIEF](https://web.archive.org/web/20260518183947/https://www.edqm.eu/en/n-nitrosamine-contamination-in-brief)

**The text of Ph. Eur. 2.5.42 itself was not read.** It is only available by Ph. Eur. subscription. Everything below about 2.5.42 comes from the EDQM announcements.

All EU source documents are published in English, which is their original language, so no translations were needed.

## 1. Delta table vs the FDA baseline

### 1a. Computerized systems, records and data integrity

| # | Topic | FDA baseline | EU requirement | Source | LIMS implication |
|---|---|---|---|---|---|
| E1 | Retention period | No number. Part 11 defers to predicate rules (part11.md open question 3). | Batch documentation: at least 1 year after batch expiry or at least 5 years after QP certification, whichever is longer. Critical raw data supporting the MA (for example validation, stability): kept while the MA is in force. It may be retired only when superseded by a full new data set, with a documented justification. | CH4 §4.11–4.12 (same text in CH4d §4.77–4.78) | The retention rule is computed per record from **batch expiry date** and **QP certification date**, so the Sample needs a batch expiry field. A contract lab rarely knows the QP date (see open question 2). Add a "supports MA / stability / validation" legal-hold flag with no automatic expiry. |
| E2 | Raw data definition | Record-type registry with a "Part 11 record" flag. | "For electronic records regulated users should define which data are to be used as raw data. At least, all data on which quality decisions are based should be defined as raw data." | CH4 Principle (Records) | Add a `raw_data` flag to the record-type registry. It defaults to yes for anything that feeds a result, a review or a release. |
| E3 | Disposal of records | Deletion blocked while inside retention. | A documented disposal process, so that only the correct records are disposed of after retention. Measures reduce the risk of deleting the wrong documents, and the access rights that allow disposal are controlled. | CH4d §4.79 (draft) | Disposal is its own privileged workflow: a preview list, a signed approval by QA, and an audit-trail entry. It is never an ordinary delete. |
| E4 | Read-only after release | Append-only audit trail; new versions, never overwrite. | After completion of a process (for example product release), GMP data and metadata, including audit trails, are protected from deletion and change for the whole retention period. Integrity is verified when data is moved to an archive. | A11d §17.1–17.2 (draft) | Released reports and their underlying records are locked. A correction after release is an amended report version with a linked Deviation, never an edit. The archive export carries a checksum that is verified on write. |
| E5 | Data-integrity attributes | ALCOA (FDA). The baseline adds "+" from PIC/S. | **ALCOA++**: adds *Traceable* ("the ability to trace the history, modification or location of data by means of recorded identifications"). *Consistent* explicitly covers "date formats, units of measurement, approaches to rounding, significant digits". | CH4d §4.63 Table 1, Glossary (draft) | Add row D12 *Traceable* to the checklist. Put rounding, significant-figure and unit rules in one server-side configuration used by every result and report, rather than per screen. |
| E6 | Signature policy and hybrid signing | Part 11 §11.50/§11.70 manifestation and linking. | The regulated user identifies which records need a legally binding signature and has a signature policy. The signatory is qualified for the meaning of the signature. "If records exist electronically such records should be signed electronically. The use of a hybrid system should be avoided." | CH4d §4.66–4.73 (draft) | Add a per-record-type "legally binding signature required" flag. Don't offer a print, wet-sign and scan route for records that live in the LIMS. Check the signer's role and Training Record against the signature meaning. |
| E7 | Hosted service / supplier contract | Written agreement covering data access, backup and audit trails (FDA [CI]; A11 §3.1). | The contract also covers: SLAs and KPIs; supplier audits; support during inspections; issue and security communication; **an exit strategy by which the user retains control of the data**; and **the user's ability to test new versions before release**. The user must "understand, approve and justify" the hosted provider's controls through an SLA. | A11d §7.1–7.5; CH4d §4.76 (drafts) | A low-cost VPS will not sign such terms, so the lab documents the gap in a supplier assessment. The software supplies the exit strategy (full export of data, metadata and audit trail) and a staging environment where each release is tested before production. |
| E8 | Alarms | Alert to Admin on lockout / repeated failed signing (from draft A11 §11). | Where users rely on the system to notify them of an event that needs action, alarms are required. The alarm log records the alarm name, alarm time, acknowledgement time, username and role, and a reason comment. Users cannot edit or deactivate the log, and it is periodically reviewed. | A11d §8.1–8.7 (draft) | Keep an `alarm` log for action-needed events (calibration overdue, instrument blocked, clock drift, backup failure, lockout). Acknowledgement is role-gated and needs a comment. The log is searchable and exportable. |
| E9 | Security operations | MFA, lockout, encryption, idle logout. | Penetration testing "at regular intervals" for critical internet-facing systems (§15.19). Timely security patching, "for critical vulnerabilities, this might be immediately" (§15.13). Strict firewall rules, reviewed periodically (§15.8–15.9). A tested disaster-recovery plan with a defined RTO (§15.7). A secure encrypted protocol for remote connections (§15.20). Replication to a distant secondary site "where relevant" (§15.6). | A11d §15 (draft) | Before go-live and then periodically: a pen test, a patch cadence, a firewall rule review, and a written RTO. Replication to a second data centre is optional ("where relevant") and a budget decision (open question 6). |
| E10 | Backups | Scheduled off-server backups with a restore test. | Tiered intervals, for example hourly, daily, weekly and monthly, with risk-based retention "correspondingly a week, a month, a quarter, and years". Backups are **physically separated at a safe distance** and **not on the same logical network** as the original data. | A11d §16.2–16.4 (draft) | Backups go to a different provider or account, not a volume on the same VPS network. The backup job enforces the retention tiers, and restore tests are recorded in the LIMS. |
| E11 | Periodic review | Annex 11 §11 periodic evaluation (baseline). | Review scope includes, among other items, actions from earlier reviews, audits and inspections; the adequacy of backup, restore and disaster-recovery procedures; and the "adequacy and timeliness of archival". A final review is done when the system is retired. | A11d §14.1–14.3 (draft) | A periodic-review report that pulls access changes, configuration changes, incidents and Deviations, alarm-log statistics, and backup and restore evidence for the period. |
| E12 | Audit-trail review method | Reviewer and QA see the record's audit trail inline before release (DI Q7–Q8). | QA runs an ongoing programme of audit-trail reviews as part of self-inspection. These should be "both random … and targeted". Review by exception is acceptable, and validated "exception reports" may replace line-by-line review. | PICS §9.8 items 1–2; PICS §9.6 (review by exception); EMA-DI Q&A 8 | Add an **audit-trail exception report**: edits after first save, reintegrations and reprocessing, invalidations, changes after review, off-hours changes, and admin actions. Add a QA "random record" picker. The report itself falls within validation scope. |
| E13 | Contract-lab obligations to the customer | Customer portal; no specific data-access duty. | The contract acceptor gives "reasonable access to data generated on behalf of the contract giver during audits" (§10.3.3). The contract giver may verify source electronic data and metadata (§10.3.4). The acceptor must notify the contract giver of any data-integrity failures (§10.3.2). De-identified multi-client data sets may be used for review (§10.3.5). | PICS §10.3.2–10.3.5 | A Customer-scoped audit export of source files, metadata and audit trail for that Customer's samples only. A Deviation category "data-integrity failure" with a required Customer-notification step. Optional: a de-identified cross-Customer export. |
| E14 | Equipment logbooks | Not covered in the baseline. | Logbooks for major or critical analytical equipment, kept in chronological order: use, calibration, maintenance, cleaning and repair, with dates and the people involved. | CH4 §4.31 | Each LC-MS/MS run writes a "use" entry (sequence, samples, Analyst) to that instrument's logbook automatically, next to calibration and maintenance entries. |
| E15 | Draft Annex 22 (AI) | None. | A new Annex 22 on artificial intelligence was in the same 2025 consultation. It was **not reviewed** for this note. | CONS | Only relevant if the LIMS adds AI or ML in GMP decisions. Out of scope for now. |

### 1b. Nitrosamine limits, testing and reporting

| # | Topic | FDA baseline | EU requirement | Source | LIMS implication |
|---|---|---|---|---|---|
| N1 | Reference list and cadence | FDA web page, revision 30 (24 Sep 2026). | EMA Appendix 1 (XLSX, Rev. 13, 1 Jun 2026) plus Q&A Rev.23 (10 Oct 2025). CEP limits are based on EMA AIs [EDQM-BRIEF]. MAHs are "advised to routinely check" the Q&A for new limits [QA Q&A 5]. | APP1; QA | The AI reference table is keyed by **jurisdiction**. Each row carries the source document, revision and publication date. EU and FDA rows for the same compound coexist. |
| N2 | CPCA category 1 | 26.5 ng/day. | **18 ng/day**, "equal to the class-specific TTC for N-nitrosamine impurities". Categories 2–5 are the same as FDA (100 / 400 / 1500 / 1500). | APP2 table | The CPCA-category → AI mapping is per jurisdiction. Category 1 compounds get a limit about 32 % lower in the EU. |
| N3 | Nitrosamine with no published AI | Default 26.5 ng/day unless justified (G p.13). | No universal default; the temporary AI was deleted in July 2023 [QA Q&A 21]. The AI is set by one of: substance-specific TD50; CPCA (App. 2); a negative enhanced Ames test (1.5 µg/day); surrogate read-across; or a negative in vivo TGR study (control as an NMI under Q3A/B). A CPCA category from another authority may be used "but this will need confirmation". | QA Q&A 10, 21 | The AI record has a `basis` enum: compound-specific, SAR/read-across (surrogate), CPCA category, EAT-negative, NMI (Q3A/B), interim. "Unassigned" blocks release in EU mode instead of falling back to 26.5. |
| N4 | Limits not expressed as an AI | Not described. | ICH Q3A/B limits apply to: NMIs (for example N-nitroso-ciprofloxacin, "Can be controlled according to ICH Q3A/B" [APP1]); products for advanced cancer only (ICH S9 scope); and products whose API is itself mutagenic or clastogenic at therapeutic doses. "The same risk approach is applicable to all routes of administration. Corrections to limits are generally not acceptable." | QA Q&A 10; APP1 | The specification model needs a second limit type: a Q3A/B threshold, expressed as a % or reporting threshold rather than ng/day, with its own LoQ rule (N7). |
| N5 | MDD basis for ppm | MDD from US labeling. | MDD "as reflected in the SmPC". For a finished-product control point the limit is usually per **active moiety** (free base, free acid, anhydrous). For an API-only control point it is per drug substance (salt, hydrate). The nitrosamine's molecular weight is not used. Where SmPCs differ between Member States, the calculation is done "for each different maximum exposure". | QA Q&A 10, 11 | The product record stores MDD with a `basis` field (active moiety / salt form) and allows **several MDDs** (per market). The limit calculation and report show each one. |
| N6 | Less-than-lifetime (LTL) | LTL factors 80× / 13.3× / 6.67× / 1× for LTL-labeled products (24 Sep 2026); usually by supplement. | "The 'less than lifetime' (LTL) approach should not be applied in calculating the limits". It is used only as a temporary **interim limit during CAPA**: 13.3 × AI for treatment up to 12 months and 6.7 × AI for longer, capped at 1.5 µg/day except for AI > 1.5 µg/day, CPCA category 5 or EAT-negative. It applies for up to 3 years from publication of the initial AI, is set by the lead authority, and is **not** put into specifications by variation. | QA Q&A 10, 20, 22 | In EU mode an LTL factor is not a product attribute. An EU interim limit is a time-limited override entered by QA with the authority's reference and an end date. It shows on the report as "interim limit" and never becomes the specification. |
| N7 | LoQ requirement | No numeric LoQ; the baseline *inferred* LoQ ≤ 10 % of the limit. | Explicit rules: the LoQ "should thus be used for impurity testing and decision-making". Routine quantitative control: LoQ ≤ limit. Justifying skip testing: LoQ ≤ 30 % of the limit. Justifying omission from the specification: LoQ ≤ 10 %. For Q3A/B-controlled nitrosamines, LoQ ≤ the reporting threshold. Exceptions are allowed for high-dose products and for multiple nitrosamines. | QA Q&A 9 | A method-suitability check per product, analyte and jurisdiction computes LoQ as a % of the limit and states which uses it supports (routine, skip testing, omission). It warns when a trend claim (N8) exceeds what the LoQ can show. |
| N8 | When a specification is needed | Above 10 % of AI → release and stability specification needed. | Below 10 % of AI is "negligible", needs no specification, and is **excluded from total-nitrosamine calculations**. The test may be omitted only if the result is "consistently below 10 %". ICH Q6A skip testing is allowed if a single nitrosamine is "consistently below 30 %". The root cause must be well understood. | QA Q&A 10, 15 | A per-product trend view of each nitrosamine against the 10 % and 30 % lines, over batches. The multi-nitrosamine calculation drops analytes below 10 % in EU mode. |
| N9 | Multiple nitrosamines | Default: total ≤ AI of the most potent. Flexible: Σ % of AI ≤ 100 %, n ≤ 3. | **Option 1**: the total limit is set by the most potent nitrosamine present at ≥ 10 % of its AI, and the calculation must state which nitrosamines are included. **Option 2 fixed**: each nitrosamine has a limit at a chosen % of its AI (for example 20:80) so the percents add to ≤ 100 %; no total limit. **Option 2 flexible**: each nitrosamine at its own AI limit plus a total limit of Σ % of AI ≤ 100 %. No cap on the number of nitrosamines is stated. The choice "needs to be duly justified". | QA Q&A 10, Annex 1 | Specification rule enum: `single`, `EU_opt1_most_potent`, `EU_opt2_fixed(ratios)`, `EU_opt2_flexible`, `FDA_default`, `FDA_flexible`. Use the Q&A's own example as a test vector (section 3). |
| N10 | Result units and what is reported | ppm to 3 significant figures if ≥ LOD; "not detected" below LOD (FDA methods). | Specifications "in ppm or ppb" (the Q&A examples use ppb). On first detection, levels are reported "in ng and ppm, together with the corresponding calculations" based on the SmPC maximum daily dose. Decisions use the LoQ (N7). | QA Q&A 10, 11, 9 | Display ppm or ppb per specification. Each result shows exposure in ng/day with the calculation. **Inference, not stated in the Q&A**: for EU specifications, a value between LOD and LoQ should be reported as "< LoQ (value ppm)" and not used as a number in pass/fail or totals (open question 4). |
| N11 | Confirmatory batch coverage | At least 3 representative batches covering expiry, API sources and the riskiest strength. | Marketed products: 10 % of annual batches or 3 per year, whichever is higher, **including retained samples still within expiry**. All batches if fewer than 3 a year. More batches when there are several manufacturers or sources. A justified worst-case strength is allowed. New applications: at least 6 pilot-scale or 3 production-scale batches. | QA Q&A 8, 14 | The submission form captures manufacture date, expiry, strength, API manufacturer/source and "retained sample: yes/no", so a batch-coverage summary can be produced per product and year. |
| N12 | Analytical technique and controls | Validated method; no technique rule. | "Use of accurate mass techniques are required (MS/MS or high-resolution accurate mass systems)". Control for artefacts: nitrosamines in testing materials, contamination in sample prep, in-situ formation, and co-elution (DMF with NDMA). "Control experiments should be conducted such as analysing samples by orthogonal analytical methods." OMCL methods on the EDQM site are a starting point. | QA Q&A 8 | The method record carries the technique (QQQ MS/MS or HRAM) and required control injections (reagent blank, in-situ formation check). An optional link to an orthogonal confirmatory test. |
| N13 | Escalation on detection | Batches above the AI that are distributed → Field Alert Report by the application holder. | When a nitrosamine is found **for the first time**, the MAH informs authorities "forthwith … irrespective of the amount detected". Above the limit: an (interim) investigation report with root cause, risk-mitigation plan and benefit/risk. | QA Q&A 11 | A "first detection" flag per product and nitrosamine: the first quantifiable result above the LoQ triggers a Customer notification even when it is below the AI. Results above the limit also open a Deviation. |
| N14 | Pharmacopoeial method: Ph. Eur. 2.5.42 | FDA methods (M-RAN, M-MET8 etc.), not compendial. | 2.5.42 "N-Nitrosamines in active substances". Adopted November 2020 (168th session); published in Supplement 10.6, July 2021. Three procedures: GC-MS, LC-MS/MS and GC-MS/MS. Procedures A and B are validated "as a limit test with a target concentration of 30 ppb", and procedure C (GC-MS/MS) quantitatively. Covers NDMA, NDEA, NDBA, NMBA, NDiPA, NEiPA and NDPA, validated for tetrazole sartans. Other substances or medicinal products need "demonstrated the suitability for the intended purpose with additional validation". Seven EDQM reference standards support it. | EDQM-NEW; EDQM-2542; EDQM-BRIEF | Add a **limit-test result type** ("complies / does not comply, ≤ 30 ppb") next to quantitative ppm. The method record cites the Ph. Eur. chapter and edition. Reference-standard lots link to their CRS source. A validation or suitability record is required before 2.5.42 is used on any non-sartan product. |
| N15 | Ph. Eur. general monographs | None. | General monographs 2034 (Substances for pharmaceutical use) and 2619 (Pharmaceutical preparations) include an N-nitrosamines paragraph, implemented 1 January 2024. 2619 requires risk evaluation "throughout their shelf-life" and a control strategy if the risk is confirmed. Individual active-substance monographs get a nitrosamine test only for process or degradation impurities with an approved limit; medicinal-product monographs normally get none. | EDQM-2034; EDQM-STRAT | Shelf-life coverage matters for the EU. The LIMS supports stability-timepoint nitrosamine testing on the same product specification (it already needs this for FDA App. C growth). |
| N16 | Names and synonyms | NEIPA/NIPEA, NDIPA, MNP. | EMA and EDQM spellings: NDiPA, NEiPA, MeNP (1-methyl-4-nitrosopiperazine), NPZ. | APP1; EDQM-NEW | Key analytes by CAS/SMILES, with a synonym list per analyte, so EU and FDA lists match up without duplicate analytes. |

## 2. EMA vs FDA acceptable intakes for named nitrosamines

AI in ng/day for lifetime exposure. EMA values are from APP1 Rev. 13. FDA values are from FDA-W rev 30, Table 1 (CPCA) or Table 2 (compound-specific or surrogate), unless noted. **Bold** marks a difference.

| Nitrosamine | Abbrev. | EMA AI | EMA basis | FDA AI | FDA basis | Difference |
|---|---|---|---|---|---|---|
| N-nitroso-dimethylamine | NDMA | 96 | Compound-specific | 96 | Compound-specific (T2) | Same |
| N-nitroso-diethylamine | NDEA | 26.5 | Compound-specific | 26.5 | Compound-specific (T2) | Same |
| N-nitroso-N-methylaniline | NMPA | 100 | CPCA cat 2 | 100 | CPCA cat 2 (T1) | Same |
| N-nitroso-ethylisopropylamine | NEIPA / NEiPA | 400 | CPCA cat 3 | 400 | CPCA cat 3 (T1) | Same |
| N-nitroso-N-methyl-4-aminobutyric acid | NMBA | 1500 | CPCA cat 4 | 1500 | CPCA cat 4 (T1) | Same |
| N-nitroso-diisopropylamine | NDIPA / NDiPA | 1500 | CPCA cat 5 | 1500 | CPCA cat 5 (T1) | Same |
| N-nitroso-di-n-butylamine | NDBA | 26.5 | SAR from NDEA | **not listed** | Default 26.5 applies (G p.13) | Same number; the EU value is published, the FDA one is a default |
| N-nitroso-di-n-propylamine | NDPA | 26.5 | SAR from NDEA | **not listed** | Default 26.5 | Same number, as above |
| N-nitroso-methylethylamine | NMEA | 26.5 | SAR from NDEA | **not listed** | Default 26.5 | EU publishes it (source: amphotericin B) |
| N-nitroso-morpholine | NMOR | **127** | Compound-specific TD50 | not listed | — | EU only |
| N-nitroso-pyrrolidine | NPYR | **1700** | Compound-specific TD50 | not listed | — | EU only |
| N-nitroso-piperidine | NPIP | **1300** | Compound-specific TD50 | not listed on its own (used as the surrogate) | — | EU only |
| N-nitroso-diethanolamine | NDELA | **1900** | Compound-specific | not listed | — | EU only |
| N-methyl-N-nitrosophenethylamine | NMPEA | **8** | Compound-specific | not listed | — | EU only; the lowest AI on APP1 |
| NNK | NNK | 100 | Compound-specific | 100 (surrogate) | Used as surrogate in T2 | Same |
| N-nitroso-piperazine | NPZ | **400** | CPCA cat 3 | **1300** | NPIP surrogate (T2) | **EU about 3× stricter** |
| N-nitroso-ciprofloxacin | — | **NMI (ICH Q3A/B)** | Negative in vivo mutagenicity | **1500** | CPCA cat 4 (T1); FDA interim 12,000 ng/day / 8 ppm to 8/1/2027 (T3) | **EU uses a Q3A/B limit, not an AI** |
| 1-methyl-4-nitrosopiperazine (rifampicin) | MeNP / MNP | 400 | CPCA cat 3 | 400 | CPCA cat 3 (T1); FDA interim 3,000 ng/day / 5 ppm (T3) | Same AI; FDA also has an interim limit |
| 1-cyclopentyl-4-nitrosopiperazine (rifapentine) | CPNP | **not listed** | — | 400 | CPCA cat 3 (T1) | FDA only |
| NTTP (sitagliptin) | NTTP | 100 | CPCA cat 2 | 100 | CPCA cat 2 (T1) | Same |
| N-nitroso-nortriptyline | — | **18** | CPCA cat 1 | **26.5** | CPCA cat 1 (T1); FDA interim 600 ng/day / 4 ppm (T3) | **EU stricter (cat 1 value)** |
| N-nitroso-desmethyl-sumatriptan | — | **18** | CPCA cat 1 | **26.5** | CPCA cat 1 (T1) | **EU stricter** |
| N-nitroso-desmethyl-rizatriptan | — | **18** | CPCA cat 1 | **26.5** | CPCA cat 1 (T1) | **EU stricter** |
| N-nitroso-desmethyl-citalopram | — | **100** | SAR from NNK | **26.5** | CPCA cat 1 (T1) | **EU less strict** |
| N-nitroso-desmethyl-doxylamine | — | **100** | SAR from NNK | **26.5** | CPCA cat 1 (T1) | **EU less strict** |
| N-nitroso-sertraline | — | 100 | CPCA cat 2 | 100 | CPCA cat 2 (T1); FDA interim 600 ng/day / 3 ppm (T3) | Same AI |
| N-nitroso-duloxetine / -fluoxetine / -atomoxetine | — | 100 each | SAR from NNK | 100 each | NNK surrogate (T2) | Same |
| N-nitroso-desmethyl-diltiazem | — | 100 | SAR from NNK | 100 | NNK surrogate (T2) | Same |
| N-nitroso-methylphenidate | — | 1300 | SAR (NPIP) | 1300 | NPIP surrogate (T2) | Same |
| N-nitroso-varenicline | NNV | 400 | CPCA cat 3 | 400 | CPCA cat 3 (T1) | Same |
| N-nitroso-vonoprazan | — | **not listed** | — | 96 | NDMA surrogate (T2) | FDA only |
| *CPCA category 1 (any)* | — | **18** | APP2 | **26.5** | RAIL Table 1 | **EU stricter** |

How to read the table: the seven small-molecule nitrosamines in FDA's guidance and Ph. Eur. 2.5.42 have the same numbers in both regions. The differences are in NDSRIs and less common small nitrosamines. The main drivers are the category 1 value (18 vs 26.5) and different surrogate or NMI conclusions (NPZ, ciprofloxacin, desmethyl-citalopram).

## 3. Worked examples (fictional)

**EU Option 1 vs Option 2 on the Q&A's own data.** The Q&A gives this example: finished product MDD 300 mg, NDMA 38 ppb, NDEA 44 ppb [QA Q&A 10]. The limits are NDEA 26.5 ÷ 300 = 88 ppb (most potent) and NDMA 96 ÷ 300 = 320 ppb.

- Option 1: total 82 ppb ≤ NMT 88 ppb → pass.
- Option 2 fixed at 20:80: NDMA NMT 64 ppb, NDEA NMT 70 ppb → both pass.
- Option 2 flexible: 12 % + 50 % = 62 % ≤ 100 % → pass.

These are the Q&A's published numbers, so they make a good unit-test vector.

**Same result, different verdict (category 1 NDSRI).** A fictional product has an MDD of 150 mg and contains N-nitroso-nortriptyline.

| | EU | FDA |
|---|---|---|
| AI | 18 ng/day | 26.5 ng/day |
| Limit (AI ÷ 150 mg) | 0.120 ppm | 0.177 ppm |
| Result 0.150 ppm | **fails** (125 % of AI) | passes (85 % of AI) |

A product specification therefore has to name its jurisdiction, and a multi-market Customer may need both verdicts on one report (open question 1).

**Zelotrin ZLT-0007 from the FDA baseline, under EU rules.** MDD 400 mg, NDMA 0.0500 ppm, NDEA 0.0100 ppm. Both are at or above 10 % of their AI, so both count.

- Option 1: 0.0600 ppm ≤ NDEA limit 0.0663 ppm → pass.
- Option 2 flexible: 20.8 % + 15.1 % = 35.9 % → pass.

The verdict matches the FDA baseline.

## 4. Open questions for the owner

1. **Jurisdiction model.** Does the demo carry a jurisdiction per product specification: FDA, EU, or both with two verdicts? The AI table, CPCA mapping, LTL handling, multi-nitrosamine rules and reporting all differ (N1–N10). Proposed: the specification carries one jurisdiction, and the report can show the other as information.
2. **Retention anchor for a contract lab.** CH4 §4.11 counts from batch expiry and QP certification, and the lab rarely knows the QP date. Proposed default: keep for at least the later of (batch expiry + 1 year) and (report release + 5 years), with a legal hold for stability and validation data. Confirm, or set per Customer contract.
3. **EU interim limits.** Support the Q&A 22 CAPA interim limit (13.3× or 6.7× AI, time-limited, authority-assigned) as a QA-entered override, or leave it out of the demo?
4. **Values between LOD and LoQ for EU specifications.** Report "< LoQ" and exclude the value from totals (proposed, and consistent with Q&A 9's "LoQ … for decision-making"), or keep FDA's "report if ≥ LOD" for both?
5. **Ph. Eur. 2.5.42 text.** The chapter needs a Ph. Eur. subscription. Does the owner have access to transcribe the LC-MS/MS procedure parameters, or should the demo refer to the chapter only by citation and keep M-RAN as the parameter template?
6. **Draft Annex 11 operations on a ≤ $10/month host.** Which of pen testing, secondary-site replication, separate-network backups and an RTO does the demo adopt now, given the drafts are not in force (E7–E10)?
7. **Q3A/B-type nitrosamine limits.** Does the specification model need the NMI / ICH S9 limit type (N4) in the demo, or only ng/day AIs?
