# Nitrosamine Testing Laboratory

The company's R&D laboratory, which tests mainly APIs for nitrosamine impurities by LC-MS/MS and does both GMP and non-GMP work, under ISO/IEC 17025, 21 CFR Part 11 and EU GMP Annex 11. The company's QC labs will share this language when they join. This glossary covers the LIMS, equipment logbooks, inventory, document vault, and ELN.

## Language

### Organization

**Lab**:
One of the company's testing laboratories. Tests, equipment, stock and reports belong to exactly one Lab; methods, controlled company documents, people and Customers belong to the company.
_Avoid_: Site, tenant, location

### People and parties

**Customer**:
An internal department or external organization that submits samples for testing. Its people may log in to the portal, where they see only that Customer's work. A department that needs its work kept apart from the rest of its organization is its own Customer.
_Avoid_: Client, requester

**Customer Contact**:
A named person at a Customer through whom the Lab deals with it, listed with a callback number in its Quality Agreement or internal nomination: only a Customer Contact's written request opens or changes a portal account for that Customer's people. The Lab may also disable one on its own.
_Avoid_: Customer admin, account owner, sponsor

**Customer User**:
A person with a portal account for a Customer, acting for one Customer at a time: submits, tracks, downloads Test Reports and sends messages. A member of staff may also be a Customer User, under the same account.
_Avoid_: Portal user, requester, client user

**Customer Approver**:
A Customer User named to decide for the Customer in the portal (in its Quality Agreement, or for an internal department by its head): accepting Specifications and Planned Deviations, answering Holds, and supplying Phase II plans and Protocol approvals. Their accept is audited but is never an Electronic Signature. Nobody takes a Customer decision on a record where they took a Lab decision, or the reverse.
_Avoid_: Approver (alone, which suggests QA), signatory, authoriser

**Quality Agreement**:
The written agreement between the company and an external Customer covering GMP testing: audit access to source data, notice of data-integrity failures, record retention and what happens at contract end, its Customer Approvers, and the duty to report leavers. It is current from its effective date until its review date passes or a newer version supersedes it, and the Lab accepts no GMP Test from an external Customer without a current one.
_Avoid_: Contract, technical agreement, QAG

**Sample Custodian**:
The lab role that accepts or rejects submissions and physically receives samples.
_Avoid_: Receiver, sample clerk

**Analyst**:
The lab role that performs assigned tests and records results.
_Avoid_: Tester, chemist

**Reviewer**:
The second person who checks an Analyst's results and records before they count.
_Avoid_: Checker, verifier

**QA**:
The quality role that authorizes documents and releases reports.
_Avoid_: Approver, quality

**Lab Manager**:
The role that assigns tests to Analysts and oversees the workload.
_Avoid_: Supervisor

**Admin**:
The role that manages user accounts, roles and configuration inside the system, and unlocks accounts. An Admin never also holds a business role.
_Avoid_: Administrator, superuser, IT

**Platform Operator**:
Whoever runs the server and database outside the system. Independent of the Lab, holds no business role, and has no access to records through the system.
_Avoid_: Admin, host, IT

**Membership**:
A person's role in one Lab, granted by the Admin with a reason. A person holds a role only in a Lab where they have a Membership for it, and someone holding Admin or Platform Operator in any Lab holds no business role in any Lab.
_Avoid_: Permission, group, access

**Printed name**:
The name a person's Signatures and records show. The Admin may change it with a reason; each Signature keeps the printed name as signed. Unlike the username, which never changes.
_Avoid_: Full name, signing name

**One-time link**:
The link through which a person sets their own password, so that the Admin never sees or sets it. It works once and expires; the LIMS keeps only a hash of it.
_Avoid_: Invitation, reset email, activation code

### Sample chain

**Submission**:
One request from a Customer to the company, listing the Samples sent and the Tests wanted on each. It is numbered company-wide when submitted, such as `SUB-2026-000045`.
_Avoid_: Order, request, job

**Acceptance**:
The Sample Custodian's review of each requested Test before testing starts: that the Lab can do it for this Product, that the Method suits the request, and that any Specification it will be judged against is agreed. It accepts or rejects that Test with a reason the Customer sees. A Submission is accepted if any of its Tests is.
_Avoid_: Contract review, approval, intake

**Change Request**:
A Customer's request to change a Submission after it is Submitted, which sends each Test it affects back to Acceptance. A Test that already has a Preparation is never changed; the Customer gets a new Test instead.
_Avoid_: Amendment, revision, edit request

**Price List**:
A Lab's list of what it offers Customers: for each Method and service level (Standard or Expedited), a price and a turnaround target in business days. A Customer may have its own contract price for an entry. The price and turnaround in force are copied onto a Test when it is accepted.
_Avoid_: Catalogue, rate card, quote

**Product**:
A Customer's API or drug product, identified by the Customer's product code, its manufacturer and its synthesis route or process, and for a drug product its dosage form and composition. Its API is named as a Substance. The same API from two manufacturers is two Products. A change of route or formulation, which the Customer must declare, makes a new version of the Product.
_Avoid_: Material, compound, item

**Specification**:
The set of limits for a Product that Reportable Results are judged against. A Product may have several, each with a purpose such as release or shelf-life; stability results are judged against the shelf-life one their Protocol names. It has one Specification Section per Jurisdiction. The Lab builds each from a Specification Request; a Submission may use it only once QA has approved it and the Customer has accepted that version, Decision Rule included. Any change after QA approval makes a new version, which the Customer must accept again.
_Avoid_: Spec limit, acceptance criteria (for products)

