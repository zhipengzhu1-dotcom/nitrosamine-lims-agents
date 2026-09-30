# Research: running an assistant within the demo's hosting, cost and security limits

Ticket: #42 (part of map #1, feeds [Decide the assistant layer](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/43)). Every price and term below was read from the provider's own page on **2026-09-30**, unless marked otherwise. Prices are USD per million tokens (MTok), before tax. Check them again before any budget or contract decision.

It builds on [hosting research](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/blob/research/hosting/docs/research/hosting.md) (#6) and [ADR 0002](../adr/0002-react-spa-fastify-postgres-hosted-on-the-owners-mac-then-a-us-vps.md) (#14). ADR 0002 hosts the demo on the owner's Mac now and on a Lightsail 2 GB VPS in us-east-1 later. It is US-hosted, treated as an **open** system (#10), and has a real-data gate. What the assistant may do under GxP rules is ticket #39's question. This file covers only whether it can run, what it costs, and how it stays safe.

## Answer

**Yes, as a hosted API, not self-hosted.** The assistant runs as a server-side call from Fastify to a hosted model. The demo's server does no model work.

- **Model.** Claude Sonnet 5.5 (`claude-sonnet-5-5`) for both tiers, explain-and-find and draft. It costs $2 input and $10 output per MTok [A1]. It is retired no sooner than 2027-09-28 [A2][A3].
- **Demo cost.** About **$9/month** at the volume assumed below, held under a **$10/month** spend limit on a dedicated workspace [A4]. The server bill does not change.
- **Real lab.** About **$190/month**, or $212 with US-only inference. The Start tier's $500/month cap covers it [A4].
- **Self-hosting fails.** The smallest models that fit beside Postgres, Node and the worker in 2 GB are too slow and too weak. A GPU costs about $384/month.
- **Security.** The model gets read-only tools that call the same lab-scoped seam, with the signed-in person's `ActorContext`. Untrusted text reaches it only as labelled, JSON-encoded tool results. It gets no write, sign or status tools.
- **Reproducibility.** Pin the exact model ID, log every call in full, and treat a model change as a signed Release Log change with an eval rerun.

## 1. Hosted model APIs

### 1.1 Anthropic (Claude API, first-party)

**Prices** [A1]:

| Model | ID | Input | Output | Cache read | Batch in / out | Retirement, not sooner than [A3] |
|---|---|---|---|---|---|---|
| Claude Haiku 4.5 | `claude-haiku-4-5-20251001` | $1 | $5 | $0.10 | $0.50 / $2.50 | **2026-10-15** |
| Claude Sonnet 5.5 | `claude-sonnet-5-5` | $2 | $10 | $0.20 | $1 / $5 | 2027-09-28 |
| Claude Opus 5.5 | `claude-opus-5-5` | $4 | $20 | $0.20 | $2 / $10 | 2027-09-22 |
| Claude Fable 5.1 | `claude-fable-5-1` | $10 | $50 | $0.25 | $5 / $25 | 2027-09-01 |

- A 5-minute cache write costs 1.25× input, and a 1-hour write costs 2× [A1].
- US-only inference (`inference_geo: "us"`) costs 1.1× on every token category. It works on Claude 4.6 and later models only, so Haiku 4.5 rejects it with a 400 [A1][A5].
- The full 1M-token context is billed at the standard rate [A1].
- Claude 4.7 and later models use a newer tokenizer that makes about 30% more tokens for the same text [A1]. The token counts below are the billed counts.
- Haiku 4.5 is the cheapest, but it has no US-only option. It may also retire within weeks of this research (not sooner than 2026-10-15). **Don't build on it.**

**Spend control** [A4]:

- Each tier has a monthly spend cap: Start $500, Build $1,000, Scale $200,000.
- An organization or workspace can set its own lower limit. Once it is reached, requests return HTTP 400 until the month ends.
- Workspaces can also have their own rate limits.
- So the demo gets its own workspace with a $10 limit, and a runaway loop or an abusive visitor stops there.

**Data retention and training:**

- **Default retention.** For API customers, Anthropic "automatically delete[s] inputs and outputs on our backend within 30 days" [A6, updated 2026-07-01]. The API docs page says conversation content "is not retained by default" [A7]. The two pages disagree, so plan for the longer one: up to 30 days.
- **Flagged content.** Flagged content is kept up to 2 years, even under ZDR [A6][A7].
- **Training.** API data is not used for training without express permission [A7][A8].
- **Zero data retention (ZDR).** ZDR is per organization and requested through sales [A7].
  - Prompt caching and inline PDF input are ZDR-eligible.
  - The Batch API (29-day retention), the Files API, code execution and the MCP connector are not [A7].
  - Fable 5.1 is a "Covered Model" that needs 30-day retention, so it is not available under ZDR [A7].
- **DPA.** Anthropic's DPA with SCCs is automatically incorporated into its Commercial Terms [A9]. On the Claude API, Anthropic is the data processor [A7].

**Regions** [A5][A10]:

| Where | First-party Claude API | Notes |
|---|---|---|
| US | `inference_geo: "us"` (1.1×). Workspace geo (data at rest) is US-only today | Set `allowed_inference_geos: ["us"]` on the workspace so no request can escape it |
| EU | No EU inference geo | Only through Bedrock or Google Cloud regional endpoints, at a 10% premium over their global endpoints [A1]. Their retention terms are the cloud provider's, not Anthropic's [A7] |
| Japan | Japan is a supported country. No Japan inference geo | Bedrock and Google Cloud regional endpoints, as for the EU (not verified per model) |
| China | Mainland China and Hong Kong are **not supported**. Anthropic may also refuse entities majority-owned from unsupported countries [A10] | The same holds for OpenAI [O4] and Gemini [G3]. A China lab would need a domestic provider under Chinese rules, which is outside this ticket |

### 1.2 OpenAI API

- **Prices.** `gpt-5.6-terra` $2 input / $0.20 cached / $12 output; `gpt-5.6-luna` $0.20 / $0.02 / $1.20; `gpt-5.6-sol` $4 / $0.40 / $20. Batch is 50% off [O1].
- **Regional uplift.** Data-residency endpoints carry a 10% uplift for models released on or after 2026-03-05 [O1].
- **Retention and training.** Abuse-monitoring logs are kept up to 30 days. API data is not used for training unless you opt in [O2].
- **ZDR.** ZDR needs OpenAI's approval, and some endpoints can't use it [O2].
- **Regions.** US and EU support regional processing. Japan and other regions store data only [O2].
- **Deprecation.** Generally available models get at least 6 months' notice [O3].
- **DPA.** Not verified: the enterprise-privacy page could not be read.

### 1.3 Google Gemini API

- **Prices.** `gemini-3.8-flash` $0.75 input / $3.75 output through 2026-12-31, **doubling to $1.50 / $7.50 on 2027-01-01**. `gemini-3.5-flash-lite` $0.30 / $2.50. `gemini-3.1-pro-preview` $2 / $12 [G1].
- **Training.** Paid-tier content is "not used to improve our products". Free-tier content is used, so the free tier is ruled out [G1][G2].
- **Retention.** Both tiers allow 30-day logging for abuse enforcement [G2].
- **Deprecation.** No minimum notice period is stated [G4].
- **Not verified.** Vertex AI prices, ZDR and residency terms could not be read in full.

### 1.4 Cost estimate

**Assumptions** (mine, to be replaced by measured `usage` once the feature runs):

| Call | Input tokens | Output tokens (incl. thinking) | What goes in |
|---|---|---|---|
| Explain and find | 6,000 | 800 | System prompt and tool definitions (~3,000), the question, and the records the tools return (~3,000) |
| Draft | 12,000 | 2,000 | As above, plus the Deviation or Run, its Results, and the relevant Method and SOP excerpts |

| Volume per month | Explain calls | Draft calls | Basis |
|---|---|---|---|
| Demo | 300 | 60 | Owner plus a few visitors, about 10 questions and 2 drafts a day |
| Real lab | 7,000 | 1,200 | 25 staff × 12 questions × 22 working days = 6,600, plus ~400 from Customer Users. Drafts: one review comment for about half of 500+ samples, plus Deviations, Holds and Customer replies |

**Per call** = input tokens × input price + output tokens × output price. For Sonnet 5.5:

- Explain: 6,000 × $2/1M + 800 × $10/1M = $0.012 + $0.008 = **$0.020**
- Draft: 12,000 × $2/1M + 2,000 × $10/1M = $0.024 + $0.020 = **$0.044**

**Per month:**

| Model | Explain / call | Draft / call | Demo (300 + 60) | Real lab (7,000 + 1,200) | Real lab, US-only ×1.1 |
|---|---|---|---|---|---|
| Claude Haiku 4.5 | $0.010 | $0.022 | $3.00 + $1.32 = **$4.32** | $70.00 + $26.40 = **$96.40** | n/a (no `inference_geo`) |
| **Claude Sonnet 5.5** | $0.020 | $0.044 | $6.00 + $2.64 = **$8.64** | $140.00 + $52.80 = **$192.80** | **$212.08** |
| Claude Opus 5.5 | $0.040 | $0.088 | $12.00 + $5.28 = **$17.28** | $280.00 + $105.60 = **$385.60** | $424.16 |
| Claude Fable 5.1 | $0.100 | $0.220 | $30.00 + $13.20 = **$43.20** | $700.00 + $264.00 = **$964.00** | $1,060.40 |
| OpenAI gpt-5.6-terra | $0.0216 | $0.048 | **$9.36** | **$208.80** | ×1.1 on residency endpoints |
| OpenAI gpt-5.6-luna | $0.00216 | $0.0048 | **$0.94** | **$20.88** | ×1.1 |
| Gemini 3.8 Flash (2026 price) | $0.0075 | $0.0165 | **$3.24** | **$72.30** (2027: $144.60) | not verified |

Worked examples:

- Sonnet 5.5, demo: 300 × $0.020 + 60 × $0.044 = $6.00 + $2.64 = $8.64.
- Sonnet 5.5, real lab: 7,000 × $0.020 + 1,200 × $0.044 = $140 + $52.80 = $192.80. US-only: $192.80 × 1.1 = $212.08.

**Levers.**

- **Prompt caching.** Caching the ~3,000-token system prompt and tool block saves 3,000 × ($2 − $0.20)/1M = $0.0054 per cache hit on Sonnet 5.5. That is about $44/month at real-lab volume if most calls hit, but little on the demo, where the 5-minute cache often expires between calls.
- **Batch API.** It halves the price, but it is not ZDR-eligible [A7] and is too slow for in-context buttons. It suits only overnight jobs.
- **Effort.** Lower effort cuts thinking tokens. Measure it on the eval set before relying on it.

**Reading the numbers.**

- Token counts differ between providers' tokenizers, so the cross-provider rows are rough.
- Quality differs more than price. Model choice belongs to #43, against an eval set of fictional cases (section 5).
- At real-lab volume, even Opus 5.5 is under 0.05% of the lab's estimated $1M+/month revenue. The demo budget, not the lab's, is what constrains the choice.

### 1.5 Is the provider a supplier needing a quality agreement?

**Yes.** Once the assistant sends records to a provider, that provider holds GxP data on its own systems for up to 30 days. That is the open-system case in #10: records "stored on systems operated by third parties". The EU research (row E7) already requires a written agreement with a hosted service: Annex 11 §3.1 now, and the draft Annex 11 §7.1–7.5 adds SLAs, audit rights, incident notice and an exit path.

- **Demo, fictional data.** Add Anthropic to ADR 0002's supplier table. It holds prompts and outputs for up to 30 days (flagged content up to 2 years), and its exit path is to switch provider, since nothing is stored there that the LIMS doesn't keep itself. The standard Commercial Terms and incorporated DPA [A9] are enough while all data is fictional.
- **Before real data.** Add the provider to the real-data gate's list of supplier quality agreements. The agreement should cover:
  - retention, and ZDR if obtained;
  - US-only inference;
  - notice of model retirement and of changes;
  - incident notice;
  - the ownership and use of data.
- **A standard DPA is not a quality agreement.** It covers privacy, not GMP. Whether Anthropic will sign GMP terms is not verified. If it won't, the lab records the gap in a supplier assessment, as E7 already says to do for the VPS.

## 2. Self-hosted small models

**Not usable on the demo's server. A usable add-on costs far more than the budget.**

- **No spare RAM.** Lightsail 2 GB has 2 vCPUs, 60 GB and costs $12/month, and Postgres, Node, the PDF worker and Caddy already share its memory [L1]. The next sizes up are 4 GB for $24 and 8 GB for $44, both still 2 vCPU. No GPU bundle is offered [L1].
- **What fits.**
  - At 4-bit, Qwen3.5-0.8B is a 533 MB file [S1].
  - Qwen3.5-2B (Apache-2.0, February 2026) is 1.28 GB before its KV cache [S2]. Neither leaves room for the stack.
- **Speed.** No published llama.cpp figures exist for 2 shared x86 vCPUs (not verified).
  - The nearest measured point is a Raspberry Pi 5 with 4 real cores. It prompt-processes a 3B model at about 27 tokens/s and generates at about 6 tokens/s [S3, a community benchmark].
  - Halve that for 2 shared vCPUs that also serve Postgres. A 3,000-token explain prompt would then take about 3,000 ÷ 15 = 200 s before the first word. That is unusable for an in-context button.
- **Quality.**
  - Qwen3.5-2B scores 55.3 MMLU-Pro and 61.2 IFEval in its default mode. Thinking mode reaches 66.5 and 78.6, with 43.6 on BFCL-V4 tool use and 25.6 on AA-LCR long-context reasoning [S2].
  - Its model card warns it is "more prone to entering thinking loops".
  - A model that follows instructions only 61% of the time can't be trusted to quote a Result's value exactly or to ignore instructions planted in a portal message.
- **GPU add-on.** AWS g4dn.xlarge (T4, 16 GB) is about $0.526/hour on demand in us-east-1 [S4, third-party listing; AWS's own page did not render the figure]. Running it 24×7 costs 0.526 × 730 h = **$384/month**, which is more than the real lab's whole Sonnet 5.5 bill.
- **Cheaper CPU boxes.** Hetzner's larger CPU boxes are EU-only, and ADR 0002 rejected them.
- **What self-hosting would buy.** It keeps data off a third-party model provider. That matters only once real data exists, and the lab can then pay for a GPU host or buy ZDR from the API provider instead.

## 3. Security

### 3.1 Where untrusted text comes from

- Customer portal messages
- Submission free text (sample descriptions, notes)
- Uploaded PDFs (Customer CoAs, SDSs, Protocol drafts)
- The text of instrument reports (MassLynx exports)
- Free text in any record an outsider can influence

Indirect prompt injection works because "GenAI models combine the data and instruction channels" [N1 §3.4]. NIST's advice is to "design systems with the assumption that prompt injection attacks are possible" [N1 §3.4.4]. OWASP also doubts that "fool-proof methods of prevention" exist [W1]. So the design limits what a successful injection can reach, rather than trying to stop every injection.

### 3.2 Controls

1. **No act tools at all.** The assistant has read tools and a "propose draft" output, nothing else.
   - It gets no tool that saves, signs, releases, accepts, changes status, sends a message or emails.
   - This follows OWASP LLM06: minimise extensions, "read-only" access, and human approval for high-impact actions [W3].
   - A draft appears in the person's own editor as unsaved text. It becomes a record only when that person saves it and, where required, gives an Electronic Signature. How that is attributed is #39's and #43's question.
2. **Same seam, same person.**
   - Each read tool is a thin wrapper over the query functions the UI already calls through the lab-scoped seam. It uses the `ActorContext` Fastify built for the request, with the same person, role and Lab.
   - The model never sees SQL, database credentials or the API key, and never chooses the Lab or Customer. Those come from the context, not from tool arguments.
   - This is OWASP's "execute in the user's context" and "complete mediation" [W3].
   - Consequences:
     - A Customer User's assistant can reach only that Customer's work, because the seam already enforces it.
     - An Analyst's assistant can't see a Lab they don't belong to.
     - A test like the seam test in ADR 0002 should prove that an assistant tool call without the context's Lab fails.
3. **Untrusted text only as labelled tool results.** Anthropic's guidance [A11], applied here:
   - Put third-party content only in `tool_result` blocks.
   - Say where it came from, for example `{"source":"portal_message","customer":"…","text":"…"}`.
   - JSON-encode it so it can't break out of its quotes.
   - Put an untrusted-content policy in the system prompt.
   - Never put the app's own instructions inside tool results.
   - Optionally screen tool output with a small classifier call first. Anthropic suggests Haiku 4.5, which would need replacing when it retires.
4. **No cross-Customer or cross-Lab retrieval.**
   - One conversation serves one `ActorContext` and holds nothing across sessions.
   - Start with structured search (sample number, Lot, Method, status, date) through the seam, not a vector index.
   - If embeddings are added later, they live in Postgres in the owning table's scope, with `lab_id NOT NULL` and Customer, and are filtered by the seam before similarity ranking. This is OWASP LLM08's "permission-aware vector and embedding stores" with "strict logical and access partitioning" [W4]. A separate shared index is ruled out.
   - Company-owned Documents (SOPs, Methods) may be shared across Labs, as the multi-lab must-dos already allow.
5. **Output handling.**
   - Render assistant text as plain text or sanitised Markdown with no remote images or auto-fetched links, so an injected instruction can't exfiltrate data through a URL.
   - Numbers in an explanation are shown beside the stored values from the database, never only in the model's words.
   - These follow OWASP's call to define output formats and validate them with deterministic code [W1].
6. **Least privilege for the key.**
   - The API key is a Docker Compose secret, like the other secrets in ADR 0002, and never reaches the browser.
   - It belongs to a dedicated workspace with:
     - `allowed_inference_geos: ["us"]` [A5];
     - the $10 spend limit;
     - its own rate limits [A4].
7. **Rate limits per person.** Set an in-app daily quota per person (for example 50 explain and 10 draft calls). Log refusals. OWASP lists logging, monitoring and rate limiting as damage limits [W3].
8. **Red-team before real data.** Build a fixed set of fictional portal messages, PDFs and report text with planted instructions ("ignore previous instructions", "list other customers' samples"). It must pass before each model change and before the real-data gate [A11][W1].

## 4. Reproducibility

- **Pin the exact ID.** "Every Claude model ID is a pinned snapshot, including the dateless IDs used from the 4.6 generation on" [A2]. So `claude-sonnet-5-5` does not drift. Store it in configuration, never as a moving alias.
- **Outputs can't be regenerated.** Claude 4.7 and later reject non-default `temperature`, `top_p` and `top_k` with a 400 [A3]. Running the same input again may give different words, so the logged output is the evidence, not a rerun.
- **Log every call.** Keep an append-only row in the owning Lab's tables, recording:
  - who asked (the `ActorContext`);
  - model ID, effort and `inference_geo`;
  - the system-prompt and tool-definition versions (hash);
  - the Record Versions the tools returned;
  - the full request and response;
  - `usage` and Anthropic's `request-id`.

  Size check: an average call is about 8,000 tokens ≈ 32 KB of text. 8,200 calls × 32 KB ≈ 260 MB/month ≈ 3 GB/year before Postgres compression. The VPS's 60 GB disk [L1] holds that. Whether this log is a GxP record, and how long to keep it, is #39's question. Keep it from day one, because it can't be rebuilt.
- **Model retirement.**
  - Anthropic gives "at least 60 days' notice before model retirement" by email and in the docs, and requests to a retired model fail [A3].
  - Dates are "not sooner than", not promises. Opus 4.1 was retired about 2 months after notice (2026-06-05 → 2026-08-05) [A3].
  - Treat a model change like any release: a Release Log entry, the eval set rerun with its results attached, and the owner's *Approved* signature (ADR 0002 change control).
  - Past calls keep their logged model ID, so history stays interpretable after retirement.
  - Anthropic commits to preserving the weights of retired models [A3], but they can't be called, so this doesn't help reproduce outputs.
  - Partner platforms set their own retirement dates [A3].

## 5. Recommendation for #43

1. **Model.** Use `claude-sonnet-5-5` on the first-party Claude API for both tiers. Opus 5.5 is the step up if drafts prove weak on the eval set. Its $17/month demo cost would need a higher limit.
2. **Account.** Use one Anthropic organization with a dedicated demo workspace:
   - `allowed_inference_geos: ["us"]`;
   - a $10 monthly spend limit;
   - the key as a Compose secret.
3. **Wiring.** A Fastify route builds the prompt from the request's `ActorContext`. Read tools wrap the lab-scoped seam. Untrusted text goes in as JSON tool results. There are no write tools.
4. **Records.** Keep an append-only assistant call log, and pin the model ID in configuration.
5. **Change control.** Keep an eval set of fictional explain, draft and injection cases, rerun on every model change as a Release Log entry.
6. **Supplier.** Add Anthropic to ADR 0002's supplier table now. Add a quality agreement (and ZDR if obtainable) to the real-data gate.
7. **Out of scope.** Self-hosting and Haiku 4.5 are ruled out. China labs are out of scope.

## 6. Compliance review (2026-09-30)

`part11-expert`, `iso17025-expert` and `usp-expert` reviewed this file. USP found no gaps. Part 11 found five and ISO/IEC 17025 six, overlapping. Each gap below is fixed by a requirement that [Decide the assistant layer](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/43) must adopt. The requirements supersede §3.2, §4 and §5 where they differ.

### 6.1 Gaps and the requirement that closes each

| # | Gap | Requirement for #43 |
|---|---|---|
| R1 | Record content sits at the provider under its keys and retention (up to 30 days, flagged content up to 2 years), and nothing stops real data reaching it (§11.30; A11d §10.4; ISO 4.2.4) | While the data class is `real`, the assistant route refuses to call the provider unless a Release Log entry signed *Approved* names Anthropic's quality agreement and either ZDR in force or a QA-signed risk acceptance covering both copies. "Assistant provider" joins the real-data gate's lapse list. Tools return only the fields the question needs. |
| R2 | The quality-agreement list is short (A11d §7.2–7.5; ISO 4.2.4) | Add: audit rights or an accepted substitute (SOC 2, ISO 27001), support at inspections, SLAs and response times, how quality and security issues are reported, a written exit strategy, how provider staff reach retained prompts and how that is logged, sub-processors, confidentiality of Customer information, and written confirmation of the retention period. Where Anthropic won't sign GMP terms, a QA-signed supplier assessment records each missing item, as row E7 requires for the VPS. |
| R3 | Anthropic's supplier entry has no evaluation, monitoring or re-evaluation (ISO 6.6.2, 7.11.4) | The entry records the requirements (US-only geo, no training use, retention ≤ 30 days, 60-day retirement notice, incident notice), this file as evaluation evidence, re-evaluation at every model change and at least yearly, and the person who watches deprecation notices. |
| R4 | Portal answers give Customers interpretations no authorised person released (ISO 7.8.7.1, 6.2.6) | For Customer Users the assistant only finds, navigates and shows released report content verbatim with stored values. It refuses interpretation and conformity questions and turns them into a portal message to an authorised person. Each exchange is kept as a Customer communication record (7.1.8). A role-keyed tool registry gives Customer Users only portal queries, and a test proves they can't return an unreleased or OOS value. |
| R5 | The model can state a verdict the LIMS didn't compute (#23 build rule 14; JIREI GMP20-11) | The system prompt forbids verdicts. A server-side check flags or strips conformity terms (pass, fail, conforms, OOS, within or out of specification). Any verdict in the assistant panel is rendered from the stored verdict and its Calculation Version (ADR 0006). |
| R6 | Values inside drafts are unchecked transcriptions (ISO 7.11.6; A11 §6, A11d §10.2) | Drafts cite Results, limits, Lot numbers and IDs as references the server fills from the database. Any number or identifier left in free text is matched, on save, against the Record Versions the call log recorded, and a mismatch is highlighted before the person can save. Limits keep their written decimals (GN 7.10) and results their stored rounding (GN 7.20). |
| R7 | Change control covers only the model ID, and the eval set has no pass criteria (§11.10(k)(2); A11d §6.6; ISO 7.11.2) | One versioned assistant configuration holds the model ID, system prompt, tool definitions, untrusted-content policy, effort, `inference_geo`, quotas, screening classifier and role-to-tool map. It changes only by a Release Log entry signed *Approved* with eval and red-team results attached. Every eval case has a written pass criterion. A passing run is required before first use. The server refuses a configuration hash with no Release Log entry. The eval set reruns monthly to catch provider drift. |
| R8 | Assistant failures aren't System Incidents (ISO 7.11.3 e) | Add to ADR 0002's System Incident list: assistant unavailable (spend or rate limit, outage, retired model), a flagged or confirmed injection, and a confirmed wrong output someone saved. The last two open a Data Integrity Deviation. |

### 6.2 Unclear points, settled

- **Call log.** INSERT-only grant, the audit tables' blocking triggers, each row on the Lab's hash chain, database-clock timestamps, `lab_id NOT NULL`, no UI or API that turns logging off, reads restricted (rows hold Customer content), a Record Type Register row with a raw-data flag and a named data-integrity owner. Retention is at least the 4-year floor, or that of the record the draft became if longer; [Research: what an AI assistant may do in a GxP LIMS](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/39) may lengthen it.
- **Attribution of a saved draft.** The person who saves is the author. The save's audit entry carries the call-log row ID and an "assistant-drafted" flag, and the model's pre-edit text stays in the call log.
- **Documents.** Document tools return only the Effective version, or the version the Test pins, and answers cite Document ID and version. Methods are limited to this Lab's Method Adoptions.
- **Transport and console.** HTTPS with certificate verification and no TLS-terminating proxy. The Anthropic Console account goes in the access-rights register with MFA, named key holders and a rotation interval.

### 6.3 Procedural

- Assistant use is enabled per person only with a current Training Record on an assistant-use SOP (building on the training decision). The assistant's instructions and limits are a controlled document in the vault.
- Before real Customer data, each Customer's Quality Agreement names the model provider as a sub-processor. A per-Customer flag disables Customer-scoped tools until that is recorded.
- The assistant route is in the penetration-test scope.

### 6.4 For the owner

`iso17025-expert` found that ADR 0002's supplier table for IT providers (Cloudflare, AWS, Apple, now Anthropic) has no evaluation, approval or re-evaluation fields, and the glossary's **Supplier** covers only Materials and calibration services. This predates the assistant and is left for the owner to decide.

## Sources (read 2026-09-30)

- [A1] Anthropic, Pricing: https://platform.claude.com/docs/en/about-claude/pricing
- [A2] Anthropic, Models overview: https://platform.claude.com/docs/en/about-claude/models/overview
- [A3] Anthropic, Model deprecations: https://platform.claude.com/docs/en/about-claude/model-deprecations
- [A4] Anthropic, Rate limits (spend limits, workspace limits): https://platform.claude.com/docs/en/api/rate-limits
- [A5] Anthropic, Data residency: https://platform.claude.com/docs/en/manage-claude/data-residency
- [A6] Anthropic Privacy Center, "How long do you store my organization's data?" (updated 2026-07-01): https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data
- [A7] Anthropic, API and data retention (ZDR scope, Covered Models, feature eligibility): https://platform.claude.com/docs/en/manage-claude/api-and-data-retention
- [A8] Anthropic Privacy Center, "Is my data used for model training?": https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training
- [A9] Anthropic Privacy Center, DPA: https://privacy.claude.com/en/articles/7996862-how-do-i-view-and-sign-your-data-processing-addendum-dpa
- [A10] Anthropic, Supported countries and regions: https://www.anthropic.com/supported-countries
- [A11] Anthropic, Mitigate jailbreaks and prompt injections: https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/mitigate-jailbreaks
- [O1] OpenAI, API pricing: https://developers.openai.com/api/docs/pricing
- [O2] OpenAI, Your data: https://developers.openai.com/api/docs/guides/your-data
- [O3] OpenAI, Deprecations: https://developers.openai.com/api/docs/deprecations
- [O4] OpenAI, Supported countries: https://developers.openai.com/api/docs/supported-countries
- [G1] Google, Gemini API pricing: https://ai.google.dev/gemini-api/docs/pricing
- [G2] Google, Gemini API terms: https://ai.google.dev/gemini-api/terms
- [G3] Google, Gemini API available regions: https://ai.google.dev/gemini-api/docs/available-regions
- [G4] Google, Gemini API deprecations: https://ai.google.dev/gemini-api/docs/deprecations
- [L1] AWS, Lightsail pricing: https://aws.amazon.com/lightsail/pricing/
- [S1] Unsloth, Qwen3.5-0.8B GGUF: https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF
- [S2] Qwen, Qwen3.5-2B model card: https://huggingface.co/Qwen/Qwen3.5-2B (GGUF size: https://huggingface.co/unsloth/Qwen3.5-2B-GGUF)
- [S3] Raspberry Pi 5 llama.cpp benchmark (community): https://github.com/leemailto2008/pi5-llm-arena
- [S4] g4dn.xlarge on-demand price, us-east-1 (third-party listing): https://instances.vantage.sh/aws/ec2/g4dn.xlarge?region=us-east-1
- [W1] OWASP Top 10 for LLM Applications 2025, LLM01 Prompt Injection: https://genai.owasp.org/llmrisk/llm01-prompt-injection/
- [W2] OWASP LLM02 Sensitive Information Disclosure: https://genai.owasp.org/llmrisk/llm022025-sensitive-information-disclosure/
- [W3] OWASP LLM06 Excessive Agency: https://genai.owasp.org/llmrisk/llm062025-excessive-agency/
- [W4] OWASP LLM08 Vector and Embedding Weaknesses: https://genai.owasp.org/llmrisk/llm082025-vector-and-embedding-weaknesses/
- [N1] NIST AI 100-2e2025, Adversarial Machine Learning (March 2025): https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-2e2025.pdf
- [N2] NIST AI 600-1, Generative AI Profile: https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf
- Internal: [research/eu](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/blob/research/eu/docs/research/eu.md) row E7; [research/part11-closed-open](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/blob/research/part11-closed-open/docs/research/part11-closed-open.md); ADR 0002.

## Not verified

- Whether Anthropic will sign GMP quality-agreement terms, and ZDR eligibility for a small organization.
- Anthropic's two retention statements disagree ("not retained by default" [A7] against "within 30 days" [A6]). This file plans for 30 days.
- Per-model availability of Claude on Bedrock and Google Cloud regional endpoints in the EU and Japan.
- Vertex AI prices, ZDR and residency terms. The OpenAI DPA.
- CPU inference speed on 2 shared x86 vCPUs. The 200 s figure is an estimate from Pi 5 data.
- The g4dn price on AWS's own page.
- The token counts per call are assumptions, to be replaced by measured `usage`.
