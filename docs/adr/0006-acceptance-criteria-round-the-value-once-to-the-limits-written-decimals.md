# Acceptance Criteria round the value once to the limit's written decimals; readings, gates and times compare exactly

Every Acceptance Criterion is judged the same way. The value is kept at full precision, rounded once, half away from zero, to the decimals the limit is written with, and compared, with the limit including its own value. Acceptance Criteria are the limits a Check Plan, Method or Method Protocol sets. USP General Notices 7.20 requires this rule for `<41>` and `<621>`, and the company SOP adopts it for the lab's own limits, so one rule covers every criterion and the written decimals are the only lever on strictness (0.05 % passes 0.0549 %; 0.050 % doesn't).

These are compared exactly instead:
- readings, and plausibility ranges;
- gates on whether a measurement counts at all, such as a net weight against the smallest net weight;
- gates between two stored values;
- times and counts;
- proficiency-test scores, against the Lab's PT-plan criteria.

A value an instrument's software has already rounded is never rounded again: it is compared as exported against a criterion written to the same decimals. Specification Lines follow their Jurisdiction Rule Set (ADR 0003). The rule is written in one company SOP and implemented by one QA-approved Calculation Version that every verdict records, and a later version never changes a recorded verdict in place. Source: [Decide how Check and Run Check results are compared with their limits](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/37).

## Considered options

- **Full precision everywhere.** Rejected: it is stricter than USP.
  - It fails a balance USP passes. BAL-05 reads +0.10495 % against 0.10 %, which opens a Major Equipment Deviation and Holds that no regulation requires.
  - It makes printed acceptance ranges narrower than the regulation.
- **7.20 for USP-cited limits, full precision for the lab's own.** Rejected. The same error would pass on one balance and fail on another, depending on a source field nobody sees at the bench, and many criteria mix sources.
- **A rounding setting per criterion or per Lab.** Rejected: it adds something to misconfigure, and more Critical Data, with no need yet. A Lab that must follow GB/T 8170 for its own checks can add a Lab setting then.
- **Rounding readings too.** Rejected: USP doesn't settle it, and a fridge written as 2–8 °C would accept 8.4 °C without an Excursion.
- **Rounding an exported value again to a coarser limit.** Rejected: a second rounding flips verdicts. 79.46 exports as 79.5, which would round to 80 and pass NLT 80.

## Consequences

- **A limit's decimals are part of its value.** "0.10" and "0.1" differ in storage, hashing and approval diffs, and QA's approval screen shows what each limit accepts.
- **Arithmetic is exact decimal in a pinned context.** Binary floating point, `Math.round` and `toFixed` get the ties wrong: an exact +0.105 % computes as 0.10499… and passes.
- **Compendial criteria keep their printed decimals.** The instrument's export is set to match them. Only the lab's own criteria, a Method's or a Check Plan's, may be written to the export's or display's decimals, and they then cite the Method or the SOP, not the compendial text.
- **Don't "simplify" the comparison.** Comparing floats, or rounding a reading, a gate or an exported value, silently changes verdicts.
