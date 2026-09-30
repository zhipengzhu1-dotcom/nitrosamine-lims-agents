# Nitrosamine LC-MS/MS LIMS

A demo LIMS for a nitrosamine QC lab, built to 21 CFR Part 11, EU GMP Annex 11 and ISO/IEC 17025. All data is fictional.

## Orient first

- **Map.** The effort is charted on the wayfinder map, [Map: Nitrosamine LC-MS/MS LIMS prototype](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/1) (`gh issue view 1`). Its Destination, Notes and Decisions so far are the project's standing decisions: read them before choosing an approach, and build on a decision rather than reopening it. Notes also set autonomy: deploys, force-pushes and data deletion pause for the owner.
- **Glossary.** `CONTEXT.md` holds the domain language. Name things in code, tickets and prose with its terms, and update it inline through the `domain-modeling` skill when a term is sharpened or added.
- **Research.** Each closed research ticket's findings live on a `research/<name>` branch: `git show origin/research/<name>:docs/research/<name>.md`. The ticket's resolution comment names the branch.

## Workflow

- **Code work** routes through `pstack:poteto-mode`. The map's Notes list the skills it hands off to (architect, tdd, deslop, interrogate, UI skills).
- **Compliance review.** Before merging any change or closing any ticket that touches records, audit trail, e-signatures, login or accounts, roles and authorisation, the sample chain, results, equipment, inventory, Deviations, documents, reports, retention or hosting, dispatch both expert agents in parallel and resolve their findings:
  - `part11-expert`: Part 11, FDA data integrity, EU Annex 11 (2011 and the 2025 draft), and the China and Japan computerized-system rules.
  - `iso17025-expert`: ISO/IEC 17025:2017 and ANAB AR 2250.

  Give each the diff range or ticket and the map ticket it serves, e.g. "Review `main..HEAD` for [Decide the Deviation workflow](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/16)". Each returns a verdict per applicable requirement; a `gap` blocks merge until fixed or recorded as a decision on the map.
- **Editing an expert agent**: rerun `python3 evals/agents/run.py` and keep it green; add a case to `evals/agents/cases.json`, with its expected verdict taken from the research, for each behaviour you change.

## Data

`OneDrive_3_9-29-2026/` holds the owner's real instrument exports. It stays local and out of git (it is in `.git/info/exclude`); read it to learn formats, and write only fictional data into the repo.
