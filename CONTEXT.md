# Nitrosamine Testing Laboratory

The company's R&D laboratory, which tests mainly APIs for nitrosamine impurities by LC-MS/MS and does both GMP and non-GMP work, under ISO/IEC 17025, 21 CFR Part 11 and EU GMP Annex 11. The company's QC labs will share this language when they join. This glossary covers the LIMS, equipment logbooks, inventory, document vault, and ELN.

## Language

### Organization

**Lab**:
One of the company's testing laboratories. Tests, equipment, stock and reports belong to exactly one Lab; methods, controlled company documents, people and Customers belong to the company.
_Avoid_: Site, tenant, location

### People and parties

**Customer**:
An internal department or external organization that submits samples for testing. A Customer may log in to the portal.
_Avoid_: Client, requester

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

### Sample chain

**Submission**:
One request from a Customer to the company, listing the Samples sent and the Tests wanted on each.
_Avoid_: Order, request, job

**Acceptance**:
The Sample Custodian's review of each requested Test before testing starts, which accepts or rejects that Test with a reason. A Submission is accepted if any of its Tests is.
_Avoid_: Contract review, approval, intake

**Product**:
A Customer's API or drug, identified by the Customer's product code. The same API from two manufacturers is two Products.
_Avoid_: Material, compound, item

**Specification**:
The set of limits for a Product that Reportable Results are judged against. A Product may have several, each with a purpose such as release or shelf-life; stability results are judged against the shelf-life one their Protocol names.
_Avoid_: Spec limit, acceptance criteria (for products)

**Lot**:
One manufactured quantity of a Product, identified by the manufacturer's lot number.
_Avoid_: Batch

**Sample**:
The smallest identified portion of material that gets its own results. Material with a different storage history is a different Sample, so one Lot pulled at a stability time point in two pack sizes is two Samples.
_Avoid_: Specimen, item

**Container**:
A physical bottle, vial or bag received for a Sample; used for custody and storage, never for results. Stability units are Containers: placed into a Study Condition, then moved into a Pull's Sample.
_Avoid_: Vial (for received material), unit

**Method**:
A controlled, versioned analytical procedure, owned by the company and kept in the document vault.
_Avoid_: Procedure, assay, analysis

**Method Adoption**:
A Lab's record of its status on one Method version (in development, validated here, transferred in, verified, retired) for a stated scope of Products, with their supplier or route where the impurity profile may differ. When a new Method version is approved, QA records whether each Lab's Adoption carries forward or must be re-verified, re-validated or re-transferred.
_Avoid_: Method status, qualification

**Test**:
One Method requested on one Sample; the unit of work assigned to an Analyst in one Lab.
_Avoid_: Analysis, assay, job

**GxP Class**:
Whether a Test is GMP or non-GMP. Every Test is GMP unless marked non-GMP at acceptance with a signed reason. Once results exist it can be raised to GMP, never lowered. Non-GMP covers only method development, feasibility, and Customer-labelled research or screening samples. Validation, verification, transfer and Phase 1 material are always GMP. Non-GMP work is still audit-trailed, signed and second-checked where data is typed or corrected, but skips the Reviewer and QA release, and its Test Reports carry no accreditation mark.
_Avoid_: GMP flag, regulated/unregulated

**Run**:
One instrument sequence, such as one quantitation file, holding injections for many Tests alongside standards and check samples.
_Avoid_: Batch, sequence, sample list

**Preparation**:
One weighed and diluted solution made from a Sample for a Test.
_Avoid_: Aliquot, prep, replicate

**Result**:
The value for one analyte from one Preparation.
_Avoid_: Reading, value

**Reportable Result**:
The value for one analyte on one Test that is compared with the Specification and printed on the Test Report: the mean of the Test's Preparations, each the mean of its injections.
_Avoid_: Final result, reported value

**Reinjection**:
Injecting the same Preparation again.
_Avoid_: Rerun

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
The signed document a Lab issues to a Customer with Reportable Results. It may be titled "Certificate of Analysis" when printed, but is never called a CoA in the system. Once released it changes only through a Deviation: superseded by an Amended Report, or Withdrawn when its results cannot be corrected.
_Avoid_: CoA, certificate, report

### Stability

**Protocol**:
A versioned plan for the stability testing of one Product: its Storage Conditions, the ages to test at in each, the Tests and Methods for each age, units per Pull and in reserve, the shelf-life Specification, the decision rule and whether conformity statements are wanted, Pull Windows, trend rules and GxP Class. It pins the version of each Storage Condition it uses. Written by the Customer or the Lab, owned by the company, and in force only once the Customer's approval is attached and QA has signed it Approved. It is the accepted request for every Pull made under it. An amendment is a new version, approved the same way, that applies to a Study from a named Time Point onward and never changes Time Points already pulled. It also states whether its data supports a marketing authorisation, which puts its Studies' records, and everything behind their results, under legal hold that only QA can lift.
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
What must be checked on one piece of Equipment or one Room: the kind of Check, its schedule, its acceptance criteria, whether it blocks use, and the controlled document it comes from.
_Avoid_: Schedule, maintenance plan

