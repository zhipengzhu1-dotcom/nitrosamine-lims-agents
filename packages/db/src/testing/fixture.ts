import { randomUUID, createHash } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { DB } from '../generated.ts';
import { runAudited, type AuditContext, type AuditedTx } from '../audited.ts';
import { createLab } from '../doors.ts';
import { COMPANY_LEDGER, SERVICE, ledgerOf, type CommitKey, type LabId, type LedgerId, type PersonId, type SessionId } from '../ids.ts';

export const TEST_RELEASE = 'test';

export type Person = {
  readonly id: PersonId;
  readonly username: string;
  readonly printedName: string;
  /** A live session opened in the Lab the person works in (null Lab for the Admin). */
  readonly session: SessionId;
  readonly lab: LabId | null;
};

export type Fixture = {
  readonly labA: LabId;
  readonly labB: LabId;
  /** Analyst in Lab A. */
  readonly ann: Person;
  /** Reviewer in Lab A: the second person for Verified. */
  readonly bob: Person;
  /** QA in Lab A. */
  readonly cid: Person;
  /** Lab Manager in Lab A. */
  readonly dee: Person;
  /** Analyst in Lab B. */
  readonly eve: Person;
  /** Admin, company-wide, no Lab. */
  readonly adam: Person;
  /** A context for `person` acting as `role`, with sensible defaults a test can override. */
  readonly ctx: (person: Person, role: string, over?: Partial<AuditContext>) => AuditContext;
  /** A context for the seed service identity on the company ledger. */
  readonly seedCtx: (over?: Partial<AuditContext>) => AuditContext;
};

export const commitKey = (): CommitKey => randomUUID() as CommitKey;

const ledgersFor = (lab: LabId | null): readonly LedgerId[] => (lab ? [ledgerOf(lab), COMPANY_LEDGER] : [COMPANY_LEDGER]);

export function serviceContext(over: Partial<AuditContext> = {}): AuditContext {
  return {
    person: SERVICE.seed.person,
    role: SERVICE.seed.role,
    actingLab: null,
    customer: null,
    action: 'seed',
    reason: { kind: 'first_save' },
    appRelease: TEST_RELEASE,
    session: null,
    commitKey: commitKey(),
    ledgers: [COMPANY_LEDGER],
    ...over,
  };
}

/** Seeds two Labs, six people with accounts, roles and live sessions, and the test release. */
export async function seedFixture(db: Kysely<DB>): Promise<Fixture> {
  const labA = randomUUID() as LabId;
  const labB = randomUUID() as LabId;
  type Role = readonly [string, LabId | null];
  const spec: readonly { key: keyof Pick<Fixture, 'ann' | 'bob' | 'cid' | 'dee' | 'eve' | 'adam'>; name: string; roles: readonly [Role, ...Role[]] }[] = [
    { key: 'ann', name: 'Ann Analyst', roles: [['Analyst', labA]] },
    { key: 'bob', name: 'Bob Reviewer', roles: [['Reviewer', labA], ['Analyst', labA]] },
    { key: 'cid', name: 'Cid Quality', roles: [['QA', labA]] },
    { key: 'dee', name: 'Dee Manager', roles: [['LabManager', labA]] },
    { key: 'eve', name: 'Eve Analyst', roles: [['Analyst', labB]] },
    { key: 'adam', name: 'Adam Admin', roles: [['Admin', null]] },
  ];
  const people = {} as Record<(typeof spec)[number]['key'], Person>;

  await db.insertInto('release').values({ id: TEST_RELEASE }).onConflict((oc) => oc.doNothing()).execute();

  const out = await runAudited(db, serviceContext(), { kind: 'company' }, async (tx: AuditedTx) => {
    await createLab(tx, { id: labA, code: 'RD', ianaZone: 'America/New_York' });
    await createLab(tx, { id: labB, code: 'QC', ianaZone: 'Asia/Shanghai' });
    for (const p of spec) {
      const id = randomUUID() as PersonId;
      const username = p.key;
      const lab = p.roles[0][1];
      await tx.db.insertInto('person').values({ id, printed_name: p.name }).execute();
      await tx.db.insertInto('account').values({ person_id: id, username, password_hash: 'argon2id$fixture' }).execute();
      for (const [role, roleLab] of p.roles) {
        await tx.db.insertInto('role_grant').values({ id: randomUUID(), person_id: id, role, lab_id: roleLab }).execute();
      }
      const session = randomUUID() as SessionId;
      await tx.db.insertInto('session').values({
        id: session,
        token_hash: createHash('sha256').update(session).digest(),
        person_id: id,
        acting_lab_id: lab,
        workstation: 'bench-1',
        absolute_end_at: new Date(tx.dbNow.getTime() + 12 * 3600 * 1000),
      }).execute();
      await tx.db.insertInto('session_activity').values({ session_id: session, last_activity_at: sql`clock_timestamp()` }).execute();
      people[p.key] = { id, username, printedName: p.name, session, lab };
    }
    return { commit: people };
  });
  if (!('commit' in out)) throw new Error('fixture rolled back');

  return {
    labA,
    labB,
    ...out.commit,
    ctx: (person, role, over = {}) => ({
      person: person.id,
      role,
      actingLab: person.lab,
      customer: null,
      action: 'test.action',
      reason: { kind: 'first_save' },
      appRelease: TEST_RELEASE,
      session: person.session,
      commitKey: commitKey(),
      ledgers: ledgersFor(person.lab),
      ...over,
    }),
    seedCtx: serviceContext,
  };
}
