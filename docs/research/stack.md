# Research: React + TypeScript stack and database for an append-only audit trail

Ticket: #5 (part of map #1). Feeds #13 (audit trail and e-signature design) and #14 (stack and hosting ADR). Researched 2026-09-29. Versions come from the GitHub releases API (`gh api repos/<owner>/<repo>/releases`), the npm registry (`npm view`) and PyPI (`pip index versions`), all queried that day. All data in this project is fictional.

## Recommendation

**Use a React single-page app talking to a plain TypeScript API server, with PostgreSQL 18 enforcing the audit trail and a separate Python worker that pulls extraction jobs from a Postgres table.** Concretely:

- **UI:** Vite 8 + React 19 + TypeScript, TanStack Query for server state, one client router (React Router 8 in data mode or TanStack Router). Static files only, so there is no server-rendering surface.
- **API:** Fastify 5 on Node.js 24 (Active LTS), with the official Zod type provider so each route's request and response schema is both the runtime validator and the TypeScript type.
- **Data access:** Kysely 0.29 query builder, with types generated from the live database by `kysely-codegen`. Migrations are plain SQL, because the parts that matter most (roles, grants, triggers, hash chain) are SQL anyway.
- **Database:** PostgreSQL 18, supported until November 2030. The audit trail is built into the database: trigger capture, a hash chain, revoked UPDATE/DELETE/TRUNCATE, and blocking triggers.
- **Files:** uploaded instrument reports go in a content-addressed store on disk, keyed by SHA-256. The hash is recorded in an audited row.
- **Python:** a worker (psycopg 3 + pdfplumber) claims jobs with `FOR UPDATE SKIP LOCKED` and writes *draft* extracted values. An Analyst still has to confirm and e-sign them.

Why this and not the alternatives:

1. **The database is the source of truth, so the audit trail doesn't depend on the app being correct.** Part 11 §11.10(e) asks for "secure, computer-generated, time-stamped audit trails" where "record changes shall not obscure previously recorded information" ([eCFR 21 CFR 11.10](https://www.ecfr.gov/api/versioner/v1/full/2026-09-01/title-21.xml?part=11&section=11.10)). Putting capture and immutability in Postgres means a bug or a bypass in the TypeScript layer still can't write an unaudited change. Since the schema lives in SQL, a SQL-first query builder with types generated from the database (Kysely + kysely-codegen) keeps the TypeScript types matching what the database actually enforces. A TS-schema-first ORM keeps a second copy of that schema.
2. **Authorization in one explicit place.** A Fastify route is an ordinary function. The auth check and the `withActor(...)` transaction wrapper are visible in every handler. Next.js's own postmortem of CVE-2025-29927 (middleware bypass via the `x-middleware-subrequest` header, which affected self-hosted `next start`) says "We do not recommend Middleware to be the sole method of protecting routes" ([Vercel postmortem](https://vercel.com/blog/postmortem-on-next-js-middleware-bypass)). CVE-2025-55182 (CVSS 10.0) was an unauthenticated RCE through React Server Function deserialization. The React team says apps whose "React code does not use a server" were not affected ([react.dev advisory](https://react.dev/blog/2025/12/03/critical-security-vulnerability-in-react-server-components)). A plain SPA stays out of that whole category.
3. **TypeScript-first, as the map requires.** Python is kept to what it does best, PDF extraction, and connects only through Postgres.
4. **Small footprint.** Three processes on one box: Node, Postgres and the Python worker. There's no Redis or message broker, because Postgres is the queue. The choice of host belongs to #6.

What we give up: no server rendering (not needed for an authenticated lab app), and Kysely is still 0.x (pin the version). Stack B (Next.js) is a reasonable second choice if the owner prefers one framework for everything.

## Stack comparison

