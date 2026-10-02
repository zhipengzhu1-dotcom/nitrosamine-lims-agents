import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { it } from 'node:test';
import { routes, stepRoute } from '@lims/domain';
import { sql } from 'kysely';
import { Client, ok, startApi } from './harness.ts';

const api = await startApi('lims_api_sign_in_concurrency_test');
const cora = api.person('cora');
const desk = await api.login(cora);

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
    await api.untilWaitingOnLocks(1);
    const signedIn = phone.call(routes.login, { username: cora.username, password: cora.password });
    const answers = Promise.all([submitted, signedIn]);
    await api.untilWaitingOnLocks(2);
    return { answers };
  });
  const [submission, signIn] = await answers;
  assert.deepEqual(await incidents(), incidentsBefore, 'no System Incident opened');
  ok(submission);
  ok(signIn);
});
