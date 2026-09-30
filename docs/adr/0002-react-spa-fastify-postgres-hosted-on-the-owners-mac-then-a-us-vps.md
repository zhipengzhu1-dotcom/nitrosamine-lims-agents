# React SPA + Fastify + Postgres, hosted on the owner's Mac until a US VPS

We build a Vite + React 19 single-page app on a Fastify 5 API (Node 24), with Kysely (types generated from the database) over PostgreSQL 18 and a Python pdfplumber worker, in one pnpm monorepo. Authorisation is checked in Fastify for every request through a per-request `ActorContext`, never in framework middleware. That is why Next.js was rejected: its 2025 middleware-bypass CVE (CVE-2025-29927) is the failure this project can't afford. Login is built in-house: password + TOTP in the walking skeleton, with passkeys following, which is why the demo needs a real domain. The demo is US-hosted. For now it runs on the owner's MacBook, and it moves to an AWS Lightsail 2 GB VPS in us-east-1 (about $13/mo with the domain) once it has to be always on. The move is a restore of the latest backup, so nothing may depend on macOS. Source: [Decide the tech stack and hosting](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/14), reviewed by the Part 11 and ISO/IEC 17025 expert agents.

## Must-dos carried from the multi-lab research

- Company-owned tables are kept apart from lab tables, and every lab table has `lab_id NOT NULL`. A nullable `lab_id` silently bypasses composite foreign keys and per-lab unique keys.
- Every sample number and report number carries a lab code.
- Fastify builds an `ActorContext` (person, role, Lab) for each request. All data access goes through one lab-scoped seam, and a test proves that a query without the context's Lab fails.
- There is a company audit chain alongside each Lab's chain.
- Each Test has its own `lab_id`, separate from its Submission.
- Each Test has a GxP Class.
- Deferred: Postgres row-level security, per-lab export, and deployment automation.

## Hosting shape

- **Runtime.** Docker Compose runs Caddy, the app, Postgres and the worker, with images pinned by digest and built for arm64 and amd64. On the Mac the runtime is Colima, not Docker Desktop: Docker Desktop's free licence stops at 250 employees or $10M revenue, and the company is over that.
- **Storage.** Compose uses named volumes only. A CI check fails on any bind mount, so the server can never reach the owner's real instrument exports in the repo folder.
- **Secrets.** Docker Compose secrets hold the TOTP encryption key, the password pepper, the token for the Worker's upload endpoint, the SES credentials and the `age` public key. They are read from owner-only files outside the repo and never committed.
- **Reaching the demo.** On the Mac, the demo is reached only through a Cloudflare Tunnel on a domain bought from Cloudflare Registrar, so no router port is opened. On the VPS, DNS is grey-cloud (not proxied) and Caddy terminates TLS itself.
- **Time.** chrony with NTS against time.cloudflare.com runs inside the Linux VM. `makestep` steps the clock at once after the Mac wakes, and each step is a System Incident. The API refuses audited writes until chrony reports sync within 1 second. Audit timestamps come from the database clock.
- **Encryption at rest with lab-held keys** (the §11.30 open-system control):
  - On the Mac, FileVault covers it, turned on 2026-09-29. Its recovery key must be held by the owner, not escrowed to iCloud.
  - On the VPS, the Postgres and report-store volumes are LUKS-encrypted with a passphrase the lab holds, unlocked by hand over SSH after each reboot. The move is blocked until this is in place.

## Integrity, backup and recovery

- **Anchoring.** A Cloudflare Worker on a 15-minute cron holds the audit-anchor HMAC key as a Worker secret. It pulls each chain head from the server and writes it to AWS S3 with Object Lock in **compliance mode**, where no account, root included, can delete an object or shorten its retention. Retention defaults to 4 years, the ANAB AR 2250 floor, and is extended when retention classes are set. R2's bucket lock was rejected for anchors, because Cloudflare documents lock rules as removable by anyone with bucket permissions.
- **Backups.**
  - A nightly `pg_dump`, the report store and the operator logs are encrypted with `age` and sent to R2, a different provider and network that serves as the second site.
  - The server holds no R2 credential. It uploads through the Cloudflare Worker, which writes through its R2 binding under a new time-stamped key and refuses to overwrite an existing key. So the server can add backups but can't delete, list or replace them. An owner-set 7-day R2 lock on the backup prefix adds a second guard, no longer than the shortest rotation so the lifecycle rule can still expire old dailies.
  - Backup retention is 7 daily, 4 weekly and 12 monthly backups, plus a yearly one kept 4 years, applied by an R2 lifecycle rule the owner sets and the server can't change.
  - Operator logs go to their own prefix, outside that rotation, and are kept 4 years.
  - Each backup run is recorded on the company audit chain.
  - The `age` private key exists in two offline copies in separate places.
- **Recovery.** The written objectives are 24 hours to restore (RTO) and 24 hours of data loss (RPO). A restore drill runs each quarter, decrypting with one of the two key copies. It passes when chain-verify succeeds against the S3 anchors and every report-store hash matches.
- **System Incidents.**
  - **What counts:** chain-verify failure, a missed backup or anchor, a failed drill, a clock step, a lockout, or repeated failed signing.
  - **The record:** each is written to the company chain, shown in an in-app alarm list, and emailed through SES to the owner's inbox (an address kept in deployment config).
  - **Closing:** the owner records the immediate and corrective actions and signs *Acknowledged*.
  - **Off-server checks:** the Worker checks how old the newest backup and the last anchor are, so a host that is down still raises the alarm.
  - **While the Mac sleeps:** nothing can be written, so a missed pull only counts once the host is back and the head has moved without an anchor. Missed nightly jobs run on wake.

## Change control and security

- **Release Log.** Every release, configuration change and host move gets a Release Log entry: image digests, CI and ZAP baseline results, and the owner's *Approved* signature. After the move, the VPS serves nothing until chain-verify passes against the S3 anchors.
- **Patching.** Image digests are bumped monthly, and critical fixes go in within 7 days, including macOS and Colima now, and the VPS operating system, kernel and sshd after the move.
- **Security testing.** An OWASP ZAP baseline scan runs in CI. It is passive, so a real penetration test is required before any real data or any second user.

## Suppliers and the demo exception

| Supplier | Holds or sees | Exit path |
|---|---|---|
| Cloudflare | DNS; the Tunnel (sees all Mac-demo traffic in plaintext, including passwords and TOTP codes); the Worker and its HMAC key; R2 backups (encrypted) | Move DNS, run the anchor job elsewhere, copy the encrypted backups out |
| AWS | S3 anchors; SES alarm email; later, the Lightsail VPS | Anchors stay readable until their retention ends; SES and Lightsail are replaceable |

- **Plaintext at Cloudflare** is accepted only while all data is fictional, and ends with the grey-cloud VPS.
- **Operator logs.** Every owner-role connection and statement in Postgres is logged (`log_connections` plus pgaudit) and shipped nightly with the backup. On the VPS, SSH session logs are shipped too.
- **The two-role exception.** The owner holds both Platform Operator and Admin as a signed exception, per the audit trail decision. It covers the TOTP key and pepper being readable by the operator. It lapses before any second person or real data.
- **Before real records,** each supplier needs a quality agreement, not just its standard terms.

## Considered options

- **Hetzner CX23 (EU, about $7/mo)** was the research pick. It was rejected because the demo must be US-hosted, and in any case the CX and CAX lines were out of stock through September 2026.
- **Lightsail IPv6-only at $10** was rejected because GitHub can't be reached over IPv6.
- **Hetzner US CPX11 ($20.49)** was rejected on cost.
