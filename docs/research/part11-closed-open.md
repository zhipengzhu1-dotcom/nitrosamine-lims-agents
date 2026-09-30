# Part 11: is a vendor-hosted LIMS a closed or an open system?

Researched 2026-09-29. Question: under 21 CFR Part 11, is a LIMS hosted by a vendor (a cloud VPS, or a multi-lab SaaS run by the vendor) a **closed** system (§11.3(b)(4), §11.10) or an **open** system (§11.3(b)(9), §11.30)? In this setup the lab administers every application account (staff and Customer portal). The hosting provider or platform operator controls the infrastructure: OS, database and backups.

## Answer

The regulation and FDA's own preamble settle one point: classification turns only on **who controls access to the system that holds the records**. It does not turn on who owns the hardware. On third-party hosting, FDA's only direct statement is from 1997, and it says **open**. Records "stored on systems operated by third parties, such as commercial online services" are under the third party's access control, and "the agency would regard such a system as being open" (comment 44). The same preamble also says the rule is "silent" on how access may be authorized, "such as existence of a fiduciary responsibility or contractual relationship" (comment 41). That silence is where the industry argument for "closed" comes from: a vendor under contract whose privileged access the lab authorizes and can revoke. FDA has never adopted that argument in writing. The 2003 Scope and Application guidance does not discuss classification at all. The October 2024 clinical-investigations Q&A (Rev. 1) also declines to classify cloud or IT-service-provider systems. Instead it says that, "because of changing technologies and the increased risk of cybersecurity threats, a risk assessment should be conducted for all electronic systems" whatever their label. Its cloud-retention answer cites §11.30 for the duty to protect "authenticity, integrity, and confidentiality". I found no FDA warning letter or compliance-program text that classifies a hosted system either way. So calling this LIMS "closed" is an interpretation the lab would have to defend. Calling it "open" follows the only FDA text that speaks to the facts. The two facts that weigh most toward "open" are that the operator controls the OS and database, and that the operator's staff can reach records without going through the application. The multi-tenant SaaS case is the clearer of the two. The design consequence is the same whichever label wins: build the §11.30 additional measures in from the start.

## What the sources say

### 1. The regulation (21 CFR 11.3, 11.10, 11.30; text unchanged since 1997)

62 FR 13465-13466; the current eCFR text is identical.

- §11.3(b)(4): "*Closed system* means an environment in which system access is controlled by persons who are responsible for the content of electronic records that are on the system."
- §11.3(b)(9): "*Open system* means an environment in which system access is not controlled by persons who are responsible for the content of electronic records that are on the system."
- §11.30: "Persons who use open systems to create, modify, maintain, or transmit electronic records shall employ procedures and controls designed to ensure the authenticity, integrity, and, as appropriate, the confidentiality of electronic records from the point of their creation to the point of their receipt. Such procedures and controls shall include those identified in § 11.10, as appropriate, and additional measures such as document encryption and use of appropriate digital signature standards to ensure, as necessary under the circumstances, record authenticity, integrity, and confidentiality."
- §11.3(b)(5): "*Digital signature* means an electronic signature based upon cryptographic methods of originator authentication, computed by using a set of rules and a set of parameters such that the identity of the signer and the integrity of the data can be verified."
- §11.70: "Electronic signatures and handwritten signatures executed to electronic records shall be linked to their respective electronic records to ensure that the signatures cannot be excised, copied, or otherwise transferred to falsify an electronic record by ordinary means."

### 2. The 1997 preamble (62 FR 13430, March 20, 1997)

**Comment 41** (pp. 13440-13441) is the controlling test:

> "The agency agrees that the most important factor in classifying a system as closed or open is whether the persons responsible for the content of the electronic records control access to the system containing those records. A system is closed if access is controlled by persons responsible for the content of the records. If those persons do not control such access, then the system is open because the records may be read, modified, or compromised by others to the possible detriment of the persons responsible for record content. Hence, those responsible for the records would need to take appropriate additional measures in an open system to protect those records from being read, modified, destroyed, or otherwise compromised by unauthorized and potentially unknown parties. The agency does not believe it is necessary to codify the basis or criteria for authorizing system access, such as existence of a fiduciary responsibility or contractual relationship. By being silent on such criteria, the rule affords maximum flexibility to organizations by permitting them to determine those criteria for themselves."

