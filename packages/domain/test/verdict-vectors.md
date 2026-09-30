# Verdict golden vectors

Every row is run by `verdict-vectors.test.ts` against `judgeCriterion` (Kind `full precision` or `as exported`) or `judgeTest` (Kind `… Section`). Validation evidence for Calculation Version `calc-2026.1`.

How to read the columns:

- **Value(s)**: the full-precision value, the value as the instrument exported it, or a Test's Preparation results in ppm separated by `;`. `a/b` is the exact quotient, as a Preparation's C × V / W is, so a result that never terminates in decimal can be written down.
- **Limit**: as written. A range is `low–high`, each bound inclusive. Section limits are NMT, in ppm.
- **Rounding**: an Acceptance Criterion always rounds half away from zero (ADR 0006), and an exported value is never rounded (`none`). A Section rounds by its Jurisdiction Rule Set, except that a USP claim always rounds half away from zero (GN 7.20).
- **Compared**: what was compared with the limit. A range shows the low-bound rounding, then the high-bound rounding, because each bound rounds to its own decimals. A Section shows each Preparation's rounding, then the Reportable Result's (the mean of the Preparations, rounded once), or `—` when the Reportable Result is not judged.
- **Verdict**: a Section's verdict is its Reportable Result's (`not judged` when the variability between Preparations failed or could not be computed), followed by every Preparation that fails on its own (decision 29: a failing Preparation opens OOS even when the mean passes).
- **% of limit**: the full-precision Reportable Result as a share of the limit, printed to one decimal. Display only.
- **Variability limit** and **Variability**: the Method's Acceptance Criterion between Preparations (decision 29, #37 §3). `RD` is the relative difference of a pair, `|a − b| / mean × 100 %`, computed from the unrounded Preparation results and rounded once, half away from zero, to the limit's decimals; every pair is shown. `none` means the Method sets no variability limit.
- **Above 30 %**: whether the share of the limit exceeds a 30 % band. Bands compare the exact ratio, never the printed figure.

