# Nitrosamine LC-MS/MS LIMS

A demo LIMS for a nitrosamine QC lab, built to 21 CFR Part 11, EU GMP Annex 11 and ISO/IEC 17025. All data is fictional.

## Orient first

- **Map.** The effort is charted on the wayfinder map, [Map: Nitrosamine LC-MS/MS LIMS prototype](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/1) (`gh issue view 1`). Its Destination, Notes and Decisions so far are the project's standing decisions: read them before choosing an approach, and build on a decision rather than reopening it. Notes also set autonomy: deploys, force-pushes and data deletion pause for the owner.
- **Glossary.** `CONTEXT.md` holds the domain language. Name things in code, tickets and prose with its terms, and update it inline through the `domain-modeling` skill when a term is sharpened or added.
- **Research.** Each closed research ticket's findings live on a `research/<name>` branch: `git show origin/research/<name>:docs/research/<name>.md`. The ticket's resolution comment names the branch.
- **Coding standards.** `docs/coding-standards.md` holds the rules for all hand-written code, and `pnpm check` is the gate. The import at the end of this file loads the rules into every session.

## Workflow

- **Code work** routes through `pstack:poteto-mode`. The map's Notes list the skills it hands off to (architect, tdd, deslop, interrogate, UI skills).
- **Compliance review** is the final verification of a behaviour change, run once on the finished work. A behaviour change adds or modifies what the LIMS does: what it records, who may act, which step it blocks, how it calculates or compares a result, or what it shows, exports, signs or keeps. A decision (an ADR, a ticket answer, a glossary definition) counts as much as code, and non-GMP Tests as much as GMP ones. Everything else (refactors, renames, tests, build and dev tooling, styling, link and typo fixes, the agents and skills themselves) merges with one line in the commit, PR or ticket: "No compliance review: <reason>". When unsure, treat the work as a behaviour change.

  Run it last: once the tests pass and the code reviews are resolved, or once the ticket's resolution is written, and before the merge or the close. Dispatch in parallel each expert whose scope the work touches:
  - `part11-expert`: Part 11, FDA data integrity, EU Annex 11 (2011 and the 2025 draft), and the China and Japan computerized-system rules.
  - `iso17025-expert`: ISO/IEC 17025:2017 and ANAB AR 2250.
  - `usp-expert`: USP–NF General Notices and general chapters: methods and compendial procedures, equipment checks, reference standards, water, results rounding, and stability storage.

  Give each the whole diff range or ticket and the map ticket it serves, e.g. "Review `main...HEAD` for [Decide the Deviation workflow](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/16)". Write the range with three dots, which holds only the branch's own changes once `main` has moved on. Each returns a verdict per applicable requirement; a `gap` blocks merge until fixed or recorded as a decision on the map. After a fix, rerun only the expert that raised the gap.
- **Editing an expert agent**: rerun `python3 evals/agents/run.py` and keep it green; add a case to `evals/agents/cases.json`, with its expected verdict taken from the research, for each behaviour you change.

## Data

`OneDrive_3_9-29-2026/` holds the owner's real instrument exports. It stays local and out of git (it is in `.git/info/exclude`); read it to learn formats, and write only fictional data into the repo. Published regulatory values (acceptable intakes, pharmacopoeial limits) are the exception: they are real and cite their source and revision.

## Coding standards

@docs/coding-standards.md