**Check**:
One performance of a Check Plan (a reading, verification, calibration, maintenance or qualification), with its outcome against the acceptance criteria.
_Avoid_: Test (reserved for work on Samples), inspection, calibration (for the general case)

**Excursion**:
A Room or storage location going outside its limits, shown by a reading or its minimum and maximum since the last reading. It is presumed to have lasted from the last in-limit reading unless attached evidence shows a shorter time.
_Avoid_: Alarm, out-of-range, spike

**Equipment Logbook**:
The chronological record of everything that happened to one piece of Equipment: each use, Check, cleaning, repair, software change, status change, Deviation and Transfer.
_Avoid_: Log, usage log

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

**Deviation**:
A record that something departed from its acceptance criteria or procedure and must be investigated and closed by QA; this project's name for ISO/IEC 17025 nonconforming work. Its Kind is one of OOS, OOT, Equipment, Room, Excursion, Run Check Failure, Material, Procedure, Data Integrity, Proficiency Testing or Other, and it is Open, Investigating, In QA Review or Closed. Its Kind is fixed once opened, except that QA may reclassify Other. A Deviation raised in error is closed with that finding, never cancelled, and a Closed one never reopens or changes.
_Avoid_: Incident, nonconformance, NCR

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
A record that the LIMS itself failed or misbehaved (an alarm, a missed backup or anchor, a failed restore drill, a clock step), closed once its immediate and corrective actions are recorded and acknowledged. It becomes a linked Data Integrity Deviation when QA judges it could have affected results or records; a broken or unanchored audit chain, or a clock step during audited writes, always does.
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
A Lab's plan, Effective before the work starts, for validating, verifying or transferring in one Method version: what will be tested, how, and the acceptance criteria.
_Avoid_: Protocol (alone, which means a stability Protocol), validation plan

**Method Report**:
A Lab's approved account of validating, verifying or transferring in one Method version, citing the Method Protocol it followed, the Tests and Runs behind it, and any departures. A Method Adoption becomes validated here, verified or transferred in only by citing an Effective Method Report of that purpose, and the purpose must suit the Method's basis: an alternative Method needs validation, and a transfer in must cite a validation.
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
One saved state of a record that can be signed. Changing a signable record makes a new Record Version; earlier versions are kept.
_Avoid_: Revision, edit

**Audit Trail**:
The permanent, system-generated history of every change to records, accounts and configuration: who (with role and Lab), what (old and new value), when, and why. Nobody can edit or switch it off.
_Avoid_: Log, history, change log

**Reason for Change**:
The cause recorded with every change made after a record is first saved.
_Avoid_: Comment, justification

**Electronic Signature**:
A person's sign-off on one Record Version with one Signature Meaning, given by re-entering their user ID, password and second factor. It shows as unsigned if the record changes afterwards, and can never be withdrawn.
_Avoid_: E-sig, approval, sign-off

**Signature Meaning**:
What an Electronic Signature attests: Performed, Verified, Reviewed, Approved, Released, Authored or Acknowledged.
_Avoid_: Signature type, status

**Authorisation**:
QA's grant allowing a person to sign with a given Signature Meaning within a scope (a Method or record type) in one Lab, valid for 12 months unless renewed through a Competence Assessment. A Method Authorisation covers every version of that Method; each version still needs its own Training Record. QA may suspend one, citing a Deviation, and nobody grants, renews or lifts their own. It is separate from a Training Record: being trained is not being authorised.
_Avoid_: Permission, access right, qualification

**Return**:
Sending a record back, with a reason, to the person who signed it Performed, instead of signing it. It is recorded but not signed.
_Avoid_: Reject (in review), send back

**Critical Data Change**:
A change, after its first save, to a result value, weight, dilution volume, standard concentration, maximum daily dose, acceptable intake, the instrument a Run used, a Room, storage or DI water reading, or a Material Lot's certified value, purity, salt form, uncertainty or expiry or retest date. It stays a proposal until a second person approves it.
_Avoid_: Correction, amendment

**Amended Report**:
A new version of a released Test Report that corrects it, linked to a Deviation and stating what changed and why. The original stays on record, marked Superseded.
_Avoid_: Revised report, reissue

**Record Type Register**:
The QA-approved list of record types, stating for each whether it is a Part 11 record, whether it needs a legally binding signature, whether it is raw data, whether its primary form is electronic or paper, its retention class and its data-integrity owner.
_Avoid_: Record catalogue
