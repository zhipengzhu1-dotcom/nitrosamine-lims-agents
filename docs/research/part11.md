# Part 11 and FDA data-integrity requirements for the LIMS

Research for [#2](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/2). All lab data in this project is fictional; the regulatory text below is real and quoted from the sources listed at the end.

## Short answer

Part 11 asks for a mix of software and procedural controls. The software's share is a closed list, and the whole list is cheap to build:

1. **Per-person identity and role checks.** Unique accounts, no shared logins, role-based authority checks on every write and every signature. Admin is kept apart from record content.
2. **An append-only, computer-generated, time-stamped audit trail.** It records who, what (old and new value), when and why for every create, modify and delete. Changes never overwrite earlier data, and no user can edit or turn off the trail.
3. **Workflow sequence enforcement.** The sample chain runs in order: submission → acceptance → receipt → assignment → result → review → QA release.
4. **Electronic signatures that are part of the record itself.** Each shows printed name, date/time and meaning. Each is bound to the record's content, so an edit made after signing shows the record as unsigned. Signing needs re-authentication with two components.
5. **Credential controls.** Lockout and alerting on failed logins, the ability to deauthorize a lost TOTP device, and periodic access review.
6. **Complete human-readable and electronic copies.** Exports that carry the audit trail and metadata. Retrieval for the whole retention period, with tested backups.
7. **Keep everything.** Invalidated, reprocessed, aborted and failing data is retained, never only the final value, and each entry is saved when it is made.

Several things are procedural and the lab owns them: validation, training records, SOPs, the §11.100(c) non-repudiation letter to FDA, identity verification before issuing a signature, and audit-trail review. The software should still make each of these easy, and in some cases enforce it (training gates assignment).

**Recommendation.** Build every §11.10 control, even the ones FDA says it will not currently enforce ([SA] §III.A: validation, audit trail, copies, retention). Three reasons: predicate rules and FDA's data-integrity guidance still expect their substance, EU Annex 11 has no matching enforcement discretion, and the draft 2025 Annex 11 turns most of them into explicit, testable system features. Design to the **draft Annex 11 §11–13 identity, audit-trail and signature rules** as the strictest superset. It costs little extra and matches the map's TOTP 2FA decision.

## Scope notes that shape the design

- **What counts as a Part 11 record.** Part 11 covers records kept electronically "in place of paper" (and records kept in both forms that are relied on) when a predicate rule requires them. It also covers electronic signatures meant to equal handwritten ones ([SA] §III.B.2). FDA recommends the lab document, per record type, whether it relies on the electronic or the paper version ([SA] §III.B.2). → The LIMS should carry a **record-type registry** (sample, result, deviation, equipment check, SOP version, and so on) with a "Part 11 record: yes/no" flag. Anything relied on for release defaults to yes.
- **Closed vs open system.** A closed system is one where "system access is controlled by persons who are responsible for the content of electronic records" ([P11] §11.3(b)(4)). The deciding factor is who controls access, not whether the server is on the internet. The lab administers every account, including Customer portal accounts, so the system can be designed as **closed** (§11.10). Because it is internet-facing, it should still take on the cheap §11.30-style extras: encryption in transit and at rest, and a content hash bound to each signature. FDA's 2024 Q&A says risk-assess security for *all* systems "because of changing technologies and the increased risk of cybersecurity threats" ([CI] Q11 fn 51). *This is an interpretation. The regulation does not rule on cloud hosting.*
- **ALCOA vs ALCOA+.** FDA's CGMP guidance defines data integrity as ALCOA: attributable, legible, contemporaneously recorded, original or a true copy, accurate ([DI] Q1a). The "+" (complete, consistent, enduring, available) comes from PIC/S PI 041-1 §7.4 ([PICS]), not from FDA. The ticket asks for ALCOA+, so the checklist covers all nine. Each maps to a row below.
- **Cloud/IT provider.** A regulated entity using hosted services stays responsible for Part 11 compliance. It should have a written agreement covering access to data for the retention period, backup/recovery and audit trails ([CI] §III.C, Q17). Annex 11 also requires formal agreements with third parties who host or maintain the system ([A11] §3.1). → The ≤$10/month VPS is a supplier. Its terms and a data-exit plan belong in the lab's records.

## Requirement checklist

**Control** key: **S** = software control (the LIMS must implement it), **P** = procedural control (the lab owns it via SOP or record), **S+P** = both.

### A. Closed-system controls (§11.10)

| # | Requirement | Source | Control | Implication for this LIMS |
|---|---|---|---|---|
| A1 | Validate the system for "accuracy, reliability, consistent intended performance, and the ability to discern invalid or altered records." | [P11] §11.10(a); [DI] Q3 (each CGMP workflow validated for intended use); [A11] §4 | S+P | IQ/OQ/PQ is out of scope, but the build should leave evidence behind: automated tests per workflow, traceable user requirements ([A11] §4.4), and a record-hash check so altered records can be detected. |
| A2 | Generate "accurate and complete copies of records in both human readable and electronic form." | [P11] §11.10(b); [SA] §III.C.4 (PDF/XML exports; keep search/sort ability where feasible); [DI] Q9, Q17 | S | Each record gets a PDF (human-readable) and JSON/CSV (electronic) export that includes metadata, signatures and audit trail. Whole-dataset export for inspection. |
| A3 | Protect records for "accurate and ready retrieval throughout the records retention period." | [P11] §11.10(c); [SA] §III.C.5; [DI] Q1e (backup = true copy incl. metadata, original or compatible format) | S+P | Scheduled off-server backups including audit tables. Documented restore test ([A11] §7.2). Retention period per record type in config. Deletion blocked while a record is inside its retention period. |
| A4 | Limit system access to authorized individuals. | [P11] §11.10(d); [DI] Q4 (documented list of authorized users and privileges) | S+P | Login required for every route. An access-rights register that records date added, rights and changes ([CI] Q11; [A11] §12.3). |
| A5 | "Secure, computer-generated, time-stamped audit trails" that independently record operator entries and actions that create, modify or delete records. "Record changes shall not obscure previously recorded information." Keep for at least the record's retention period. | [P11] §11.10(e); [DI] Q1c; [CI] Q12 (old value, new value, user ID and role, reason; protected from modification and disabling), Q13 (deliberate actions, not keystrokes) | S | Append-only audit table written by the server, never by the client. Update-in-place is not allowed on regulated tables: a new version is created and the old one kept. Reason-for-change prompted on every edit. No UI or API can edit or disable the trail. Audit trail records are kept as long as their subject records. |
| A6 | Operational system checks "to enforce permitted sequencing of steps and events." | [P11] §11.10(f) | S | A state machine for the sample chain and document lifecycle. The server rejects out-of-order transitions (for example, release before review). |
| A7 | Authority checks so only authorized individuals can use the system, sign, alter a record or perform an operation. | [P11] §11.10(g); [DI] Q4 | S | Role/permission check on every action and every signature meaning. Training Record gate on test assignment. Separation of duties: the Reviewer cannot be the Analyst on the same result, and QA release needs the QA role. |
| A8 | Device checks to determine "the validity of the source of data input." | [P11] §11.10(h) | S | For instrument report import: record the instrument/equipment ID, file hash, file name and upload metadata. Reject reports from instruments that are blocked (open Deviation) or out of calibration. |
| A9 | People who develop, maintain or use the system have the education, training and experience for their tasks. | [P11] §11.10(i); [DI] Q16; [CI] Q15 | P (S assists) | Lab SOP and training records. The LIMS can gate system roles on a "system-use training" Training Record, the same way it gates methods. |
| A10 | Written policies holding individuals accountable for actions under their e-signatures. | [P11] §11.10(j) | P (S assists) | Lab policy. The LIMS shows an attestation the user must acknowledge when their signature is enabled, and records that acknowledgement. |
| A11 | Controls over systems documentation (distribution and use), plus revision and change control with an audit trail. | [P11] §11.10(k)(1)–(2); [A11] §10 | S+P | Git history, pull requests and tagged releases are the change record for code and config. Admin configuration changes inside the app go through the audit trail. |

### B. Signature manifestation and linking (§11.50, §11.70)

| # | Requirement | Source | Control | Implication for this LIMS |
|---|---|---|---|---|
| B1 | A signed record shows the signer's printed name, the date and time of signing, and the meaning (review, approval, responsibility, authorship). | [P11] §11.50(a) | S | The Signature entity holds `printed_name`, `signed_at` (UTC plus stated zone), `meaning` (enum per workflow step) and `role`. Draft Annex 11 adds username and role ([A11d] §13.6). |
| B2 | Those items are subject to the same controls as records and appear in every human-readable form (screen and print). | [P11] §11.50(b) | S | Signatures are audit-trailed, immutable rows. Every record view and PDF export renders the signature block. |
| B3 | Signatures are linked to their records so they "cannot be excised, copied, or otherwise transferred to falsify an electronic record by ordinary means." | [P11] §11.70; [A11] §14b ("permanently linked"); [A11d] §13.8 (a later change makes it "clearly appear as unsigned") | S | Each signature stores the record ID, the version, and a hash of the canonical record content at signing time. Any later edit creates a new version, and the old signature no longer verifies, so the new version shows as unsigned until re-signed. |

### C. Electronic signatures and credentials (§11.100, §11.200, §11.300)

| # | Requirement | Source | Control | Implication for this LIMS |
|---|---|---|---|---|
| C1 | Each e-signature is unique to one person and never reused or reassigned. | [P11] §11.100(a); [DI] Q5 (no shared logins) | S | Usernames can never be reissued, even after deactivation. Accounts are deactivated, never deleted. |
| C2 | Verify the person's identity before issuing an e-signature. | [P11] §11.100(b); [CI] Q26 (government ID, MFA-backed credentials, etc.) | P (S assists) | Admin workflow step "identity verified by X on date Y (method)" is required before signing is enabled on an account. |
| C3 | Certify to FDA that e-signatures are the legally binding equivalent of handwritten ones (letter of non-repudiation). | [P11] §11.100(c); [CI] Q29 (one letter can cover the organization) | P | Lab action, done once. No software work. (This is a fictional lab, so nothing is sent.) |
| C4 | Non-biometric signatures use at least two distinct components, such as ID code and password. | [P11] §11.200(a)(1) | S | Username + password is the Part 11 minimum. The map's TOTP is extra. |
| C5 | Within one continuous session: the first signing uses all components, and later signings use at least one component "only executable by, and designed to be used only by, the individual." Outside a continuous session, every signing uses all components. | [P11] §11.200(a)(1)(i)–(ii); [A11d] §13.3 (full re-auth at least as strong as login; subsequent signings in immediate sequence by password; relying on the existing login is "not acceptable") | S | The signing dialog asks again for credentials; the existing session never counts as a signature. Proposed: first signing = password + TOTP, subsequent signings in the same unbroken session = password. Session break after idle timeout. |
| C6 | Signatures are used only by their genuine owners, and misuse would need two or more people to collaborate. | [P11] §11.200(a)(2)–(3) | S+P | Admins cannot see or set passwords (hashed only) or TOTP secrets. Admin password reset forces the user to change the password at next login ([A11d] §11.4). A reset alone does not let an admin sign as the user. |
| C7 | ID code + password combinations stay unique. | [P11] §11.300(a) | S | Unique username constraint. |
| C8 | Issuances are "periodically checked, recalled, or revised (e.g., … password aging)." | [P11] §11.300(b); [A11d] §11.11 (recurrent access reviews) | S+P | A periodic access-review report (who holds what role, last login). Admin can force credential reset. Aging policy is configurable. |
| C9 | Loss management: electronically deauthorize lost or compromised tokens and devices, and issue replacements under rigorous controls. | [P11] §11.300(c) | S+P | Admin can revoke a user's TOTP enrolment immediately, and re-enrolment needs the identity check again. Both events go in the audit trail. |
| C10 | Transaction safeguards that prevent unauthorized use, and "detect and report in an immediate and urgent manner" attempted misuse to the security unit and, as appropriate, management. | [P11] §11.300(d); [CI] Q11 (limit login attempts, record failures, auto-logout); [A11d] §11.7–11.8 | S | Lockout after N failures; only an admin unlocks. An alert goes to the Admin on lockout or repeated failed signing. Failed attempts are logged. Idle logout that users cannot turn off. |
| C11 | Initial and periodic testing of tokens and cards. | [P11] §11.300(e) | P | Barely applies to authenticator-app TOTP. Cover it with a TOTP verification step at enrolment. |

### D. FDA data-integrity (CGMP Q&A 2018) and ALCOA+

| # | Requirement | Source | Control | Implication for this LIMS |
|---|---|---|---|---|
| D1 | **Attributable**: every action is traceable to one individual. No shared accounts. Read-only shared viewing is acceptable, but a shared account can't do second-person review. | [DI] Q1a, Q5 | S | Every write carries the authenticated user ID and role. No generic accounts, not even for instruments. |
| D2 | **Contemporaneous**: record data at the time of performance. A LIMS "can be designed to automatically save after each entry." | [DI] Q12 | S+P | Save each field or step to the server as it is entered, with a server timestamp. No "draft only in the browser" for regulated values. SOP: enter data immediately. |
| D3 | **Original / true copy**: dynamic instrument records (reprocessable) are not replaced by a static printout. | [DI] Q1d, Q10 | S+P | An uploaded LC-MS/MS PDF/TXT report is a *static* copy. The dynamic original stays in the instrument's data system. The LIMS stores the uploaded file byte-for-byte with its hash, and records the CDS sequence/injection reference so a reviewer can trace to the raw data. The LIMS must not present the PDF as the original record. |
| D4 | **Complete**: keep all data, including failing, aborted and invalidated results. Invalidation needs a documented, scientifically sound justification, and the original data stays in the record. | [DI] Q2, Q13 | S | Results are never deleted. "Invalidate" is a state that needs a reason and a linked Deviation/investigation. Invalidated values stay visible to Reviewer and QA. |
| D5 | Reprocessed chromatography: every result is kept, not only the final one. | [DI] Q14; [DI] Q1c (audit trail includes integration parameters and reprocessing details plus justification) | S | Allow multiple result versions per test, each with a reason. Import of a re-integrated report adds a new version and does not replace the old one. |
| D6 | Changes cannot happen without a record of the change, and there is no storage "that allows for manipulation without creating a permanent record." | [DI] Q12 | S | The database role used by the app cannot UPDATE or DELETE audit rows. Enforce with DB permissions or triggers, not just app code. |
| D7 | The system administrator role is independent of record content. Restrict changes to specs, methods and data "by technical means where possible." | [DI] Q4; [A11d] §11.10 (segregation of duties, least privilege) | S | The Admin role has no Analyst, Reviewer or QA permissions (a hard rule the software enforces). Specs and method limits are editable only through a controlled, signed change. |
| D8 | Blank forms and worksheets are controlled: issued, numbered, reconciled. | [DI] Q6 | S | The Document Vault issues worksheet/ELN templates from an approved version with a unique issuance number. Voided forms are kept with a reason. |
| D9 | Audit trail review by the people who review the record, at the same frequency as the data review (before release). | [DI] Q7, Q8; [A11d] §12.4–12.8 | S+P | The Reviewer and QA screens show the record's audit trail inline, filterable, with changes highlighted. Review sign-off includes "audit trail reviewed." The SOP defines what gets reviewed. |
| D10 | **Legible / Enduring / Available**: data is kept with the metadata needed to reconstruct the activity, readable for the whole retention period, and FDA may inspect and copy it. | [DI] Q1b, Q17; [PICS] §7.4 | S+P | Store units, instrument ID, method version and timestamps with every value. Open formats (PDF/JSON/CSV) for export and archive. |
| D11 | **Accurate / Consistent**: output checked for accuracy. Critical manual entries get a second check. Time stamps are consistent. | [DI] §II (§211.68 output "checked for accuracy"); [A11] §6; [PICS] §7.4 | S+P | Reviewer approval acts as the second check on typed entry. Range/plausibility checks on input ([A11d] §10.1). One trusted server clock for every timestamp (see E1). |

### E. Time and clocks (supports §11.10(e) and §11.50)

| # | Requirement | Source | Control | Implication for this LIMS |
|---|---|---|---|---|
| E1 | Controls make sure system date and time are correct. Only admins can change them, changes are documented, and admins are notified of any discrepancy. | [CI] Q14; [A11d] §12.3 (changing system time must itself create an audit entry) | S+P | Server timestamps only; client clocks are never trusted. NTP on the host. A startup and periodic clock-drift check that alerts the Admin. |
| E2 | Time-zone reference is clear. FDA does not expect the signer's local time, but system documentation should explain the zone reference used. | [SA] §III.A fn 5; [CI] Q14; [A11d] §12.2, §13.4 | S | Store UTC. Display lab-local time with the zone shown. Document the convention. |

## Where EU GMP Annex 11 differs

Annex 11 (revision 1, in operation since 30 June 2011) is the version currently in force. The EudraLex Volume 4 page still lists "Annex 11 - Computerised Systems (revision January 2011)" as current. A full rewrite went to stakeholder consultation from 7 July to 7 October 2025 ([A11d]). As of this research it had not been adopted.

**Annex 11 (2011) compared with Part 11**

- **Reason for change.** Annex 11 requires it outright: "For change or deletion of GMP-relevant data the reason should be documented" ([A11] §9). Part 11 §11.10(e) does not name a reason. FDA's 2024 Q&A says audit trails "should include the reasons" ([CI] Q12).
- **Audit trails.** Annex 11 is risk-based in wording ("consideration should be given, based on a risk assessment") but explicitly requires that audit trails be "regularly reviewed" ([A11] §9). Part 11 mandates the trail and says nothing about review. FDA's review expectations come from the DI guidance ([DI] Q7–Q8).
- **Signatures.** Annex 11 asks less: same impact as handwritten, permanently linked, time and date ([A11] §14). It has no stated "meaning," no two-component rule, and no non-repudiation letter. Part 11 is stricter here.
- **Things Annex 11 adds:**
  - a second check on critical manual data entry ([A11] §6)
  - printouts that show whether data changed since original entry ([A11] §8.2)
  - regular backups with restore tested and monitored ([A11] §7.2)
  - records of access-authorization changes ([A11] §12.3)
  - incident management ([A11] §13)
  - business continuity ([A11] §16)
  - archive readability tests ([A11] §17)
  - periodic evaluation ([A11] §11)
  - formal supplier agreements ([A11] §3)
- **Release.** Only the authorized person releases, recorded with an e-signature ([A11] §15, written for the Qualified Person and batch release). The closest analogue here is QA report release.
- **Enforcement discretion.** Annex 11 has none. FDA's non-enforcement of §11.10(a), (b), (c), (e) and (k)(2) ([SA] §III.A) has no EU counterpart.

**Draft Annex 11 (2025) goes further; worth designing to now**

- **Identity and access:**
  - MFA for remote access to critical systems from outside controlled perimeters ([A11d] §11.6). A cloud-hosted web LIMS fits that description, so this backs the map's TOTP decision.
  - Lockout, unlocked only by an admin ([A11d] §11.7).
  - Idle logout that users cannot disable ([A11d] §11.8).
  - A searchable login/logout access log ([A11d] §11.9).
  - Segregation of duties and least privilege ([A11d] §11.10).
- **Audit trails:**
  - The system prompts automatically for a reason on every change ([A11d] §12.2).
  - The trail is locked and cannot be disabled ([A11d] §12.3).
  - Review is independent (peer) and completed before release ([A11d] §12.6, §12.8).
  - "Flat and locked files are not acceptable" for the electronic copy; it must be searchable and sortable ([A11d] §12.9).
- **Signatures:**
  - Full re-authentication at signing ([A11d] §13.3).
  - Manifestation includes username and role ([A11d] §13.6).
  - A signed record either cannot be modified or shows as unsigned after a change ([A11d] §13.8).
- **Data handling:**
  - Plausibility checks on manual input ([A11d] §10.1).
  - Validated interfaces instead of manual transcription for instrument → LIMS transfer "where possible" ([A11d] §10.2). This supports report import over typed entry.
  - Encryption of critical data "where applicable" ([A11d] §10.4).
  - Documented restore tests ([A11d] §16.6).

## Open questions for the owner

1. **Target jurisdiction.** Is this lab FDA-only, or should the design also claim EU Annex 11 alignment? The recommendation is to build to the draft Annex 11 superset. It changes almost no scope and avoids redesign if the draft is adopted.
2. **Signing strength.** Should every signing ask for TOTP, or only the first in a session, with password for later signings? Part 11 allows the second option ([P11] §11.200(a)(1)(i)). Draft Annex 11 requires re-authentication at least as strong as login ([A11d] §13.3), so if login is password + TOTP, the first signing should be too. Proposed default: first signing in a session = password + TOTP, later signings = password.
3. **Retention periods.** Retention depends on predicate rules and customer contracts, and neither Part 11 nor this research sets a number. The owner (or the ISO/IEC 17025 ticket) needs to choose a default retention period per record type so deletion blocking and archiving can be built.
4. **Customer portal signatures.** Does a Customer's submission need a Part 11 e-signature (for example, a chain-of-custody attestation), or is an authenticated, audit-trailed submission enough? This decides whether Customer accounts go through identity verification (C2).

## Sources

All fetched on 2026-09-29.

- **[P11]** 21 CFR Part 11, Electronic Records; Electronic Signatures. eCFR, up to date as of 2026-09-25, via the eCFR API: https://www.ecfr.gov/api/versioner/v1/full/2026-09-25/title-21.xml?part=11
- **[SA]** FDA, *Guidance for Industry: Part 11, Electronic Records; Electronic Signatures — Scope and Application*, August 2003: https://www.fda.gov/media/75414/download
- **[DI]** FDA, *Data Integrity and Compliance With Drug CGMP: Questions and Answers, Guidance for Industry*, December 2018: https://www.fda.gov/media/119267/download
- **[CI]** FDA, *Electronic Systems, Electronic Records, and Electronic Signatures in Clinical Investigations: Questions and Answers, Guidance for Industry*, October 2024, Revision 1: https://www.fda.gov/media/166215/download. It is written for clinical investigations, not CGMP labs. It is used here as FDA's most recent statement on Part 11 mechanics (audit trail contents, access control, time, signatures).
- **[A11]** European Commission, EudraLex Volume 4, *Annex 11: Computerised Systems*, revision 1, in operation 30 June 2011: https://health.ec.europa.eu/system/files/2016-11/annex11_01-2011_en_0.pdf. Its current status is shown on the EudraLex Volume 4 page: https://health.ec.europa.eu/medicinal-products/eudralex/eudralex-volume-4_en
- **[A11d]** European Commission, draft revised *Annex 11: Computerised Systems* (stakeholder consultation 7 July – 7 October 2025): https://health.ec.europa.eu/document/download/40231f18-e564-4043-94de-c031f813d38b_en?filename=mp_vol4_chap4_annex11_consultation_guideline_en.pdf. The consultation page is https://health.ec.europa.eu/consultations/stakeholders-consultation-eudralex-volume-4-good-manufacturing-practice-guidelines-chapter-4-annex_en. It is a draft and not in force.
- **[PICS]** PIC/S, *Good Practices for Data Management and Integrity in Regulated GMP/GDP Environments*, PI 041-1, 1 July 2021: https://picscheme.org/docview/4234. Cited for the ALCOA+ definition, §7.4.