**Jurisdiction**:
A regulator whose nitrosamine limits and rules a Specification applies: FDA, EMA, NMPA or MHLW.
_Avoid_: Region, market, authority

**Specification Section**:
The part of a Specification for one Jurisdiction: its Specification Lines, its maximum daily dose, its rule for multiple nitrosamines and its own verdict. A Test conforms only if every Section passes.
_Avoid_: Sub-specification, regional spec

**Specification Line**:
One analyte's limit within a Specification Section. The limit is derived from an Acceptable Intake, a fixed concentration, a limit test at a stated concentration, or report only (no limit). A limit derived from an Acceptable Intake is the intake divided by the maximum daily dose, rounded half up to two significant figures; a tighter limit is a fixed-concentration line, no higher than the derived value and written to at least its decimals. It is kept as written, with its decimal places, together with a reporting threshold.
_Avoid_: Spec limit, criterion

**Acceptable Intake**:
The daily intake of one nitrosamine, in ng/day, that a Jurisdiction accepts. It records its basis (compound-specific, surrogate, CPCA category, interim with an end date, FDA default, or Customer-justified) and its source.
_Avoid_: AI limit, TTC

**Acceptable Intake Table**:
The company's QA-verified list of the Acceptable Intakes one Jurisdiction publishes, each row citing its source document, revision and effective date. A Specification copies only Verified rows. A newer row supersedes an older one; it never rewrites it.
_Avoid_: AI list, limits database

**Jurisdiction Rule Set**:
The versioned rules that a Jurisdiction's Specification Sections follow: rounding, the share-of-limit triggers, the allowed rules for multiple nitrosamines, how values below the LOQ enter a sum, CPCA category values and less-than-lifetime factors. Each version is signed Verified by a second QA person. A Specification pins the version in force when QA approves it.
_Avoid_: Regional settings, jurisdiction config

**Decision Rule**:
The agreed way a Reportable Result is judged against a limit: simple or guarded acceptance. It records its risk basis, the words printed for each outcome, and what a conditional outcome means. The Customer accepts it as part of the Specification.
_Avoid_: Acceptance criteria, pass/fail rule

**First Detection**:
The first released GMP result at or above the LOQ for one analyte in one Product under an EMA or MHLW Specification Section, across all Labs. A valid Preparation's Result at or above the LOQ counts, even when the Reportable Result prints "< LOQ". The Customer is told. If that result is later invalidated, the record is marked superseded, never removed.
_Avoid_: First positive, new finding

**Specification Request**:
What a Customer sends so the Lab can build a Specification: its Jurisdictions, maximum daily dose, treatment duration, purpose, basis, any pharmacopoeial conformance claim with its official edition, the nitrosamines of concern, and the Customer's own specification document. Its values count as Customer-supplied.
_Avoid_: Spec sheet, limit request

**Lot**:
One manufactured quantity of a Product, identified by the manufacturer's lot number.
_Avoid_: Batch

**Sample**:
The smallest identified portion of material that gets its own results. Material with a different storage history is a different Sample, so one Lot pulled at a stability time point in two pack sizes is two Samples. Its number carries the Lab's code and the Lab's local year, such as `RD-S-2026-000123`; numbers in a Lab never repeat and never skip.
_Avoid_: Specimen, item

**Container**:
A physical bottle, vial or bag received for a Sample; used for custody and storage, never for results. Stability units are Containers: placed into a Study Condition, then moved into a Pull's Sample. Its number is its Sample's number with a suffix, such as `RD-S-2026-000123-C02`.
_Avoid_: Vial (for received material), unit

**Substance**:
A company catalogue entry for one chemical entity, such as an API, a nitrosamine or an internal standard, fixed by its CAS number and structure, which a second person checks when the entry is created, with its names (native-script ones included) and its kind (API, small nitrosamine, NDSRI or other impurity). Its identity is never edited: a wrong one is corrected by retiring the entry with a reason and creating a new one. Its names and kind change only by a QA-approved revision.
_Avoid_: Compound, chemical, analyte (for the catalogue entry)

**Analyte**:
A Substance that a Method measures. Acceptable Intakes, Specification Lines, Results and First Detections all name their Analyte as a Substance.
_Avoid_: Target, parameter, component

**Method**:
A controlled, versioned analytical procedure, owned by the company and kept in the document vault. Each version fixes its Analytes, calculation, Preparations and injections, variability limit, Run Checks, Solution Recipes, how long a Preparation stays usable, the Equipment performance and Material grades it needs, and its basis: compendial, alternative or in-house. A Method is compendial only when its Analytes and Products are covered by the pharmacopoeial text it cites.
_Avoid_: Procedure, assay, analysis

**Method Adoption**:
A Lab's record of its status on one Method version (in development, validated here, transferred in, verified, verified (basic compendial), retired) for a stated scope of Products, with their supplier or route where the impurity profile may differ, and the LOQ, LOD, range and maximum dilution per Analyte and scope entry that a cited Method Report established. When a new Method version is approved, QA records whether each Lab's Adoption carries forward or must be re-verified, re-validated or re-transferred.
_Avoid_: Method status, qualification

**Verified (basic compendial)**:
The Method Adoption status for a basic compendial procedure (loss on drying, residue on ignition, pH) that `<1226>` exempts from a verification study: QA approves a justification for the named Products, backed by one passing Run on a known sample. It is never allowed for a Method with nitrosamine Analytes.
_Avoid_: Verification not required, exempt

