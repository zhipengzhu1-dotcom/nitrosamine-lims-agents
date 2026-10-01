# The assistant reads as the asker and drafts prose; it never acts, and no number or verdict comes from the model

The LIMS has an AI assistant for people who don't use AI. It explains and finds, reading only what the person who asked may read, and it drafts prose that a person edits and saves as their own. It never acts. The model holds no LIMS credential: its path uses a database role with SELECT on business tables and INSERT only on the Assistant Call table, and every state-changing route rejects it. Draft EU GMP Annex 22 keeps LLMs out of critical GMP uses, Part 11 gives a signature to one genuine owner, and FDA requires the quality unit to clear AI output. The limits are therefore enforced by the server, not by instructions to the model.

- **Values and verdicts.** Every number, limit, result and identifier in an answer or an Assistant Draft is filled by the server from the stored record, or matched on save against the Record Versions the Assistant Call read. A save with an unmatched number is refused until the person types it. Rounding and verdicts come only from the Calculation Version (ADR 0006).
- **Authorship.** The person who saves is the author. The server sets an assistant-drafted mark and the Assistant Call ID on any save to a field for which an Assistant Draft was offered to that person in that session, however the text got there. Nobody can remove the mark.
- **Change control.** One Assistant Configuration (model ID, system prompt and templates, tool definitions, role-to-tool map, retrieval parameters, untrusted-content policy, effort, inference region, workspace, quotas, screening classifier) changes only by a Release Log entry signed *Approved* with eval and red-team results. The server refuses a configuration hash with no such entry.
- **No dependency.** Every assistant surface has a path that works without it, so a spend limit, an outage or a failed monthly eval rerun switches the assistant off and blocks nothing.
- **Hosting.** Claude Sonnet 5.5 on Anthropic's first-party API, US-only inference, under its own $10/month spend limit.

Source: [Decide the assistant layer](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/43), which holds the surfaces, draft targets, training gate and monitoring.

## Considered options

- **An agent that acts as the signed-in person.** Rejected: it is a second actor behind one identity, which is the shared-login failure (Part 11 §11.100(a), §11.200(a)(2)), and a session that can sign defeats re-authentication (draft Annex 11 §13.3).
- **An assistant account that can write.** Rejected: an LLM deciding is a critical GMP application (draft Annex 22 §1).
- **Drafted values that a person accepts.** Rejected: a number someone skims and accepts still has direct impact. Values come from the validated Import or typed entry.
- **A chat panel with history across records.** Rejected: it carries context between records and Customers. Follow-up questions stay on one record and end when it changes.
- **Background preparation under a non-person identity.** Rejected for now: nothing needs it. If added, it is a new decision, read-only and scoped to one Lab.
- **A portal assistant for Customer Users.** Left out of the first build. The only form it may ever take finds and shows released content word for word and refuses interpretation.
- **A self-hosted model.** Rejected by the hosting research on cost and quality.
- **Marking assistant-drafted text on the face of a Test Report.** Rejected: no rule requires it. The mark is in the Audit Trail and its exports, and each Quality Agreement says which Customer-facing text may begin as an Assistant Draft.

## Consequences

- **Don't give the assistant path a write grant or a new route "to save a click".** The test that every state-changing route rejects it is part of validation.
- **Citations are built from the Assistant Call, never from the model's words.** A citation of a record the call didn't read is dropped and opens a System Incident.
- **The Assistant Call table is a Part 11 record** on the Lab's hash chain, kept at least 4 years, or as long as the record a draft fed if longer.
- **Revisit** when Annex 22 is final (targeted for Q4 2026) and on any model retirement notice. Both are change-control triggers.