| | **A. SPA + Fastify + Kysely (recommended)** | **B. Next.js full-stack + Drizzle** | **C. SPA + FastAPI + SQLAlchemy** | **D. SPA + Fastify + Prisma** |
|---|---|---|---|---|
| UI | Vite 8.3, React 19.3, TanStack Query 5 | Next.js 16.3 App Router (RSC, Server Functions) | Vite + React, same as A | Same as A |
| API layer | Fastify 5.12 with Zod type provider | Route handlers / Server Functions inside Next | FastAPI 0.142 (Python) | Fastify 5.12 |
| DB access | Kysely 0.29.6, types via kysely-codegen 0.20 (introspects the DB) | Drizzle ORM 0.45.3 stable; 1.0 is still in RC (rc.4, June 2026) | SQLAlchemy 2.1.1 + Alembic | Prisma ORM 7.x; npm `latest` is 8.0.0-rc.19 |
| Types DB → UI | DB → codegen → Kysely; route Zod schemas → shared TS types | TS schema → DB (migrations generated); one TS codebase end to end | DB ← SQLAlchemy models → Pydantic → OpenAPI → generated TS client (Hey API) | Prisma schema → DB + client |
| Audit-trail fit | Very good: SQL migrations are the natural home for triggers and grants; `sql` template works inside `db.transaction()` for `set_config` | Good: triggers go in `drizzle-kit generate --custom` raw SQL migrations | Very good: SQL via Alembic `op.execute` | Good: raw SQL migrations; `$executeRaw` works in interactive transactions |
| Server-side authz | Explicit per-route hooks | Must be repeated in every Server Function and route handler; middleware is not enough (CVE-2025-29927) | Explicit per-route dependencies | Explicit per-route hooks |
| Python interop | Postgres job table (worker is separate) | Same as A | Native: extraction runs in-process or as a task | Same as A |
| Maturity / risk | Fastify, React, Postgres very mature; Kysely 0.x but active (release 2026-09-16) | Very popular, but a large, fast-moving surface and two framework-level CVEs in 2025 | Very mature; but the main codebase becomes Python, against the map's "TypeScript mainly" | Prisma is moving to a new major (8.0 in RC); heavier generated client |
| Runtime footprint | Node + Postgres + Python worker | Node (Next server) + Postgres + Python worker; nginx recommended in front | Python (uvicorn) + Postgres; one language runtime fewer | Same as A |

Notes on the table:

