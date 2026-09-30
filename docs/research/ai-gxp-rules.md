# What an AI assistant may do in a GxP LIMS

Research for [#39](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/39), part of map [#1](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/1). Sources were fetched on 2026-09-29 and 2026-09-30. The baselines are `docs/research/part11.md` (branch `research/part11`, [#2](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/2)) and `docs/research/eu.md` (branch `research/eu`, [#25](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/25)). Their findings are not repeated here. Capitalised domain terms (Record Version, Electronic Signature, Authorisation and so on) are defined in `CONTEXT.md`.

"Assistant" means a large language model (LLM) built into the LIMS. It answers questions and writes text. It is generative and probabilistic: the same prompt can give different output.

## Short answer

No text in force names an AI assistant. Every source that does speak to AI says the same thing: **a named, qualified person stays accountable for anything the AI produces, and the AI never makes a GMP decision.** The three-tier proposal fits the sources. Two points need sharpening.

1. **What matters is what the output is used for, not the tier's name.** Draft Annex 22 says generative AI and LLMs "should not be used in critical GMP applications" [A22 §1]. A critical application is one "with direct impact on patient safety, product quality or data integrity". An LLM may work only where its output does not have that impact on its own. In non-critical use it asks for a human-in-the-loop (HITL): qualified personnel "responsible for ensuring that the outputs … are suitable for the intended use" [A22 §1]. Records of that review "may imply" a review "of every output" [A22 §10.5]. This project takes the stricter reading as its own choice: a qualified person checks every output before it counts. So an assistant may never produce a value of record, a verdict, a calculation that counts, or a status. That holds even as a "draft", because a draft number that a person skims and accepts still has direct impact.
2. **"Act" is ruled out by several rules, not just a design choice.** An Electronic Signature is "executed, adopted, or authorized by an individual" [P11 §11.3(b)(7)]. It must "be used only by their genuine owners" [P11 §11.200(a)(2)]. Signing that relies "on the previous system authentication is not acceptable" [A11d §13.3]. A shared account that can change data "constitute[s] a violation of data integrity" [A11d §11.1]. An agent acting in a person's session breaks all of these. An agent acting from its own account would be an LLM in a critical GMP application, which draft Annex 22 excludes.

**Status on 2026-09-30.** Draft Annex 22 is still a draft. The 2025 consultation drew support for allowing generative AI with guardrails. EMA held an expert workshop on exactly that on 30 June and 1 July 2026. No report has been published [EMA-WS]. The EMA Inspectors Working Group targets Q4 2026 for the final texts of Annex 22, Annex 11 and Chapter 4 [IWG]. The final Annex 22 may therefore allow LLMs in some critical uses behind guardrails. The tier design below does not depend on that outcome. It keeps the LLM outside critical decisions either way.

**FDA** has no rule written for LLMs in CGMP labs. It enforces the existing one: on 2 April 2026 it cited a firm whose SOPs and specifications were written by "AI agents" without proper quality-unit review. "Any output or recommendations from an AI agent must be reviewed and cleared by an authorized human representative of your firm's QU" [WL-PUR].

## The three tiers

### Tier 1: Explain and find (read-only)

**May:**
- Answer questions about Effective Documents, Methods, Specifications and records the person can already open.
- Find records, such as "open Deviations on this Equipment" or "Tests due this week".
- Explain a recorded verdict or an Audit Trail entry in plain words, citing the Record Version it read.
- Summarise an Audit Trail to help a Reviewer find entries worth checking. The Review record links the summary (G8).

**May not:**
- Disclose anything the person cannot read. A wider service account breaks least privilege [A11d §11.10] and the authority checks of [P11 §11.10(d), (g)]. The one exception is background work (§"Compliance review", G7).
- Write anything: no record, no field, no status.
- Stand in for a review a person must perform, such as the audit-trail review [A11d §12.5–12.6], the Reviewer's second check [211.194(a)(8)] or QA release.
- Give an answer that someone treats as the value of record. The record is the cited Record Version, not the assistant's restatement of it.

**Controls:**
- **Runs as the person.** Every query runs with the person's own role, Lab and Customer scope, enforced by the server, not by the prompt.
- **No write path.** The assistant's tools are read-only API calls. This is a technical control, not an instruction to the model.
- **Cites its sources.** Each answer links the Record Versions and Document versions it used, so the person can check the original.
- **Labelled.** Answers are marked "Assistant answer, not a record".
- **Intended use and validation.** Write the intended use and its limits. Validate the module in proportion to risk, as part of the LIMS [A11d §2.2, §9; 17025 §7.11.2]. The FDA and EMA principles ask for the same things: "clear context of use", a "risk-based approach" and "life cycle management" [GAIP 2, 4, 9].
- **Configuration control.** Record the model provider, model name and version as software identity [17025 §6.4.13(a)]. Treat a model change as a change under change control [A11d §3.1(ii), §6.6; 17025 §7.11.2]. Annex 22 §10.1–10.2 asks this of AI models, and it is good practice here. The whole assistant configuration, not only the model, is one versioned item (G5).
- **Supplier and confidentiality.** A hosted model provider is a service provider. It needs a contract and oversight [A11d §7], and it must meet the standard as an external provider [17025 §7.11.4]. Sending Customer data to it is a confidentiality question under [17025 §4.2]; see open question 1.

**Regulatory weight.** Low. Tier 1 is "operational efficiency", which FDA's AI guidance puts outside its scope [FDA-AI §II]. *Interpretation:* under draft Annex 22 it is non-critical, as long as nobody treats an answer as data. The draft does not classify it.

### Tier 2: Draft (a person reviews, adopts and signs)

**May draft text:**
- The description of a Deviation or Complaint, an investigation narrative, and proposed CAPA Actions.
- Document text in the vault editor: an SOP revision or a Method section. It may not add or change any number, limit, acceptance criterion or unit (G1).
- Test Report comments and Customer messages. One that carries an opinion or interpretation is adopted or sent only by a person Authorised for opinions and interpretations (G4).
- A Change Request description.
- A Review Checklist pre-read: "these three Injections were excluded; the reasons are …", each point citing its record.

**May not draft:**
- Any value of record: a Result, a reading, a Check value, a weight, a Run Check value, an extracted instrument value, or any field in the Critical Data Change list. These are critical data, and an LLM is not allowed to produce them [A22 §1]. Instrument values keep coming from the validated TargetLynx Import (ADR 0005) or from typed entry.
- The structured requirements of a Method or Specification: Acceptance Criteria and limits (with their written decimals, NMT or NLT), Run Check and system suitability criteria, replicate counts, outlier tests, adjustment allowances and the claim of a compendial basis. Numbers in drafted Method or Specification prose come from the approved record.
- The entries of a Deviation's impact list. The server computes them.
- A reason for excluding an Injection or invalidating a result.
- Any verdict, rounding or calculation. Those belong to the QA-approved Calculation Version (ADR 0006). They must be checked and backed by "a written record of the program … along with appropriate validation data" [211.68(b)], which an LLM cannot provide.
- The Reason for Change. Draft Annex 11 asks the audit trail to record why [A11d §12.2]. *Interpretation:* that means the person's own reason. See open question 3.
- A Signature Meaning, a status or a decision. These are Tier 3.

**Controls:**
- **The draft is a proposal, not a record.** It is kept apart from the record until the person adopts it. On adoption, the saved text becomes a normal Record Version authored by the person. The Audit Trail's "who" is the person, because the adoption is the person's "manual user interaction" [A11d §12.1–12.2; P11 §11.10(e)].
- **Record the draft's origin.** The Record Version keeps origin metadata: the Assistant Call it came from, the assistant configuration version, the time, and whether the person edited the text before saving. This keeps the record attributable and the change reconstructable [DI Q1; PICS §7.4]. Keep the draft as first generated, linked to the Record Version it fed.
- **Adoption is a real review.** The person must hold the Authorisation for the activity [17025 §6.2.6], and the normal lifecycle still applies. A Document is still Reviewed by an authorised non-author and Approved by QA. A Deviation still follows its workflow. FDA: "If you use AI as an aid in document creation, you must review the AI generated documents to ensure they were accurate and actually compliant with CGMP" [WL-PUR]. Draft Chapter 4: accountability for data "produced or processed with artificial intelligence … rests with the regulated user" [C4d §4.24].
- **No one-click accept of the whole draft on critical records.** Show the draft as editable text that the person saves. Citations shown beside the text are not enough: values the draft quotes are filled by the server or matched on save (G2).
- **Train and monitor the people.** When a model gives input to a person's decision, "the training and consistent performance of the operator should be monitored like any other manual process" [A22 §3.3]. Records of that human review "should be kept" [A22 §10.5]. Track how often drafts are adopted unedited as a warning sign, and look at it in periodic review [A11d §14].
- **Tier 1 controls also apply:** runs as the person, labelled, validated, under change control, supplier-controlled.

**Regulatory weight.** Medium. The text lands in GMP records that people rely on. The FDA warning letter shows that the regulator judges it as the firm's own work. The assistant is only an aid.

### Tier 3: Act (never)

**Never:**
- Apply any Electronic Signature, with any Signature Meaning (Performed, Verified, Reviewed, Approved, Released, Authored, Acknowledged).
- Accept or reject a Submission, confirm or reject an Import, match or exclude an Injection, approve a Critical Data Change, or Return a record.
- Change any status, such as a Deviation's state, a Hold, a Fitness Status, an Equipment status or a Document Status.
- Grant or suspend an Authorisation or an account.

**The most it may do** is take the person to the right screen, with a Tier 2 draft in place. The person then performs the action through the normal UI, with the normal re-authentication.

**Why:**
- **Signatures belong to one person.** [P11 §11.3(b)(7), §11.100(a), §11.200(a)(2)–(3)]; [A11d §13.3, §13.7]; draft Chapter 4 says "A signature represents the legally binding will of the signatory" [C4d §4.65].
- **No borrowed sessions.** An agent working through a person's session or credentials is exactly the unauthorised use that §11.300(d) transaction safeguards exist to "prevent … and to detect and report". An agent in the person's session could also use the signature with no second person colluding, which defeats §11.200(a)(3).
- **No agent accounts.** Unique personal accounts [A11d §11.1] and authority checks for "only authorized individuals" [P11 §11.10(g)] leave no room for an LLM account that decides. Rule-based automation by the validated system is different: the Calculation Version's verdicts are deterministic and QA-approved.
- **Decisions stay with people.** Approving and rejecting belongs to the quality unit [211.22(a), (c)]. Reviewing and authorising results belongs to authorised personnel [17025 §6.2.6(c)]. An LLM taking any of these decisions is a critical GMP application [A22 §1].

**Control:** the assistant holds no credentials and has no API that changes state or signs. Its path uses a database role with SELECT on business tables and INSERT only on the Assistant Call log [ai-agents §6.2]; that is the §11.300(d) safeguard. Prove it in validation with a test showing every state-changing endpoint rejects the assistant's calls.

## Attribution, audit trail and records

- **Who is the author.** The person who adopts a draft is its author. Part 11 audit trails record "operator entries and actions" [P11 §11.10(e)]. FDA's "attributable" means traceable to one individual [DI Q1]. Recording the assistant as the actor would break both. The assistant belongs in the record's origin metadata, not in the "who".
- **How the trail shows "drafted by assistant".** Add an origin field to the audit entry for the save, for example "origin: Assistant Call AC-000123, configuration v Y, edited: yes". Draft Annex 11's who / what / when / why [A11d §12.2] is unchanged. The origin field is extra, so an inspector can see where AI was involved.
- **Is AI output a record or raw data?**
  - Draft Chapter 4: "At least, all data on which quality decisions are based should be defined as raw data" [C4d §4.27(iv)].
  - Raw data is "the first capture of stored information" [C4d glossary].
  - So a Tier 2 draft is not raw data about the sample. It is part of how a record came to be. Once adopted, the saved text is the record.
  - A Tier 1 answer is not a record, provided nobody bases a quality decision on it instead of on the cited record.
  - The Record Type Register should list the **Assistant Call** log and the **Assistant Draft** (G10). A Tier 1 answer is not a GMP record, but its Assistant Call is retained. QA approves those entries. *This is interpretation: no source rules on it.*
- **Keeping prompts and outputs.**
  - No source sets a retention rule for prompts.
  - Recommendation: keep every Assistant Call at least 4 years, including Tier 1 answers and drafts nobody adopted. Where a draft fed a record, keep its Assistant Call for the longer of 4 years and that record's retention, with the record's audit trail [P11 §11.10(e)] (G6).
  - *Interpretation, not verified against any AI-specific text.*

## What each source says

### EU GMP Annex 22 (draft, 7 July 2025)

- **Status.** A consultation draft from 7 July to 7 October 2025. It is not in EudraLex Volume 4 [EUDRA]. The IWG 2026–2028 work plan targets Q4 2026 for a final text to the Commission, "in parallel with the update of Annex 11 and Chapter 4" [IWG].
- **Scope.** It applies to AI "used in critical applications with direct impact on patient safety, product quality or data integrity, e.g. to predict or classify data", and only to static, deterministic, trained models. Dynamic models and probabilistic outputs "should not be used in critical GMP applications" [A22 §1].
- **Generative AI.** It "does not apply to Generative AI and Large Language Models (LLM), and such models should not be used in critical GMP applications". In non-critical applications, "personnel with adequate qualification and training should always be responsible for ensuring that the outputs from such models are suitable for the intended use, i.e. a human-in-the-loop (HITL)", and the annex's principles "may be considered" [A22 §1].
- **People.** Subject matter experts, QA, data scientists and IT work closely together. Everyone has "adequate qualifications, defined responsibilities and appropriate level of access" [A22 §2.1]. A process SME approves the intended use and the acceptance criteria before testing [A22 §3.1, §4.2].
- **Test data** (for models inside its scope):
  - it is representative, stratified and big enough [A22 §5.1–5.2];
  - labels are verified [A22 §5.3];
  - generating test data with generative AI "is not recommended" [A22 §5.6];
  - it is kept independent of training data, with access control and an audit trail [A22 §6];
  - a test plan is approved, and deviations are investigated [A22 §7];
  - features are explained [A22 §8] and confidence is logged [A22 §9].
- **Operation.** Change control and configuration control; performance and input-drift monitoring; and records of human review, which may mean "a consistent review and/or test of every output" [A22 §10].
- **What is moving.** EMA's workshop page says the consultation "suggested support for potentially enabling the use of technologies such as generative AI (GenAI) or large language models (LLMs)". It asked for input on "guardrails" and on "what level and form of human-in-the-loop oversight is still required" [EMA-WS]. The agenda covered regulatory pathways for adaptive and probabilistic AI, human oversight and accountability, validation and lifecycle, and outsourced activities [EMA-AG]. As of 2026-09-30 there is no report and no revised text [EMA-WS; EUDRA].

### EU draft Annex 11 and Chapter 4 (7 July 2025)

- Draft Annex 11 does not mention AI. Its general rules apply to an assistant module:
  - validated before use, with QRM that considers "the level and novelty of automation" [A11d §2.1–2.2];
  - "no increase in the overall risk of the process" [A11d §2.8];
  - outsourced activities leave the regulated user "fully responsible" [A11d §2.6].
- Draft Chapter 4 does mention AI:
  - "The accountability for the integrity of documents, records or (raw) data produced or processed with artificial intelligence or any other automatic means … rests with the regulated user" [C4d §4.24].
  - AI support "should be included in a pharmaceutical quality system regardless of the service located on premise or as a hosted service" [C4d §4.25].
  - Decision-making supported by AI falls under Annex 22 [C4d §4.23].
- **EU AI Act, Article 4 (AI literacy)** [AIA]. Providers and deployers of AI systems "shall take measures to support the development of AI literacy of their staff and other persons dealing with the operation and use of AI systems on their behalf". It applies from 2 February 2025 [AIA; Art. 113(a)]. The page read gives this wording, which is softer than the 2024 text ("ensure, to their best extent, a sufficient level"), so it may have been amended; the current wording is *not verified*. Either way, the Lab is a deployer and meets it through the assistant-use training in Tier 2 and hosting §6.3.
- EMA's reflection paper (final, 9 September 2024) warns that "generative language models are prone to include plausible but erroneous or incomplete output" [EMA-RP §2.3.5]. For manufacturing it points to ICH Q8–Q10 "awaiting revision of current regulatory requirements and GMP standards" [EMA-RP §2.3.6].

### FDA

- **AI to support regulatory decision-making** (draft, January 2025) [FDA-AI]:
  - It covers AI that produces "information or data to support regulatory decision-making regarding safety, effectiveness, or quality".
  - It does not cover AI "used for operational efficiencies (e.g., internal workflows, resource allocation, drafting/writing a regulatory submission) that do not impact patient safety, drug quality, or the reliability of results" [FDA-AI §II].
  - Its seven-step credibility framework rates model risk as "model influence" × "decision consequence" [FDA-AI §IV.A.3]. *Interpretation:* Tiers 1 and 2 keep model influence low, because a person's independent check is the evidence relied on.
  - It says AI in manufacturing "must be implemented in accordance with current good manufacturing practice", and names the quality unit's duties under 21 CFR 211.22 and 211.68 [FDA-AI fn 21].
  - FDA's AI page (content current 1 May 2026) still lists it as draft [FDA-PAGE].
  - No final version was found up to 30 September 2026. It is still the draft announced in the Federal Register on 7 January 2025 [FDA-FR; FDA-PAGE].
- **FDA–EMA Guiding Principles of Good AI Practice in Drug Development** (January 2026). Ten high-level principles that cover manufacturing. They include "human-centric by design", "clear context of use", "risk-based performance assessment" of "the complete system including human-AI interactions", and "life cycle management" [GAIP]. They are not guidance and set no specific control.
- **Warning letter to Purolea Cosmetics Lab** (MARCS-CMS 722591, 2 April 2026, CDER) [WL-PUR]. Under the heading "Inappropriate Use of Artificial Intelligence in Pharmaceutical Manufacturing":
  - the firm used AI agents to write specifications, procedures and master records;
  - it had skipped process validation because the AI agent "never told you it was required";
  - FDA requires that AI output be "reviewed and cleared by an authorized human representative of your firm's QU". That sentence cites only section 501(a)(2)(B) of the FD&C Act.
  - The letter speaks of "AI agents", not generative AI. It is the first CGMP enforcement text found on AI output. It confirms Tier 2's rule and adds one: people review, the quality unit clears, and the firm stays responsible (G9).
- **CDER discussion paper, *Artificial Intelligence in Drug Manufacturing*** (2023) [CDER-DP]. It is "not a draft or final guidance". It flags possible "ambiguity on how to apply existing … CGMP regulations to AI", that "cloud applications may affect oversight of pharmaceutical manufacturing data and records", and that quality agreements with third parties "may have gaps with respect to managing the risks of AI". Hosting R1–R2 answer the last two.
- **CDER Guidance Agenda** (July 2026) plans two drafts for 2026: "AI and ML Quality Considerations in Pharmaceutical Manufacturing" and "Computer Software Assurance for AI-Based Systems in Drug Manufacturing and Clinical Investigations; Supplemental Guidance" [CDER-AG]. Neither had been published by 30 September 2026. CDER's newly added guidance list was checked up to 4 September. Items from 5 to 30 September are *not verified*.
- **Part 211 still decides the lab's duties.** Computer output "shall be checked for accuracy" [211.68(b)]. Lab records carry "the initials or signature of the person who performs each test" and of "a second person showing that the original records have been reviewed" [211.194(a)(7)–(8)]. The quality unit approves or rejects procedures and specifications [211.22(c)]. None of these can be handed to an assistant.

### Part 11 applied to assistant output

| Question | Answer | Source |
|---|---|---|
| Who is the author of an adopted draft? | The person who adopts it. The Audit Trail records their entry, with the assistant as origin metadata. | [P11 §11.10(e)]; [DI Q1]; [A11d §12.2] |
| Can the assistant use the person's session or credentials to act? | No. Signatures are used "only by their genuine owners". An agent in the person's session could use the signature with no second person colluding, which defeats §11.200(a)(3). Transaction safeguards must prevent and report unauthorised use; here that is the SELECT-only database role [ai-agents §6.2]. | [P11 §11.200(a)(2)–(3), §11.300(d)]; [A11d §13.3] |
| Can it have its own account to act? | Not to sign or decide. Access and authority are for "authorized individuals". An LLM deciding is a critical application. | [P11 §11.10(d), (g)]; [A11d §11.1]; [A22 §1] |
| Is its output an electronic record? | Anything it stores is an "electronic record" in the broad sense of §11.3(b)(6). Part 11 controls apply once a predicate rule requires the record or the record is relied on. An adopted draft is; a Tier 1 answer is not. | [P11 §11.3(b)(6)]; baseline part11.md scope notes |
| Retention | Every Assistant Call at least 4 years; one that fed a record, the longer of that and the record's retention. | [P11 §11.10(e)]; G6 |
| Policy | Written policy that holds people "accountable and responsible for actions initiated under their electronic signatures" must cover adopting drafts. | [P11 §11.10(j)] |

### PIC/S, Japan and China (only where they differ)

- **PIC/S.**
  - PIC/S drafted Annex 22, Annex 11 and Chapter 4 jointly with the EMA Inspectors Working Group "to maintain global alignment of standards", and consulted on them on the same dates [PICS-NEWS].
  - The PIC/S draft Annex 22 has the same text: LLMs "should not be used in critical GMP applications", and a human-in-the-loop is required for non-critical use [PICS-A22].
  - The PIC/S GMP Guide PE 009-18 (in force 24 September 2026) has no AI annex. Its Annex 11 is still the 2011 text [PE009].
  - No separate PIC/S position was found. There is no delta.
  - The 2026 PIC/S Seminar, "Digital Transformation in GMP" (Istanbul, 4–6 November 2026), may say more. Its programme was not yet published.
- **Japan (MHLW, PMDA).**
  - No notification, administrative notice or GMP事例集 Q&A sets rules for AI use by manufacturers or test labs.
  - The 2010 CSV guideline (薬食監麻発1021第11号) and the 2005 ER/ES 指針 are unrevised, so the baseline `research/jp` rules apply unchanged.
  - MHLW's 事務連絡 of 19 August 2025 on digital terms and case studies in drug manufacturing defines AI, generative AI and LLM for reference only. It sets no requirement [JP-DX].
  - PMDA set up a project team in May 2026 to publish 「AI利活用に関する基本的考え方」 (basic principles for using AI across the product life cycle). Nothing has been published yet [JP-PT]. Watch it.
  - PMDA's AI action plan of 26 September 2025 covers only PMDA's own work. There is no delta.
- **China (NMPA).**
  - No industry rule on AI in GMP was found. The GMP Appendix on Computerized Systems (2015) is unchanged (see `research/cn`).
  - The 国家药监局关于"人工智能+药品监管"的实施意见 (国药监综〔2026〕6号, signed 11 March 2026, published 2 April 2026) is addressed to regulators. It sets the same shape for their own AI-assisted review: "数智赋能、人工复核、全程留痕" (AI assists, people re-check, everything leaves a trace). It also insists on AI's "辅助型定位" (auxiliary role) with clear "功能边界和责任主体" (functional limits and accountable party). It plans a 计算机化系统验证指南 (computerized system validation guide) for clinical-trial records [NMPA-AI].
  - The three tiers already meet this. There is no delta for the design.

### ISO/IEC 17025 and ANAB

- **Edition.**
  - ISO/IEC 17025:2017 is still the edition in force. NATA and UKAS both cite it as current [17025-ED].
  - A secondary claim that a "2025 edition" was published traces to a dead link and is not supported.
  - No revision project was found, and the standard does not mention AI. ISO's own pages returned 403, so the catalogue stage is *not verified*.
- **§6.2 Personnel.** The assistant is not personnel. The person who adopts a draft, or relies on an answer, must be competent and hold the Authorisation for that activity: methods, analysing results, and reporting, reviewing and authorising results [17025 §6.2.5–6.2.6, as paraphrased in PJLA LF-56]. Add assistant use to system-use training (as Annex 22 §3.3 does).
- **§7.11 Data control.** The assistant is part of the LIMS. It is validated for functionality, including interfaces, before introduction, and each change, including a model change, is authorised, documented and validated [17025 §7.11.2]. Calculations and data transfers are checked [17025 §7.11.6]. Both are PJLA LF-56's paraphrase of the clauses [PJLA]. The assistant therefore does neither: it does no calculation that counts and no transfer of values. A hosted model provider is an external provider [17025 §7.11.4].
- **§6.4 Equipment.** Software counts as equipment. The model's identity and version are recorded [17025 §6.4.1, §6.4.13(a)].
- **§4.1 Impartiality.** No source links AI to impartiality. *Interpretation:* the risk is small but real if the assistant were tuned or prompted to steer results or conformity statements. Keep it out of verdicts and conformity statements (Tier 2 "may not"), and list it in the impartiality risk review.
- **§4.2 Confidentiality.** Customer data sent to a third-party model is information shared outside the Lab. See open question 1.
- **ANAB.** AR 2250 Revision 8 (effective 6 March 2026) has no text on AI, software or automation [ANAB]. ANAB's AI work is outside labs (ISO/IEC 42001 certification-body accreditation). ILAC, now the Global Accreditation Cooperation, has no AI policy for labs [ANAB]. No accreditation-body rule adds to the above.

## Recommendation

Adopt the three tiers as proposed, with these rules:

1. **The assistant never produces a value of record, a verdict, a calculation, a limit or other structured Method or Specification requirement, an impact-list entry, a Reason for Change, a reason to exclude or invalidate, or a status**, not even as a draft. Values come only from Import, typed entry or the Calculation Version.
2. **The assistant runs as the person, reads only what they can read, and holds no credentials or state-changing API.** Validation proves this.
3. **Adopted drafts carry origin metadata naming their Assistant Call, and every Assistant Call is kept at least 4 years**, or as long as the record it fed if longer.
4. **Adopting a draft needs the Authorisation for that activity, and the normal second-person review stays.**
5. **The model is configuration-controlled software.** A model change is a change: revalidate, and record the model as software identity.
6. **Revisit when Annex 22 is final** (target Q4 2026). If it opens critical uses to LLMs with guardrails, these rules still stand. They are stricter.
7. **Adopt the requirements in §"Compliance review"**, and those in §6 of the hosting and always-on agents research, which win where they differ.

## Open questions for the owner

1. **Where does the model run, and may Customer data go there?** Settled since by [Research: running an assistant within the demo's hosting, cost and security limits](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/42), §6 R1–R3: a hosted provider, no real data until an approved quality agreement, and a supplier entry with evaluation and re-evaluation.
2. **Which Tier 2 drafts are in the first build?** Deviation narratives and SOP text carry the most value and the least risk. Review Checklist pre-reads help Reviewers, but they risk anchoring the review.
3. **May the assistant suggest a Reason for Change** that the person must edit or confirm? *Interpretation:* draft Annex 11 wants the person's own reason [A11d §12.2]. The safer default is no.
4. ~~Is Tier 1 on for Customer Users in the portal?~~ Replaced by G4: the portal assistant only finds and shows released content verbatim.

## Compliance review (2026-09-30)

`part11-expert`, `iso17025-expert` and `usp-expert` reviewed this file. USP found no gaps. Part 11 found its source readings accurate and asked for seven wording or citation fixes, none of which changes a conclusion, and found ten gaps. ISO/IEC 17025 found six gaps, most shared with Part 11. The fixes, and USP's additions to "May not draft", are made in place above. Each gap is closed by a requirement that [Decide the assistant layer](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/43) must adopt. Where this file differs from §6 of [Research: running an assistant within the demo's hosting, cost and security limits](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/42) (R1–R8) or of [Research: how always-on AI agents make AI invisible (Grok Bot, OpenAI dots, Meta Muse)](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/40) (A1–A4), those sections win.

### Gaps and the requirement that closes each

| # | Gap | Requirement for #43 |
|---|---|---|
| G1 | A Document draft could change a number, limit or unit, and so change a Method or Specification without anyone noticing (211.22(c); ISO 7.11.6) | In Document drafts the assistant may not add or change any number, limit, acceptance criterion or unit. The server compares the numbers in the draft with the Effective version it started from and blocks the save on any difference the person has not typed themselves. |
| G2 | Values quoted in drafts are unchecked transcriptions (ISO 7.11.6; A11 §6) | Adopt hosting R6 and agents A1: values are filled by the server or matched on save against the Record Versions the Assistant Call read. Citations shown beside the text are not enough. Limits and Deviation impact-list entries are on "May not draft". |
| G3 | The model could state a verdict the LIMS did not compute | Adopt hosting R5: no verdicts from the model. Conformity terms are stripped or flagged on the server, and any verdict shown is rendered from the stored verdict and its Calculation Version. |
| G4 | Open question 4 would let the portal assistant interpret results for Customers (ISO 7.8.7, 6.2.6 b) | Adopt hosting R4 and agents A2. The portal assistant only finds and shows released content verbatim. Interpretation questions go to an authorised person as a Customer message. Each exchange is kept as a Customer communication record (ISO 7.1.8). A Test Report comment or Customer message that carries an opinion or interpretation is adopted or sent only by a person Authorised for opinions and interpretations, is labelled as one, and cites its basis. |
| G5 | Change control covers the model only (§11.10(k)(2); A11d §3.1(ii), §6.6; ISO 7.11.2) | Adopt hosting R7 and agents A4: one versioned assistant configuration (model, system prompt, tool definitions, role-to-tool map and the rest) that changes only through a Release Log entry signed *Approved*, with eval results attached. Every Assistant Call records the configuration version in force. |
| G6 | Retention was set only for adopted drafts (ISO 8.4) | Every Assistant Call is kept at least 4 years, including Tier 1 answers and drafts nobody adopted. One whose draft fed a record is kept for the longer of that and the record's retention. |
| G7 | "Runs as the person" leaves no room for background work, and "read" was the wrong verb (§11.10(d), (g); A11d §11.10) | Add agents A3: background work runs under a read-only non-person identity scoped to one Lab. Its output is stored with the Record Versions it read and shown only to a viewer who can read every one of them. The rule becomes: the assistant must not *disclose* anything the person cannot read. |
| G8 | A Tier 1 audit-trail summary feeds a review but leaves no trace in it (A11d §12.5–12.6) | The Review record links the Assistant Call behind any summary the Reviewer opened. "Audit trail reviewed" can be ticked only after the trail itself was shown (agents §6.3). |
| G9 | Tier 2 targets are not tied to the quality unit's clearance (Purolea; 211.22(c)) | Each target has the QA step below that clears it, or the reason it has none. |
| G10 | The call log and the Assistant Draft have no Record Type Register rows | Add the rows below. |

### Tier 2 targets and the QA step that clears each (G9)

| Target | QA step that clears it |
|---|---|
| Deviation description, investigation narrative, proposed CAPA Actions | QA closes the Deviation (In QA Review to Closed). |
| SOP revision or Method section | Reviewed by an authorised non-author, then Approved by QA [211.22(c)]. |
| Test Report comment | QA release of the Test Report. |
| Complaint description | None by default. The outcome is reviewed or approved by someone not involved [17025 §7.9]; a Complaint linked to a Deviation is cleared when QA closes that Deviation. |
| Customer message | None. It passes on released content, and an opinion in it needs the sender's opinions Authorisation (G4). It is not a procedure, specification or batch decision under 211.22. |
| Change Request description | None. It is the Customer's own request, and the Lab reviews it when each affected Test goes back to Acceptance. |
| Review Checklist pre-read | None. It is never saved into a record. The Reviewer's own second-person review [211.194(a)(8)] is the check, and the Review record links the Assistant Call (G8). |

### Record Type Register rows (G10)

Proposed for QA approval. *Interpretation: no source rules on these values.*

| Record type | Part 11 record | Legally binding signature | Raw data | Primary form | Retention | Data-integrity owner |
|---|---|---|---|---|---|---|
| Assistant Call | Yes | No | No: it is not the first capture of anything about a Sample [C4d glossary] | Electronic | At least 4 years; the longer of that and the fed record's, where a draft fed a record | The Lab Manager, named by QA in the row |
| Assistant Draft (held in its Assistant Call, as first generated) | Yes | No | No | Electronic | As its Assistant Call | As its Assistant Call |

### Glossary

The draft ID in this file, the "call log" of #42 and the "request log" of #40 are one thing. `CONTEXT.md` now names it **Assistant Call**, with **Assistant Draft** for the text a call offers to be saved into a record.

### For the owner

`iso17025-expert` found that the glossary's **Authorisation** has no scope for opinions and interpretations, which G4 needs. [Decide the assistant layer](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/43), or reopening [Decide how training records gate test assignment](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/19), must add one.

## Sources and revisions relied on

| Key | Source | Revision / date | Link |
|---|---|---|---|
| A22 | European Commission, EudraLex Vol. 4, draft *Annex 22: Artificial Intelligence* | Consultation draft, 7 July – 7 October 2025. Not in force | [PDF](https://health.ec.europa.eu/document/download/5f38a92d-bb8e-4264-8898-ea076e926db6_en?filename=mp_vol4_chap4_annex22_consultation_guideline_en.pdf) |
| A11d | European Commission, draft *Annex 11: Computerised Systems* | Consultation draft, 7 July 2025. Not in force | [PDF](https://health.ec.europa.eu/document/download/40231f18-e564-4043-94de-c031f813d38b_en?filename=mp_vol4_chap4_annex11_consultation_guideline_en.pdf) |
| C4d | European Commission, draft *Chapter 4: Documentation* | Consultation draft, 7 July 2025. Not in force | [PDF](https://health.ec.europa.eu/document/download/fa336a6e-753b-46fc-b53b-9178bacd8878_en?filename=mp_vol4_chap4_consultation_guideline_en.pdf) |
| CONS | Consultation page for Chapter 4, Annex 11 and Annex 22 | Status "Closed" | [Page](https://health.ec.europa.eu/consultations/stakeholders-consultation-eudralex-volume-4-good-manufacturing-practice-guidelines-chapter-4-annex_en) |
| EUDRA | EudraLex Volume 4 page | Checked 29 and 30 September 2026. Annex 11 "revision January 2011"; no Annex 22 | [Page](https://health.ec.europa.eu/medicinal-products/eudralex/eudralex-volume-4_en) |
| IWG | EMA, *The 3-year work plan for the Inspectors Working Group*, January 2026 – December 2028 | PDF dated 23 March 2026. Annex 22, Annex 11 and Chapter 4 each target Q4 2026 | [PDF](https://www.ema.europa.eu/en/documents/other/3-year-work-plan-inspectors-working-group_en.pdf) |
| EMA-WS | EMA, *GMP: Multistakeholder workshop on expert contributions to AI guidance development (Annex 22)* | Held 30 June – 1 July 2026; page first published 23 June 2026. No report as of 30 September 2026 | [Page](https://www.ema.europa.eu/en/events/good-manufacturing-practice-multistakeholder-workshop-expert-contributions-artificial-intelligence-guidance-development-annex-22) |
| EMA-AG | EMA, *Draft agenda Annex 22 Expert Workshop – Day 1* | 19 June 2026 | [PDF](https://www.ema.europa.eu/en/documents/agenda/annex-22-expert-workshop-draft-agenda-day-1-session-interested-parties_en.pdf) |
| EMA-RP | EMA, *Reflection paper on the use of AI in the medicinal product lifecycle*, EMA/CHMP/CVMP/83833/2023 | Final, 9 September 2024 | [PDF](https://www.ema.europa.eu/en/documents/scientific-guideline/reflection-paper-use-artificial-intelligence-ai-medicinal-product-lifecycle_en.pdf) |
| FDA-AI | FDA, *Considerations for the Use of Artificial Intelligence to Support Regulatory Decision-Making for Drug and Biological Products* | Draft, January 2025 | [PDF](https://www.fda.gov/media/184830/download) |
| FDA-FR | Federal Register notice of availability for FDA-AI | 7 January 2025 | 90 FR 1157, FR Doc. 2024-31542 | [Page](https://www.federalregister.gov/documents/2025/01/07/2024-31542) |
| FDA-PAGE | FDA CDER, *Artificial Intelligence for Drug Development* | Content current as of 1 May 2026 | [Page](https://www.fda.gov/about-fda/center-drug-evaluation-and-research-cder/artificial-intelligence-drug-development) |
| GAIP | FDA and EMA, *Guiding Principles of Good AI Practice in Drug Development* | January 2026 | [PDF](https://www.fda.gov/media/189581/download) |
| WL-PUR | FDA CDER, Warning Letter to Purolea Cosmetics Lab, MARCS-CMS 722591 | 2 April 2026 | [Page](https://www.fda.gov/inspections-compliance-enforcement-and-criminal-investigations/warning-letters/purolea-cosmetics-lab-722591-04022026) |
| CDER-DP | FDA CDER, *Artificial Intelligence in Drug Manufacturing*, discussion paper | 2023. The PDF shows only the year; the March 2023 date the review gives was not confirmed | [PDF](https://www.fda.gov/media/165743/download) |
| AIA | Regulation (EU) 2024/1689 (AI Act), Article 4 | Applies from 2 February 2025. Read from a secondary mirror because EUR-Lex returned an empty page; the OJ reference and current wording are *not verified* | [Page](https://artificialintelligenceact.eu/article/4/); [EUR-Lex](https://eur-lex.europa.eu/eli/reg/2024/1689/oj/eng) |
| CDER-AG | FDA, *CDER Guidance Agenda: New and Revised Draft Guidances Planned for Publication in Calendar Year 2026* | July 2026 | [PDF](https://www.fda.gov/media/185228/download) |
| P11 | 21 CFR Part 11, via the eCFR API | Up to date as of 28 September 2026 | [eCFR](https://www.ecfr.gov/current/title-21/chapter-I/subchapter-A/part-11) |
| 211 | 21 CFR Part 211, via the eCFR API | Up to date as of 28 September 2026 | [eCFR](https://www.ecfr.gov/current/title-21/chapter-I/subchapter-C/part-211) |
| DI | FDA, *Data Integrity and Compliance With Drug CGMP: Questions and Answers* | December 2018 (as cited in the Part 11 baseline) | [PDF](https://www.fda.gov/media/119267/download) |
| PICS | PIC/S PI 041-1, *Good Practices for Data Management and Integrity* | 1 July 2021 (as cited in the Part 11 baseline) | [Doc](https://picscheme.org/docview/4234) |
| NMPA-AI | 国家药监局关于"人工智能+药品监管"的实施意见, 国药监综〔2026〕6号 | Signed 11 March 2026, published 2 April 2026. Read from the CCFDIE mirror | [Page](https://www.ccfdie.org/cn/ggtz/webinfo/2026/05/1778087188385326.htm) |
| 17025 | ISO/IEC 17025:2017, clause text as summarised in `docs/research/iso17025.md` (branch `research/iso17025`) | ISO's own pages returned 403. Clause wording rests on accreditation-body paraphrase, as in that baseline | — |
| PJLA | PJLA LF-56, *ISO/IEC 17025:2017 Working Document* | Rev. 1.1, revised 12/20 (as cited in the ISO/IEC 17025 baseline) | [PDF](https://www.pjlabs.com/downloads/LF-56-17025-2017.pdf) |
| ANAB | ANAB AR 2250, *Accreditation Requirements: ISO/IEC 17025 Testing Laboratories (Non-Forensics)* | Revision 8, effective 6 March 2026 | [Doc](https://anab.qualtraxcloud.com/ShowDocument.aspx?ID=8160) |
| PICS-NEWS | PIC/S news, *Joint stakeholders consultation on the revision of Chapter 4, Annex 11 and on the new Annex 22* | Geneva, 7 July 2025 | [Page](https://picscheme.org/en/news/joint-stakeholders-consultation-on-the-revision-of-chapter-4) |
| PICS-A22 | PIC/S copy of draft Annex 22 | 7 July 2025, draft | [Doc](https://picscheme.org/docview/9715) |
| PE009 | PIC/S GMP Guide PE 009-18, Annexes | Dated 23 September 2026, in force 24 September 2026. Only Annex 19 changed; no AI annex | [Doc](https://picscheme.org/docview/11333) |
| JP-DX | MHLW 監視指導・麻薬対策課 事務連絡, 「デジタル用語の定義」 and 「医薬品製造業におけるデジタル技術活用事例集（2024年度版）」 | 令和7年8月19日 (2025-08-19). Reference only | [Page](https://www.mhlw.go.jp/web/t_doc?dataId=00tc9297&dataType=1&pageNo=1) |
| JP-PT | PMDA 「AI利活用に関する基本的考え方」検討PT | Active from May 2026, announced 2026-06-02. No output yet | [Page](https://www.pmda.go.jp/rs-std-jp/cross-sectional-project/0001.html) |
| 17025-ED | NATA ISO/IEC 17025 page; UKAS laboratory publications | Read 2026-09-30. Both cite ISO/IEC 17025:2017 as current | [NATA](https://nata.com.au/accreditation/laboratory-accreditation-iso-iec-17025/), [UKAS](https://www.ukas.com/resources/publications/laboratory-accreditation/) |

**Not verified or not reviewed.**
- EU AI Act obligations for the model provider or the Lab: only Article 4 (AI literacy) is noted, under "What each source says"; the rest is not reviewed.
- ISPE GAMP Guide: Artificial Intelligence (July 2025): an industry guide, not a regulator text; not reviewed.
- The retention and Record Type Register points under "Attribution, audit trail and records" are interpretation. No AI-specific source rules on them.
