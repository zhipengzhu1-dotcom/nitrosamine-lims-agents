// Proves the part A tests can fail: each mutant breaks one database rule, runs the test file that
// guards it, and expects that run to fail. A mutant that survives means the test proves nothing.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** `test` is a vitest path inside `package` (default @lims/db's directory). */
type Mutant = { name: string; file: string; find: string; replace: string; test: string; package?: string };

const MUTANTS: Mutant[] = [
  {
    name: 'LS001 self-approval allowed',
    file: 'migrations/0020_records.sql',
    find: "and new.signer_person_id = v.created_by then\n    raise exception 'nobody approves",
    replace: "and false then\n    raise exception 'nobody approves",
    test: 'test/adr0001.test.ts',
  },
  {
    name: 'LS002 typist may verify',
    file: 'migrations/0020_records.sql',
    find: "if new.meaning = 'Verified' and exists (",
    replace: "if false and exists (",
    test: 'test/adr0001.test.ts',
  },
  {
    name: 'LS000 anyone signs for anyone',
    file: 'migrations/0020_records.sql',
    find: "if new.signer_person_id <> (ctx->>'person_id')::uuid then",
    replace: 'if false then',
    test: 'test/signature.test.ts',
  },
  {
    name: 'signature not bound to the stored hash',
    file: 'migrations/0020_records.sql',
    find: 'foreign key (ledger_id, record_version_id, content_hash)\n    references lims.record_version (ledger_id, id, content_hash),',
    replace: 'foreign key (record_version_id)\n    references lims.record_version (id),',
    test: 'test/signature.test.ts',
  },
  {
    name: 'LI001 Admin may hold a business role',
    file: 'migrations/0030_identity.sql',
    find: "and ((new.role = 'Admin' and g.role = any (business))",
    replace: "and false and ((new.role = 'Admin' and g.role = any (business))",
    test: 'test/admin-exclusivity.test.ts',
  },
  {
    name: 'LA005 undeclared ledger writable',
    file: 'migrations/0010_ledger_audit.sql',
    find: "if not (ctx->'ledgers') ? p_ledger::text then",
    replace: 'if false then',
    test: 'test/lab-scope.test.ts',
  },
  {
    name: 'a second receipt for one commit key',
    file: 'migrations/0040_identity_pipeline.sql',
    find: "create unique index one_receipt_per_commit_key on lims.commit_outcome (commit_key) where outcome = 'receipt';",
    replace: '',
    test: 'test/pipeline-tables.test.ts',
  },
  {
    name: 'a half-enrolled account',
    file: 'migrations/0040_identity_pipeline.sql',
    find: 'check ((password_hash is null) = (totp_secret_enc is null))',
    replace: 'check (true)',
    test: 'test/pipeline-tables.test.ts',
  },
  {
    name: 'one enrolment token for two people',
    file: 'migrations/0040_identity_pipeline.sql',
    find: 'token_hash      bytea not null unique,',
    replace: 'token_hash      bytea not null,',
    test: 'test/pipeline-tables.test.ts',
  },
  {
    name: 'a session unlock does not end a run of failures',
    file: 'migrations/0040_identity_pipeline.sql',
    find: "where x.person_id = p.id and x.kind in ('login_ok', 'signing_ok', 'unlock', 'unlock_session')), 0)",
    replace: "where x.person_id = p.id and x.kind in ('login_ok', 'signing_ok', 'unlock')), 0)",
    test: 'test/session.test.ts',
    package: 'apps/api',
  },
  {
    name: 'a rejected version is reused by seal',
    file: 'migrations/0060_seal_after_rejection.sql',
    find: "     and not exists (select 1 from lims.version_rejection r where r.version_id = v.id)\n",
    replace: '',
    test: 'test/adr0001.test.ts',
  },
  {
    name: "LR001 a locked value's pending change is approved",
    file: 'migrations/0061_lock_settles_pending.sql',
    find: "if new.meaning in ('Verified', 'Approved') and lims.locked(v.record_id) then",
    replace: 'if false then',
    test: 'test/release-lock.test.ts',
  },
  {
    name: "LR001 a locked value's pending change is rejected",
    file: 'migrations/0061_lock_settles_pending.sql',
    find: "  if lims.locked(v.record_id) then\n    raise exception 'record % is locked by a Released Test Report', v.record_id using errcode = 'LR001';\n  end if;\n  return new;",
    replace: '  return new;',
    test: 'test/release-lock.test.ts',
  },
  {
    name: 'LV006 an effective version is rejected',
    file: 'migrations/0061_lock_settles_pending.sql',
    find: 'if not exists (select 1 from lims.pending_version p where p.id = new.version_id) then',
    replace: 'if false then',
    test: 'test/release-lock.test.ts',
  },
  // 0062 replaces lims.capture() again, so the Customer and Lab guards are mutated where they now live.
  {
    name: "LA006 a Customer may write another Customer's Lab row",
    file: 'migrations/0062_customer_writes.sql',
    find: "when 'sample' then newj->>'customer_id' = ctx->>'customer_id'",
    replace: "when 'sample' then true",
    test: 'test/sample-chain.test.ts',
  },
  {
    name: 'LA006 a Customer may change a Lab row in place',
    file: 'migrations/0062_customer_writes.sql',
    find: "customer_own := tg_op = 'INSERT' and",
    replace: 'customer_own :=',
    test: 'test/sample-chain.test.ts',
  },
  {
    name: 'LA006 other Lab writable',
    file: 'migrations/0062_customer_writes.sql',
    find: "and ledger is distinct from (ctx->>'acting_lab_id')::uuid\n     and not customer_own then",
    replace: 'and false then',
    test: 'test/lab-scope.test.ts',
  },
  {
    name: 'LA006 a Customer writes a bare record row of any kind',
    file: 'migrations/0062_customer_writes.sql',
    find: "when 'record' then newj->>'kind' = 'test'",
    replace: "when 'record' then true",
    test: 'test/sample-chain.test.ts',
  },
  {
    name: "LA006 a Customer's Sample arrives numbered or received",
    file: 'migrations/0062_customer_writes.sql',
    find: "                       and newj->>'state' = 'Expected' and newj->>'number' is null\n                       and newj->>'received_at' is null and newj->>'received_by' is null\n",
    replace: '',
    test: 'test/sample-chain.test.ts',
  },
  {
    name: "LA006 a Customer's Test arrives pinned, numbered or assigned",
    file: 'migrations/0062_customer_writes.sql',
    find: "                     and newj->>'state' = 'Requested' and newj->>'number' is null\n                     and newj->>'method_version_id' is null and newj->>'specification_version_id' is null\n                     and newj->>'assigned_analyst' is null and newj->>'acceptance_reason' is null\n",
    replace: '',
    test: 'test/sample-chain.test.ts',
  },
  {
    name: "LA006 a Customer's download event names another person",
    file: 'migrations/0062_customer_writes.sql',
    find: "and newj->>'person_id' = ctx->>'person_id'",
    replace: '',
    test: 'test/sample-chain.test.ts',
  },
];