The comment was answering commenters who "cited outside contractors, suppliers, temporary employees, and consultants" and asked for "a change of emphasis from organizational membership to organizational control over system access". FDA made that change.

**Comment 43** (p. 13441): a commenter proposed defining "closed" by functional traits, including "physical access control, ... and being under legal obligation to the organization responsible for operating the system." FDA replied: "The agency agrees that the functional characteristics cited by the comment are appropriate for a closed system, but has decided that it is unnecessary to include them in the definition."

**Comment 44** (p. 13441) is FDA's direct statement on third-party hosting:

> "The agency advises that dial-in access over public phone lines could be considered part of a closed system where access to the system that holds the electronic records is under the control of the persons responsible for the content of those records. The agency cautions, however, that, where an organization's electronic records are stored on systems operated by third parties, such as commercial online services, access would be under control of the third parties and the agency would regard such a system as being open."

**Comment 19** (pp. 13436-13437) says classification can change with how the records are handled:

> "The classification of a system as open or closed in a particular situation depends on what is done in that situation. ... should the firm's representative transfer copies of those records to a public online service that stores them for the drug firm's subsequent retrieval, the agency considers such transfer and storage to be within an open system because access to the system holding the records is controlled by the online service, which is not responsible for the record's content."

**Comment 56** (p. 13443): FDA kept a separate definition of "open" because "controls for open systems merit distinct provisions in part 11 and defining the term is basic to understanding which requirements apply to a given system."

**Comment 94** (pp. 13451-13452) covers what §11.30 requires:

> "The agency advises that § 11.30 requires additional controls, beyond those identified in § 11.10, as needed under the circumstances, to ensure record authenticity, integrity, and confidentiality for open systems. Use of digital signatures is one measure that may be used, but is not specifically required."

> "The agency has revised the final rule to clarify its intent that firms retain the flexibility to use any appropriate digital signature as an additional system control for open systems."

FDA named RSA and NIST's DSS (FIPS 186) as the standards it knew of. On encryption it said the term "is generally understood to mean the transforming of a writing into a secret code or cipher."

**Comment 95** (p. 13452): "use of digital signatures and encryption would be an option when extra measures are necessary under the circumstances." Transmission "by way of a public online service" would require extra measures. A "direct connection" might not.

**Comment 97** (p. 13452): moving a record off an open system to its final storage location "may necessitate open system controls." FDA also said that "the concept of nonrepudiation is part of record authenticity and integrity."

### 3. The 2003 Scope and Application guidance (August 2003)

This guidance does not revisit whether a system is open or closed. What it does say is that §11.30 stays enforced. Section III.A (p. 4) lists what FDA will still enforce, including "limiting system access to authorized individuals", operational, authority and device checks, and training. It also lists "controls for open systems corresponding to controls for closed systems bulleted above (§ 11.30)", along with the e-signature requirements. Enforcement discretion reaches the "corresponding requirement in §11.30" only for validation, audit trails (III.C.2, p. 6), record retention and record copying.

### 4. The October 2024 clinical-investigations Q&A, Rev. 1

"Electronic Systems, Electronic Records, and Electronic Signatures in Clinical Investigations: Questions and Answers." Its scope is clinical investigations under parts 312 and 812, so it applies to a CGMP QC lab only by analogy. It is still FDA's most recent statement on cloud and IT service providers.

**Q11, footnote 51** (p. 12). This is the one place the Q&A mentions the open/closed split, and it moves the question to risk assessment:

> "Part 11 differentiates electronic systems as closed or open (§§ 11.10 and 11.30) and describes additional measures that may be necessary for open systems. Because of changing technologies and the increased risk of cybersecurity threats, a risk assessment should be conducted for all electronic systems for the selection and application of appropriate security safeguards."

**Q11 body** (p. 12):

