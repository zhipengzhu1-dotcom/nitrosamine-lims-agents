import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { routes } from '@lims/domain';
import { sql } from 'kysely';
import { Client, ok, refusedWith, startApi } from './harness.ts';

const api = await startApi('lims_api_preferences_test');
const ana = api.person('ana');
const rui = api.person('rui');
const cora = api.person('cora');

const reducedMotionOf = async (client: Client) => ok(await client.call(routes.me)).preferences.reducedMotion;

describe('the reduced-motion preference', () => {
  it('is off for a person who never set it, and the sign-in reply says so', async () => {
    const client = new Client(api.base);
    const signedIn = ok(
      await client.call(routes.login, { username: rui.username, password: rui.password, labId: api.labId }),
    );
    assert.deepEqual(signedIn.preferences, { reducedMotion: false });
  });

  it('a person sets it and reads it back, the next sign-in carries it, and the Audit Trail records the one change under the person', async () => {
    const client = await api.login(cora);
    assert.deepEqual(ok(await client.call(routes.setPreferences, { reducedMotion: true })), { reducedMotion: true });
    ok(await client.call(routes.setPreferences, { reducedMotion: true }));
    assert.equal(await reducedMotionOf(client), true);
    ok(await client.call(routes.logout));

    const again = new Client(api.base);
    const signedIn = ok(
      await again.call(routes.login, { username: cora.username, password: cora.password, labId: api.labId }),
    );
    assert.deepEqual(signedIn.preferences, { reducedMotion: true });

    const entries = await api.superuser
      .selectFrom('auditEntry')
      .select(['actor', 'role', 'reason', 'op', sql`new_row->'reduced_motion'`.as('reducedMotion')])
      .where('tableName', '=', 'person')
      .where('op', '=', 'UPDATE')
      .where(sql`new_row->>'id'`, '=', cora.id)
      .execute();
    assert.deepEqual(entries, [
      {
        actor: `person:${cora.username}`,
        role: 'none',
        reason: 'Set my reduced-motion preference',
        op: 'UPDATE',
        reducedMotion: true,
      },
    ]);
  });

  it('a person changes only their own preference', async () => {
    const client = await api.login(ana);
    ok(await client.call(routes.setPreferences, { reducedMotion: true }));
    const other = await api.login(rui);
    assert.equal(await reducedMotionOf(other), false);
    ok(await client.call(routes.setPreferences, { reducedMotion: false }));
    assert.equal(await reducedMotionOf(client), false);
  });

  it('after Switch user the session reply carries the new person’s preference, and switching back carries the first person’s again', async () => {
    const tablet = await api.login(ana);
    ok(await tablet.call(routes.setPreferences, { reducedMotion: true }));

    ok(await tablet.call(routes.lock));
    const asRui = ok(
      await tablet.call(routes.login, { username: rui.username, password: rui.password, labId: api.labId }),
    );
    assert.equal(asRui.person.username, rui.username);
    assert.deepEqual(asRui.preferences, { reducedMotion: false });

    ok(await tablet.call(routes.lock));
    const asAna = ok(
      await tablet.call(routes.login, { username: ana.username, password: ana.password, labId: api.labId }),
    );
    assert.deepEqual(asAna.preferences, { reducedMotion: true });

    ok(await tablet.call(routes.lock));
    const unlocked = ok(await tablet.call(routes.unlock, { password: ana.password }));
    assert.deepEqual(unlocked.preferences, { reducedMotion: true }, 'an unlock carries it too');
    ok(await tablet.call(routes.setPreferences, { reducedMotion: false }));
  });

  it('a locked session cannot change the preference', async () => {
    const client = await api.login(rui);
    ok(await client.call(routes.lock));
    refusedWith(await client.call(routes.setPreferences, { reducedMotion: true }), 'sessionLocked');
    assert.equal(
      (await api.superuser.selectFrom('person').select('reducedMotion').where('id', '=', rui.id).executeTakeFirst())
        ?.reducedMotion,
      false,
    );
  });

  it('with no session the preference cannot be set', async () => {
    refusedWith(await new Client(api.base).call(routes.setPreferences, { reducedMotion: true }), 'noSession');
  });
});
