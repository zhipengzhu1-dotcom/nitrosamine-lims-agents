# Specifications judge each Jurisdiction separately, from pinned reference data

A Specification has one Specification Section per Jurisdiction (FDA, EMA, NMPA, MHLW). Each Section has its own lines, maximum daily dose, rule for multiple nitrosamines and verdict. A Test conforms only if every Section passes, and the report prints every Section's verdict. The limits and rules come from company reference data, not from the Specification author:

- **Acceptable Intake Tables**: one per Jurisdiction, with insert-only rows. A second QA person, never the row's author, signs each row Verified. The tables sit on the company audit chain, and the Admin has no write path. Each row cites its source, revision and effective date.
- **Jurisdiction Rule Sets**: insert-only versions on the company audit chain, each signed Verified by a second QA person, with no Admin write path, covering rounding, share-of-limit triggers, the allowed multiple-nitrosamine rules, how values below the LOQ enter a sum, CPCA values and less-than-lifetime factors.

A Specification **copies** each Acceptable Intake it uses, with the row-version ID. It also **pins** the Rule Set version in force when QA approves it. It never reads either live. The server derives each AI-based limit and stores it as written, rounded down to its stated digits.

We chose this because the regulators disagree sharply and change often. NDIPA is 1500 ng/day at FDA and EMA but 26.5 at MHLW and NMPA. CPCA category 1 is 26.5 at FDA and 18 at EMA and MHLW. FDA's limits page went through 30 revisions in three years. A Customer selling in two markets needs to see "passes FDA, fails MHLW". A result judged last year must still show the same verdict when the tables change. Source: [Decide the specification and limits model](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/29), reviewed by the Part 11, ISO/IEC 17025 and USP expert agents.

## Considered options

- **One Jurisdiction per Specification**, with a Test judged against several Specifications. Rejected: the Customer would approve several documents, and their verdicts could drift apart.
- **One Specification judged only against the strictest limit.** Rejected: it hides which market fails, and the multiple-nitrosamine rules and rounding differ by Jurisdiction, so "strictest" isn't one number.
- **Specifications read the tables and rules live.** Rejected: an edit to reference data would silently change the verdicts of Specifications the Customer has already accepted.

## Consequences

- A superseded Acceptable Intake row, a new Rule Set version, an ended interim limit or a new official version of a cited pharmacopoeial text **never changes a pinned Specification**. Each one blocks new Acceptance against that Specification until a new version is Authored, Approved by QA and accepted again by the Customer. Tests already accepted stay on their pinned version, unless the cited official text changes before the first Preparation or the Customer adopts the new version; either sends the Test to request re-review.
- **A USP conformance claim is judged by USP General Notices 7.20**: round half up to the limit's decimal places, with simple acceptance, whatever rounding the Section's Rule Set uses. So an NMPA Section rounds half to even except on a line carrying a USP claim. A claim to another pharmacopoeia follows that pharmacopoeia's own general notices.
- Each Section rounds the full-precision result on its own. One Section's rounded value never feeds another's.
- Seeded Acceptable Intakes are the real published values with their sources, entered through the audited path. In the demo, fictional QA users sign them Verified through the normal signing endpoint, re-authenticated and hash-bound. A production deployment loads them unverified, for its own QA to verify. NMPA rows stay unverified until they have been checked by hand against CDE's site. A Specification may copy only a Verified row, and QA approval is blocked while it cites any other.
