# The real-data gate's control list

The real-data gate ([ADR 0002](adr/0002-react-spa-fastify-postgres-hosted-on-the-owners-mac-then-a-us-vps.md); spec [#85](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/85), Further Notes) refuses the `real` data class while any control on this list is unbuilt. The list is one of the gate's conditions; the others (every login value at its decided value, every demo exception recorded as lapsed, live anchoring, a personal FileVault key, no record created under `fictional`) are in ADR 0002 and the spec. The list is every control of a build-order phase marked "before real data", plus the four tasks the spec names. Each pull request that builds a control marks its row Built with a link to its ticket. [Release Log, service identities, real-data gate and banner](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/102) turns this list into the registry the server reads; until then this document is the list.

| Phase | Control | Built |
| --- | --- | --- |
| 1 | Closed schemas | [#86](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/86) |
| 1 | Refusal kinds | [#86](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/86) |
| 1 | Commit keys | [#87](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/87) |
| 1 | System Incidents with log volume, redaction and the unwritten-incident check | Partly: [#89](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/89) built the incidents and redaction, and [#90](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/90) the unwritten-incident check. Unbuilt: the API log volume in the deploy config with its nightly shipping under `oplogs/` (proposed on #89) |
| 1 | A chain-verify failure opens a System Incident (QA's Verify chain names every failing entry and how far the chain is intact, [#111](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/111), opens one System Incident per break, and raises the alarm when it opens one) | Partly: [#186](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/186) and [#211](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/211) built the incidents and the alarm on the API log. Unbuilt: the alarm email and the in-app alarm list ([#167](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/167)) |
| 1 | Access Events with the expiry sweep | [#91](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/91) (Access Events), [#92](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/92) (the expiry sweep) |
| 1 | A lockout, a burst of failed sign-ins from one address or against one unknown-ID hash, or repeats against a locked account open a System Incident | [#93](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/93); the per-address rule takes effect in the deploy once [#180](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/180) sets `LIMS_TRUSTED_PROXIES` and Caddy forwards the client's address |
| 1 | Counters | [#88](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/88) |
| 1 | Transaction IDs | [#88](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/88) |
| 2 | Signing function and Signature fields | [#95](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/95) |
| 2 | Record Versions | [#94](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/94) |
| 2 | Lab at sign-in | [#98](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/98) |
| 2 | Workstations | [#99](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/99) |
| 2 | Identity Verification | [#100](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/100) |
| 2 | Unlock | |
| 2 | Admin constraint | [#100](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/100) |
| 2 | Decided login (TOTP, password rules, lockout 5, pepper) behind the data class; TOTP covers sign-in, signing and the Lab switch, which until then re-authenticates with user ID and password only ([#98](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/98)) | |
| 2 | Release Log, service identities, real-data gate and banner | |
| 3 | Critical Data Change | |
| 3 | Return | |
| 3 | Holds | |
| 3 | Picklist reasons | |
| 3 | Record Type Register | |
| 3 | Calculation Versions | |
| 3 | Review Checklists | |
| 3 | Readable Audit Trail panel | [#111](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/111) |
| 3 | QA audit export | [#112](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/112) |
| 4 | Document vault | |
| 4 | Training Records | |
| 4 | Authorisations | |
| 4 | Appointments | |
| 4 | Competence Assessments | |
| 7 | Equipment | |
| 7 | Rooms | |
| 7 | Check Plans | |
| 7 | Checks | |
| 7 | Unconfirmed Values | |
| 7 | Excursions | |
| 7 | Suppliers | |
| 7 | Materials | |
| 7 | Packs | |
| 7 | Solutions | |
| 8 | Acceptance | |
| 8 | Receipt | |
| 8 | Assignment gate | |
| 8 | Preparations | |
| 8 | Runs | |
| 8 | Typed entry | |
| 8 | Python worker Import | |
| 8 | Raw-Data Manifest | |
| 8 | Run Checks | |
| 8 | Verdicts | |
| 8 | Reviewed | |
| 9 | Deviations | |
| 9 | OOS | |
| 9 | CAPA Actions | |
| 9 | Planned Deviations | |
| 9 | Complaints | |
| 9 | PT Plan and Rounds | |
| 13 | Test Report format | |
| 13 | Release past the slice | |
| 13 | Amended Reports | |
| 13 | Withdrawal notices | |
| 13 | Downloads | |
| 13 | Check a copy | |
| task | Penetration test | |
| task | Supplier quality agreements | |
| task | The VPS move | |
| task | IT supplier evaluation | |