- **B (Next.js).** Self-hosting with `next start` works, and the docs recommend putting a reverse proxy in front "rather than exposing it directly to the internet" ([Next.js self-hosting guide](https://nextjs.org/docs/app/guides/self-hosting), docs v16.3.6). The cost is architectural: Server Functions are public endpoints, so each one needs its own auth check, and RSC deserialization adds to the attack surface. For a Part 11 demo, where "prove who did what" is the whole point, that surface is a liability with no matching benefit.
- **C (FastAPI).** This is the strongest choice if Python were the main language. FastAPI publishes OpenAPI 3.1 and recommends Hey API for TypeScript clients ([FastAPI: generate clients](https://fastapi.tiangolo.com/advanced/generate-clients/)). But the typed domain logic would then live in Python, and the React side would only get generated types.
- **D (Prisma).** Viable. Prisma documents that `$executeRaw`/`$queryRaw` work inside `$transaction(async tx => ...)` ([Prisma raw queries, v7 docs](https://www.prisma.io/docs/orm/prisma-client/using-raw-sql/raw-queries)), which is what the audit context needs. But its npm `latest` tag now points at an 8.0 release candidate, and its schema DSL can't express triggers or grants, so you maintain two schema languages.
- **Drizzle vs Kysely** is close. Drizzle documents custom SQL migrations for "DDL alternations currently not supported by Drizzle Kit", which covers triggers and functions ([drizzle-kit custom migrations](https://orm.drizzle.team/docs/kit-custom-migrations)). Kysely is picked because it generates types *from* the database, which is where the audit rules live ([Kysely: generating types](https://kysely.dev/docs/generating-types)). Both are 0.x as a stable line.

### Maintenance status (2026-09-29)

| Project | Latest release | Last push | License |
|---|---|---|---|
| PostgreSQL | 18.6 (supported to 2030-11-14); 19 in beta 4 | n/a | PostgreSQL |
| Node.js | 24 Active LTS; 22 Maintenance LTS | n/a | MIT |
| React | v19.3.0 (2026-09-09) | 2026-09-29 | MIT |
| Vite | v8.3.1 (2026-09-24) | 2026-09-29 | MIT |
| Fastify | v5.12.5 (2026-09-16) | 2026-09-29 | MIT |
| Kysely | v0.29.6 (2026-09-16) | 2026-09-29 | MIT |
| Drizzle ORM | 0.45.3 (2026-09-21); v1.0.0-rc.4 (2026-06-27) | 2026-09-29 | Apache-2.0 |
| Prisma | 8.0.0-rc.13 on GitHub (2026-09-28); npm prev stable 7.10.0 | 2026-09-30 | Apache-2.0 |
| Next.js | v16.3.7 (2026-09-29) | 2026-09-30 | MIT |
| FastAPI | 0.142.1 (2026-09-29) | 2026-09-29 | MIT |
| SQLAlchemy | 2.1.1 (2026-09-25) | 2026-09-29 | MIT |
| Zod | v4.6.5 (2026-09-13) | 2026-09-30 | MIT |
| pdfplumber | v0.11.10 (2026-06-15) | 2026-08-06 | MIT |
| PyMuPDF | 1.28.2 (2026-08-06) | 2026-09-29 | **AGPL-3.0** |
| psycopg | 3.3.6 (PyPI) | n/a | n/a |
| procrastinate | 3.10.0 (PyPI) | n/a | MIT |
| pg-boss | 12.35.0 (2026-09-26) | 2026-09-29 | MIT |

None of these are archived. Note the PyMuPDF license (AGPL-3.0, per the GitHub API) for #8's choice of extraction library. pdfplumber is MIT.

## Append-only, tamper-evident audit trail in Postgres

The patterns form layers. Each one closes a gap the previous one leaves open.

| Layer | What it stops | Primary source |
|---|---|---|
| **1. Trigger capture.** An `AFTER INSERT OR UPDATE OR DELETE ... FOR EACH ROW` trigger on every audited table writes old/new row images to `audit.entry`. | App code forgetting to log | Postgres "Example 41.4" audit trigger, [PL/pgSQL triggers](https://www.postgresql.org/docs/current/plpgsql-trigger.html) |
| **2. Actor and reason via transaction-local settings.** The API calls `set_config('lims.actor_id', ..., true)` inside each write transaction. The trigger reads it with `current_setting(..., true)` and raises if it's missing. | Writes without an attributable person (a pooled DB login is not a person) | `set_config` with `is_local = true` is transaction-scoped, [admin functions](https://www.postgresql.org/docs/current/functions-admin.html) |
| **3. Least-privilege roles.** Tables are owned by a `NOLOGIN` owner role. The app role gets no UPDATE/DELETE/TRUNCATE on `audit.entry`, and inserts only through a `SECURITY DEFINER` trigger function. | App-level SQL rewriting history | [REVOKE](https://www.postgresql.org/docs/current/sql-revoke.html); [CREATE FUNCTION: writing SECURITY DEFINER functions safely](https://www.postgresql.org/docs/current/sql-createfunction.html) (pin `search_path`, `pg_temp` last, revoke EXECUTE from PUBLIC) |
| **4. Blocking triggers.** `BEFORE UPDATE OR DELETE` row trigger and `BEFORE TRUNCATE` statement trigger that raise. | Mistakes by anyone with table privileges, including the owner | TRUNCATE triggers are statement-level only, [CREATE TRIGGER](https://www.postgresql.org/docs/current/sql-createtrigger.html) |
| **5. Hash chain.** Each entry stores `prev_hash` and `row_hash = sha256(prev_hash ‖ canonical(entry))`. Appends are serialized by `pg_advisory_xact_lock`. `audit.verify()` recomputes the chain. | Silent edits by someone who got past layers 3–4 | Built-in `sha256(bytea)`, [binary string functions](https://www.postgresql.org/docs/current/functions-binarystring.html); advisory locks, [admin functions](https://www.postgresql.org/docs/current/functions-admin.html) |
| **6. External anchoring.** A scheduled job exports the chain head (`id`, `row_hash`), HMAC'd with a key that isn't on the DB server, to a place the DB admin can't rewrite. | A superuser recomputing the whole chain | Design consequence of the two caveats below |

Two caveats set how far the database alone can go:

- The table owner can `ALTER TABLE ... DISABLE TRIGGER` on user triggers ("You must own the table to use ALTER TABLE"). Superusers bypass privileges and RLS, and can set `session_replication_role = replica`, which stops ordinary triggers from firing ([ALTER TABLE](https://www.postgresql.org/docs/current/sql-altertable.html), [client config](https://www.postgresql.org/docs/current/runtime-config-client.html), [row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)). So the app never connects as the owner or as a superuser, and layers 5–6 make any privileged tampering **detectable**, even though it can't be made impossible.
- **pgAudit is not the audit trail.** It writes to the server log, and says "Audit logging is best-effort and not transactional" and "There is no guarantee that a committed transaction will have a corresponding audit log entry" ([pgaudit README](https://github.com/pgaudit/pgaudit)). It can be an extra ops log of DDL and superuser activity, but not the Part 11 record.

Related rule for business tables: "record changes shall not obscure previously recorded information" can be met by the audit table's `old_row` alone. For results and signed records, #13 should consider insert-only versioned rows, so the current table never loses a value either.

### SQL sketch

This is an **untested sketch** (no Postgres was available in the research session). It targets PostgreSQL 18 and is meant to be turned into a real migration with tests in #13 or #24.

```sql
-- Roles: the owner never logs in; the app and worker never own anything.
CREATE ROLE lims_owner  NOLOGIN;
CREATE ROLE lims_app    LOGIN;   -- API server
CREATE ROLE lims_worker LOGIN;   -- Python extractor

CREATE SCHEMA audit AUTHORIZATION lims_owner;
SET ROLE lims_owner;

CREATE SEQUENCE audit.entry_seq;
CREATE TABLE audit.entry (
  id           bigint      PRIMARY KEY,            -- assigned under the chain lock, see audit.chain()
  occurred_at  timestamptz NOT NULL,               -- server clock, set by audit.chain()
  actor_id     uuid        NOT NULL,
  reason       text,
  action       text        NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  table_name   text        NOT NULL,
  row_pk       text        NOT NULL,
  old_row      jsonb,
  new_row      jsonb,
  hash_version smallint    NOT NULL,
  prev_hash    bytea       NOT NULL,
  row_hash     bytea       NOT NULL UNIQUE
);

-- Canonical bytes for one entry. Timestamps are rendered in UTC so the session TimeZone
-- can't change the hash. jsonb normalizes key order, so equal rows serialize the same way.
CREATE FUNCTION audit.entry_hash(e audit.entry) RETURNS bytea
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT sha256(e.prev_hash || convert_to(jsonb_build_array(
           e.hash_version, e.id,
           to_char(e.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
           e.actor_id, e.reason, e.action, e.table_name, e.row_pk, e.old_row, e.new_row
         )::text, 'UTF8'))
$$;

-- Chain every insert: take one global lock, then assign id, time, prev_hash and row_hash.
-- The id comes from the sequence *after* the lock, so id order is chain order.
CREATE FUNCTION audit.chain() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(1100);   -- arbitrary constant key; held until commit or rollback
  NEW.id           := nextval('audit.entry_seq');
  NEW.occurred_at  := clock_timestamp();
  NEW.hash_version := 1;
  SELECT e.row_hash INTO NEW.prev_hash FROM audit.entry e ORDER BY e.id DESC LIMIT 1;
  NEW.prev_hash    := coalesce(NEW.prev_hash, '\x00'::bytea);   -- genesis
  NEW.row_hash     := audit.entry_hash(NEW);
  RETURN NEW;
END $$;
CREATE TRIGGER entry_chain BEFORE INSERT ON audit.entry
  FOR EACH ROW EXECUTE FUNCTION audit.chain();

-- Append-only, even for the owner (unless it disables triggers; see caveats).
CREATE FUNCTION audit.reject() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'audit.entry is append-only (% blocked)', TG_OP;
END $$;
CREATE TRIGGER entry_no_change   BEFORE UPDATE OR DELETE ON audit.entry
  FOR EACH ROW EXECUTE FUNCTION audit.reject();
CREATE TRIGGER entry_no_truncate BEFORE TRUNCATE ON audit.entry
  FOR EACH STATEMENT EXECUTE FUNCTION audit.reject();

-- Capture: attached to every audited business table. Runs as lims_owner.
CREATE FUNCTION audit.capture() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  actor uuid := nullif(current_setting('lims.actor_id', true), '')::uuid;
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'audited write to %.% without lims.actor_id', TG_TABLE_SCHEMA, TG_TABLE_NAME;
  END IF;
  INSERT INTO audit.entry (actor_id, reason, action, table_name, row_pk, old_row, new_row)
  VALUES (actor,
          nullif(current_setting('lims.reason', true), ''),
          TG_OP,
          TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME,
          CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END::text,   -- convention: every audited table has "id"
          CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
          CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION audit.capture() FROM PUBLIC;

-- Example audited table.
CREATE TABLE public.sample (id uuid PRIMARY KEY, status text NOT NULL /* ... */);
CREATE TRIGGER sample_audit AFTER INSERT OR UPDATE OR DELETE ON public.sample
  FOR EACH ROW EXECUTE FUNCTION audit.capture();

-- Privileges: the app reads the trail but can't write it directly.
REVOKE ALL ON ALL TABLES IN SCHEMA audit FROM PUBLIC;
GRANT USAGE  ON SCHEMA audit TO lims_app;
GRANT SELECT ON audit.entry  TO lims_app;
GRANT SELECT, INSERT, UPDATE ON public.sample TO lims_app;   -- no DELETE on regulated records

-- Verification: returns nothing when the chain is intact. Gaps in id (rolled-back
-- transactions) are fine because links are checked with lag(), not id + 1.
CREATE FUNCTION audit.verify() RETURNS TABLE (entry_id bigint, problem text)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT id, problem FROM (
    SELECT e.id,
           CASE
             WHEN e.prev_hash <> coalesce(lag(e.row_hash) OVER (ORDER BY e.id), '\x00'::bytea) THEN 'broken link'
             WHEN e.row_hash  <> audit.entry_hash(e)                                            THEN 'row altered'
           END AS problem
    FROM audit.entry e
  ) v WHERE problem IS NOT NULL
$$;
RESET ROLE;
```

API side (Kysely). Every audited write goes through one wrapper, so no handler can forget the actor:

```ts
export async function withActor<T>(
  db: Kysely<DB>,
  actor: { id: string },
  reason: string | null,
  work: (trx: Transaction<DB>) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`select set_config('lims.actor_id', ${actor.id}, true),
                     set_config('lims.reason',   ${reason ?? ''}, true)`.execute(trx);
    return work(trx);
  });
}
```

Design notes on the sketch:

- **Isolation level matters.** The chain trigger reads the latest `row_hash` after waiting on the lock. Under Read Committed (the Postgres default), "each command sees a snapshot as of when that command began", so it sees the entry committed by whoever held the lock before. Under Repeatable Read the snapshot is fixed at the transaction's first statement, and two entries could claim the same predecessor ([transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html)). Audited transactions must run at Read Committed. `audit.verify()` catches it if one doesn't.
- **Throughput.** One global advisory lock serializes every audited write until commit. That's fine for a single lab. If it ever became a bottleneck, the fix would be per-entity chains (lock key = hash of `table_name`), not dropping the chain.
- **Server time.** `occurred_at` is set from `clock_timestamp()` inside the trigger, so neither the client nor the app can supply it. Trusted time and time zones are still open on the map ("Time and clocks").
- **Hash stability.** Values in `old_row`/`new_row` are turned into JSON at capture time, so later changes to the session don't affect them. `hash_version` allows the canonical form to change later without breaking old entries.
- **E-signatures (§11.70 linking)** can be ordinary audited rows (`signature(record_table, record_id, record_hash, meaning, signer_id, signed_at)`) whose `record_hash` is the audited row's `row_hash`. That ties the signature to the exact content that was signed. The details belong to #13.

## File storage for uploaded reports

| Option | Pros | Cons |
|---|---|---|
| **Content-addressed files on local disk (recommended for the demo)**: `blobs/sha256/ab/cd/<hash>`, write-once, read-only permissions; a `stored_file` row (sha256, size, media type, original name, uploader) captured by the audit trigger | Tiny DB; SHA-256 in the audited row makes the file tamper-evident; identical uploads dedupe automatically; the Python worker reads the same path | Two things to back up together (DB + blob directory); a write can leave an orphan file if the DB insert fails (harmless, can be garbage-collected) |
| **`bytea` in Postgres** | One transaction, one backup, simplest consistency; field limit is 1 GB ([limits](https://www.postgresql.org/docs/current/limits.html)), far above report PDFs | Bloats the database and every dump; slower backup and restore on a small server |
| **S3-compatible object storage** | Durable, off-box, some providers offer object lock | Monthly cost and a second vendor; provider choice belongs to #6 |

Write order for the disk option: stream the upload (e.g. `@fastify/multipart` 10.x), hashing as you go → fsync to a temp file → rename to the hash path → insert `stored_file` and the extraction job inside `withActor(...)`. Put the store behind a small `BlobStore` interface (`put(stream) → sha256`, `open(sha256)`) so switching to S3 later touches one module. How retention and backup work is on the map's "Backup, retention and archiving" list.

## Python worker interop

**Pattern: a Postgres job table, written in the same transaction as the upload.** It's a transactional outbox, so a job exists if and only if the upload committed.

```sql
CREATE TABLE extraction_job (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  file_sha256 bytea  NOT NULL,
  parser      text   NOT NULL,             -- e.g. 'lcmsms-vendor-x-v1'
  state       text   NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','done','failed')),
  attempts    int    NOT NULL DEFAULT 0,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Worker claim (psycopg 3); SKIP LOCKED lets several workers share the queue.
UPDATE extraction_job SET state = 'running', attempts = attempts + 1
WHERE id = (SELECT id FROM extraction_job WHERE state = 'queued'
            ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
RETURNING id, file_sha256, parser;
```

- `SKIP LOCKED` "can be used to avoid lock contention with multiple consumers accessing a queue-like table" ([SELECT](https://www.postgresql.org/docs/current/sql-select.html)). The API also sends `NOTIFY extraction` so the worker wakes up right away. NOTIFY is delivered only on commit and isn't kept for listeners that are disconnected ([NOTIFY](https://www.postgresql.org/docs/current/sql-notify.html)), so the worker also polls on a timer and on startup.
- The worker connects as `lims_worker`. It can SELECT jobs and `stored_file`, UPDATE job state, and INSERT into `extraction_result` (draft values plus the parser version). It gets **no** privilege on results, samples or signatures. It sets `lims.actor_id` to a dedicated system-user id, so its writes are audited as "system: extractor vX". Extracted values become results only when an Analyst confirms and e-signs them. That keeps the map's review chain intact.
- The payload contract between Python and TypeScript is one JSON Schema file. Python validates it with Pydantic, TypeScript with Zod at the API boundary.
- Off-the-shelf alternatives: **pg-boss** 12.x is a Node library; **procrastinate** 3.10 (MIT, Python 3.10+, PostgreSQL 13+, async) is a Python task queue on Postgres ([procrastinate](https://github.com/procrastinate-org/procrastinate)). Each is native to only one side of the Node/Python boundary, and the other side would have to write into its internal schema. For a single job type, the roughly 20-line table above is simpler and fully auditable. A FastAPI sidecar called over HTTP also works, but it ties the upload request to the extractor's uptime and loses the outbox guarantee.

## Open questions for the owner

1. **Next.js or not.** This research recommends a plain SPA + Fastify (A) over Next.js (B), mainly to keep the server surface small and authorization explicit. If you'd rather have one Next.js codebase, B works with the same database design. #14 should record the choice.
2. **Where the chain head gets anchored** (layer 6): a separate git repo, email to QA, or object storage with object lock. This depends on the host (#6) and backup design.

## Sources (all fetched 2026-09-29)

- 21 CFR 11.10(c), (e): https://www.ecfr.gov/api/versioner/v1/full/2026-09-01/title-21.xml?part=11&section=11.10
- PostgreSQL versioning policy: https://www.postgresql.org/support/versioning/
- PostgreSQL 18 docs: [PL/pgSQL triggers](https://www.postgresql.org/docs/current/plpgsql-trigger.html), [CREATE TRIGGER](https://www.postgresql.org/docs/current/sql-createtrigger.html), [REVOKE](https://www.postgresql.org/docs/current/sql-revoke.html), [CREATE FUNCTION](https://www.postgresql.org/docs/current/sql-createfunction.html), [ALTER TABLE](https://www.postgresql.org/docs/current/sql-altertable.html), [client config](https://www.postgresql.org/docs/current/runtime-config-client.html), [row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html), [binary string functions](https://www.postgresql.org/docs/current/functions-binarystring.html), [pgcrypto](https://www.postgresql.org/docs/current/pgcrypto.html), [admin functions](https://www.postgresql.org/docs/current/functions-admin.html), [transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html), [JSON types](https://www.postgresql.org/docs/current/datatype-json.html), [SELECT](https://www.postgresql.org/docs/current/sql-select.html), [NOTIFY](https://www.postgresql.org/docs/current/sql-notify.html), [limits](https://www.postgresql.org/docs/current/limits.html)
- pgAudit: https://github.com/pgaudit/pgaudit
- Node.js releases: https://nodejs.org/en/about/previous-releases
- Fastify type providers: https://fastify.dev/docs/latest/Reference/Type-Providers/
- Kysely: https://kysely.dev/docs/generating-types, https://kysely.dev/docs/category/transactions
- Drizzle: https://orm.drizzle.team/docs/kit-custom-migrations, https://github.com/drizzle-team/drizzle-orm/releases/tag/v1.0.0-rc.4
- Prisma raw queries (v7 docs): https://www.prisma.io/docs/orm/prisma-client/using-raw-sql/raw-queries
- Next.js self-hosting: https://nextjs.org/docs/app/guides/self-hosting
- CVE-2025-29927 postmortem: https://vercel.com/blog/postmortem-on-next-js-middleware-bypass
- CVE-2025-55182 advisory: https://react.dev/blog/2025/12/03/critical-security-vulnerability-in-react-server-components
- FastAPI client generation: https://fastapi.tiangolo.com/advanced/generate-clients/
- procrastinate: https://github.com/procrastinate-org/procrastinate
- Release and repository metadata: GitHub REST API (`repos/<owner>/<repo>` and `/releases`) for vercel/next.js, drizzle-team/drizzle-orm, prisma/prisma, kysely-org/kysely, fastify/fastify, remix-run/react-router, TanStack/router, fastapi/fastapi, timgit/pg-boss, pymupdf/PyMuPDF, jsvine/pdfplumber, vitejs/vite, facebook/react, sqlalchemy/sqlalchemy, colinhacks/zod; npm registry and PyPI for package versions.
