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

**Product**:
A Customer's API or drug, identified by the Customer's product code. The same API from two manufacturers is two Products.
_Avoid_: Material, compound, item

**Specification**:
The set of limits for a Product that Reportable Results are judged against.
_Avoid_: Spec limit, acceptance criteria (for products)

**Lot**:
One manufactured quantity of a Product, identified by the manufacturer's lot number.
_Avoid_: Batch

**Sample**:
The smallest identified portion of material that gets its own results. Material with a different storage history is a different Sample, so one Lot pulled at a stability time point in two pack sizes is two Samples.
_Avoid_: Specimen, item

**Container**:
A physical bottle or vial received for a Sample; used for custody and storage, never for results.
_Avoid_: Vial (for received material), unit

**Method**:
A controlled, versioned analytical procedure, owned by the company and kept in the document vault.
_Avoid_: Procedure, assay, analysis

**Method Adoption**:
A Lab's record of its status on one Method (in development, validated here, transferred in, verified, retired).
_Avoid_: Method status, qualification

**Test**:
One Method requested on one Sample; the unit of work assigned to an Analyst in one Lab.
_Avoid_: Analysis, assay, job

**GxP Class**:
Whether a Test is GMP or non-GMP. Every Test is GMP unless marked non-GMP at acceptance with a signed reason. Once results exist it can be raised to GMP, never lowered. Non-GMP covers only method development, feasibility, and Customer-labelled research or screening samples. Validation, verification, transfer and Phase 1 material are always GMP.
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
A new Test on the same Sample after the original Test is invalidated; the original is kept and linked, never deleted.
_Avoid_: Repeat test, reanalysis

**Resample**:
A new Sample from the Customer to replace one that cannot be tested.
_Avoid_: Resubmission

**Transfer**:
Moving a Sample, equipment or stock from one Lab to another, recorded as a dispatch in one Lab and a receipt in the other; identifiers never change.
_Avoid_: Move, relocation

**Test Report**:
The signed document a Lab issues to a Customer with Reportable Results. It may be titled "Certificate of Analysis" when printed, but is never called a CoA in the system.
_Avoid_: CoA, certificate, report

### Inventory

**CoA**:
A supplier's Certificate of Analysis for one lot of a standard or reagent.
_Avoid_: Certificate (alone)

**SDS**:
A supplier's Safety Data Sheet for a material, kept at its current version.
_Avoid_: MSDS

### Quality

**Deviation**:
A record that something departed from its acceptance criteria or procedure (an out-of-range reading, a failed check, an out-of-specification result) and must be investigated and closed. It is this project's name for ISO/IEC 17025 nonconforming work.
_Avoid_: Incident, nonconformance, NCR

**Training Record**:
Evidence that a person is qualified on a specific method or SOP version, required before they can be assigned tests under it.
_Avoid_: Qualification, certificate

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
QA's grant allowing a person to sign with a given Signature Meaning. It is separate from a Training Record: being trained is not being authorised.
_Avoid_: Permission, access right, qualification

**Return**:
Sending a record back, with a reason, to the person who signed it Performed, instead of signing it. It is recorded but not signed.
_Avoid_: Reject (in review), send back

**Critical Data Change**:
A change, after its first save, to a result value, weight, dilution volume, standard concentration, maximum daily dose, acceptable intake, or the instrument a Run used. It stays a proposal until a second person approves it.
_Avoid_: Correction, amendment

**Amended Report**:
A new version of a released Test Report that corrects it, linked to a Deviation and stating what changed. The original stays on record.
_Avoid_: Revised report, reissue

**Record Type Register**:
The QA-approved list of record types, stating for each whether it is a Part 11 record, whether it needs a legally binding signature, whether it is raw data, whether its primary form is electronic or paper, its retention class and its data-integrity owner.
_Avoid_: Record catalogue
