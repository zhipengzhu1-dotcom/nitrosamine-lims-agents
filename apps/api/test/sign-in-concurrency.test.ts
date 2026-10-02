import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { it } from 'node:test';
import { routes, stepRoute } from '@lims/domain';
import { sql } from 'kysely';
import { Client, ok, startApi } from './harness.ts';

const api = await startApi('lims_api_sign_in_concurrency_test');
const cora = api.person('cora');
const desk = await api.login(cora);

async function untilWaitingOnLocks(sessions: number): Promise<void> {
  for (let waiting = 0; waiting < sessions; ) {
    await sql`select pg_sleep(0.05)`.execute(api.superuser);
    ({ n: waiting } = await api.superuser
      .selectNoFrom(
        sql<number>`(select count(*)::int from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock')`.as('n'),
      )
      .executeTakeFirstOrThrow());
  }
}

it('a sign-in that meets a Submission by the same person mid-transaction lets both commit', async () => {
  const phone = new Client(api.base);
  const incidents = () => api.superuser.selectFrom('systemIncident').select(['step', 'sqlstate']).execute();
  const incidentsBefore = await incidents();
  const { answers } = await api.superuser.transaction().execute(async (tx) => {
    await sql`lock table lims.submission in exclusive mode`.execute(tx);
    const submitted = desk.send(stepRoute('submit'), {
      commitKey: randomUUID(),
      input: { methodId: api.methodId, description: 'Metformin HCl tablets (fictional)' },
    });
    await untilWaitingOnLocks(1);
    const signedIn = phone.call(routes.login, { username: cora.username, password: cora.password });
    await untilWaitingOnLocks(2);
    return { answers: Promise.all([submitted, signedIn]) };
  });
  const [submission, signIn] = await answers;
  assert.deepEqual(await incidents(), incidentsBefore, 'no System Incident opened');
  ok(submission);
  ok(signIn);
});