**Run Check**:
One Acceptance Criterion a Run must meet before any of its results count, such as S/N at the LOQ-level standard, replicate-injection RSD, resolution, or check-sample recovery. It is set by the Method with its limit and source (the Method, a monograph, or `<621>`), and every Run records its observed value and the verdict the system computes; a failed or unrecorded one blocks the Run's results and opens a Run Check Failure Deviation.
_Avoid_: SST, system suitability test (alone), acceptance check

**Uncertainty Evaluation**:
A Lab's signed estimate of the measurement uncertainty of one Analyte under one Method Adoption, for the matrices and instrument units its evidence covers, citing a Method Report or a fixed set of QC Results, and redone when the Method, an instrument, the range or the matrix changes.
_Avoid_: MU budget, uncertainty (alone, for the record)

**Test**:
One Method requested on one Sample; the unit of work assigned to an Analyst in one Lab.
_Avoid_: Analysis, assay, job

**GxP Class**:
Whether a Test is GMP or non-GMP. Every Test is GMP unless marked non-GMP at acceptance with a signed reason. Once results exist it can be raised to GMP, never lowered. Non-GMP covers only method development, feasibility, and Customer-labelled research or screening samples. Validation, verification, transfer and Phase 1 material are always GMP. Non-GMP work is still audit-trailed, signed and second-checked where data is typed or corrected, and still needs a Reviewed signing before its Test Report issues, but skips QA release, and its Test Reports carry no accreditation mark.
_Avoid_: GMP flag, regulated/unregulated

**Run**:
One instrument sequence, such as one quantitation file, holding Injections for many Tests alongside standards and check samples. It is signed Performed and Reviewed on its own, before any Test that uses it can be (for a Run holding only non-GMP Tests, those Tests' Reviewed signing covers it), and where its Method allows it may use the calibration of an earlier Run on the same instrument.
_Avoid_: Batch, sequence, sample list

**Injection**:
One acquisition from a vial within a Run, identified in the instrument's export by the ID the LIMS put in the Run's sample list. Every Injection in an imported Run is either matched to a Preparation, standard, check sample or blank, or excluded with a reason.
_Avoid_: Shot, row, acquisition (alone)

**No peak**:
The explicit entry for an Injection with no integrated peak, picked in place of a number. Nobody types "ND" or "< LOQ"; an Injection that gives a number is entered as printed, with its sign and every digit.
_Avoid_: ND, not detected (as an entry), zero

**Import**:
One upload of an instrument's export (the results file and its printed report) into a Run. The Analyst confirms it or rejects it as a whole with a reason, never edits it, and it is kept either way.
_Avoid_: Upload (alone), file

**Raw-Data Manifest**:
The Analyst's attested list of every file in a Run's raw data on the instrument's data system, with its name, size and SHA-256 hash, and where the raw data is archived. The raw data itself stays in the instrument's data system; the manifest proves later that it is unchanged.
_Avoid_: Raw data (for the manifest), file list

**Integration Declaration**:
The Analyst's statement, made when signing a Run Performed, of each manually integrated Injection and Analyte and each calibration point excluded, with its reason, or that there were none, citing the integration SOP version it follows. The Reviewer checks it against the instrument's own processing history.
_Avoid_: Manual integration flag, integration log

**Run Adjustment**:
A change to a chromatographic condition of a Run's procedure within the allowance its source permits (`<621>` for a compendial Method, the validation's robustness data otherwise), recorded with the original and adjusted values. An already adjusted procedure is never adjusted again.
_Avoid_: Modification, SST adjustment

**Review Checklist**:
The QA-approved, versioned list of what a Reviewer confirms on a Run or a Test. Items the system proves are shown as evidence; the rest are ticked by the Reviewer, and each Reviewed signature keeps the checklist version it used.
_Avoid_: Checklist (alone), review form

**Preparation**:
One weighed and diluted solution made from a Sample for a Test.
_Avoid_: Aliquot, prep, replicate

**Result**:
The value for one analyte from one Preparation.
_Avoid_: Reading, value

**Reportable Result**:
The value for one analyte on one Test that is compared with the Specification and printed on the Test Report: the mean of the Test's Preparations, each the mean of the Injections its Method counts. A Preparation that is below the LOD, negative or No peak never enters the mean across Preparations. Where one Preparation is between the LOD and the LOQ and the other at or above the LOQ, the two must agree within the Method's variability limit, and the Reportable Result is then their mean at full precision, printed as a number if it is at or above the LOQ and as "< LOQ" otherwise, with the Preparation at or above the LOQ printed beside it.
_Avoid_: Final result, reported value

**Reinjection**:
Injecting the same Preparation again, in a new Run, for a reason recorded before it is acquired. The Method sets which original Injections it replaces.
_Avoid_: Rerun

**Reprocessing**:
Integrating or quantifying a Run's existing Injections again in the instrument's software and importing the outcome, which makes a new Record Version of the Run. It never closes an OOS.
_Avoid_: Reintegration, recalculation, reanalysis

**Re-preparation**:
Making a new Preparation from the same Sample within the same Test.
_Avoid_: Reprep, repeat

**Retest**:
A new Test on the same Sample, linked to the original, created after the original is invalidated or under the Customer's OOS investigation plan, in the number that plan or the Method sets in advance. The Customer is told; the original is kept and never averaged with the Retest.
_Avoid_: Repeat test, reanalysis

**Resample**:
A new Sample from the Customer to replace one that cannot be tested.
_Avoid_: Resubmission

**Transfer**:
Moving a Sample, equipment or stock from one Lab to another, recorded as a dispatch in one Lab and a receipt in the other; identifiers never change.
_Avoid_: Move, relocation

