# Specifications judge each Jurisdiction separately, from pinned reference data

A Specification has one Specification Section per Jurisdiction (FDA, EMA, NMPA, MHLW). Each Section has its own lines, maximum daily dose, rule for multiple nitrosamines and verdict. A Test conforms only if every Section passes, and the report prints every Section's verdict. The limits and rules come from company reference data, not from the Specification author:

- **Acceptable Intake Tables**: one per Jurisdiction, with insert-only rows. A second QA person, never the row's author, signs each row Verified. The tables sit on the company audit chain, and the Admin has no write path. Each row cites its source, revision and effective date.
- **Jurisdiction Rule Sets**: insert-only versions on the company audit chain, each signed Verified by a second QA person, with no Admin write path, covering rounding, how an AI-based limit is derived and in which unit, share-of-limit triggers, the allowed multiple-nitrosamine rules, how values below the LOQ enter a sum, CPCA values and less-than-lifetime factors.

A Specification **copies** each Acceptable Intake it uses, with the row-version ID. It also **pins** the Rule Set version in force when QA approves it. It never reads either live. The server derives each AI-based limit and stores it as written.

An AI-based limit is the Acceptable Intake ÷ the maximum daily dose, rounded half up to two significant figures (metformin IR: 96 ÷ 2550 = 0.0376…, stated 0.038). [Decide the spec gaps the walking skeleton found](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/45) replaced the earlier "rounded down to its stated digits" with this rule, on the owner's ruling, and set its edges:

- **A Rule Set parameter.** The derivation is a parameter of each Jurisdiction Rule Set, set to half up, two significant figures, in all four.
- **Unit.** The Rule Set fixes the unit the derivation is done in, and a line's unit is Critical Data: a result of 322 ppb passes a limit of 0.32 ppm and fails one of 320 ppb.
- **A printed limit wins.** An authority's own printed limit is stored exactly as printed, with its decimals, never re-rounded, and wins over the computed one (USP General Notices 7.10).
- **Factors first.** A less-than-lifetime or interim factor is applied to the Acceptable Intake. The quotient is rounded once, at the end.
- **A tighter limit.** An AI-derived line stays server-computed and is never typed. A tighter limit is a fixed-concentration line the Customer sets, no higher than the derived value and written to at least its decimals. Against 0.038: 0.030, 0.035 and 0.0380 are accepted; 0.04 is refused as higher; 0.03 is refused for having fewer decimals. Against a derived 0.31, the line 0.3 is refused because it would pass 0.34.
- **"% of limit".** The 10 % trigger and every band divide the full-precision result by the limit as written, never the rounded result and never the exact quotient.
- **Flag.** A result whose full-precision value passes the written limit but exceeds the exact (Acceptable Intake × factor) ÷ maximum daily dose, compared exactly, is flagged to the Reviewer and QA. The verdict does not change, and the flag never excludes, replaces or invalidates a value.

We chose this because the regulators disagree sharply and change often. NDIPA is 1500 ng/day at FDA and EMA but 26.5 at MHLW and NMPA. CPCA category 1 is 26.5 at FDA and 18 at EMA and MHLW. FDA's limits page went through 30 revisions in three years. A Customer selling in two markets needs to see "passes FDA, fails MHLW". A result judged last year must still show the same verdict when the tables change. Source: [Decide the specification and limits model](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/29), reviewed by the Part 11, ISO/IEC 17025 and USP expert agents.

## Considered options

- **One Jurisdiction per Specification**, with a Test judged against several Specifications. Rejected: the Customer would approve several documents, and their verdicts could drift apart.
- **One Specification judged only against the strictest limit.** Rejected: it hides which market fails, and the multiple-nitrosamine rules and rounding differ by Jurisdiction, so "strictest" isn't one number.
- **Specifications read the tables and rules live.** Rejected: an edit to reference data would silently change the verdicts of Specifications the Customer has already accepted.
- **AI-based limits rounded down to their stated digits.** The first rule, replaced by the owner's ruling. Under it a passing metformin IR result tops out at 99.6 % of the Acceptable Intake, but it states 0.037 where FDA prints 0.038.
- **Half up for FDA only.** Not adopted: the derivation is set to half up in all four Rule Sets. Only FDA has a source that rounds up; the research found none for EMA, NMPA or MHLW.

## Consequences

- A superseded Acceptable Intake row, a new Rule Set version, an ended interim limit or a new official version of a cited pharmacopoeial text **never changes a pinned Specification**. Each one blocks new Acceptance against that Specification until a new version is Authored, Approved by QA and accepted again by the Customer. Tests already accepted stay on their pinned version, unless the cited official text changes before the first Preparation or the Customer adopts the new version; either sends the Test to request re-review.
- **A USP conformance claim is judged by USP General Notices 7.20**: round half up to the limit's decimal places, with simple acceptance, whatever rounding the Section's Rule Set uses. So an NMPA Section rounds half to even except on a line carrying a USP claim. A claim to another pharmacopoeia follows that pharmacopoeia's own general notices.
- **A passing result can exceed the Acceptable Intake.** Half up can state a limit up to about 5 % above the exact quotient. Metformin IR passes at up to 102.3 % of the Acceptable Intake (99.6 % under round-down). The worst case in the current reference data is 26.5 ÷ 2520 = 0.0105…, stated 0.011, which passes results up to 109.4 %. The owner accepted this on 2026-10-01; the flag above shows each such result to the Reviewer and QA.
- Each Section rounds the full-precision result on its own. One Section's rounded value never feeds another's.
- Seeded Acceptable Intakes are the real published values with their sources, entered through the audited path. In the demo, fictional QA users sign them Verified through the normal signing endpoint, re-authenticated and hash-bound. A production deployment loads them unverified, for its own QA to verify. NMPA rows stay unverified until they have been checked by hand against CDE's site. A Specification may copy only a Verified row, and QA approval is blocked while it cites any other.
