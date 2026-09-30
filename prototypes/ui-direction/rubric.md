# Rubric (judge and picker only; candidates never see this)

Score each criterion 1–5 from the running prototype (screenshots in `shots/<c>/`, the deep links, and the code), not from its RATIONALE.md claims. 5 = a reviewer could build from it as-is; 3 = workable with fixes; 1 = fails the criterion.

1. **Bench fitness.** Glove-sized targets where the bench acts (entry, confirm, sign, lock), while reading stays dense where density helps. Resolves the density-vs-touch tension on purpose, not by accident. Works at 1366×768 without horizontal scrolling.
2. **Scale.** The queue stays scannable and actionable with ~327 open Tests of 1,276, 20 Analysts, 38 held and 19 overdue: filtering, search, counts, workload, and a fast path to the next action. Assignment shows all 20 Analysts with refusal reasons.
3. **Status clarity.** Test state, Holds (separate from state), GxP Class, Fitness Status with its reason, overdue/at-risk and Deviations read at a glance, consistently across screens, never by color alone, using CONTEXT.md vocabulary.
4. **Signature integrity and shared-PC safety.** The prompt makes signer, meaning and statement, record, Record Version and hash unmistakable; typed user ID + password + fresh TOTP; lockout countdown; no accidental signing; signature block manifests afterwards. Identity always visible; lock and takeover are fast and safe.
5. **Entry and error-proofing.** Draft-vs-confirmed values are unmistakable; the flag must be handled before signing; readings enforce retype-to-confirm for out-of-limit or implausible values and state the consequence before saving; no typed times; units and limits visible while typing.
6. **Buildability.** A coherent, small token system (color roles, type, spacing, targets) and component vocabulary a React 19 + TypeScript build can adopt; accessible (contrast, focus, labels); clean console; the code is legible enough to port.

Also note, per candidate: its direction name and axis, its one or two ideas most worth grafting into another candidate, and any convergence with other candidates.