**Test Report**:
The signed document a Lab issues to a Customer with Reportable Results. Its printed title is always "Test Report", never "Certificate of Analysis". The Released signature is given on the Record Version holding the content the report prints, and the issued document is made from it once, at release, with that signature printed on it; every later copy is that same document. Once released it changes only through a Deviation: superseded by an Amended Report, or Withdrawn, by a Withdrawal notice, when its results cannot be corrected. Each of those takes its own number and cites the original's. A Test Report is numbered when its Draft is created, such as `RD-R-2026-000045`, and a Draft that never issues keeps its number on record.
_Avoid_: CoA, certificate, report

### Stability

**Protocol**:
A versioned plan for the stability testing of one Product: its Storage Conditions, the ages to test at in each, the Tests and Methods for each age, units per Pull and in reserve, the shelf-life Specification, the Decision Rule and whether conformity statements are wanted, Pull Windows, trend rules and GxP Class. It pins the version of each Storage Condition it uses. Written by the Customer or the Lab, owned by the company, and in force only once the Customer's approval is attached and QA has signed it Approved. It is the accepted request for every Pull made under it. An amendment is a new version, approved the same way, that applies to a Study from a named Time Point onward and never changes Time Points already pulled. It also states whether its data supports a marketing authorisation, which puts its Studies' records, and everything behind their results, under legal hold that only QA can lift.
_Avoid_: Stability plan, study plan, program

**Storage Condition**:
A company reference entry for a storage environment: temperature set-point and tolerance, humidity set-point and tolerance where controlled, its kind (long-term, intermediate, accelerated, refrigerated, frozen, stress) and the guideline it comes from. Each version is approved by QA.
_Avoid_: Condition (alone, which clashes with Fitness Status), climate, zone

**Study**:
One Lot on stability in one Lab under one Protocol version. It is created only when the Lab has adopted every Method the Protocol uses and has a chamber for each Storage Condition, unless QA accepts what is missing. The Studies of several Lots under the same Protocol are seen together through the Protocol, not through a separate record. It is Planned until Placement, then Active, and ends Completed when every Time Point is Reported, Missed or Cancelled and no Pull's Tests are still open, or Cancelled early with its remaining Containers disposed of or returned. It is never paused; Holds apply to its Pulls' Tests and Samples.
_Avoid_: Program, stability batch, variant

**Study Condition**:
One Storage Condition within a Study, holding the Containers placed in it. Its chamber must be In use for placements and run at the same Storage Condition. Moves between chambers in the same Lab are location changes, recorded with their times. A conditional Study Condition, such as intermediate storage, has its Containers placed at T0 but no Time Points until QA signs its activation at the Customer's request.
_Avoid_: Arm, variant, leg

**Placement**:
Putting a Study's Containers into their Study Conditions. The placement date is the Study's **T0**; every due date is T0 plus whole calendar months.
_Avoid_: Loading, set-down, start date

**Time Point**:
One scheduled age of one Study Condition, with its due date and Pull Window. It is Scheduled, then Due while its window is open, then Pulled, then Reported once its Test Report is released; or Missed or Cancelled. It is never deleted: one not pulled by the end of its window becomes Missed, opens a Deviation and stays Missed even if a late Pull follows. The initial Time Point may reuse a released Test the Lab itself made on the same Lot shortly before Placement, if the Protocol allows it and the Test is of the same Method version and at least the Protocol's GxP Class.
_Avoid_: Interval, station, pull point

**Pull Window**:
The days before and after a Time Point's due date within which its Pull is on time, set per Protocol and changed only by amendment, never once the Time Point is Due. A Pull outside it needs a reason and opens a Deviation.
_Avoid_: Grace period, tolerance

**Pull**:
The signed removal of a Time Point's Containers from their chamber. It creates a new Sample (different storage history) with the Protocol's Tests already Accepted, and is stamped with every Excursion whose span overlaps the time its Containers spent in the chamber, including one found afterwards.
_Avoid_: Withdrawal, sampling, time-point pull

**Impact Assessment**:
The QA-approved judgement, on an Excursion's Deviation, of what it means for one Study Condition stored in that chamber during it: none, assess at next Pull, or invalidate, which cancels the Study Condition's remaining Time Points. It also decides, for each overlapping Pull already reported, whether its Test Report is amended.
_Avoid_: Excursion assessment, risk assessment

**OOT Flag**:
A mark on a stability result that breaks one of its Protocol's trend rules (change from initial, step change, first detection, crossing a share of the limit, projected failure). It only flags: the Reviewer acknowledges it and the Lab Manager signs whether to open a Deviation, both before QA review.
_Avoid_: OOT result, trend alert, atypical result

**Study Summary**:
A compilation of one Study's released Test Reports, released by QA: every attribute at every Time Point, charts with limits, and Excursions. It is not a Test Report and carries no accreditation mark; it is superseded when any report it cites is amended. It holds data only: no fitted trend, shelf life or retest period, which are the Customer's to claim.
_Avoid_: Stability report, study report, evaluation

### Equipment

**Equipment**:
A physical item in one Lab with its own identity: instruments, balances, pipettes, pH meters, Karl Fischer titrators, freezers, fridges, stability chambers, the DI water dispenser, and the check weights, thermometers and loggers used to check them. Its Fitness Status is In use only while it is approved into service, has no open Deviation that blocks the use in question, has had no repair, software change, relocation or other event needing re-verification since its last passing verification, and every blocking Check is current. A before-use Check, where its Check Plan needs one, is a further gate at each use.
_Avoid_: Asset, device, instrument (for the general case)

**Room**:
A space in a Lab where Equipment stands and work is done, with its own Checks of environmental conditions. A Room, or a cabinet in it, can also be a storage location.
_Avoid_: Area, location

