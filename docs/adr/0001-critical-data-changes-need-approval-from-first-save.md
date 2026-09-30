# Critical data changes need a second person's approval from the first save

A change to critical data (a result value, weight, dilution volume, standard concentration, a Specification's maximum daily dose or acceptable intake, or the instrument a Run used) is only a proposal from the moment the value is first saved. It takes effect when a second person approves it, never the person who proposed it. Until then the earlier value stays current, and the Analyst cannot sign Performed while a correction is pending. We chose this because China's computerized-systems annex (Art. 16) requires approval for changes to *entered* critical data. Every entry saves to the server as it is made (FDA DI Q12), so a value is "entered" at its first save. The map designs to the strictest superset of Part 11, draft Annex 11, China and Japan.

## Considered options

- **Free correction until the Analyst signs Performed, approval only after.** Owner's first choice, rejected after the Part 11 expert review: it lets an Analyst overwrite a saved weight or result with only a reason, which is the case Art. 16 targets.
- **Approval from first save, as a separate step.** Rejected as too costly for typo fixes.
- **Approval from first save, folded into existing signings.** Chosen. Before Performed, any pending correction needs a Verified signing by a second person, and that signing approves every pending correction on the record. After Performed, the Reviewer (for results) or QA (for Specifications) approves it. In both cases the dialog shows each old → new value.

## Consequences

Fixing a typo in a weight is not an edit. It creates a proposed value that a second person sees and approves. "Simplifying" this into an in-place edit with a reason would break the China alignment. Source: [Decide the audit trail and electronic signature design](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/13).
