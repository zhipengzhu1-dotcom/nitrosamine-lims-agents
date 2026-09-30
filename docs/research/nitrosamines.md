# FDA nitrosamine limits and how results are reported

Research for [#4](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/4), part of map [#1](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/1). Sources fetched 2026-09-29. All example products, batches and numbers below are fictional.

## Short answer

FDA sets an **acceptable intake (AI)** for each nitrosamine in ng/day. A lab turns it into a concentration limit with **ppm = AI (ng/day) ÷ maximum daily dose (mg/day)**, using the MDD on the drug label [G p.13]. Of the named small-molecule nitrosamines, NDMA is 96 ng/day and NDEA is 26.5 ng/day [W Table 2]. NMPA is 100, NEIPA 400, NMBA 1500 and NDIPA 1500 ng/day [W Table 1]. When FDA gives no AI, the default is 26.5 ng/day [G p.13]. The result is compared at two points:

- **Above 10 % of the AI**, a release and stability specification is needed [G pp.19, 21–22].
- **Above the AI**, the batch should not be released [G p.19].

FDA sets no numeric LOQ. The LOQ has to be "commensurate with the level at which the impurities must be controlled" per ICH Q2(R1) [G p.13]. In practice the lab needs an LOQ at or below 10 % of the ppm limit; that is an inference, explained under LOQ expectations. If a product has more than one nitrosamine, the total may not exceed the AI of the most potent one [G p.13]. The alternative is FDA's flexible approach: each nitrosamine is expressed as a percent of its own AI, and the percents must add up to no more than 100 %, for up to three nitrosamines [G App. C].

FDA's own published methods report each nitrosamine in **ppm to three significant figures when the value is ≥ LOD**, and report **"not detected" below the LOD** [M-RAN; M-MET8]. The demo method record can copy FDA's LC-MS/MS triple-quad NDMA method in ranitidine [M-RAN] almost field for field.

## Sources and revisions relied on

| Key | Document | Revision / date |
|---|---|---|
| G | FDA, [*Control of Nitrosamine Impurities in Human Drugs*, Guidance for Industry](https://www.fda.gov/media/141720/download) ([landing page](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/control-nitrosamine-impurities-human-drugs)) | Revision 2, September 2024 (supersedes Feb 2021); effective 5 Sep 2024, 89 FR 72408 |
| W | FDA, [CDER Nitrosamine Impurity Acceptable Intake Limits](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/cder-nitrosamine-impurity-acceptable-intake-limits) (the "nitrosamine guidance web page") | Content current as of 09/24/2026, revision 30. Tables 1–2 updated 9/24/2026, Table 3 on 7/29/2026, Table 5 on 10/1/2024 |
| RAIL | FDA, [*Recommended Acceptable Intake Limits for NDSRIs*, Guidance for Industry](https://www.fda.gov/media/170794/download) | August 2023 (landing page current as of 08/04/2023); effective 7 Aug 2023 |
| LTL | FDA, [*Application of Less-Than-Lifetime Adjustment to Nitrosamine Impurities*](https://www.fda.gov/media/195007/download) (Emerging Issues statement on W) | 24 September 2026 |
| NDBA | FDA, [*Emerging Scientific and Technical Information on Leachable NDBA and Other Small-Molecule Nitrosamines in Infusion Bags*](https://www.fda.gov/media/188238/download) | 18 August 2025 |
| M7 | ICH/FDA, [*M7(R2) Assessment and Control of DNA Reactive (Mutagenic) Impurities*](https://www.fda.gov/media/170461/download) | M7(R2), July 2023 |
| M-RAN | FDA, [LC-MS/MS Method for the Determination of NDMA in Ranitidine DS and Solid Dosage DP](https://www.fda.gov/media/131868/download) | Dated 10/17/2019 (listed on W Table 5) |
| M-MET8 | FDA, [LC-ESI-HRMS Method for the Determination of Nitrosamine Impurities in Metformin DS and DP](https://www.fda.gov/media/138617/download) (8 nitrosamines) | Dated 06/03/2020 (W Table 5) |
| M-ARB6 | FDA, [LC-HRMS Method for the Determination of Six Nitrosamine Impurities in ARB Drugs](https://www.fda.gov/media/125478/download) | Dated 05/21/2019 (W Table 5) |
| M-MET1 | FDA, [LC-HRMS Method for the Determination of NDMA in Metformin DS and DP](https://www.fda.gov/media/134914/download) | Dated 02/04/2020 (W Table 5) |

Page numbers for G are the printed page numbers in the Rev. 2 PDF.

Some of these limits and rules change often, so the LIMS should store them as reference data with a source and an effective date, not hard-code them. The web page W had 30 revisions between Aug 2023 and Sep 2026. The less-than-lifetime (LTL) adjustment only became available on 24 Sep 2026 [W revision table; LTL].

## 1. AI limits for named nitrosamines

AI means the intake that corresponds to about one extra cancer case in 100,000 people. It assumes that dose is taken every day for 70 years [G p.12; M7]. N-nitroso compounds are in M7's "cohort of concern": for them, the generic threshold of toxicological concern (TTC) of 1.5 µg/day does not protect enough [M7 §III; G p.12].

### Small-molecule nitrosamines

| Nitrosamine | Abbrev. | FDA-recommended AI (ng/day) | Basis | Source |
|---|---|---|---|---|
| N-nitroso-dimethylamine | NDMA | **96** | Compound-specific (rat TD50 0.0959 mg/kg/day ÷ 50,000 × 50 kg) | W Table 2; G App. B |
| N-nitroso-diethylamine | NDEA | **26.5** | Compound-specific | W Table 2 |
| N-nitroso-N-methylaniline / methylphenylamine | NMPA | **100** | CPCA category 2 | W Table 1 |
| N-nitroso-ethylisopropylamine | NEIPA (NIPEA) | **400** | CPCA category 3 | W Table 1 |
| N-nitroso-N-methyl-4-aminobutyric acid | NMBA | **1500** | CPCA category 4 | W Table 1 |
| N-nitroso-diisopropylamine | NDIPA | **1500** | CPCA category 5 | W Table 1 |
| N-nitroso-di-n-butylamine | NDBA | *None published on W* | Use the 26.5 ng/day default unless the manufacturer justifies another limit [G p.13] | W (not listed); NDBA |
| N-nitroso-di-n-propylamine | NDPA | *None published on W* | Same default | W (not listed) |

The guidance names these seven small-molecule nitrosamines: NDMA, NDEA, NMPA, NDIPA, NIPEA, NDBA and NMBA [G p.5].

### NDSRIs and the CPCA

A **nitrosamine drug substance-related impurity (NDSRI)** shares structure with the API and is usually unique to that API [G landing page]. When there are no robust carcinogenicity data, FDA recommends predicting the AI with the **Carcinogenic Potency Categorization Approach (CPCA)** [G p.12; RAIL]. The CPCA score is the α-hydrogen score plus the deactivating-feature score plus the activating-feature score [RAIL App.]. The score places the NDSRI in one of five categories:

| CPCA category | Recommended AI (ng/day) | Meaning |
|---|---|---|
| 1 | 26.5 | Potency no higher than NDEA, the class-specific limit |
| 2 | 100 | No higher than NDMA (96) or NNK (100) |
| 3 | 400 | Four-fold lower potency than category 2 (a weakly deactivating feature) |
| 4 | 1500 | Activation possible but disfavoured; set at the TTC |
| 5 | 1500 | Not activated by α-hydroxylation; set at the TTC |

Source: RAIL Table 1. For US products, category 1 is 26.5 ng/day even where other regions differ.

If a nitrosamine appears in W Table 2, which uses compound-specific or read-across data, that limit overrides its CPCA limit [W]. Useful examples for demo data:

- CPCA-based (W Table 1): MNP from rifampin, 400; CPNP from rifapentine, 400; NTTP from sitagliptin, 100.
- Surrogate-based (W Table 2): N-nitroso-vonoprazan, 96 (NDMA surrogate); N-nitroso-duloxetine and N-nitroso-fluoxetine, 100 each (NNK surrogate); N-nitroso-piperazine from ciprofloxacin, 1300 (NPIP surrogate).
- **Interim limits** (W Table 3): FDA has temporarily allowed higher limits for some marketed products to prevent shortages. Examples are MNP in rifampin at 3,000 ng/day or 5 ppm, and N-nitroso-sertraline at 600 ng/day or 3 ppm, both reassessed by 8/1/2027. The LTL adjustment below does not apply to interim limits [LTL fn 8].

### Less-than-lifetime adjustment (new, 24 Sep 2026)

For products labeled for less-than-lifetime use, the lifetime AI may be multiplied by a factor that depends on treatment duration [LTL Table 1]:

| Duration of treatment | Factor |
|---|---|
| ≤ 1 month | 80× |
| > 1 to 12 months | 13.3× |
| > 1 to 10 years | 6.67× |
| > 10 years to lifetime | 1× (no adjustment) |

For example, NDEA in a product taken for under 30 days in a lifetime gets 26.5 × 80 = 2,120 ng/day [LTL fn 11]. Duration comes from the approved labeling. If the label allows both short- and long-term use, the long-term use counts [LTL §II.C]. Using an LTL-adjusted AI in a marketed product typically requires a supplement [LTL §III.B]. For a testing lab, the LTL factor is therefore an input from the Customer, not something the lab derives.

## 2. Converting an AI to a specification

**Formula:** `limit (ppm) = AI (ng/day) ÷ MDD (mg/day)` [G p.13; G App. C fn 2; W Table 3 note]

The units work out because ng/mg = 10⁻⁶, so the ratio is already ppm. It is the same as µg/g, and 1 ppm = 1000 ng/g. The MDD is "typically the MDD reflected in the drug product labeling" [G p.13].

The reverse, for reporting exposure: `exposure (ng/day) = result (ppm) × MDD (mg/day)`, and `% of AI = result (ppm) ÷ limit (ppm) × 100`.

**FDA's own example:** metformin NDMA 96 ng/day gives 0.038 ppm for immediate-release (MDD 2550 mg) and 0.048 ppm for extended-release (MDD 2000 mg) [M-MET8 p.1].

**Worked fictional example.** *Zelotrin 200 mg tablets*, labeled MDD 400 mg/day, lifetime use (no LTL factor). Batch ZLT-0007.

| Step | NDMA | NDEA |
|---|---|---|
| AI (ng/day) | 96 | 26.5 |
| Limit = AI ÷ 400 mg | **0.240 ppm** (240 ng/g) | **0.0663 ppm** (66.3 ng/g) |
| 10 % of AI (specification trigger) | 0.024 ppm | 0.00663 ppm |
| Result (fictional) | 0.0500 ppm | 0.0100 ppm |
| Exposure = result × 400 mg | 20.0 ng/day | 4.00 ng/day |
| % of own AI | 20.8 % | 15.1 % |

Both results are above 10 % of their AI and below the AI. Under G, the product therefore needs a specification but the batch passes [G pp.19, 21–22]. The table does not evaluate the multiple-nitrosamine total; section 4 does that for this batch.

**In the method, a result is computed like this** (external standard, from FDA's method) [M-RAN p.5; M-MET8 p.6]:

`ppm = (A_sample ÷ mean A_std(n=6)) × C_std (ng/mL) × V (mL) ÷ W (mg)`

Here V is the volume of diluent and W is the weight of drug substance. For drug product, divide by the target API concentration in mg/mL instead of multiplying by V ÷ W. As a check, the FDA ranitidine method uses a 1.0 ng/mL standard with 120 mg in 4.0 mL. That gives 1.0 × 4.0 ÷ 120 = 0.033 ppm at equal areas, which matches the method's stated LOQ of 0.033 ppm [M-RAN pp.1–3].

## 3. LOQ expectations

- **What the guidance requires:** it sets no numeric LOQ. "Sensitive analytical methods with appropriate limits of quantitation (LOQs) are needed". Per ICH Q2(R1), "the detection and quantitation limit should be commensurate with the level at which the impurities must be controlled", and "the LOQ should be scientifically justified" [G p.13]. The NDBA infusion-bag statement repeats this and recommends methods "capable of quantifying NDBA and other small-molecule nitrosamine impurities to the parts per billion (ppb) level" [NDBA §4].
- **Why the LOQ has to reach 10 % of the AI (inference):** each decision in G turns on whether the result is ≤ 10 % of the AI or above it [G pp.19–22]. To show a result is ≤ 10 %, the method must be able to quantify at that level. For Zelotrin NDEA, that means an LOQ of about 0.0066 ppm. **This is inferred from the decision rules; the guidance does not state it.**
- **ICH M7:** for mutagenic impurities in general, a routine test may be replaced by periodic testing when levels are below 30 % of the limit in six pilot or three production batches in a row [M7 §VIII.A, Option 1]. G's 10 % rule is the nitrosamine-specific rule to use.
- **What FDA's own methods achieved:**

| Method | Nitrosamines | LOD | LOQ | Range |
|---|---|---|---|---|
| M-RAN (LC-MS/MS QQQ) | NDMA | 0.3 ng/mL = 0.01 ppm | 1.0 ng/mL = 0.033 ppm | 0.033–3.33 ppm |
| M-MET1 (LC-HRMS) | NDMA | 1.0 ng/mL = 0.01 ppm | 3.0 ng/mL = 0.03 ppm | 0.03–0.1 ppm |
| M-MET8 (LC-ESI-HRMS) | NDMA / NDEA, NEIPA, NDIPA / NDPA, NMPA, NDBA, NMBA | 0.001–0.005 ppm | 0.01 / 0.02 / 0.005 ppm | up to 0.1 ppm |
| M-ARB6 (LC-HRMS) | NDMA, NDEA, NEIPA, NDIPA, NDBA, NMBA | 0.003–0.016 ppm | 0.05 ppm each | 0.05–5.0 ppm (NMBA 10.0) |

FDA's metformin NDMA LOQ of 0.03 ppm sits close to the metformin limit of 0.038 ppm [M-MET1; M-MET8]. So a method that is good enough to screen against the limit may still not be able to show a result is ≤ 10 % of the AI. The LIMS should record LOQ as % of limit for each analyte and product, and flag it when it is above 10 %.
- **Validation:** the user must validate FDA's methods before the data support a quality decision or a submission [W §Recommended Analytical Testing Methods]. A method validated for one product has to be shown suitable before it is used on another [G p.14].

## 4. Rules for multiple nitrosamines

1. **Default rule.** An AI applies to one nitrosamine on its own. When more than one is identified, the **total should not exceed the AI of the most potent one** [G p.13].
2. **Flexible alternative** [G p.13; App. C]. Use it when the AIs differ a lot, for example a small-molecule nitrosamine alongside an NDSRI. Express each nitrosamine as a percent of its own ppm limit; the sum must be ≤ 100 %, which corresponds to a 1:100,000 risk:
   `Σ (Xᵢ ÷ AIᵢ) × 100 % ≤ 100 %`, with Xᵢ and AIᵢ both in ppm and **n ≤ 3**.
   For more than three nitrosamines, or a different approach, contact FDA [G p.41]. The overall risk estimate covers every source, including leachables from the container closure [G App. C fn].
3. **FDA's App. C example** (Drug A, MDD 80 mg). The limits are 26.5, 37 and 1,500 ng/day, which give NMT 0.33, 0.46 and 18.75 ppm. At 0 months the sum is 46.50 % (pass). At 3 months it is 104.93 % (**fail**), even though every individual nitrosamine is within its own limit [G p.40].
4. **Zelotrin batch ZLT-0007 (fictional):**
   - Flexible approach: 20.8 % + 15.1 % = **35.9 % ≤ 100 % (pass)**.
   - Default rule: 20.0 + 4.0 = 24.0 ng/day, which is ≤ the most potent AI (NDEA, 26.5 ng/day), so it also passes.
   - Were NDMA at 0.080 ppm (32 ng/day), the default rule would fail (36 > 26.5). The flexible sum would still pass at 33.3 % + 15.1 % = 48.4 %. So which rule a product uses changes the verdict, and the product's specification has to name it.
5. **With LTL-adjusted limits**, the applicant proposes a control strategy for total exposure that stays within 1:100,000 [LTL §II.C].

## 5. What a result or report must state

FDA prescribes no laboratory report format. ISO/IEC 17025 §7.8 will set that, and it is still open on the map. The FDA sources do show what the data need to carry:

- **Identity:** each nitrosamine by name and abbreviation, and the product, strength and batch. Confirmatory testing covers **at least three representative batches**. These should span the labeled expiry, including end of expiry, include all API sources, and use the strength at greatest risk [G p.21 & fn 64].
- **Value:** the result in **ppm**. Report three significant figures when the value is ≥ LOD, and "not detected" when it is below the LOD or no peak is seen [M-RAN p.5; M-MET8 p.7]. FDA's NDSRI progress update asks for results "in ng/day or ppm" [W Table 4 note].
- **Limit context:** the AI (ng/day) and where it comes from (W table, CPCA category, interim, or LTL-adjusted), the MDD used, the ppm limit, and the % of AI. For more than one nitrosamine, also the total, stating which rule was used.
- **Where the result falls:** ≤ 10 % of the AI (no specification needed if the root cause is understood and controlled), between 10 % and 100 % (release and stability specification needed), or above the AI (do not release) [G pp.19–22].
- **Method:** the method with its validation, and its LOD and LOQ. The NDSRI progress update asks for "nitrosamine test method with validation" [W Table 4 note].
- **Dates:** "date analyzed relative to date of manufacture" [W Table 4 note]. This matters because nitrosamines can grow on stability, as in FDA's App. C example [G p.40].
- **Escalation:** batches above the AI that are already distributed trigger a Field Alert Report by the NDA/ANDA holder [G p.19]. In the LIMS this is a Customer notification and a **Deviation**, not a lab filing.

## 6. FDA method parameters a demo method record could mimic

The lab is LC-MS/MS first, so the best template is **M-RAN**: FDA's triple-quadrupole MRM method for NDMA [M-RAN pp.2–5].

| Field | Value (M-RAN) |
|---|---|
| Technique / platform | LC-MS/MS, triple quad (Agilent 6420 or equivalent), **APCI**, positive mode, MRM |
| Column | ACE Excel C18-AR, 3 µm, 50 × 4.6 mm |
| Column temperature / flow | 30 °C / 0.6 mL/min |
| Mobile phases | A: 0.1 % formic acid in water; B: 0.1 % formic acid in methanol |
| Gradient (min : %B) | 0:5, 1.0:5, 3.0:20, 7.0:100, 9.0:100, 9.1:5, 14.0:5 |
| Injection / autosampler | 10 µL / 4–8 °C |
| Source | Gas 325 °C, vaporizer 350 °C, gas flow 5 L/min, nebulizer 40 psi, capillary 4000 V, corona 5 µA |
| MRM, quantifier | 75.1 → 43.1, dwell 200 ms, fragmentor 90, CE 15, CAV 5 |
| MRM, qualifier | 75.1 → 58.1, dwell 200 ms, fragmentor 90, CE 10, CAV 5 |
| Diluent / blank | Water |
| Standards | 100 ng/mL intermediate stock; 1.0 ng/mL working standard, prepared fresh daily |
| Sample prep, drug substance | 120 mg in 4.0 mL water, vortex |
| Sample prep, drug product | 30 mg API/mL in water; shake 40 min, centrifuge 15 min at 4500 rpm, 0.22 µm PVDF filter, discard first 1 mL |
| Sequence | Blank ×2, standard ×6, blank, then 6 samples between bracketing standards, and a standard at the end |
| System suitability | %RSD of quantifier area ≤ 10 % over the first 6 standards; cumulative %RSD including bracketing standards ≤ 10 % |
| Identification | Sample RT within ±2 % of the standard RT |
| LOD / LOQ / range | 0.3 / 1.0 / 1.0–100 ng/mL (0.01 / 0.033 / 0.033–3.33 ppm) |
| Reporting | ppm to 3 significant figures if ≥ LOD, otherwise "not detected" |
| Validation basis | ICH Q2(R1) |

**For a multi-analyte demo panel**, use **M-MET8** (LC-ESI-HRMS, Q Exactive) [M-MET8 pp.2–6]:

- Column: Phenomenex Kinetex Biphenyl 2.6 µm, 150 × 3.0 mm, 40 °C, 0.4 mL/min.
- Mobile phases and injection: the same formic acid/methanol phases as M-RAN; 3 µL injection; methanol diluent.
- Standard: 3.0 ng/mL mixed standard.
- System suitability: %RSD ≤ 10 % (n = 6) and cumulative %RSD ≤ 15 %.
- Quantitation: extracted-ion chromatograms at a 15 ppm m/z tolerance.

Its extracted m/z values and retention times are:

| Analyte | m/z | RT (min) |
|---|---|---|
| NDMA | 75.0553 | 4.34 |
| NMBA | 145.0619 | 8.01 |
| NDEA | 103.0866 | 8.79 |
| NEIPA | 75.0553 | 9.46 |
| NDIPA | 131.1179 | 10.39 |
| NDPA | 131.1179 | 10.82 |
| NMPA | 137.0709 | 11.39 |
| NDBA | 57.0704 / 103.0872 / 159.1492 | 14.17 |

These are HRMS values, not QQQ MRM transitions. Among the sources fetched, FDA publishes triple-quad MRM transitions only for NDMA (M-RAN). A demo QQQ panel should either use NDMA alone or label any other transitions as fictional placeholders.

Other methods on W Table 5 that are not needed for an LC-MS/MS-first build:

- GC-MS headspace and direct-injection methods for ARBs.
- A RapidFire-MS/MS method, which FDA says not to use for NDMA or NDEA.
- LC-ESI-HRMS methods for MNP/CPNP in rifampin and rifapentine, and for N-nitroso-varenicline, -bumetanide and -propranolol [W Table 5].

## Open questions for the owner

1. **Values between LOD and LOQ.** FDA's methods report a number when the value is ≥ LOD [M-RAN; M-MET8]. Many QC labs report "< LOQ" instead. Which convention does the demo LIMS use on results and on the Certificate of Analysis?
2. **Where the MDD and treatment duration come from.** They are product labeling facts [G p.13; LTL §II.C], so presumably the Customer states them on the submission. Should the LIMS support LTL-adjusted limits at all, or only lifetime AIs?
3. **Multiple-nitrosamine rule.** Should each product specification choose between the default most-potent rule and the App. C percent-sum rule, or does the demo implement only one? Section 4 shows the two can give different verdicts.
4. **Maintaining the AI reference table.** Who keeps the AI and CPCA table current against the FDA page, which has had 30 revisions? Is it seeded from the page with an effective date and source per row?
