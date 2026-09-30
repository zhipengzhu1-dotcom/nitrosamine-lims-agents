# OOS investigations and CAPA

Research for [#33](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/33), part of map [#1](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/1). Sources fetched 2026-09-29. All products, batches and numbers in the examples are fictional; the regulatory text is real.

This note builds on `docs/research/part11.md` (#2, D4: invalidated data is kept), `iso17025.md` (#3, the 7.10 Deviation fields), `nitrosamines.md` (#4), `eu.md` (#25, N13 first detection) and `stability.md` (#30, §5 OOS/OOT on stability) and does not repeat them. It takes as given the lifecycle accepted in #12: Requested → Accepted | Rejected → Ready → Assigned → In Progress → Submitted for Review → Reviewed → Reported; side exits Cancelled (before results) and Invalidated (once results exist; a Retest is a new linked Test); a Hold pauses a Test without changing its state; QA releases Test Reports, partial reports are allowed, and an amendment supersedes.

## Short answer

1. **Deviation or a separate CAPA record?** A separate record is justified, but a small one, not a CAPA module. The Deviation holds the investigation and its root cause. Each corrective or preventive action becomes a small linked **CAPA Action** row with its own owner, due date, completion evidence and effectiveness check. Fields on the Deviation are not enough, for three reasons:
   - every source expects a documented **effectiveness check**, and that often falls due months after the investigation has closed [Q10 Table II; EU1 1.4(xiv); QS IV.D.4; ISO 8.7.1(d); PI041 12.1.1.3; CN 253(4)];
   - one investigation can need several actions, each with its own owner [Q7 11.15 "allocation of the tasks"];
   - a CAPA can come from sources that are not a Deviation: an audit, an unsatisfactory proficiency-test result, a complaint, or a trend [Q10 3.2.2; CN 252; AR2250 1.1.4].
2. **Phase I → Phase II, and who owns what.** In Phase I the laboratory checks its own work. The Analyst keeps the preparations and tells the supervisor, and the supervisor works through seven checks [OOS pp.3–5]. MHRA splits this into **Ia** (an obvious error, documented and corrected) and **Ib** (a checklist investigation, plus hypothesis testing under a written plan) [MHRA slides 6–15, 22]. **Phase II** is the full-scale investigation: production review, root cause and CAPA, any retests to a predefined plan, and impact on other batches. The manufacturer's quality unit runs it [OOS pp.6–8]. **The contract lab owns Phase I.** When Phase I finds no clear laboratory error, the lab passes its data and findings to the Customer's quality unit, which starts Phase II [OOS p.3]. The lab takes part in Phase II only by running the additional testing the Customer asks for. Batch disposition is always the Customer's [OOS p.12; 211.22; Q7 2.22].
3. **Can a standing OOS result be reported while Phase II is open?** Yes, and it should be. FDA: when a contract lab's investigation "does not determine an assignable cause, all test results should be reported to the customer on the certificate of analysis", and the investigation report should go to the customer too [OOS p.12 and fn 16]. MHRA agrees [MHRA slide 36]. The lab may **hold the report during Phase I**; ISO 7.10.1(b) lists "withholding of reports". Once Phase I concludes, the lab releases the report with the OOS flagged. Phase II retests are new Tests with their own results, and they are never averaged with the original [OOS p.10].
4. **When invalidation is allowed, and who approves it.** Only when the investigation has observed and documented a test event that "can reasonably be determined to have caused the OOS result" [OOS p.12]. That means clear laboratory error [OOS p.5] with "a valid, documented, scientifically sound justification" [DIQA Q2]. A failed outlier test never counts for a chemical assay [OOS p.11]. Neither do assumptions without evidence, which is MHRA's most common OOS deficiency [MHRA-B]. The quality unit reviews and approves investigations [211.192; 211.22(a)]. MHRA wants the hypothesis-testing plan approved by "QA/Contract Giver" before testing starts [MHRA slide 22]. The invalidated data stays in the record [DIQA Q2; part11.md D4]. **Design:** the Lab Manager runs Phase I, and QA e-signs every invalidation.
5. **Time limits.** No current regulation or guidance fixes days for closing an OOS investigation or a CAPA. The guidance says "timely" and "highest priority" [OOS pp.3, 6], and asks that each action be completed "within a defined timeframe" [QS IV.D.4]. The only FDA number is in the 1993 inspection guide: "All failure investigations should be performed within **20 business days** of the problem's occurrence" [IG93 §5.E]. That is roughly the "30 days" the ticket mentions; no primary source found says 30 days. The hard external clock is the Customer's: a **Field Alert Report within 3 working days** for a distributed US batch, unless the OOS is found invalid within 3 days [OOS p.14]. So the lab must tell the Customer **at detection**, not at the end of Phase I.

## Sources and revisions relied on

| Key | Document | Revision / date |
|---|---|---|
| OOS | FDA, [*Investigating Out-of-Specification (OOS) Test Results for Pharmaceutical Production*](https://www.fda.gov/media/158416/download) | Revision 1, May 2022. It replaces the October 2006 edition, which MHRA's deck still cites; this note quotes Rev. 1 only |
| CFR | 21 CFR [211.22](https://www.ecfr.gov/api/versioner/v1/full/2026-09-01/title-21.xml?part=211&section=211.22), [211.160](https://www.ecfr.gov/api/versioner/v1/full/2026-09-01/title-21.xml?part=211&section=211.160), [211.165](https://www.ecfr.gov/api/versioner/v1/full/2026-09-01/title-21.xml?part=211&section=211.165), [211.192](https://www.ecfr.gov/api/versioner/v1/full/2026-09-01/title-21.xml?part=211&section=211.192), [211.194](https://www.ecfr.gov/api/versioner/v1/full/2026-09-01/title-21.xml?part=211&section=211.194) | eCFR versioner, 2026-09-01 edition. 21 CFR 314.81(b)(1)(ii) (FAR) is cited as quoted in OOS p.14 |
| DIQA | FDA, [*Data Integrity and Compliance With Drug CGMP: Q&A*](https://www.fda.gov/media/119267/download) | December 2018 (Q2 p.6, Q13 pp.10–11) |
| QAG | FDA, [*Contract Manufacturing Arrangements for Drugs: Quality Agreements*](https://www.fda.gov/media/86193/download) | November 2016 |
| QS | FDA, [*Quality Systems Approach to Pharmaceutical CGMP Regulations*](https://www.fda.gov/media/71023/download) | September 2006 |
| IG93 | FDA, [*Guide to Inspections of Pharmaceutical Quality Control Laboratories* (7/93)](https://www.fda.gov/inspections-compliance-enforcement-and-criminal-investigations/inspection-guides/pharmaceutical-quality-control-labs-793) | July 1993; page "content current as of 11/13/2014". Reference material for FDA investigators, not guidance to industry |
| Q10 | ICH, [*Q10 Pharmaceutical Quality System*](https://database.ich.org/sites/default/files/Q10%20Guideline.pdf) | Step 4, 4 June 2008 |
| Q7 | ICH, [*Q7 GMP Guide for APIs*](https://database.ich.org/sites/default/files/Q7%20Guideline.pdf) | Step 4, 10 November 2000 (also EU GMP Part II) |
| EU1 | EudraLex Vol. 4 Part I, [*Chapter 1: Pharmaceutical Quality System*](https://health.ec.europa.eu/system/files/2016-11/vol4-chap1_2013-01_en_0.pdf) | Revision 3, in operation 31 January 2013 |
| EU6 | EudraLex Vol. 4 Part I, [*Chapter 6: Quality Control*](https://health.ec.europa.eu/system/files/2016-11/2014-11_vol4_chapter_6_0.pdf) | In operation 1 October 2014 |
| EU7 | EudraLex Vol. 4 Part I, [*Chapter 7: Outsourced Activities*](https://health.ec.europa.eu/system/files/2016-11/vol4-chap7_2012-06_en_0.pdf) | Revision 1, in operation 31 January 2013 |
| PICS | PIC/S, [*GMP Guide PE 009-18 Part I*](https://picscheme.org/docview/11332) | 24 September 2026. 1.4(xiv) and 6.35 match EU1/EU6 |
| PI041 | PIC/S, [*PI 041-1 Good Practices for Data Management and Integrity*](https://picscheme.org/docview/4234) | 1 July 2021 |
| MHRA | MHRA, [*Out of Specification & Out of Trend Investigations*](https://www.gov.uk/government/publications/out-of-specification-investigations) (slide deck, [pptx](https://assets.publishing.service.gov.uk/media/5a82373b40f0b62305b93186/MHRA_OOS_OOT_Oct17.pptx)) | October 2017 deck; publication first issued 28 Aug 2013, checked "still accurate" 26 Feb 2018 |
| MHRA-B | MHRA Inspectorate blog, [*Out of Specification Guidance*](https://mhrainspectorate.blog.gov.uk/2018/03/02/out-of-specification-guidance/) | 2 March 2018 |
| PJLA | PJLA, [*LF-56 ISO/IEC 17025:2017 Working Document*](https://www.pjlabs.com/downloads/LF-56-17025-2017.pdf) | Rev. 1.1 (12/20). An accreditation-body checklist that follows the standard clause by clause. ISO's own text was unreachable (see iso17025.md) |
| AR2250 | ANAB, [*AR 2250 Accreditation Requirements: ISO/IEC 17025 Testing Laboratories*](https://anab.qualtraxcloud.com/ShowDocument.aspx?ID=8160) | Effective 2026-03-06 |
| MA2100 | ANAB, [*MA 2100 Accreditation Manual for Inspection, Laboratories, and Related Activities*](https://anab.qualtraxcloud.com/ShowDocument.aspx?ID=8152) | Effective 2026-09-01 |
| CN | 卫生部令第79号, [《药品生产质量管理规范（2010年修订）》](https://www.gov.cn/gongbao/content/2011/content_1907093.htm) (China GMP) | In force 1 March 2011 (same edition as cn.md) |
| JGMP | [GMP省令](https://laws.e-gov.go.jp/api/1/lawdata/416M60000100179) (MHLW Ordinance No. 179 of 2004), e-Gov | Current e-Gov text as retrieved 2026-09-29 (same as jp.md) |
| GMPN | [GMP省令の一部改正について](https://www.pmda.go.jp/files/000264441.pdf) (薬生監麻発0428第2号) | 2021-04-28 (same as jp.md) |

OOS page numbers are the printed pages of the Rev. 1 PDF. MHRA citations are slide numbers in the deck. ICH, EU and PIC/S citations use section numbers.

## 1. The OOS investigation, phase by phase

### 1.1 What counts as OOS

OOS means any result "outside the specifications or acceptance criteria established in drug applications, drug master files (DMFs), official compendia, or by the manufacturer". It covers APIs, and the guidance "can also be used by contract firms" [OOS p.1]. "The responsibility of a contract testing laboratory in meeting these requirements is equivalent to that of a manufacturing firm" [OOS p.3]. The investigation is required, not optional: § 211.192 requires that "the failure of a batch or any of its components to meet any of its specifications shall be thoroughly investigated", with "a written record of the investigation ... [including] the conclusions and followup" [CFR 211.192]. Even rejecting the batch "does not negate the need to perform the investigation" [OOS p.3].

The same duty exists in every other jurisdiction checked:

- **EU and PIC/S.** QC must have "a procedure for the investigation of Out of Specification and Out Of Trend results" [EU6 6.7(iv)], and "any out of trend or out of specification data should be addressed and subject to investigation" [EU6 6.9].
- **ICH Q7 (APIs).** The OOS procedure must require "analysis of the data, assessment of whether a significant problem exists, allocation of the tasks for corrective actions, and conclusions" [Q7 11.15].
- **China.** 「质量控制实验室应当建立检验结果超标调查的操作规程。任何检验结果超标都必须按照操作规程进行完整的调查」 ("the QC laboratory establishes an OOS investigation SOP; every OOS must be fully investigated to it") [CN 224].
- **Japan.** When a test result fails its specification, the quality department must 「その原因を究明し、所要の是正措置及び予防措置をとる」 ("find the cause and take the necessary corrective and preventive action") and keep records [JGMP Art. 11(1)(viii)]. The notice calls this 「いわゆる"Out of Specification"」 and requires an SOP for it [GMPN §3 Art. 8(1)(iii)(コ)].

**Which value is checked for this lab.** In `CONTEXT.md`, the Reportable Result is the mean of the Test's Preparations, and each Preparation is the mean of its injections. FDA accepts both kinds of averaging when the approved method specifies them, together with variability limits between replicates. Averaging injections of one preparation "is considered one test and one result". If the replicate-variability limits fail, "the test results should not be used" [OOS pp.9–10]. There is also an important caution about preparations. When some preparation results are OOS and some within specification, and all are within the method's known variability, "a firm should err on the side of caution and treat the average of these values as an OOS result, even if that average is within specification" [OOS p.13]. The injection level is different: once the variability criteria are met, "the result of any individual replicate in and of itself should not cause the reportable result to be OOS" [OOS pp.13–14].

**LIMS rules that follow:**

- Check each **Preparation result** and the **Reportable Result** against the specification. Do not check individual injections.
- A single OOS Preparation triggers the OOS workflow even when the mean passes.
- A failed replicate-variability limit makes the Test invalid by a predefined criterion, the same as a failed system suitability. It opens a Deviation, but it is not an OOS.
- For nitrosamines, OOS is judged by the specification's decision rule. That rule can be the multi-nitrosamine percent-of-AI sum, which can fail while every analyte passes on its own (nitrosamines.md §4). The OOS flag therefore belongs to the Test's conformity evaluation, not only to one analyte's value.

### 1.2 Phase I: the laboratory investigation (the contract lab's job)

**The Analyst.** The Analyst uses only instruments that meet their performance specifications and pass system suitability. Data from a suspect period "should be properly identified and should not be used". The Analyst checks the data "before discarding test preparations or standard preparations". When a result is unexpected, the preparations "should be retained, if stable, and the analyst should inform the supervisor". When an error is obvious, for example a spill, the Analyst documents it at once, and analyses "should not be completed for the sole purpose of seeing what results can be obtained when obvious errors are known" [OOS pp.3–4].

**The supervisor's assessment** is "objective and timely", with "no preconceived assumptions" [OOS p.4]. It has seven steps:

1. discuss the method with the Analyst;
2. examine the raw data, chromatograms and spectra;
3. verify the calculations, including checking for "unauthorized or unvalidated changes" to automated calculations;
4. confirm instrument performance;
5. check the reference standards, solvents and reagents;
6. compare the method's performance with its validation and history;
7. "Fully document and preserve records" [OOS pp.4–5].

The supervisor also tests hypotheses on the retained solutions. For example, "Solutions can be re-injected ... where a transient equipment malfunction is suspected" [OOS p.5].

**MHRA's split of Phase I** [MHRA slides 6–15, 22]:

- **Phase Ia.** A "clear obvious error", such as a power failure, equipment failure, calculation error, wrong instrument parameter or spilled sample. The Analyst and supervisor document it and annotate "analysis to be repeated". The result is invalid and no further investigation is needed, but "these issues are trended".
- **Phase Ib.** The Analyst and supervisor work through a checklist of about 30 items, for example the method version, sample identity and chain of custody, calibration dates, standards, system suitability, glassware, expiry dates, the analyst's training, other batches in the same run, and method validation. They also contact "Production/Contract Giver/QP/MAH as appropriate" [slide 13]. Re-measurement may start only "once the hypothesis plan is documented". It can include "the original working stock solutions but should not include another preparation from the original sample (see: re-testing)" [slide 13]. The plan must state the hypothesis, the samples, the exact execution and how the data will be evaluated, and it must be "approved by QA/Contract Giver/QA equivalent prior to initiating". Investigational testing "may not be used to replace an original suspect analytical result" [slide 22].

In this project's words, a **Reinjection** of a retained Preparation is allowed in Phase I, but only as an investigational measurement under an approved plan. A **Re-preparation** from the Sample is a retest, which belongs to Phase II.

**Phase I outcomes:**

| Outcome | Source | What happens to the result |
|---|---|---|
| Clear laboratory error with a documented cause | "when clear evidence of laboratory error exists, laboratory testing results should be invalidated" [OOS p.5] | Invalidated. A retest substitutes for it, and "all original data must be retained" with an explanation "initialed and dated by the involved persons" and "supervisory comments" [OOS p.8]. Laboratory CAPA follows: "take corrective action to prevent recurrence" [OOS p.5]; MHRA slide 9: "Generate CAPA" |
| No assignable cause, or evidence unclear | "a full-scale OOS investigation should be conducted by the manufacturing firm" [OOS p.5] | The OOS result **stands**. The contract lab "should convey its data, findings, and supporting documentation to the manufacturing firm's quality unit (QU)", which "should then initiate the Phase 2 ... investigation" [OOS p.3] |

Two limits on the first outcome: "OOS test results should not be attributed to analytical error without completing an investigation that clearly establishes a laboratory root cause" [OOS p.6], and "Laboratory error should be relatively rare" [OOS p.5].

### 1.3 Phase II: the full-scale investigation (the Customer's job)

Phase II uses "a predefined procedure". Its objective is to "identify the root cause of the OOS result and take appropriate corrective action and preventive action", and it "should be given the highest priority". It includes "evaluation of the impact of OOS result(s) on already distributed batches". It "should be conducted by the QU", with manufacturing, process development, maintenance and engineering, and with every site involved [OOS p.6]. Its written record must hold:

1. the reason for the investigation;
2. the manufacturing aspects that may have caused it;
3. the documentation review, "with the assignment of actual or probable cause";
4. whether the problem has occurred before;
5. the corrective actions [OOS p.6].

A confirmed OOS turns into a batch-failure investigation that "must be extended to other batches or products" [OOS p.12; CFR 211.192]. MHRA adds a **Phase III**: impact on other batches, stability studies and processes, then batch disposition, with CAPA [MHRA slides 34–35].

The contract lab's part in Phase II is limited to **additional laboratory testing**:

- **Retest.** A new analysis of "the same homogeneous material that was originally collected", done to a predefined plan, often by "an analyst other than the one who performed the original test" who is "at least as experienced and qualified" [OOS p.7]. "The maximum number of retests ... should be specified in advance in a written standard operating procedure", and it "should not be adjusted depending on the results obtained". Any departure from that SOP needs "a protocol ... (subject to approval by the QU)" [OOS pp.7–8]. MHRA: "papers have suggested 5, 7, or 9" retests [slide 23].
- **Resample.** "a new sample collected from the batch", taken according to predetermined procedures [OOS p.8]. MHRA: it "Should rarely occur!", and it must be agreed with the contract giver [slide 27]. In this project that is a **Resample**, and the Customer decides on it.
- **No averaging across the investigation.** Averaging the original OOS with retest or resample results "is not appropriate because it hides variability". "It is critical that the laboratory provide all individual results for evaluation and consideration by the QU" [OOS p.10].
- **No outlier tests to invalidate chemical results.** For validated chemical tests on homogeneous samples an outlier test "should not be used to invalidate the suspect result". It is informational only [OOS p.11, fn 15 citing *U.S. v. Barr Laboratories*, 1993; MHRA slide 28].
- **If no laboratory error was found, all results count.** "there is no scientific basis for invalidating initial OOS results in favor of passing retest results. All test results, both passing and suspect, should be reported" [OOS p.8]. Footnote 10 says this includes Certificates of Analysis.

### 1.4 Who owns what in a contract-lab arrangement

| Activity | Owner | Source |
|---|---|---|
| Detect the OOS, keep the preparations, inform the supervisor | Lab (Analyst) | OOS pp.3–4 |
| Phase I (Ia/Ib) investigation and conclusion | Lab (supervisor = Lab Manager; QA approves invalidation) | OOS pp.3–5; MHRA slides 6–15 |
| Hypothesis-testing plan approval | Lab QA **and/or** contract giver, per the quality agreement | MHRA slide 22 |
| Tell the Customer; send data, findings and the investigation report | Lab | OOS p.3, p.12 fn 16; MHRA slides 13, 20 |
| Laboratory CAPA for laboratory causes | Lab | OOS p.5; QAG Case 4 pp.12–13 |
| Phase II (production review, root cause, impact on other batches) | Customer's QU | OOS pp.3, 6 |
| Retest plan approval, resampling decision | Customer's QU (the lab runs the tests) | OOS pp.7–8; MHRA slides 23, 27 |
| Batch disposition; FAR, EU authority report, Japanese MAH notification | Customer | OOS pp.12, 14; CFR 211.22(a); EU6 6.35; JGMP Art. 11-2(2) |

Other jurisdictions divide responsibility the same way:

- **FDA quality agreements.** The quality agreement should designate "responsibility for investigating deviations, discrepancies, failures, out-of-specification results, and out-of-trend results in the laboratory, and for sharing reports of such investigations" [QAG p.10]. A contract lab cannot hand this off. In QAG Case 4, a lab that used the owner's method argued it was not responsible for investigating, and FDA answered that "Analytical testing laboratories are responsible for operating in compliance with CGMP regardless of quality agreements", while the owner decides on release [QAG pp.12–13].
- **EU and ICH Q7.** A written contract sets out "who undertakes each step" [EU7 7.14–7.15; Q7 16.12]. The contract giver reviews "the records and the results related to the outsourced activities" [EU7 7.8].
- **China.** A written contract fixes each party's duties [CN 278, 287]. The contract giver must be able to see all records relevant to product quality [CN 290].
- **Japan.** The manufacturer's quality department judges results, including those from an 外部試験検査機関 (external testing laboratory). The causes it looks at include 「外部試験検査機関における検体の取扱い、試験検査の方法等に起因する場合」 ("sample handling or test methods at the external testing laboratory") [GMPN §3 Art. 11(1)(viii) ア, イ(ア)]. The contract must fix how samples are handed over and how results are communicated [GMPN §3 Art. 8(1)(iii)].

## 2. Invalidating an OOS result

**When it is allowed.**

- "Invalidation of a discrete test result may be done only upon the observation and documentation of a test event that can reasonably be determined to have caused the OOS result" [OOS p.12].
- Excluding results from a quality decision "requires a valid, documented, scientifically sound justification". Even then, "the full CGMP batch record ... would include the original (invalidated) data, along with the investigation report" [DIQA Q2].
- "All data—including obvious errors and failing, passing, and suspect data—must be in the CGMP records" [DIQA Q13].
- MHRA defines an invalidated test as one where "the investigation has determined the assignable cause" [slide 11]. Its most common inspection finding is an OOS "invalidated on the basis of assumptions and theories with no real evidence" [MHRA-B].
- PIC/S grades "Reporting of a 'desired' result rather than an actual out of specification result" as a **critical** deficiency [PI041 11.2].

**Not allowed as grounds:**

- an outlier test on a chemical assay [OOS p.11];
- a passing retest when no laboratory error was found [OOS p.8];
- a "most probable" laboratory cause offered in place of evidence [OOS p.6, "clearly establishes"].

Unexplained OOS results in the end go to the Customer's disposition as "inconclusive", and the QU gives them "full consideration" [OOS p.12].

**Who approves it.** Each source puts the decision on the quality unit:

- the quality control unit reviews and approves investigations [CFR 211.192; 211.22(a)];
- the QU "is responsible for interpreting the results of the investigation" [OOS p.12];
- changes to data are "reviewed and approved by at least one appropriately trained and qualified individual", under measures the quality unit sets [PI041 9.7];
- China: 「偏差调查报告应当由质量管理部门的指定人员审核并签字」 ("the investigation report is reviewed and signed by a designated person in QA") [CN 250];
- MHRA: Phase Ia corrections are initialled by the Analyst and the supervisor [slide 8], while hypothesis plans are approved by "QA/Contract Giver" [slide 22].

*Design judgment:* the lab's **QA** e-signs every invalidation, with the reason and the linked Deviation (part11.md D4). A Phase Ia correction made before any result existed (a spill, a power cut) is a Deviation on the Run or Preparation, not an invalidated OOS result. The Lab Manager signs those.

## 3. CAPA: when it opens and what it holds

### 3.1 When an OOS investigation must lead to CAPA

- **FDA.** "Implicit in this requirement for investigation is the need to implement corrective actions and preventive actions" [OOS p.6 fn 7, on § 211.192]. For laboratory error: "take corrective action to prevent recurrence" and "maintain adequate documentation of the corrective action" [OOS p.5]. For Phase II, identifying the root cause and CAPA is the objective [OOS p.6].
- **ICH Q10.** The CAPA system takes input from "complaints, product rejections, non-conformances, recalls, deviations, audits, regulatory inspections and findings, and trends". The "level of effort, formality, and documentation of the investigation should be commensurate with the level of risk". In commercial manufacturing, "CAPA should be used and the effectiveness of the actions should be evaluated" [Q10 3.2.2, Table II].
- **EU and PIC/S.** "An appropriate level of root cause analysis should be applied". Where the true cause can't be found, address "the most likely root cause(s)". Human error "should be justified having taken care to ensure that process, procedural or system-based errors ... have not been overlooked". CAPAs "should be identified and taken", and "The effectiveness of such actions should be monitored and assessed" [EU1 1.4(xiv); PICS 1.4(xiv)]. Significant deviations are investigated for root cause, with CAPA [EU1 1.8(vii)]. The product quality review looks back at "the effectiveness of resultant corrective and preventive actions" [EU1 1.10(iv)].
- **ISO/IEC 17025.** Where nonconforming work "could recur", the lab takes corrective action (7.10.3), which leads into 8.7 [PJLA].
- **China.** A CAPA system covers complaints, recalls, deviations, audits and trends [CN 252]. For a major deviation, 「企业还应当采取预防措施有效防止类似偏差的再次发生」 ("also take preventive action to stop similar deviations recurring") [CN 250].
- **Japan.** CAPA is mandatory for any OOS [JGMP Art. 11(1)(viii)], and for a 重大な逸脱 (serious deviation) [JGMP Art. 15(1)(ii)ハ].

So not every Deviation needs a CAPA, but every **OOS** investigation must record a CAPA decision. A lab-caused OOS always gets a laboratory CAPA. A standing OOS with no laboratory cause usually gets no lab CAPA; its CAPA is the Customer's Phase II.

### 3.2 What a CAPA record must hold

| Element | Sources |
|---|---|
| Nature of the problem, and its source record(s) | ISO 8.7.3(a) [PJLA]; Q10 3.2.2 (sources); CN 253(1) |
| Root cause, or most likely root cause, and how it was reached; human error justified | EU1 1.4(xiv); ISO 8.7.1(b); OOS p.6 item 3 ("actual or probable cause"); CN 253(2) |
| Extent: similar nonconformities elsewhere, other batches, earlier results | ISO 8.7.1(b) [PJLA]; CFR 211.192; OOS p.6 item 4; ISO 7.10.1(c) |
| Correction (immediate fix) kept distinct from corrective action (prevents recurrence) and preventive action (prevents occurrence) | QS III.D; Q10 Glossary; JGMP Art. 2(14)–(15) |
| Each action: an owner and a due date | Q7 11.15 ("allocation of the tasks"); QS IV.D.4 ("within a defined timeframe") |
| Implementation evidence and any changes made | CN 253(5); ISO 8.7.1(c) |
| Effectiveness check: criteria, when, result, who | Q10 Table II; EU1 1.4(xiv); QS IV.D.4–5; ISO 8.7.1(d); PI041 12.1.1.3; CN 253(4) |
| Update of risks and of the management system if needed | ISO 8.7.1(e)–(f) [PJLA] |
| Communication to the responsible people and management review | CN 253(6)–(7); Q10 4 |
| Records of causes, actions and results, kept by QA | ISO 8.7.3 [PJLA]; CN 254 |
| Record built up progressively as the actions proceed | 「当該措置の進捗スケジュールに沿って漸次に作成」 ("created progressively along the actions' schedule") [GMPN §3 Art. 11(1)(viii)イ, Art. 15(1)(iii)] |

Note that ISO/IEC 17025:2017 has no separate preventive-action clause. The nearest is 8.5, "actions to address risks and opportunities", which also asks the lab to "evaluate the effectiveness of these actions" [PJLA 8.5.2].

### 3.3 Why a Deviation field set is not enough

Putting "root cause / corrective action / preventive action" as text fields on the Deviation would meet the letter of § 211.192. It breaks on four points the sources insist on:

1. **Effectiveness is checked later.** Q10, EU1 1.4(xiv), QS and ISO 8.7.1(d) all require it, and it can fall months after the investigation. If the CAPA lives on the Deviation, the Deviation stays open, and with it any equipment block or Hold, until the check is done. Otherwise the check goes unrecorded.
2. **Several actions, several owners, several dates.** Q7 11.15 and QS IV.D.4 expect each action to be assigned and dated. One text field can't hold that or show what is overdue.
3. **Sources other than Deviations.** Audits, unsatisfactory PT results (ANAB requires investigation and "When appropriate, corrective action" [AR2250 1.1.4]), complaints and trend reviews [Q10 3.2.2; CN 252; QS IV.D.4] all raise CAPA. So do ANAB's own assessment findings: accreditation is granted only after "appropriate corrective action(s) for all issued ... nonconformities" [MA2100 p.7].
4. **One cause, many Deviations.** Recurring OOS from one method or analyst should lead to one CAPA. FDA: "Laboratory management should be especially alert to developing trends" [OOS p.5]. Japan: when OOS recurs despite CAPA, do a product quality review [GMPN §3 Art. 11(1)(viii)イ(イ)].

A **full CAPA module** (its own workflow engine, risk scoring, effectiveness analytics, a CAPA review board) stays out of scope, as the map says. What is justified is one small table.

```text
Deviation (existing; kind ∈ {equipment, environment, method, OOS, OOT, data-integrity, system, …})
  … iso17025.md 7.10 fields (impact on previous results, acceptability, customer notified, recall, resumption authoriser)
  root_cause_category, root_cause_text, most_likely (bool), human_error_justification?
  correction_text                       ← immediate fix, done inside the Deviation
  capa_required (bool) + reason if false
  └─ links → CapaAction[]

CapaAction (lab-owned, small)
  lab_id, number, kind {corrective, preventive}
  sources[] → Deviation | AuditFinding | PTResult | Complaint | TrendReview (Deviation only in the demo)
  description, owner (person), due_date, status {planned, in_progress, done, verified_effective, not_effective, cancelled}
  completed_at, completion_evidence (text + attachments)
  effectiveness_criterion, effectiveness_due, effectiveness_result, verified_by (e-signature)
  due_date changes → reason + QA e-signature (audit-trailed)
```

A Deviation closes when its investigation is complete and its actions are **planned**, each with an owner and a date. The effectiveness check lives on the CapaAction. A `not_effective` result opens a new action on the same source.

## 4. How OOS fits the #12 lifecycle

An OOS never adds a Test state; it uses the pieces #12 already has. The flow:

1. **Detection.** When a Preparation result or the Reportable Result fails its specification (§1.1), the LIMS:
   - opens a **Deviation** of kind OOS in phase I, prefilled with the Test, Sample, Lot, specification version, limit and value;
   - places a **Hold** on the Test, citing that Deviation;
   - records the time the Customer was notified.

   The Test stays In Progress or Submitted for Review. The Hold blocks three steps: new Preparations or Re-preparations; the Reviewed step; and QA release onto a Test Report. Reinjections are allowed only as investigational measurements recorded under the Deviation's approved hypothesis plan [MHRA slides 13, 22]. The original values stay visible and can't be edited [DIQA Q13].
2. **Phase I conclusion: laboratory error.** QA e-signs the invalidation. The Test goes to **Invalidated**, and a **Retest** is created as a new linked Test (#12). The retest result stands in for the original [OOS p.8]. The Hold is released. Laboratory CAPA actions are planned. The Customer gets the investigation report [OOS fn 16].
3. **Phase I conclusion: no assignable laboratory cause.** The OOS stands. The Phase I report goes to the Customer [OOS p.3]. The Hold is released, and the Test proceeds through Reviewed → Reported, with the OOS flagged and all individual results shown [OOS pp.8, 12; MHRA slide 36]. Other Tests on the Submission can be reported separately at any time (partial reports).
4. **Phase II (Customer).** Any retests the Customer asks for are new Tests on the same Sample, linked to the Deviation. **The original is not invalidated**, and each retest is reported on its own, never averaged with the original [OOS pp.8, 10]. A Resample arrives as a new Sample. Batch disposition is recorded, if at all, only as information the Customer has supplied.
5. **A lab error found later.** If Phase II evidence later shows a laboratory cause [OOS pp.12–13, the "atypical failure to detect the laboratory deviation"], QA invalidates the original Test, which is allowed because results exist, and an **amended Test Report supersedes** the one already issued (#12; ISO 7.8.8 in iso17025.md). The Deviation records the recall or amendment and the Customer notification (ISO 7.10.1(e)).

This exposes a **glossary conflict.** `CONTEXT.md` defines a Retest as "a new Test on the same Sample after the original Test is invalidated". FDA's and MHRA's Phase II retests happen without any invalidation. The definition needs widening (open question 3).

## 5. Time limits

| Clock | Limit | Source | Who it binds |
|---|---|---|---|
| Starting the assessment | "An assessment of the accuracy of the results should be started immediately"; the supervisor's assessment should be "objective and timely" | OOS p.4 | Lab |
| Reporting a deviation internally | 「立即报告主管人员及质量管理部门」 ("immediately report to the supervisor and QA") | CN 250 | Lab |
| Whole investigation | "thorough, timely, unbiased, well-documented"; Phase II is given "the highest priority" | OOS pp.3, 6 | Both |
| Investigation closure | "All failure investigations should be performed within 20 business days of the problem's occurrence" | IG93 §5.E (1993 inspector guide) | Inspector expectation; the only numeric FDA source |
| Field Alert Report (distributed US batch) | 3 working days, "Unless the OOS result ... is found to be invalid within 3 days" | OOS p.14; 21 CFR 314.81(b)(1)(ii) | Customer (application holder) |
| EU confirmed OOS on marketed batches (stability) | Report to competent authorities; no days given | EU6 6.35; PICS 6.35 | Customer (MAH) |
| Japan serious deviation / stability OOS | Tell the MAH 「速やかに」 ("promptly"); no days given | JGMP Art. 15(1)(ii)イ, Art. 11-2(2) | Manufacturer, so the Customer's supply chain |
| CAPA actions | "a selected action is taken within a defined timeframe"; audit CAPA "completed in a timely and effective manner" | QS IV.D.4; Q7 2.41 | Lab for its own CAPA |
| CAPA records | Updated progressively, reported to QA 「遅滞なく」 ("without delay") | GMPN §3 Art. 15(1)(iii) | Manufacturer |
| ANAB | Notify ANAB "promptly" of unsatisfactory PT results; challenge an ANAB nonconformity within 15 days | AR2250 1.1.4(a); MA2100 p.11 | Lab (accreditation, not OOS) |

No source found sets "30 days". The 1993 figure of 20 business days is about 28 calendar days, so it is probably where the industry habit comes from. MHRA and the EU set no number.

*Design judgment:*

- **Due dates, not blocks.** Due dates are configurable per lab and generate overdue alerts. They never block a step on their own.
- **Proposed defaults:**
  - Customer notified within 1 working day of OOS detection, so the Customer can meet its 3-working-day FAR clock;
  - Phase I due within 20 business days of detection [IG93];
  - each CapaAction carries its own due date, set when it is planned.
- **Extensions.** Moving any due date needs a reason and a QA e-signature.

## 6. OOT, only where it differs from OOS

- **Definition.** OOT is "generally a stability result that does not follow the expected trend", and it is "not necessarily OOS". MHRA separately names "Atypical / Aberrant / Anomalous" results that are within specification but unexpected, "chromatograms that show unexpected peaks" for example [MHRA slide 5]. No source sets a numeric OOT rule (stability.md §5.2).
- **Obligation.** The EU requires a written OOT procedure and an investigation [EU6 6.7(iv), 6.9]. FDA says only that its OOS guidance "may be useful" for OOT [OOS p.3 fn 6]. The quality agreement should assign responsibility for OOT investigations too [QAG p.10].
- **Alert levels.** MHRA grades stability OOT as "analytical, process control, and compliance alerts", with depth of investigation increasing in that order. A compliance alert predicts OOS before expiry. For that case MHRA says to test again before the next scheduled interval [MHRA slides 32–33].
- **What differs for the LIMS:**
  - **No automatic Hold.** The result is within specification, so reporting isn't blocked unless an investigation finds laboratory error.
  - **History is needed.** OOT needs historical data. A contract lab holds that data only for studies it runs (stability) and for its own control charts, and not for the Customer's release history.
  - **Response.** The flag makes the Reviewer acknowledge it. The Lab Manager decides whether to open a Deviation of kind OOT, which runs the same Phase I checklist (stability.md §5.2).

## Recommendation for the demo

Build now:

- **OOS detection** at Preparation and Reportable Result level, evaluated through the specification's decision rule (§1.1). Individual injections are not checked. Detection auto-creates a Deviation of kind OOS and a Hold on the Test, and records the Customer-notified time.
- **Phase I on the Deviation.**
  - The FDA 7-step checklist, extended with MHRA's Ib items.
  - An Ia/Ib marker.
  - A hypothesis plan with QA approval.
  - Investigational Reinjections recorded against the plan, never replacing the original.
  - A conclusion: laboratory error (QA e-signed invalidation → Test Invalidated → linked Retest), or OOS stands (Phase I report to the Customer → Hold released → normal review and release, with the OOS flagged).
- **Retest rules.**
  - A per-Method maximum number of retests, set in advance.
  - A second-analyst preference that needs a reason to override.
  - No averaging across Tests anywhere in the system.
  - No outlier-based exclusion.
- **The Deviation gains** root cause (category, text, "most likely" flag), correction, and "CAPA required?" with a reason.
- **A small CapaAction table** linked to Deviations, with kind, owner, due date, status, evidence, and an effectiveness criterion, date, result and signer. It comes with one overdue list. This is the minimum that satisfies Q10, EU1 1.4(xiv), ISO 8.7 and China 253 without a CAPA module.
- **Report behaviour.** A standing OOS is released with every individual result and a reference to the investigation. A later invalidation produces a superseding amended report.

**Later:** CAPA sources other than Deviations (audits, PT, complaints), trend-triggered CAPA across Deviations, a Customer portal view of investigation reports, OOT beyond stability, and time-limit dashboards.

## Open questions for the owner

1. **Separate CAPA record.** *Decision:* model CAPA as a small `CapaAction` table linked to Deviations, or as fields on the Deviation? *Recommended:* the small table (§3.3). It is the only way to record effectiveness checks after the Deviation closes, and several owners and due dates, without keeping Holds open. It stays far short of the out-of-scope "full CAPA module".
2. **Who approves invalidation.** *Decision:* who e-signs the invalidation of an OOS result? *Recommended:* the Lab Manager runs Phase I and QA e-signs every invalidation. A Phase Ia event recorded before any result exists is signed by the Lab Manager as an ordinary Deviation.
3. **Retest definition.** *Decision:* widen the glossary's Retest? *Recommended:* yes. Retest becomes "a new Test on the same Sample, linked to the original, created either after the original is invalidated or under an approved OOS investigation plan; the original is kept." Without this change, Phase II retests requested by the Customer have no home.
4. **What the Hold blocks.** *Decision:* which steps does an OOS Hold block? *Recommended:* new Preparations or Re-preparations (Reinjections only under the approved plan), the Reviewed step, and QA release, until Phase I concludes. The Deviation can stay open afterwards for CAPA without holding the Test.
5. **Reporting a standing OOS.** *Decision:* release the Test Report while the Customer's Phase II is still open? *Recommended:* yes. Release it as soon as Phase I concludes "no assignable laboratory cause", with the OOS flagged, all individual Preparation results, and the Deviation number. Send the Phase I report to the Customer at the same time. Phase II retests are reported separately.
6. **The invalidated result on the Test Report.** *Decision:* when a result is invalidated for laboratory error, does the Retest's Test Report mention it? *Recommended:* yes, as a note ("original Test T-… invalidated, laboratory error, Deviation D-…"), without printing the invalid value as a result. The full data goes in the investigation report sent to the Customer [OOS fn 16].
7. **Time limits.** *Decision:* the default due dates. *Recommended:* notify the Customer within 1 working day of detection; close Phase I within 20 business days [IG93]; set a due date on each CAPA action when it is planned. All three are configurable, raise alerts rather than blocks, and any extension needs a reason and a QA signature.
8. **Preparation-level OOS.** *Decision:* treat one OOS Preparation as an OOS even when the duplicate mean passes? *Recommended:* yes, following FDA's caution [OOS p.13]. It is also cheap, since results are already stored per Preparation.
9. **Maximum retests per Method.** *Decision:* the default when the Method record sets no maximum. *Recommended:* no default. A GMP Method can't be adopted without an explicit value, which the lab's SOP sets [OOS pp.7–8].
10. **Non-GMP Tests.** *Decision:* does an OOS on a non-GMP Test (development, feasibility) run the full workflow? *Recommended:* no. Flag it and require an Analyst comment, with no automatic Deviation or Hold. The OOS guidance applies to CGMP testing, and CONTEXT.md already relaxes review for non-GMP work.
11. **Customer-side Phase II data.** *Decision:* should the LIMS record the Customer's Phase II outcome and batch disposition? *Recommended:* only as an optional note with an attachment on the Deviation. The lab doesn't own those decisions, and tracking them would put the Customer's quality system inside the lab's LIMS.