const root = fileURLToPath(new URL('..', import.meta.url));
let survivors = 0;

for (const m of MUTANTS) {
  const cwd = m.package ? `${root}../../${m.package}/` : root;
  const path = `${root}${m.file}`;
  const original = readFileSync(path, 'utf8');
  if (!original.includes(m.find)) {
    console.log(`STALE    ${m.name}: pattern not found in ${m.file}`);
    survivors++;
    continue;
  }
  writeFileSync(path, original.replace(m.find, m.replace));
  let outcome: 'KILLED  ' | 'SURVIVED' | 'INVALID ';
  try {
    execFileSync('pnpm', ['exec', 'vitest', 'run', m.test], { cwd, stdio: 'pipe' });
    outcome = 'SURVIVED';
  } catch (e) {
    const out = String((e as { stdout?: Buffer }).stdout ?? '') + String((e as { stderr?: Buffer }).stderr ?? '');
    // A mutant that breaks the migration fails every test for the wrong reason and proves nothing.
    outcome = /migration \S+ failed/.test(out) ? 'INVALID ' : 'KILLED  ';
  } finally {
    writeFileSync(path, original);
  }
  console.log(`${outcome} ${m.name} (${m.test})`);
  if (outcome !== 'KILLED  ') survivors++;
}

process.exitCode = survivors === 0 ? 0 : 1;
