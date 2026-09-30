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
