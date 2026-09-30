# One company, four labs: what the single-lab build must get right

Research for [#28](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/28), part of the map [#1](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/1). Sources were fetched on 2026-09-29. All lab data is fictional.

This builds on [multi-lab tenancy research (#9)](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/blob/research/multi-lab/docs/research/multi-lab.md), [Part 11 (#2)](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/blob/research/part11/docs/research/part11.md) and [ISO/IEC 17025 (#3)](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/blob/research/iso17025/docs/research/iso17025.md). Their findings are referenced here, not repeated.

**Scope, as set by the owner.** The company has an **R&D lab** and three **QC labs**. The R&D lab is built and demoed first, and **it does both non-GMP R&D work and GMP QC work**. The design must let the three QC labs join later through configuration alone. Serving other companies is out of scope.

"Design judgment" marks a recommendation that no fetched source requires.

## Short answer

1. **Tag every piece of work, not every lab, as GMP or not.** The R&D lab does both kinds, so the GMP flag goes on each Test (and defaults from its Submission). It cannot sit on the lab. Three things are independent of each other: which lab did the work, whether the work is GMP, and whether the method is inside that lab's accreditation scope. Each one controls different gates and different report wording.
2. **Keep the same data-integrity rules for non-GMP work; relax only the workflow.** R&D data often turns into GMP evidence later. ICH Q2(R2) allows "suitable data derived from development studies" to be "used as part of validation data" [[Q2(R2)]](https://database.ich.org/sites/default/files/ICH_Q2(R2)_Guideline_2023_1130.pdf). FDA says it reviews records "not intended to satisfy a CGMP requirement but which nonetheless contain CGMP information" [[FDA DI Q&A]](https://www.fda.gov/media/119267/download). Data can only be used this way if it was captured with an audit trail, with the person who recorded it, and unchanged. So both kinds of work get the same audit trail and e-signatures. What changes for non-GMP work is that QA release and some gates are optional, and the report says so.
3. **Only the #9 model with a `lab_id` on each row still applies.** Within one company there is no need for one deployment per lab or a database per lab. Checks between labs stop being a tenant wall and become permissions: company QA may read across labs, and a person may hold roles in several labs. The #9 must-dos stay (a non-null `lab_id`, per-lab audit chains, person split from membership, one lab-scoped seam). Four new must-dos come from this ticket: the GMP flag on Tests, company-owned records alongside lab-owned ones, a company method record with per-lab adoption, and transfers recorded as a dispatch/receipt pair (not by changing `lab_id`).
4. **Accreditation scope is recorded per lab even if the certificate is company-wide.** ANAB accredits "one legal entity with multiple locations" under one management system, or gives each site its own accreditation. It decides which after review [[ANAB MA 2100]](https://anab.qualtraxcloud.com/ShowDocument.aspx?ID=8152). Either way, a result is inside scope only for the lab that performed it. The report must mark results outside scope [[ILAC P8]](https://ilac.org/?ddownload=125463).

## Which records belong to the company and which to one lab

"Company" means one row for the whole company, with no `lab_id`. "Lab" means `lab_id NOT NULL`, fixed once the row is created. "Shared with transfer" means a physical thing that moves between labs. Each lab keeps its own record of it, and a transfer record links the two.

| Record | Owner | Reason |
|---|---|---|
| Quality manual, company SOPs, code of conduct | **Company**; each applies to a listed set of labs | For a multi-location accreditation, ANAB checks that all facilities "are subject to the same management system and use the same management manual" [[ANAB MA 2100]](https://anab.qualtraxcloud.com/ShowDocument.aspx?ID=8152). Company QA approves these. This changes #9, which made every vault document lab-owned. |
| Lab-local SOPs, work instructions, forms | **Lab** | Rooms, instruments and local practice differ. The lab's QA approves them. |
| Analytical method: the controlled procedure and its versions | **Company** method record | One validated procedure is used in several labs. EU GMP 6.37–6.40 describes a transferring and a receiving laboratory working from one method [[EU GMP Ch. 6]](https://health.ec.europa.eu/document/download/c74c8720-27bf-4252-808f-d65a206a90bb_en?filename=2014-11_vol4_chapter_6.pdf). |
| Method adoption: status of a method in one lab (in development, validated here, transferred in, verified, retired) | **Lab** | A lab that did not perform the original validation "should verify the appropriateness of the testing method" (EU GMP 6.15). 21 CFR 211.194(a)(2) requires suitability "verified under actual conditions of use" [[21 CFR 211.194]](https://www.ecfr.gov/api/versioner/v1/full/2026-09-01/title-21.xml?part=211&section=211.194). |
| Accreditation (body, certificate number) | **Company or lab**, depending on ANAB's decision | Whether one multi-location accreditation or separate accreditations per site is "warranted" is ANAB's call [[ANAB MA 2100]](https://anab.qualtraxcloud.com/ShowDocument.aspx?ID=8152). |
| Accreditation scope item (method × matrix × analyte) | **Lab** | Competence is assessed where the work is done. An ANAB scope is a per-client document "owned by ANAB" [[ANAB MA 2100]](https://anab.qualtraxcloud.com/ShowDocument.aspx?ID=8152). Design judgment: key each item to the lab even under a single certificate. |
| Customer (external organization), internal department | **Company** | The Customer deals with the company. Per-lab copies would drift apart. Customer confidentiality (ISO 4.2, see #3) is enforced by which Submissions a user can see, not by keeping the Customer record in one lab. This answers #9's open question 2. |
| Person (login, password, TOTP, passkeys) | **Company** | One identity per individual (#9, Part 11 §11.100(a)). |
| Membership (person × lab × roles) | **Lab** | The same person may be an Analyst in the R&D lab and a Reviewer in a QC lab. Draft Annex 11 §12.2 asks the audit trail for "the user's role, if users may have more than one role" [[Annex 11 draft]](https://health.ec.europa.eu/document/download/40231f18-e564-4043-94de-c031f813d38b_en?filename=mp_vol4_chap4_annex11_consultation_guideline_en.pdf). |
| Training Record against a **company** SOP version | **Company** (belongs to the person) | Training on the code of conduct or a company SOP holds in every lab where that document applies. Design judgment. |
| Authorisation to run, review or release under a method (ISO 6.2.6) | **Lab** | Tied to that lab's method adoption and equipment. A transfer protocol must identify "the additional training requirements" (EU GMP 6.39 ii). |
| Rooms, environmental limits, readings | **Lab** | Physical. |
| Equipment record (ISO 6.4.13 a–h) | **Lab**, with transfer | Its "current location" is one of the required fields (6.4.13 d, see #3). Moved equipment must be verified "before it goes into or back into service" (6.4.4). The receiving lab opens its own equipment record, linked to the sending lab's. |
| Material catalogue (what an NDMA CRM or a column type *is*), approved suppliers | **Company** | Reference data. ISO 6.6 supplier approval is usually a company process. Design judgment. |
| Inventory lot, stock and working standards | **Lab**, with transfer | Storage and expiry are local. A transfer must record "special transport and storage conditions" (EU GMP 6.39 iv). CRM → stock → working-standard lineage (#3, ISO 6.5) must continue across the transfer. |
| Submission | **Company** | The Customer submits to the company. Each Test in it is assigned to one lab (next row). |
| Test, aliquot, result, ELN entry, raw instrument file | **Lab** | 21 CFR 211.194(a) needs complete data from "all tests" at the place of testing. The lab that did the work owns the record. |
| Sample custody | **Lab**, with transfer | ISO 7.4.2 requires unambiguous identification kept while the lab holds the item, and handling of "transfer" (see #3). Dispatch goes in the sending lab's records, receipt and condition on arrival in the receiving lab's. The sample ID stays the same. |
| Report / CoA | **Lab** | 7.8.2.1 (b) lab name and address, (c) location of the work, (o) authoriser (see #3). ILAC P8 says the accreditation symbol is used "only under the name … of the legal entity in which it holds accreditation" (5.3) [[ILAC P8]](https://ilac.org/?ddownload=125463). |
| Deviation | **Lab**, with links across labs | Raised where the problem happened. An impact assessment (ISO 7.10 c) may reach other labs, for example a standard lot that was sent to three labs. PIC/S expects data-integrity investigations to cover "the corporate level, including all facilities, sites and departments that could potentially be affected" [[PIC/S PI 041-1]](https://picscheme.org/docview/4234). |
| Audit trail | **One chain for company records, one chain per lab** | Each ANAB assessor or inspector reviews one location, as in #9. Company-owned records need a trail of their own. |
| LIMS change log and system-incident log (ISO 7.11) | **Company** | One system serves every lab. Each lab's configuration changes also go in that lab's own trail. |

### One Submission split across labs

The model is Submission (company) → Test (lab) → aliquot (lab). A Customer submits once, and the Sample Custodian of each receiving lab accepts the Tests assigned to that lab. Two sourced constraints shape what the Customer receives:

- **Each report comes from one lab.** 7.8.2.1 (b), (c) and (o) name one lab, one location and one authoriser (see #3). Design judgment: one report per lab by default. A combined report is allowed only if it marks which results came from the other lab.
- **Whether a sister lab counts as an "external provider" depends on the accreditation.** Under separate accreditations, the other lab's results probably count as externally provided. The Customer must then be told and approve (7.1.1), and the report marks them (7.8.2.1 p) (see #3). Results outside the issuing lab's scope need the ILAC P8 §7.1 b) disclaimer, e.g. "The conformity assessment activities marked * are not covered by the scope of accreditation" [[ILAC P8]](https://ilac.org/?ddownload=125463). Under a multi-location accreditation this may not apply. That is a question for ANAB (see Open questions).

### How transfer is stored (design judgment)

Never change `lab_id` on a row that already has history. A transfer writes three records:

1. a **dispatch** row in the sending lab;
2. a **receipt** row in the receiving lab, holding condition on arrival, storage, and whether verification is required before use;
3. a company-level **transfer** record that links the two.

Each lab's audit chain gets its own entry. Each lab's data stays complete and exportable on its own, and composite foreign keys `(lab_id, id)` keep holding.

Where result data moves between labs (a QC lab's results cited in an R&D report, or R&D development data cited in a validation report), the citing record points to the signed source record. Nothing is copied. PIC/S treats data moving between sites of one organization as needing "true copy" controls, or summary reports approved "by authorised staff at the original site", and allows evaluation of a sister site through "corporate procedures, internal audit reports" [[PIC/S PI 041-1 §7.7–7.8]](https://picscheme.org/docview/4234). A reference to the original signed record is stronger than a copy.

## Separating GMP and non-GMP work in the R&D lab

This is the core of the ticket, because the first lab mixes both.

### What the sources say

- **Part 11 covers records that a regulation requires, and records submitted to FDA.** Part 11 applies to records "under any records requirements set forth in agency regulations", and also "to electronic records submitted to the agency … even if such records are not specifically identified in agency regulations" [[21 CFR 11.1(b)]](https://www.ecfr.gov/api/versioner/v1/full/2026-09-01/title-21.xml?part=11&section=11.1). So R&D data that ends up in a filing (for example, development data inside a method-validation package) becomes Part 11 data.
- **Once data is generated for GMP, it is a GMP record.** FDA Q12: "When generated to satisfy a CGMP requirement, all data become a CGMP record." Footnote 14 adds that FDA "routinely requests and reviews records not intended to satisfy a CGMP requirement but which nonetheless contain CGMP information" [[FDA DI Q&A]](https://www.fda.gov/media/119267/download). Labelling something non-GMP does not keep inspectors from reading it.
- **Informal runs are a known way to hide testing into compliance.** FDA Q13: it is "a violative practice to use an actual sample in test, prep, or equilibration runs as a means of disguising testing into compliance". "All data—including obvious errors and failing, passing, and suspect data—must be in the CGMP records" [[FDA DI Q&A]](https://www.fda.gov/media/119267/download). A lab that runs both kinds of work must stop a GMP sample from quietly being run as "R&D".
- **"R&D" does not mean non-GMP.** Phase 1 investigational drugs are exempt from Part 211 but still subject to the statutory CGMP requirement. The exemption ends once the drug is used in Phase 2 or 3 [[21 CFR 210.2(c)]](https://www.ecfr.gov/api/versioner/v1/full/2026-09-01/title-21.xml?part=210&section=210.2). A firm that "engages in only some operations" subject to CGMP must comply only for those operations (210.2(b), same source). That is the legal basis for classifying each piece of work separately.
- **Annex 11 covers systems "used in GMP activities".** The draft applies "to all types of computerised systems used in the manufacturing of medicinal products" and its rules are written for systems "used in GMP activities" [[Annex 11 draft §1–2]](https://health.ec.europa.eu/document/download/40231f18-e564-4043-94de-c031f813d38b_en?filename=mp_vol4_chap4_annex11_consultation_guideline_en.pdf). A LIMS that holds any GMP data is such a system, and the validated scope applies to the whole system, not to individual records. Design judgment: one system with one validated state, not a "GMP mode" that can be switched off.
- **Controls may be scaled to risk, but the scaling must be written down.** PIC/S: "Not all data or processing steps have the same importance", so controls should be "risk proportionate". "Whereas data integrity requirements relate to all GMP/GDP data", prioritisation "should be documented in accordance with quality risk management principles" [[PIC/S PI 041-1 §5.3.4, §5.5.1]](https://picscheme.org/docview/4234).
- **Development data can feed validation.** "Suitable data derived from development studies (see ICH Q14) can be used as part of validation data" [[ICH Q2(R2) §2]](https://database.ich.org/sites/default/files/ICH_Q2(R2)_Guideline_2023_1130.pdf). ICH Q14 treats "prior knowledge", including "internal knowledge from a company's proprietary development", as input to procedure development and lifecycle [[ICH Q14 §4.1]](https://database.ich.org/sites/default/files/ICH_Q14_Guideline_2023_1116.pdf).
- **Accreditation does not cover everything a lab does.** A lab may report results outside its scope only with a clear disclaimer, and nothing may imply accreditation where there is none [[ILAC P8 §7]](https://ilac.org/?ddownload=125463). ANAB applies this through PR 1018 [[ANAB AR 2250 §8]](https://anab.qualtraxcloud.com/ShowDocument.aspx?ID=8160). No fetched ANAB or ILAC document forbids mixing non-accredited R&D work and accredited testing in one lab.

### Recommendation

1. **Store three separate facts on each Test.**
   - `gxp_class`: `gmp` or `non_gmp`. It defaults from the Submission and is set at request review (ISO 7.1).
   - `in_accredited_scope`: worked out from the lab's scope items. It is not typed in.
   - `lab_id`.

   Draft Annex 11 §11.10's rule that people "involved in GMP activities do not have administrative privileges" also applies per person in a mixed lab [[Annex 11 draft]](https://health.ec.europa.eu/document/download/40231f18-e564-4043-94de-c031f813d38b_en?filename=mp_vol4_chap4_annex11_consultation_guideline_en.pdf).
2. **Default to GMP. Classification can be raised later but never lowered.** A Test becomes `non_gmp` only through an explicit, signed choice at acceptance, with a reason. Once any result exists, `gmp` can never become `non_gmp`. This closes the FDA Q13 loophole. Design judgment, grounded in Q12–Q13.
3. **Identical data-integrity controls for both classes.** Append-only audit trail, recorded author, e-signatures, raw files kept, invalidated data kept. That makes non-GMP data usable later as development data (Q2(R2)). It also matches FDA footnote 14. And it means there is only one code path to build and validate.
4. **Workflow gates depend on the class.** For `non_gmp` (design judgment; a documented risk assessment covers it under PIC/S §5.5.1):
   - QA release is not required;
   - second-person review can be optional, set per lab;
   - equipment and standards not qualified for GMP use may be used;
   - the report or ELN export is stamped "Non-GMP: not for release or regulatory use" and carries no accreditation claim.

   For `gmp`: every gate from #2 and #3 applies (trained and authorised Analyst, equipment in service, batch QC passing, QA release).
5. **Mark equipment, standards and methods as GMP-qualified or not.** A `gmp` Test may only cite equipment that is in service and qualified, a method adopted and verified in that lab, and standard lots within their validity period. Instruments used only for R&D stay usable for `non_gmp` work. Design judgment on top of 21 CFR 211.160(b) and ISO 6.4 (see #3).
6. **Reuse data by pointing to it. Never relabel it.** When method development in the R&D lab (`non_gmp`) feeds validation, the flow is:
   1. QA approves a validation protocol, a `gmp` record. Under 21 CFR 211.160(a), test procedures are "reviewed and approved by the quality control unit" [[21 CFR 211.160]](https://www.ecfr.gov/api/versioner/v1/full/2026-09-01/title-21.xml?part=211&section=211.160).
   2. The validation runs as `gmp` Tests.
   3. The validation report may cite specific non-GMP development records, with a justification, under Q2(R2) §2.
   4. The cited records stay `non_gmp`. The citation itself is signed and audit-trailed.
7. **Method transfer to a QC lab is a record with a lifecycle.** EU GMP 6.37–6.40 [[EU GMP Ch. 6]](https://health.ec.europa.eu/document/download/c74c8720-27bf-4252-808f-d65a206a90bb_en?filename=2014-11_vol4_chapter_6.pdf) requires:
   - a gap analysis against the original validation;
   - a detailed protocol: tests, training needs, standards and samples, transport and storage, acceptance criteria;
   - deviations investigated before the transfer closes;
   - a report of the comparative outcome.

   ICH Q2(R2) and Q14 accept "partial or full revalidation … and/or comparative analysis of representative samples", or a justification for skipping transfer experiments [[Q2(R2)]](https://database.ich.org/sites/default/files/ICH_Q2(R2)_Guideline_2023_1130.pdf), [[Q14 Table 2]](https://database.ich.org/sites/default/files/ICH_Q14_Guideline_2023_1116.pdf).

   In the LIMS, closing the transfer sets the QC lab's method adoption to `verified`. The Lab Manager can then ask for the method to be added to that lab's accreditation scope, which ANAB adds after its own review ("Scope Modification") [[ANAB MA 2100]](https://anab.qualtraxcloud.com/ShowDocument.aspx?ID=8152).

   For the R&D-only demo, only the data model is needed. The transfer screens can wait until the first QC lab joins.

### Does each lab's accreditation scope have to stay separate?

ANAB decides whether the labs share one accreditation or hold one each, after checking whether "key activities are performed as part of a single management system" [[ANAB MA 2100]](https://anab.qualtraxcloud.com/ShowDocument.aspx?ID=8152). The detailed rules are in ANAB PR 2307 (Multiple Location Accreditation). **PR 2307 could not be fetched** (ANAB's resource pages returned 403), so its details are not stated here. ILAC G18 (scope formulation) was fetched but its text could not be extracted.

What the data model must hold either way:

- scope items keyed per lab;
- an accreditation record that one or several labs point to;
- the report logic that follows from these (accreditation symbol, disclaimers).

## Per-lab configuration

Everything below is a lab setting or a lab-owned master record, never a constant in code. The R&D lab is the first row. Adding a QC lab means creating its lab row, rooms, equipment, adoptions, memberships and scope. No code changes.

| Setting | Why per lab |
|---|---|
| Name, address, legal entity, time zone | Report fields 7.8.2.1 (b) and (c). Time zone on audit entries (see #9). ILAC P8 5.3 legal-entity rule for the accreditation symbol. |
| Number prefixes (e.g. `RD-2026-000123`, `QC1-…`) | Sample and report numbers are unique across the company *and* show the lab at a glance. Design judgment. This also removes #9's covert-channel concern. |
| Rooms and their environmental limits; equipment and check schedules (daily balance, quarterly pipette, freezers) | Physical. The five rooms and five balances on the map are the R&D lab's. |
| Method adoptions and scope items | See above. |
| Report/CoA template: company base + lab header, accreditation text and disclaimer rules | 7.8.2.1, ILAC P8 §7. |
| Retention periods (floor from company policy, per record type) | See #9. The ANAB floor of 4 years applies to accredited labs (see #3). |
| Workflow switches for `non_gmp` work (second review required?) | Only meaningful in labs that accept non-GMP work. QC labs would set "GMP only". Design judgment. |
| Which company SOPs apply | A company document lists the labs it applies to. The lab cannot edit it. |

## Identity: one login, a role in each lab

The #9 model (person → membership → roles) applies directly. Additions for one company:

- **One login and one second factor per person, a current lab per session.** The session holds `current_lab_id`. Every write and every signature records the lab and the role held there (draft Annex 11 §12.2, above). Switching lab is an explicit action and is audit-trailed. With one membership (the R&D demo), the switcher never appears. Design judgment.
- **Company-level roles.** Company QA approves company documents and can read every lab for oversight and cross-site investigations (PIC/S corporate scope, above). The system administrator stays independent of GMP work (draft Annex 11 §11.10; FDA Q4, see #9). In one company, "platform operator" from #9 becomes company IT.
- **Training and authorisation.** Training Records against company SOP versions belong to the person and hold in every lab. Method authorisations (ISO 6.2.6) belong to the membership (see the table).
- **Customer portal users** are company-level people with access per Customer organization. They see their Submissions in every lab, and each report is issued by its own lab.
- **Stack.** Fastify warns against reference-type request decorators because "any mutation will impact all requests". It recommends setting a fresh value per request "in the 'onRequest' hook" [[Fastify Decorators]](https://fastify.dev/docs/latest/Reference/Decorators/). The `ActorContext {person, currentLab, memberships}` should be built there, then passed explicitly into the lab-scoped data seam (see #9 and the stack research).

## PostgreSQL facts behind "company row vs lab row"

- **Don't make `lab_id` nullable to mean "company".** "Normally, a referencing row need not satisfy the foreign key constraint if any of its referencing columns are null", unless `MATCH FULL` is used or the columns are `NOT NULL`. By default, unique constraints treat nulls as distinct, unless `NULLS NOT DISTINCT` is declared [[PG 18 Constraints]](https://www.postgresql.org/docs/current/ddl-constraints.html). A nullable `lab_id` would quietly weaken both the composite foreign keys and the per-lab unique keys from #9. Design judgment: company-level records live in their own tables with no `lab_id`, and lab-owned tables keep `lab_id NOT NULL`. For the one mixed case (controlled documents), use an explicit `owner_scope` (`company` | `lab`), a CHECK that makes `lab_id` required exactly when the scope is `lab`, and `UNIQUE NULLS NOT DISTINCT` on the document number.
- **Composite foreign keys need a matching unique constraint:** "A foreign key must reference columns that either are a primary key or form a unique constraint" (same source). Every lab-owned parent table needs `UNIQUE (lab_id, id)`.
- The RLS facts in #9 still hold if row-level security is ever turned on. Within one company, a lab policy would be `lab_id = ANY(the actor's labs)` for reads and `= current lab` for writes, rather than a hard tenant wall.

## The #9 recommendations, revised

**Must do now** means it is in the R&D-lab walking skeleton, because adding it after Part 11 records exist means migrating those records. **Can wait** means it can be added when the first QC lab joins, without touching existing rows.

| # | Recommendation | Status | Change from #9 |
|---|---|---|---|
| 1 | `lab` table (R&D lab = row 1), `lab_id NOT NULL` on every lab-owned table, and a written classification of each table | **Must do now** | Adds a third class: company-level tables (documents, people, Customers, method records, material catalogue, Submissions). |
| 2 | Per-lab business keys; composite FKs `(lab_id, id)` | **Must do now** | Numbers carry a lab prefix, so they are unique company-wide too. |
| 3 | One data seam that requires a context | **Must do now** | Becomes `ActorContext` (person, current lab, lab memberships, company roles). Built in Fastify `onRequest`. |
| 3b | Turn on RLS policies | **Can wait** | One company: the app seam plus a non-owner database role is enough for the demo. |
| 4 | Audit entries carry lab, person and role in that lab; hash chains per scope | **Must do now** | Adds a **company** chain for company-owned records. A transfer writes to both labs' chains. |
| 5 | Person / membership split | **Must do now** | Unchanged. Training on company SOPs goes on the person, method authorisation on the membership. |
| 6 | Two admin tiers | **Must do now** | The platform operator becomes company IT. Adds company QA with cross-lab read access. |
| 7 | Vault key prefixes | **Must do now** | `company/…` and `labs/{lab_id}/…`. |
| 8 | Per-lab settings instead of constants | **Must do now** | The list above (time zone, prefixes, report header, retention, non-GMP switches). |
| 9 | Export of one lab | **Can wait** | No exit strategy between companies is needed. Keep filtering the audit trail and records by lab, which a per-location assessor needs. |
| 10 | Reproducible deployment | **Can wait** (stays with #14) | Only one deployment is needed. |
| — | Tenant routing, schema or database per lab, per-lab encryption keys, federation | **Dropped** | Serving other companies is out of scope. |
| N1 | `gxp_class` on Submission and Test: default GMP, can be raised, never lowered after results exist | **Must do now** | New. The first lab mixes GMP and non-GMP work. |
| N2 | `in_accredited_scope` derived from per-lab scope items; report disclaimer logic | **Must do now** | New (ILAC P8 §7). |
| N3 | Company method record + per-lab method adoption; GMP Tests require an adopted, verified method | **Must do now** (model) / can wait (transfer screens) | New (EU GMP 6.15, 6.37–6.40). |
| N4 | `lab_id` never changes; transfers are dispatch + receipt + company transfer record | **Must do now** (rule) / can wait (screens) | New. |
| N5 | Test has its own `lab_id`, separate from the company Submission | **Must do now** | New. Splitting a Submission is then configuration. |
| N6 | Deviation links across labs | **Can wait** | New. A link table added later touches no existing rows. |

Tickets affected: [#18](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/18) (document vault) needs company-owned documents with per-lab applicability. [#14](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/14) (stack/hosting ADR) should record N1–N5 and rows 1–8. `CONTEXT.md` will need glossary entries for **Lab**, **GxP class**, **Method adoption** and **Transfer**.

## Open questions for the owner

1. **One ANAB accreditation for several locations, or one per lab?** This decides whether the quality manual is company-owned. It also decides whether a sister lab's results on a report count as "externally provided" (ISO 7.1.1, 7.8.2.1 p). The answer comes from ANAB under PR 2307, which this research could not fetch. Until then, the data model supports both.
2. **What non-GMP work does the R&D lab do?** Early method development only, or also testing of Phase 1 clinical material? Phase 1 material is still under statutory CGMP (21 CFR 210.2(c)). The proposed default is that everything is GMP unless explicitly classified non-GMP at acceptance.
3. **Should non-GMP results need a second-person review?** Proposal: a per-lab switch, on by default in the R&D lab.
4. **Are all four labs one legal entity?** ILAC P8 5.3 ties the accreditation symbol to the legal entity holding the accreditation. ANAB also covers "a family of companies with separate legal entities" [[ANAB MA 2100]](https://anab.qualtraxcloud.com/ShowDocument.aspx?ID=8152).
5. **How much can the labs see of each other?** Proposal: company QA reads every lab. Other staff see only labs where they hold a membership. R&D confidentiality may need more than this.
6. **Are all labs in one time zone?** The design stores UTC plus the lab's zone either way (#9). This only affects defaults.

## Sources

All fetched 2026-09-29.

- FDA: [21 CFR 11.1](https://www.ecfr.gov/api/versioner/v1/full/2026-09-01/title-21.xml?part=11&section=11.1); [21 CFR 210.2](https://www.ecfr.gov/api/versioner/v1/full/2026-09-01/title-21.xml?part=210&section=210.2); [21 CFR 211.160](https://www.ecfr.gov/api/versioner/v1/full/2026-09-01/title-21.xml?part=211&section=211.160); [21 CFR 211.194](https://www.ecfr.gov/api/versioner/v1/full/2026-09-01/title-21.xml?part=211&section=211.194) (eCFR versioner API, 2026-09-01 edition); [Data Integrity and Compliance With Drug CGMP Q&A (Dec 2018)](https://www.fda.gov/media/119267/download), Q12 with footnote 14, Q13
- EudraLex Vol. 4: [Chapter 6 Quality Control (2014)](https://health.ec.europa.eu/document/download/c74c8720-27bf-4252-808f-d65a206a90bb_en?filename=2014-11_vol4_chapter_6.pdf), §6.15, §6.37–6.41; [Annex 11 draft for consultation (July 2025)](https://health.ec.europa.eu/document/download/40231f18-e564-4043-94de-c031f813d38b_en?filename=mp_vol4_chap4_annex11_consultation_guideline_en.pdf), §1, §2, §10.2–10.3, §11.10, §12.2
- PIC/S: [PI 041-1 Good Practices for Data Management and Integrity (July 2021)](https://picscheme.org/docview/4234), §4, §5.3.4, §5.5.1, §7.7, §7.8.4–7.8.5, §12 note 13
- ICH: [Q2(R2) Validation of Analytical Procedures (2023)](https://database.ich.org/sites/default/files/ICH_Q2(R2)_Guideline_2023_1130.pdf), §2 and transfer; [Q14 Analytical Procedure Development (2023)](https://database.ich.org/sites/default/files/ICH_Q14_Guideline_2023_1116.pdf), §4.1, Table 2
- ANAB: [MA 2100 Accreditation Manual (effective 2026-09-01)](https://anab.qualtraxcloud.com/ShowDocument.aspx?ID=8152), Organizational Structure, Proposed Scope Development, Scope Modification; [AR 2250 ISO/IEC 17025 Testing (effective 2026-03-06)](https://anab.qualtraxcloud.com/ShowDocument.aspx?ID=8160), Scopes and §8
- ILAC: [P8:11/2023 Use of Accreditation Symbols](https://ilac.org/?ddownload=125463), §5.3, §7
- PostgreSQL 18: [Constraints](https://www.postgresql.org/docs/current/ddl-constraints.html)
- Fastify v5.12: [Decorators](https://fastify.dev/docs/latest/Reference/Decorators/)
- Not retrieved: ANAB PR 2307 (Multiple Location Accreditation) and the ANAB 17025 resource index (HTTP 403); ILAC G18:2010 (the PDF was fetched but its text could not be extracted); ISO/IEC 17025 itself (paywalled, see #3).