**Check Plan**:
What must be checked on one piece of Equipment or one Room: the kind of Check, its schedule, its Acceptance Criteria, whether it blocks use, and the controlled document it comes from.
_Avoid_: Schedule, maintenance plan

**Check**:
One performance of a Check Plan (a reading, verification, calibration, maintenance or qualification), with the outcome the system computes against its Acceptance Criteria.
_Avoid_: Test (reserved for work on Samples), inspection, calibration (for the general case)

**Excursion**:
A Room or storage location going outside its limits, shown by a reading or its minimum and maximum since the last reading. It is presumed to have lasted from the last in-limit reading unless attached evidence shows a shorter time.
_Avoid_: Alarm, out-of-range, spike

**Equipment Logbook**:
The chronological record of everything that happened to one piece of Equipment: each use, Check, cleaning, repair, software change, status change, Deviation and Transfer.
_Avoid_: Log, usage log

**Abandoned Check**:
A Check ended with a reason before it was signed Performed. It keeps every value typed into it, still takes a second person's Reviewed signature, and never counts as a pass. A Check holding an Unconfirmed Value or a pending Critical Data Change cannot be Abandoned.
_Avoid_: Cancelled Check, deleted Check, void

### Inventory

**Material**:
A catalogue entry for something the company buys to use in testing, such as a reference standard, reagent, solvent, consumable or column, with its manufacturer and catalogue number, category, storage conditions, in-use period after opening, and current SDS. A Material that any Method marks as critical is checked on receipt like a reference standard. Owned by the company.
_Avoid_: Item, product, chemical