> "Regulated entities should conduct a risk assessment to determine appropriate procedures and controls to secure records and data at rest and in transit to prevent access by intervening or malicious parties."

> "Other safeguards, such as encryption, should be used to ensure confidentiality of the data."

**Q5** (p. 6) covers retention, including cloud. Footnote 35 cites **§11.30**, not §11.10, for the first sentence below:

> "There are various ways to retain electronic records; for example, in electronic storage devices and using cloud computing services. Regulated entities must ensure the authenticity, integrity, and confidentiality of the data and also should ensure that the meaning of the record is preserved. [fn 35: See § 11.30.]"

**Section III.C, "Information Technology Service Providers and Services"** (p. 15):

> "Regulated entities can contract with IT service providers for IT services in a clinical investigation (e.g., data hosting, cloud computing software, platform and infrastructure services). Regulated entities are responsible for ensuring that electronic records meet applicable part 11 requirements."

Its suitability bullets include "Access controls used by the IT service provider ... including SOPs for granting and revoking access", "Processes and procedures the IT service provider has for data migration, data backup, recovery, contingency plans", "Ability to provide secure, computer-generated, time-stamped audit trails", and "Ability to secure and protect the confidentiality of data at rest and in transit".

**Q17** (p. 16) recommends a written agreement ("master service agreement with an associated service level agreement or quality agreement"). It must cover "the roles and responsibilities of the regulated entity and the IT service provider" and "a plan that ensures the sponsor will have access to data throughout the regulatory retention period."

**Q24** (p. 21): Part 11 "do[es] not specify a particular method to create a valid electronic signature." Username-and-password e-signatures remain valid, and so do digital signatures.

**Takeaway:** the Q&A treats cloud hosting as legitimate and never labels it closed. It frames the controls with §11.30 vocabulary: authenticity, integrity, confidentiality, at rest and in transit, encryption.

### 5. Warning letters and compliance programs

I found none that classify a hosted system as open or closed. I searched fda.gov warning letters and read the text of Compliance Programs 7348.810 (sponsors/CROs) and 7348.811 (clinical investigators). Both mention third-party EDC systems and databases but do not classify them.

The closest example is the risk this question is about. The **Applied Therapeutics, Inc. warning letter** (CDER, dated Nov 27, 2024, posted Dec 3, 2024, MARCS-CMS 696833) says that "a third-party vendor contracted by Applied Therapeutics deleted electronic data in Q-global®, including associated audit trails, for the (b)(4) for all 47 subjects", and that "FDA was unable to access and copy and verify records". The violation was cited under 21 CFR 312.58, not Part 11. The firm's own corrective actions, which FDA quotes, included "Electronic data (even if held on third-party systems) will be backed up appropriately and held at the sponsor" and "External vendors will not have the ability to delete files from any electronic systems."

### 6. The predicate rule for this lab (drug CGMP QC)

21 CFR 211.68(b): "Appropriate controls shall be exercised over computer or related systems to assure that changes in master production and control records or other records are instituted only by authorized personnel. ... Hard copy or alternative systems, such as duplicates, tapes, or microfilm, designed to assure that backup data are exact and complete and that it is secure from alteration, inadvertent erasures, or loss shall be maintained."

### 7. EU and PIC/S: is the framing equivalent?

**EU GMP Annex 11 (2011).** It has no open/closed distinction; the word "open" does not appear. Hosting is handled as supplier management. §3.1: "When third parties (e.g. suppliers, service providers) are used e.g. to provide, install, configure, integrate, validate, maintain (e.g. via remote access), modify or retain a computerised system or related service or for data processing, formal agreements must exist between the manufacturer and any third parties, and these agreements should include clear statements of the responsibilities of the third party." §3.2 adds that "The need for an audit should be based on a risk assessment." Hosting does not change the controls. It adds contractual and oversight duties.

**Draft revised Annex 11** (EC/PIC/S consultation, July 7 to October 7, 2025). This is still a draft: as of 2026-09-29 the EudraLex Vol. 4 page lists only the 2011 Annex 11. It brings back an open-system idea, but only for e-signatures, and it uses a Part 11-like test based on control of access:

