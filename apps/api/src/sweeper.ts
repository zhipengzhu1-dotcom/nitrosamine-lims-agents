// The session sweeper (svc:session-sweeper). Enforcement never waits for it: the state is derived
// on every request. It only writes the audited idle_lock rows the access log needs, so a lock
// that happened by the clock also has its event.

import { sql, type Kysely } from 'kysely';
import { COMPANY_LEDGER, runAudited, SERVICE, type AuditContext, type DB } from '@lims/db';
import type { CommitKey } from '@lims/domain/ids';
import { randomUUID } from 'node:crypto';

export async function sweepIdleSessions(db: Kysely<DB>, release: string): Promise<number> {
  const ctx: AuditContext = {
    person: SERVICE.sessionSweeper.person, role: SERVICE.sessionSweeper.role, actingLab: null, customer: null,
    action: 'session.sweep', reason: { kind: 'action' }, appRelease: release, session: null, commitKey: randomUUID() as CommitKey, ledgers: [COMPANY_LEDGER],
  };
  const out = await runAudited(db, ctx, { kind: 'company' }, async (tx) => {
    const rows = await tx.db.selectFrom('session as s').leftJoin('session_activity as a', 'a.session_id', 's.id')
      .select(['s.id', 's.person_id'])
      .where('s.locked_at', 'is', null).where('s.ended_at', 'is', null)
      .where(sql<boolean>`lims.session_state(s, coalesce(a.last_activity_at, s.started_at), now()) = 'locked'`)
      .execute();
    for (const s of rows) {
      await tx.db.updateTable('session').set({ locked_at: sql`clock_timestamp()`, lock_reason: 'idle' }).where('id', '=', s.id).execute();
      await tx.db.insertInto('auth_event').values({ person_id: s.person_id, session_id: s.id, kind: 'idle_lock', counts_toward_lockout: false }).execute();
    }
    return { commit: rows.length };
  });
  return 'commit' in out ? out.commit : 0;
}
