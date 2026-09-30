# Verdict golden vectors

Every row is run by `verdict-vectors.test.ts` against `judgeCriterion` (Kind `full precision` or `as exported`) or `judgeSpecification` (Kind `… Section`). Validation evidence for Calculation Version `calc-2026.1`.

How to read the columns:

- **Value(s)**: the full-precision value, the value as the instrument exported it, or a Section's Preparation results in ppm separated by `;`.
- **Limit**: as written. A range is `low–high`, each bound inclusive. Section limits are NMT, in ppm.
- **Rounding**: an Acceptance Criterion always rounds half away from zero (ADR 0006), and an exported value is never rounded (`none`). A Section rounds by its Jurisdiction Rule Set, except that a USP claim always rounds half away from zero (GN 7.20).
- **Compared**: what was compared with the limit. A range shows the low-bound rounding, then the high-bound rounding, because each bound rounds to its own decimals. A Section shows each Preparation's rounding, then the Reportable Result's (the mean of the Preparations, rounded once).
- **Verdict**: a Section's verdict is its Reportable Result's, followed by every Preparation that fails on its own (decision 29: a failing Preparation opens OOS even when the mean passes).
- **% of limit**: the full-precision Reportable Result as a share of the limit, to one decimal.

| # | Checks | Kind | Value(s) | Limit | Rounding | Compared | Verdict | % of limit | Source |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Written decimals are the lever: 0.05 accepts 0.0549 | full precision | 0.0549 | NMT 0.05 | half away | 0.05 | conforms | — | ADR 0006; GN 7.20 |
| 2 | 0.050 does not accept 0.0549 | full precision | 0.0549 | NMT 0.050 | half away | 0.055 | does not conform | — | ADR 0006 |
| 3 | An exact tie rounds away from zero (binary floats make it 0.10499… and pass) | full precision | 0.105 | NMT 0.10 | half away | 0.11 | does not conform | — | ADR 0006 |
| 4 | Just below the tie passes (BAL-05, +0.10495 %) | full precision | 0.10495 | NMT 0.10 | half away | 0.10 | conforms | — | ADR 0006 |
| 5 | A negative tie rounds away from zero too | full precision | -0.105 | NLT -0.10 | half away | -0.11 | does not conform | — | GN 7.20 |
| 6 | An exported value is compared as exported, never rounded to 80 | as exported | 79.5 | NLT 80.0 | none | 79.5 | does not conform | — | ADR 0006 (79.46 exports as 79.5) |
| 7 | A criterion coarser than the export is refused, not judged | as exported | 79.5 | NLT 80 | none | — | criterion coarser than export | — | ADR 0006 |
| 8 | The full-precision value behind that export rounds once, to 79 | full precision | 79.46 | NLT 80 | half away | 79 | does not conform | — | ADR 0006 |
| 9 | An export coarser than the criterion is refused too | as exported | 80 | NLT 80.0 | none | — | export coarser than criterion | — | ADR 0006 ("written to the same decimals") |
| 10 | Recovery just inside the low bound | full precision | 79.96 | 80.0–120.0 | half away | 80.0 / 80.0 | conforms | — | ADR 0006 |
| 11 | Recovery at the tie below the low bound rounds up to it | full precision | 79.95 | 80.0–120.0 | half away | 80.0 / 80.0 | conforms | — | ADR 0006 |
| 12 | Recovery just below the tie fails | full precision | 79.94 | 80.0–120.0 | half away | 79.9 / 79.9 | does not conform | — | ADR 0006 |
| 13 | Recovery just above the high bound rounds down to it | full precision | 120.04 | 80.0–120.0 | half away | 120.0 / 120.0 | conforms | — | ADR 0006 |
| 14 | Recovery at the tie above the high bound fails | full precision | 120.05 | 80.0–120.0 | half away | 120.1 / 120.1 | does not conform | — | ADR 0006 |
| 15 | An exported recovery with more decimals than the range is refused | as exported | 79.96 | 80.0–120.0 | none | — | criterion coarser than export | — | ADR 0006 |
| 16 | Each bound rounds to its own decimals | full precision | 79.6 | 80–120.0 | half away | 80 / 79.6 | conforms | — | ADR 0006 (per bound) |
| 17 | Each bound rounds to its own decimals, failing low | full precision | 79.4 | 80–120.0 | half away | 79 / 79.4 | does not conform | — | ADR 0006 (per bound) |
| 18 | A trailing-zero limit is stricter | full precision | 1.505 | NMT 1.50 | half away | 1.51 | does not conform | — | ADR 0006; decision 29 |
| 19 | The same value against the limit without the trailing zero | full precision | 1.505 | NMT 1.5 | half away | 1.5 | conforms | — | ADR 0006; decision 29 |
| 20 | A mean of three that doesn't terminate is rounded once (3 dp first would give 0.035, then 0.04, and fail) | FDA Section | 0.0344; 0.0348; 0.0348 | NMT 0.03 | half away | 0.03; 0.03; 0.03 → 0.03 | conforms | 115.6 | decision 29 |
| 21 | A failing Preparation is reported even when the mean passes | FDA Section | 0.030; 0.036 | NMT 0.03 | half away | 0.03; 0.04 → 0.03 | conforms; preparation 2 does not conform | 110.0 | decision 29 |
| 22 | Every Preparation and the mean fail | FDA Section | 0.045; 0.047 | NMT 0.03 | half away | 0.05; 0.05 → 0.05 | does not conform; preparation 1 does not conform; preparation 2 does not conform | 153.3 | decision 29 |
| 23 | A trailing-zero limit in a Section | FDA Section | 0.0305 | NMT 0.030 | half away | 0.031 → 0.031 | does not conform; preparation 1 does not conform | 101.7 | decision 29 |
| 24 | GB/T 8170 half-even: a tie rounds to the even neighbour, down | NMPA Section | 0.105 | NMT 0.10 | half even | 0.10 → 0.10 | conforms | 105.0 | decision 29; GB/T 8170 |
| 25 | GB/T 8170 half-even: a tie rounds to the even neighbour, up | NMPA Section | 0.115 | NMT 0.11 | half even | 0.12 → 0.12 | does not conform; preparation 1 does not conform | 104.5 | decision 29; GB/T 8170 |
| 26 | GB/T 8170 half-even: above the tie rounds up | NMPA Section | 0.1051 | NMT 0.10 | half even | 0.11 → 0.11 | does not conform; preparation 1 does not conform | 105.1 | decision 29; GB/T 8170 |
| 27 | A USP claim uses GN 7.20 whatever the Rule Set says | NMPA Section, USP claim | 0.105 | NMT 0.10 | half away | 0.11 → 0.11 | does not conform; preparation 1 does not conform | 105.0 | decision 29 |