- §13.2 (lines 359-361): "Where the system owner does not have full control of system accesses (open systems), or where required by other legislation, electronic signatures should, in addition, meet applicable national and international requirements, such as trusted services." (In the EU, "trusted services" in practice means eIDAS trust services.)
- §7.1 (lines 128-132): relying on a vendor or service provider "does not change the requirements put forth in this document. The regulated user remains fully responsible." §7.2 to §7.5 require an audit or assessment, oversight through SLAs and KPIs, documentation available on site, and a contract.
- §10.4 (line 260): "Where applicable, critical data should be encrypted on a system."
- §13.8 (lines 379-382): "Controls should be in place to ensure that a signed record cannot be modified or alternatively, that if a later change is made to a signed record, it will clearly appear as unsigned."
- §15.20 (lines 503-504): "When remotely connecting to systems over the internet, a secure and encrypted protocol should be used."

**PIC/S PI 041-1 (1 July 2021).** It has no open/closed concept. §9.1.10 (p. 32): "The principles herein apply equally to circumstances where the provision of computerised systems is outsourced. In these cases, the regulated entity retains the responsibility to ensure that outsourced services are managed and assessed in accordance with GMP/GDP requirements". Its data-governance list names "decentralised/cloud-based data storage, processing and transfer activities" as an area where data-governance procedures may need to change (§6.4.2, p. 13).

Overall, the EU and PIC/S texts do not tie hosting to a separate control set. Their approach is: the regulated user keeps responsibility, contracts and assesses the provider, and applies risk-based security. The 2025 draft Annex 11 is the exception. For a system whose owner lacks "full control of system accesses", it raises the e-signature standard, which parallels §11.30.

## Design consequences for this LIMS

Treat the hosted LIMS as **open for design purposes**, and document a closed-system argument only as a fallback position. Each control below costs little in a new system. Each also works even if the lab later argues "closed". The first four answer comment 41's concern directly: records that "may be read, modified, or compromised by others". Here those others are the operator's staff with database or OS access, which bypasses the application's own access control and audit trail.

1. **Encrypt everything in transit (TLS for staff UI, Customer portal, APIs and instrument uploads).**
   - §11.30: "additional measures such as document encryption".
   - Q&A Q11: "secure records and data at rest and in transit to prevent access by intervening or malicious parties."
   - Draft Annex 11 §15.20: "a secure and encrypted protocol should be used."

2. **Encrypt at rest, with keys the lab controls, not the operator.** Use application-level or envelope encryption with a lab-held key-encryption key for confidential Customer data and results. The claim that provider-managed disk or database encryption does not protect against the operator is interpretation, but it follows from comment 41's rationale.
   - Q&A Q11: "Other safeguards, such as encryption, should be used to ensure confidentiality of the data."
   - Q&A III.C: "Ability to secure and protect the confidentiality of data at rest and in transit".
   - Draft Annex 11 §10.4: "critical data should be encrypted on a system."

3. **Bind each signature to a content hash; optionally make it a true digital signature.** When a record is signed (Analyst result, Reviewer check, QA release), compute a hash (e.g., SHA-256) over a canonical serialization of the record's content. Store the hash with the signature manifestation (name, date/time, meaning). On every display or export, recompute the hash and show the record as unsigned or invalid if it no longer matches. As an option, also sign that hash with a lab-held private key (a FIPS 186 algorithm such as ECDSA or EdDSA). That meets §11.3(b)(5) and the "appropriate digital signature standards" in §11.30, while the user-facing e-signature stays username plus password (Q&A Q24).
   - §11.30: "use of appropriate digital signature standards".
   - §11.70: signatures "cannot be excised, copied, or otherwise transferred to falsify an electronic record by ordinary means."
   - Comment 94: "firms retain the flexibility to use any appropriate digital signature as an additional system control for open systems."
   - Draft Annex 11 §13.8: "if a later change is made to a signed record, it will clearly appear as unsigned."
   - §11.10(a), which applies through §11.30: "the ability to discern invalid or altered records."

