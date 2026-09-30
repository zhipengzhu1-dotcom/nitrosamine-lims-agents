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
    name: 'LA006 other Lab writable',
    file: 'migrations/0010_ledger_audit.sql',
    find: "and ledger is distinct from (ctx->>'acting_lab_id')::uuid then",
    replace: 'and false then',
    test: 'test/lab-scope.test.ts',
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
