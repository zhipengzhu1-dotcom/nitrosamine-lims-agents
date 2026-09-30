# A Method's performance lives on the Lab's Adoption, copied from signed records, never typed in

A Method version says what the procedure is and what it must meet; it never carries LOQ, LOD, range, maximum dilution or uncertainty. Those are what one Lab demonstrated on one scope of Products, so they live with that Lab's Method Adoption, per Analyte and scope entry, and the Acceptance gate, the verdict engine and the report read them only from signed records. Every Adoption value is copied, never typed, from one of these sources, and the Adoption's signed content stores the source's version, row and SHA-256:

- the Lab's own Effective Method Report whose purpose suits the Method's basis, with the range taken from the levels the Report actually tested;
- the sending unit's signed Method Report, under an approved `<1224>` transfer waiver;
- nothing, for Verified (basic compendial), which carries no performance values.

Uncertainty is the exception: U is never copied onto the Adoption. It lives in a separate Uncertainty Evaluation per Adoption and Analyte, the one performance value that is estimated rather than measured, signed Approved by a QA who did not evaluate it, with its evidence pinned by Result IDs and a hash. The gates read the current Approved Evaluation, and each Test pins its version and SHA-256.

A new Report changes nothing until the Adoption is signed again. When a new Method version has validation impact None, the server drafts the carried-forward Adoption, and the Lab takes no new assignments on that Method until QA signs it. A one-off Product outside scope may use the Adoption's values under a QA justification the Customer accepts, but never typed values.

We chose this because two Labs running the same Method version reach different LOQs, a new matrix needs its own evidence, and ISO/IEC 17025 7.2 and the Part 11 expert both need every gating number traceable to the signed evidence behind it. Putting LOQ on the Method would have been simpler and wrong for the QC labs that join later. Source: [Decide the Method record's structured data](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/36), reviewed by the Part 11, ISO/IEC 17025 and USP expert agents.

## Considered options

- **Performance on the Method version.** Rejected: one Lab's validation would stand for every Lab, and a second Lab's better or worse LOQ would need a new company Method version.
- **Performance typed onto the Adoption by QA.** Rejected: nothing would tie the gating number to its evidence, and a later Report could silently disagree with it.