**Material Lot**:
One supplier lot of a Material, with its lot number, CoA and expiry or retest date, and for a reference standard its certified value, uncertainty, purity, producer and traceability class: CRM (from a national metrology institute or an accredited ISO 17034 producer) or RM (characterised in-house before use).
_Avoid_: Batch, lot (alone, which means a Customer's Lot)

**Pack**:
One received package of a Material Lot (a bottle, ampoule, box or single column) with its own label ID, owned by one Lab. It is Unopened, Opened or Finished, and a Finished Pack can never be used again; its remaining amount is not tracked.
_Avoid_: Container (which is for Samples), unit, bottle, stock item

**Solution**:
Anything a Lab makes from Packs or other Solutions (a stock, intermediate, working or internal standard, a mobile phase, a diluent), recording each parent and the amount taken, so every standard traces back to its reference material. Never made from a Sample; that is a Preparation.
_Avoid_: Prep, standard (alone), mix, reagent (for made solutions)

**Solution Recipe**:
A Method version's instruction for making one Solution: its target concentration, its parent Materials or Solutions, and how long it stays stable. GMP work uses only Solutions made from a recipe; only non-GMP work may make ad-hoc Solutions.
_Avoid_: Prep sheet, formula, SOP (for this)

**Supplier**:
A company the Lab buys Materials or calibration services from, approved by QA for a stated scope. The approval lapses when the Supplier's accreditation or its re-evaluation falls due, and nothing is received from a Supplier that is not approved.
_Avoid_: Vendor, provider, manufacturer

**Fitness Status**:
Whether a piece of equipment, a Pack or a Solution may be used now: Quarantined, In use, Suspended, Expired or Retired. Every step that records use checks it the same way. What a status blocks can depend on the step: a storage location in an Excursion refuses new placements but not removals.
_Avoid_: Status (alone), availability, condition

**CoA**:
A supplier's Certificate of Analysis for one lot of a standard or reagent.
_Avoid_: Certificate (alone)

**SDS**:
A supplier's Safety Data Sheet for a material, kept at its current version.
_Avoid_: MSDS

### Quality

**Acceptance Criterion**:
A limit, set by a Check Plan, a Method or a Method Protocol, that a value from a Check, a Run, a validation study or a Training Run must meet, kept exactly as written with its decimals, operator, unit and source, and for a tolerance its reference and whether it is relative or absolute. The value is rounded once, to the limit's written decimals, before it is compared, except that readings, times and counts are compared exactly, and a value the instrument's software already rounded is compared as exported, against a limit written to the same decimals. Specification Lines, plausibility ranges, and gates on whether a measurement counts at all, such as a net weight against the balance's smallest net weight, are not Acceptance Criteria.
_Avoid_: Tolerance (alone), target, spec limit

**Deviation**:
A record that something departed from its acceptance criteria or procedure and must be investigated and closed by QA; this project's name for ISO/IEC 17025 nonconforming work. Its Kind is one of OOS, OOT, Equipment, Room, Excursion, Run Check Failure, Material, Procedure, Data Integrity, Proficiency Testing or Other, and it is Open, Investigating, In QA Review or Closed. Its Kind is fixed once opened, except that QA may reclassify Other. A Deviation raised in error is closed with that finding, never cancelled, and a Closed one never reopens or changes.
_Avoid_: Incident, nonconformance, NCR

**Accreditation Scope**:
The Lab's current scope of accreditation from ANAB, registered from its certificate, listing the Methods, Analytes, matrices and ranges it covers, which entries are flexible, and any suspension, withdrawal or reduction. Whether a result is accredited is read from it, never set by hand, and a released Test Report keeps the scope revision it was judged against.
_Avoid_: ANAB flag, accredited list

**Planned Deviation**:
A Deviation approved by QA and accepted by the Customer before the work, allowing a stated, technically justified departure from a Method on named Tests.
_Avoid_: Waiver, exception, concession

**Risk Level**:
How serious a Deviation is: Minor (no effect on any result), Major (affects Tests in progress) or Critical (could affect released results, or a data-integrity failure). Every OOS is at least Major.
_Avoid_: Severity, priority, classification

**Investigator**:
The person assigned to find a Deviation's impact, root cause and correction; the opener unless the Lab Manager reassigns it.
_Avoid_: Owner (for Deviations), assignee

**Complaint**:
An expression of dissatisfaction from a Customer or other party about the Lab's work, which gets its own acknowledgement, investigation and outcome, and may link to a Deviation.
_Avoid_: Feedback, grievance, Deviation (for complaints)

**CAPA Action**:
One Corrective or Preventive action raised from a Deviation, with one owner, a due date, evidence, and an effectiveness check whose criterion and date are set when the action is raised and which may be signed off after the Deviation closes. An action judged Not Effective needs a new linked action.
_Avoid_: CAPA (alone), action item

**Hold**:
A record that pauses a Test or Sample for a stated reason (a Deviation, a receipt discrepancy, a Customer query, blocked equipment) without changing its state. It blocks named steps until it is released, and several can be open at once.
_Avoid_: On hold (as a status), suspension, quarantine

**System Incident**:
A record that the LIMS itself failed or misbehaved (an unexpected failure answered with a reference the person can quote, an alarm, a missed backup or anchor, a failed restore drill, a clock step), or that someone may be attacking sign-in (a lockout, a burst of failed sign-ins from one address or against one unknown user ID, repeated attempts against a locked account), closed once its immediate and corrective actions are recorded and acknowledged. It becomes a linked Data Integrity Deviation when QA judges it could have affected results or records; a broken or unanchored audit chain, or a clock step during audited writes, always does.
_Avoid_: Alarm (the notice, not the record), outage, Deviation (for LIMS failures)

**Training Record**:
Evidence that a person is trained on one Document version, at the Training Level set for their role: Read and Understood is the person's own Acknowledged signature; Demonstrated adds a passing Training Run. It belongs to the person, never expires by time, and stops being current when a newer version that requires training for their role takes effect.
_Avoid_: Qualification, certificate

**Training Level**:
What QA sets for each Distribution role on an approved Document version: None (existing Training Records carry forward), Read and Understood, or Demonstrated.
_Avoid_: Training required (alone), training type

**Training Run**:
Work a trainee does on a known sample, or a Check done as training, judged against the version's demonstration acceptance criteria, signed Performed by the trainee and Verified by an authorised trainer, to earn a Demonstrated Training Record. It is recorded like any other work but is never reported to a Customer and never counts as a scheduled Check. The validation, verification or transfer work behind a Method Adoption counts as the first Training Runs on that Method version.
_Avoid_: Practice run, supervised test

**Competence Assessment**:
A yearly review of whether a person remains competent in each thing they are authorised for, one line per Authorisation citing evidence such as their own passing Tests, a proficiency testing result, a blind or retained sample, an observed Run, or an audit of their reviews. The Lab Manager signs it Reviewed and QA signs it Approved, never the person assessed. A line without evidence lets its Authorisation lapse; a failed line suspends it and opens a Deviation.
_Avoid_: Requalification, annual review, proficiency check

### Document vault

**Document**:
A controlled document in the vault, owned by the company or by one Lab, with a Document Type and a number such as `RD-SOP-0012`. The number is assigned when the first draft is created and never changes or gets reused; a document brought in from the old system keeps its old number as a Former Number and its old version label. The Document's content lives in its versions, each a Record Version with a whole-number version.
_Avoid_: File, attachment, controlled copy

**Document Owner**:
The person answerable for a Document's content and its Periodic Review; the author of its first version unless QA reassigns it.
_Avoid_: Author (for this), custodian

**Document Type**:
The fixed kind of a Document: Quality Manual, Policy, SOP, Work Instruction, Method, Method Protocol, Method Report, Form, Worksheet or External Document. A Method is a Document whose versions also carry the Method's structured data.
_Avoid_: Category, document class

**Method Protocol**:
A Lab's plan, Effective before the work starts, for validating, verifying or transferring in one Method version: the requirements the Method must meet, such as the lowest limit it must serve, what will be tested, how, and the acceptance criteria. A transfer's Protocol also names the sending unit and the transfer type.
_Avoid_: Protocol (alone, which means a stability Protocol), validation plan

**Method Report**:
A Lab's approved account of validating, verifying or transferring in one Method version, citing the Method Protocol it followed, the Tests and Runs behind it, and any departures, with each result against its criterion and a signed statement that the Method is fit for its intended use. A Method Adoption becomes validated here, verified or transferred in only by citing an Effective Method Report of that purpose, and the purpose must suit the Method's basis: an alternative Method needs validation, and a transfer in must cite a validation.
_Avoid_: Validation report (alone), qualification report

**Document Status**:
Where one version of a Document stands: Draft, In Review, Approved, Effective, Superseded or Retired. A Draft, or an Approved version before its Effective Date, that goes no further is Abandoned. A Draft is signed Authored, then Reviewed by at least one authorised person who is not the author, then Approved by QA, who neither wrote nor reviewed it. Only one version of a Document is Effective at a time.
_Avoid_: Stage, lifecycle state

**Effective Date**:
The date QA sets at approval on which a version replaces the previous one, which then becomes Superseded.
_Avoid_: Release date, issue date

**Distribution**:
The roles and people a Document version applies to. Where a role's Training Level is not None, each person in it is due a Training Record on the version by its Effective Date.
_Avoid_: Audience, recipients

**Periodic Review**:
The scheduled check that an Effective Document is still correct, every 2 years by default, or yearly for the Quality Manual and Policies. It ends in either No Change, which moves the next review date on without a new version, or a new Draft. An overdue review only raises alerts.
_Avoid_: Annual review, re-approval

**External Document**:
A Document the Lab did not write, such as a CoA, an SDS, a standard, a guidance document or a vendor manual, registered with its issuer's identifier and version and the date it was received. A standard, guidance or manual is Approved by QA for use and checked yearly against the issuer's current version. A pharmacopeial text takes effect on its Official Date, not when it is published.
_Avoid_: Reference document, third-party document

**Issued Copy**:
One numbered paper copy of an Effective Form or Worksheet, recorded against who took it and why. Every Issued Copy is reconciled as Returned (scanned and linked to what it records), Voided with a reason and kept, or Missing, and a Missing one opens a Deviation.
_Avoid_: Controlled copy, printout

### ELN

**Notebook**:
A Lab's electronic notebook for one stated purpose, such as one Method's development, the year's Deviation investigations, or one person's general work, with an Owner and a number such as `RD-NB-0007` that is never reused. It is Open until its Owner closes it, and a Closed Notebook takes no new entries except Addenda and never reopens.
_Avoid_: Project, folder, lab book

**Notebook Entry**:
One numbered record in a Notebook, such as `RD-NB-0007-0042`, of work done on its work date: narrative, tables, images and attachments, linking to the Samples, Tests, Runs, Solutions, Equipment and other records it concerns rather than recording their data again. Entry numbers run without gaps; an entry started in error is Voided with a reason, never deleted. Signing it Performed locks it; a witness who is not the author signs it Reviewed.
_Avoid_: Page, experiment, note

**Addendum**:
A Notebook Entry that corrects or adds to a signed one, linked to it and signed on its own. A signed entry is never edited.
_Avoid_: Amendment, correction entry

**Late Entry**:
A record whose work date is earlier than the Lab's current day when it is first saved. It carries a reason and stays flagged, however late. A work date after the Lab's current day is never allowed.
_Avoid_: Backdated entry, retrospective entry

**Development Plan**:
The first Notebook Entry of a method-development Notebook, which states what the development will establish and how; later entries link back to it, and it changes only by Addenda.
_Avoid_: Project plan, development protocol (a Method Protocol is for validation)

**True Copy**:
A scan of a paper record, such as a returned Issued Copy, a legacy logbook page or a supplier CoA, that a second person has signed Verified as complete and legible. The paper original is Retained, with its location, unless QA approves an assessment allowing its destruction.
_Avoid_: Scan (alone), certified copy, electronic copy

### Records and signatures

**Record Version**:
One saved state of a record that can be signed: the record's canonical content, the SHA-256 of that content and the canonical form that rendered it. A change to the record, to a child of it, or to a record it names (for a Test: its Result, Sample, Method or Customer) makes a new Record Version of it and of every record built on it, such as the Test Report on a Test; a save that leaves the content as it was, such as a step forward, makes none. Earlier versions are kept, and a Signature given on one shows as unsigned once a later version exists, even if the content comes back.
_Avoid_: Revision, edit

**Audit Trail**:
The permanent, system-generated history of every change to records, accounts and configuration, and of every Access Event: who (with role and Lab), what (old and new value), when, and why. A normal forward step in a workflow, such as Receive, Performed or Released, records its action name as the reason; a step off that path, such as a Return, rejection, Hold, reassignment, cancellation, Reprocessing or account unlock, and any change to a saved value or setting, takes a reason picked from a list. Every entry carries the transaction ID of the change that wrote it, so entries written together read as one change. Nobody can edit or switch it off.
_Avoid_: Log, history, change log

**Access Event**:
The Audit Trail record of one sign-in (succeeded or failed), sign-out, idle or absolute expiry, lock, unlock (succeeded or failed), lockout, takeover, Lab switch, failed Re-authentication at signing, or credential event (a password changed or reset, an authenticator enrolled or revoked). It never holds a secret. An expiry carries the instant the session ended (its last request plus the idle limit, or its sign-in plus the absolute limit), not the time the LIMS noticed. An attempt against an unknown user ID is recorded too, in a form that lets repeats be recognised but never as the text typed.
_Avoid_: Login log, session log, access log

**Audit Export**:
The Audit Trail of one Customer's Submissions, Samples, Tests and their records, with the shared records they use, which QA generates to answer that Customer's audit. Another Customer's identifiers are redacted wherever they appear. It comes as a searchable data file (JSON or CSV) with a PDF of the same entries, each entry in glossary words beside its raw values. Generating one is itself recorded in the Audit Trail with the hash of each file handed out. Customers never see the Audit Trail any other way.
_Avoid_: Audit report, trail dump, audit log export

**Lab switch**:
Moving a signed-in person's work from one Lab to another in which they hold a Membership. It needs the full re-authentication of a sign-in, nothing is chosen for them, and from then on they see only the new Lab's records. It is an Access Event, and a failed one counts toward the lockout.
_Avoid_: Change Lab, Lab login, context switch

**Workstation**:
A bench PC the Admin has registered with its name, Lab, Room and browser policy (the managed browser settings it runs, as the Admin describes them), and whose browser the Admin has enrolled with a device token. Every session and Access Event from that browser carries it, and a session on it opens in its Lab. A device that is not registered shows as an unregistered device; the portal and desk PCs may be used that way.
_Avoid_: Terminal, client, kiosk

**Commit Key**:
The one-time key a screen chooses for one press of a step and sends again when it retries that press, so the step happens once however often the press reaches the LIMS. A retry from the same session with the same entries gets the first answer back; the key used with other entries or from another session is refused.
_Avoid_: Idempotency key, request ID, nonce

**Reason for Change**:
The cause recorded with every change made after a record is first saved.
_Avoid_: Comment, justification

**Electronic Signature**:
A person's sign-off on one Record Version with one Signature Meaning, given by re-entering their user ID, password and second factor. It shows as unsigned if the record changes afterwards, and can never be withdrawn.
_Avoid_: E-sig, approval, sign-off

**Signature Meaning**:
What an Electronic Signature attests: Performed, Verified, Reviewed, Approved, Released, Authored or Acknowledged.
_Avoid_: Signature type, status

**Signature Statement**:
The QA-approved, versioned sentence a signer attests to on every Electronic Signature, shown on the signature sheet before the credentials. Each Signature records the version it showed and its hash, and a later version comes into force only through a Release Log entry that QA signs Approved.
_Avoid_: Attestation text, legal text, disclaimer

**Re-authentication**:
The signer's proof of identity for one Electronic Signature: the typed user ID, password and second factor, checked again whatever the session already proved. A successful one is a single-use record for that person, session and Signature Meaning, written with the Signature it enables; a failed one is an Access Event that counts toward the lockout.
_Avoid_: Password prompt, confirmation, session reuse

**Authorisation**:
QA's grant allowing a person to sign with a given Signature Meaning within a scope (a Method or record type) in one Lab, valid for 12 months unless renewed through a Competence Assessment. A Method Authorisation covers every version of that Method; each version still needs its own Training Record. QA may suspend one, citing a Deviation, and nobody grants, renews or lifts their own; QA's Approved signature on one rests on a current Appointment. It is separate from a Training Record: being trained is not being authorised. It is one of four separate facts that must all hold before a person can sign, with an Identity Verification, the Acknowledged e-signature policy and LIMS-use training. A Reviewed Authorisation on a Test's Method also lets its holder approve a correction to a result made after Performed and before Released, unless they proposed it or signed Performed.
_Avoid_: Permission, access right, qualification

**Appointment**:
The record that gives a QA person the authority to sign Approved on Authorisations and Competence Assessments in one Lab, from a start date and against a named version of the role requirements. The manager named in the Effective quality manual signs it Approved; for that one signing the naming stands in for an Authorisation. Nobody else may sign it, and never the person appointed or an Admin. It is not an Authorisation: a QA's own Authorisations, such as to sign Released, are granted by another QA.
_Avoid_: Designation, delegation, QA authorisation

**Identity Verification**:
The recorded check of who a person is (which Admin checked, what, and when), made before their first credential is issued and again before a replacement authenticator is enrolled. It is one of the four facts that enable signing.
_Avoid_: ID check, onboarding, vetting

**Return**:
Sending a record back, with a reason, to the person who signed it Performed, instead of signing it. It is recorded but not signed.
_Avoid_: Reject (in review), send back

**Critical Data Change**:
A change, after its first save, to a result value, weight, dilution volume, standard concentration, any field of a Specification, Specification Section or Specification Line (such as its maximum daily dose, Acceptable Intake, limit and its decimal places, reporting threshold, conformance claim or Decision Rule), a Customer-supplied water or LOD value, the instrument a Run used, an Injection's match to a Preparation or standard or its exclusion, a typed Injection's ID or acquisition time, a Run Adjustment's values, a Room, storage or DI water reading, a Check's typed value such as a balance or pipette weighing, a Customer Lot's expiry or retest date, a Material Lot's certified value, purity, salt form, uncertainty or expiry or retest date, any value typed from a calibration certificate (its certified values, corrections, uncertainty and k, calibrated range, as-found and as-left values, or its Supplier's verdict and decision rule), a manually entered Run Check value, any structured field of a Method version, a Method Report's results, a validation impact decision, a Method Adoption's status, scope entries, LOQ, LOD, range, maximum dilution or cited Method Report, any field of an Uncertainty Evaluation or Accreditation Scope, or a Substance's kind. It stays a proposal until a second person approves it. Once a versioned record such as a Method or Specification is approved, a change is a new version instead.
_Avoid_: Correction, amendment

**Unconfirmed Value**:
A typed reading or Check value that is implausible or fails its Acceptance Criterion, saved at its first entry but not yet the value of record. Only the person who typed it confirms it, by typing it again; replacing it is a Critical Data Change. Until it is resolved it blocks use as if it had failed, and if it is still unresolved at the end of the Lab day it becomes the value of record, flagged as not confirmed.
_Avoid_: Draft, pending value, unsaved entry

**Refused Entry**:
A typed value the system refused outright because a gate said the measurement cannot count, such as a net weight below the balance's smallest net weight or a balance that is not In use. It is kept with its reason on the record it was attempted on, but it is never a value of that record.
_Avoid_: Rejected value, invalid entry, error

**Amended Report**:
A new version of a released Test Report that corrects it, linked to a Deviation and stating what changed and why. It takes a new number and prints "Amendment to Report" with the original's number. The original stays on record, marked Superseded.
_Avoid_: Revised report, reissue

**Record Type Register**:
The QA-approved list of record types, stating for each whether it is a Part 11 record, whether it needs a legally binding signature, whether it is raw data, whether its primary form is electronic or paper, its retention class and its data-integrity owner.
_Avoid_: Record catalogue

**Calculation Version**:
One QA-approved version of the system's calculations, including how values are compared with Acceptance Criteria, naming the version of the SOP it implements. Every computed value and verdict records the Calculation Version that produced it, and a later version never changes a recorded verdict in place: a corrected verdict is a new record linked to it.
_Avoid_: Algorithm version, software version, release