4. **Make the audit trail tamper-evident: a hash chain, with its head anchored outside the operator's reach.** Chain each audit entry to the previous entry's hash. Periodically export the chain head (e.g., a daily digest) to lab-controlled storage, which lets the lab detect deletion or editing of audit history at the database level.
   - §11.10(e), which applies through §11.30: "secure, computer-generated, time-stamped audit trails" that "independently record" actions, and "Record changes shall not obscure previously recorded information."
   - Applied Therapeutics warning letter: "a third-party vendor ... deleted electronic data ..., including associated audit trails."

5. **Keep an independent backup or export copy under lab control, in a human-readable and electronic form, for the whole retention period.**
   - 21 CFR 211.68(b): backup "secure from alteration, inadvertent erasures, or loss".
   - §11.10(b)/(c), through §11.30: accurate and complete copies; "accurate and ready retrieval throughout the records retention period."
   - Q&A Q17: "a plan that ensures the sponsor will have access to data throughout the regulatory retention period."
   - Firm commitment quoted in the Applied Therapeutics letter: data "even if held on third-party systems" backed up and "held at the sponsor."

6. **Put the operator's privileged access under the lab's authority, by contract and by logs.** This is also what the fallback "closed" argument depends on. Requirements:
   - A quality agreement that names the operator roles with OS or database access.
   - Lab approval, and the ability to revoke, for each privileged account.
   - The operator's admin-access logs delivered to the lab for review.
   - No vendor ability to delete records.
   - For multi-tenant SaaS, documented tenant isolation.

   Sources:
   - Comment 41: the rule is silent on "fiduciary responsibility or contractual relationship" criteria.
   - Comment 43: being "under legal obligation to the organization" is an appropriate closed-system trait.
   - Q&A III.C: "Access controls used by the IT service provider ... including SOPs for granting and revoking access".
   - Q&A Q17: written agreement covering "roles and responsibilities".
   - Annex 11 (2011) §3.1 and draft §7.1 to §7.5.

7. **Keep the Customer portal inside lab-controlled access.** Customers are outside parties, but comment 41 lets the lab set its own authorization criteria, so accounts the lab administers do not by themselves make the system open. Portal traffic still crosses the public internet, so control 1 applies. Comment 95 says transmission via a public service calls for "additional measures".

**For EU submissions:** if the draft Annex 11 §13.2 becomes final as written, a system whose owner lacks "full control of system accesses" would need e-signatures that also meet "trusted services" requirements (eIDAS). Designing control 3 so that a qualified signature provider can be added later keeps that option open.

## Sources

- 21 CFR Part 11 final rule and preamble, 62 FR 13430-13466 (March 20, 1997): https://www.govinfo.gov/content/pkg/FR-1997-03-20/html/97-6833.htm
- Current 21 CFR Part 11 (eCFR): https://www.ecfr.gov/current/title-21/chapter-I/subchapter-A/part-11
- FDA, Part 11 Scope and Application guidance (August 2003): https://www.fda.gov/media/75414/download
- FDA, Electronic Systems, Electronic Records, and Electronic Signatures in Clinical Investigations: Q&A, Rev. 1 (October 2024): https://www.fda.gov/media/166215/download
- FDA warning letter, Applied Therapeutics, Inc., MARCS-CMS 696833: https://www.fda.gov/inspections-compliance-enforcement-and-criminal-investigations/warning-letters/applied-therapeutics-inc-696833-12032024
- FDA Compliance Programs 7348.810 and 7348.811 (checked; no classification text): https://www.fda.gov/media/75916/download, https://www.fda.gov/media/75927/download
- 21 CFR 211.68: https://www.law.cornell.edu/cfr/text/21/211.68
- EU GMP Annex 11 (2011): https://health.ec.europa.eu/system/files/2016-11/annex11_01-2011_en_0.pdf
- Draft revised Annex 11 (consultation, July 2025): https://health.ec.europa.eu/document/download/40231f18-e564-4043-94de-c031f813d38b_en?filename=mp_vol4_chap4_annex11_consultation_guideline_en.pdf
- PIC/S PI 041-1 (1 July 2021): https://picscheme.org/docview/4234