| # | Checks | Kind | Value(s) | Limit | Rounding | Compared | Verdict | % of limit | Variability limit | Variability | Above 30 % | Source |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Written decimals are the lever: 0.05 accepts 0.0549 | full precision | 0.0549 | NMT 0.05 | half away | 0.05 | conforms | — | — | — | — | ADR 0006; GN 7.20 |
| 2 | 0.050 does not accept 0.0549 | full precision | 0.0549 | NMT 0.050 | half away | 0.055 | does not conform | — | — | — | — | ADR 0006 |
| 3 | An exact tie rounds away from zero (binary floats make it 0.10499… and pass) | full precision | 0.105 | NMT 0.10 | half away | 0.11 | does not conform | — | — | — | — | ADR 0006 |
| 4 | Just below the tie passes (BAL-05, +0.10495 %) | full precision | 0.10495 | NMT 0.10 | half away | 0.10 | conforms | — | — | — | — | ADR 0006 |
| 5 | A negative tie rounds away from zero too | full precision | -0.105 | NLT -0.10 | half away | -0.11 | does not conform | — | — | — | — | GN 7.20; #37 §1 |
| 6 | An exported value is compared as exported, never rounded to 80 | as exported | 79.5 | NLT 80.0 | none | 79.5 | does not conform | — | — | — | — | ADR 0006 (79.46 exports as 79.5) |
| 7 | A criterion coarser than the export is refused, not judged | as exported | 79.5 | NLT 80 | none | — | criterion coarser than export | — | — | — | — | ADR 0006 |
| 8 | The full-precision value behind that export rounds once, to 79 | full precision | 79.46 | NLT 80 | half away | 79 | does not conform | — | — | — | — | ADR 0006 |
| 9 | An export coarser than the criterion is refused too | as exported | 80 | NLT 80.0 | none | — | export coarser than criterion | — | — | — | — | ADR 0006 ("written to the same decimals") |
| 10 | Recovery just inside the low bound | full precision | 79.96 | 80.0–120.0 | half away | 80.0 / 80.0 | conforms | — | — | — | — | ADR 0006 |
| 11 | Recovery at the tie below the low bound rounds up to it | full precision | 79.95 | 80.0–120.0 | half away | 80.0 / 80.0 | conforms | — | — | — | — | ADR 0006 |
| 12 | Recovery just below the tie fails | full precision | 79.94 | 80.0–120.0 | half away | 79.9 / 79.9 | does not conform | — | — | — | — | ADR 0006 |
| 13 | Recovery just above the high bound rounds down to it | full precision | 120.04 | 80.0–120.0 | half away | 120.0 / 120.0 | conforms | — | — | — | — | ADR 0006 |
| 14 | Recovery at the tie above the high bound fails | full precision | 120.05 | 80.0–120.0 | half away | 120.1 / 120.1 | does not conform | — | — | — | — | ADR 0006 |
| 15 | An exported recovery with more decimals than the range is refused | as exported | 79.96 | 80.0–120.0 | none | — | criterion coarser than export | — | — | — | — | ADR 0006 |
| 16 | Each bound rounds to its own decimals | full precision | 79.6 | 80–120.0 | half away | 80 / 79.6 | conforms | — | — | — | — | ADR 0006 (per bound) |
| 17 | Each bound rounds to its own decimals, failing low | full precision | 79.4 | 80–120.0 | half away | 79 / 79.4 | does not conform | — | — | — | — | ADR 0006 (per bound) |
| 18 | A trailing-zero limit is stricter | full precision | 1.505 | NMT 1.50 | half away | 1.51 | does not conform | — | — | — | — | ADR 0006; decision 29 |
| 19 | The same value against the limit without the trailing zero | full precision | 1.505 | NMT 1.5 | half away | 1.5 | conforms | — | — | — | — | ADR 0006; decision 29 |
| 20 | GN 7.20 illustration: assay NLT 98.0 %, 97.96 % | full precision | 97.96 | NLT 98.0 | half away | 98.0 | conforms | — | — | — | — | USP GN 7.20 |
| 21 | GN 7.20 illustration: assay NLT 98.0 %, 97.92 % | full precision | 97.92 | NLT 98.0 | half away | 97.9 | does not conform | — | — | — | — | USP GN 7.20 |
| 22 | GN 7.20 illustration: assay NLT 98.0 %, 97.95 % | full precision | 97.95 | NLT 98.0 | half away | 98.0 | conforms | — | — | — | — | USP GN 7.20 |
| 23 | GN 7.20 illustration: assay NMT 101.5 %, 101.55 % | full precision | 101.55 | NMT 101.5 | half away | 101.6 | does not conform | — | — | — | — | USP GN 7.20 |
| 24 | GN 7.20 illustration: assay NMT 101.5 %, 101.46 % | full precision | 101.46 | NMT 101.5 | half away | 101.5 | conforms | — | — | — | — | USP GN 7.20 |
| 25 | GN 7.20 illustration: assay NMT 101.5 %, 101.45 % | full precision | 101.45 | NMT 101.5 | half away | 101.5 | conforms | — | — | — | — | USP GN 7.20 |
| 26 | GN 7.20 illustration: limit test NMT 0.02 %, 0.025 % | full precision | 0.025 | NMT 0.02 | half away | 0.03 | does not conform | — | — | — | — | USP GN 7.20 |
| 27 | GN 7.20 illustration: limit test NMT 0.02 %, 0.015 % | full precision | 0.015 | NMT 0.02 | half away | 0.02 | conforms | — | — | — | — | USP GN 7.20 |
| 28 | GN 7.20 illustration: limit test NMT 0.02 %, 0.027 % | full precision | 0.027 | NMT 0.02 | half away | 0.03 | does not conform | — | — | — | — | USP GN 7.20 |
| 29 | GN 7.20 illustration: limit test NMT 3 ppm, 0.00035 % (3.5 ppm) | full precision | 3.5 | NMT 3 | half away | 4 | does not conform | — | — | — | — | USP GN 7.20 |
| 30 | GN 7.20 illustration: limit test NMT 3 ppm, 0.00025 % (2.5 ppm) | full precision | 2.5 | NMT 3 | half away | 3 | conforms | — | — | — | — | USP GN 7.20 |
| 31 | GN 7.20 illustration: limit test NMT 3 ppm, 0.00028 % (2.8 ppm) | full precision | 2.8 | NMT 3 | half away | 3 | conforms | — | — | — | — | USP GN 7.20 |
| 32 | A negative value rounds on its magnitude: −9.5 is −10 | full precision | -9.5 | NLT -9 | half away | -10 | does not conform | — | — | — | — | USP GN 7.20; #37 §1 |
| 33 | A mean of three that doesn't terminate is rounded once (3 dp first would give 0.035, then 0.04, and fail) | FDA Section | 0.0344; 0.0348; 0.0348 | NMT 0.03 | half away | 0.03; 0.03; 0.03 → 0.03 | conforms | 115.6 | RD NMT 20.0 | 1.2; 1.2; 0.0 conforms | yes | decision 29 |
| 34 | A failing Preparation is reported even when the mean passes | FDA Section | 0.030; 0.036 | NMT 0.03 | half away | 0.03; 0.04 → 0.03 | conforms; preparation 2 does not conform | 110.0 | RD NMT 20.0 | 18.2 conforms | yes | decision 29 |
| 35 | Every Preparation and the mean fail | FDA Section | 0.045; 0.047 | NMT 0.03 | half away | 0.05; 0.05 → 0.05 | does not conform; preparation 1 does not conform; preparation 2 does not conform | 153.3 | RD NMT 20.0 | 4.3 conforms | yes | decision 29 |
| 36 | A trailing-zero limit in a Section | FDA Section | 0.0305 | NMT 0.030 | half away | 0.031 → 0.031 | does not conform; preparation 1 does not conform | 101.7 | none | — | yes | decision 29 |
| 37 | GB/T 8170 half-even: a tie rounds to the even neighbour, down | NMPA Section | 0.105 | NMT 0.10 | half even | 0.10 → 0.10 | conforms | 105.0 | none | — | yes | decision 29; GB/T 8170 |
| 38 | GB/T 8170 half-even: a tie rounds to the even neighbour, up | NMPA Section | 0.115 | NMT 0.11 | half even | 0.12 → 0.12 | does not conform; preparation 1 does not conform | 104.5 | none | — | yes | decision 29; GB/T 8170 |
| 39 | GB/T 8170 half-even: above the tie rounds up | NMPA Section | 0.1051 | NMT 0.10 | half even | 0.11 → 0.11 | does not conform; preparation 1 does not conform | 105.1 | none | — | yes | decision 29; GB/T 8170 |
| 40 | A USP claim uses GN 7.20 whatever the Rule Set says | NMPA Section, USP claim | 0.105 | NMT 0.10 | half away | 0.11 → 0.11 | does not conform; preparation 1 does not conform | 105.0 | none | — | yes | decision 29 |
| 41 | Variability over its limit leaves the Reportable Result unjudged | FDA Section | 0.024; 0.030 | NMT 0.03 | half away | 0.02; 0.03 → — | not judged | — | RD NMT 20.0 | 22.2 does not conform | — | decision 29; #37 §3 |
| 42 | Variability rounds once, and a tie rounds away from zero (20.05 → 20.1) | FDA Section | 0.03599; 0.04401 | NMT 0.05 | half away | 0.04; 0.04 → — | not judged | — | RD NMT 20.0 | 20.1 does not conform | — | #37 §1, §3; GN 7.20 |
| 43 | Variability exactly at its limit conforms | FDA Section | 0.0288; 0.0352 | NMT 0.05 | half away | 0.03; 0.04 → 0.03 | conforms | 64.0 | RD NMT 20.0 | 20.0 conforms | yes | #37 §1, §3 |
| 44 | A variability statistic the skeleton does not compute leaves the Reportable Result unjudged | FDA Section | 0.030; 0.031 | NMT 0.03 | half away | 0.03; 0.03 → — | not judged | — | RSD NMT 5.0 | not built | — | decision 29 |
| 45 | One Preparation gives no pair, so the variability is missing | FDA Section | 0.020 | NMT 0.03 | half away | 0.02 → — | not judged | — | RD NMT 20.0 | missing | — | decision 29 |
| 46 | A non-terminating mean just below the tie (0.0349996…) rounds down | FDA Section | 1.04999/30; 1.04999/30 | NMT 0.03 | half away | 0.03; 0.03 → 0.03 | conforms | 116.7 | RD NMT 20.0 | 0.0 conforms | yes | GN 7.20; #37 §9 |
| 47 | Prints 30.0 % of the limit, but the exact share (29.99…) is below a 30 % band | FDA Section | 0.008999 | NMT 0.03 | half away | 0.01 → 0.01 | conforms | 30.0 | none | — | no | decision 29 |
| 48 | Variability just over its limit rounds once, down to it (20.04 → 20.0), and conforms | FDA Section | 0.035992; 0.044008 | NMT 0.05 | half away | 0.04; 0.04 → 0.04 | conforms | 80.0 | RD NMT 20.0 | 20.0 conforms | yes | #37 §1, §3 |
