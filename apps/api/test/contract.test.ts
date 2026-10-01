// The web app may import only @lims/contract, so the few rules it needs are copied there. Each copy
// is checked against the server's own definition here, where both are importable.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHANGE_REASONS, PASSWORD_RULES, SIGNS_AS, STATEMENT, type SessionAnswer } from '@lims/contract/session';
import { BALANCE_KIND as DOMAIN_BALANCE_KIND } from '@lims/domain/gates';
import { SIGNS_AS as DOMAIN_SIGNS_AS, STATEMENT as DOMAIN_STATEMENT } from '@lims/domain/signing';
import { BALANCE_KIND } from '@lims/contract';
import { ReasonSchema } from '../src/commands/values.ts';
import { PASSWORD_PROBLEM_TEXT } from '../src/identity/password.ts';
import { enrol, login, testApi, type TestApi } from '../src/testing/harness.ts';
import { createLab } from './support.ts';

describe('the contract copies of server rules', () => {
  it('the Balance kind the workbench filters by is the one the gates refuse on', () => {
    expect(BALANCE_KIND).toBe(DOMAIN_BALANCE_KIND);
  });

  it('SIGNS_AS matches the domain\'s', () => {
    expect(SIGNS_AS).toEqual(DOMAIN_SIGNS_AS);
  });

  it('each meaning\'s statement matches the domain\'s', () => {
    expect(STATEMENT).toEqual(DOMAIN_STATEMENT);
  });

  it('the Reason for Change picklist is exactly what value.change accepts, besides Other', () => {
    const [picklist] = ReasonSchema.options;
    expect(CHANGE_REASONS.map((r) => r.code)).toEqual(picklist.shape.code.options);
  });

  it('the password rules the enrolment page prints are the server\'s', () => {
    expect(PASSWORD_RULES).toEqual(Object.values(PASSWORD_PROBLEM_TEXT));
  });
});

describe('GET /api/session when locked', () => {
  let api: TestApi;
  beforeAll(async () => {
    api = await testApi();
  });
  afterAll(() => api.close());

  it('names the owner in full, when it locked, the Lab\'s zone and the workstation', async () => {
    const lab = await createLab(api, 'RD');
    const ann = await enrol(api, { username: 'ann', printedName: 'Ann Analyst', grants: [{ role: 'Analyst', lab: lab.id as never }, { role: 'Reviewer', lab: lab.id as never }] });
    const tab = await login(api, ann, 'bench-9');
    const locked = await tab.command('session.lock', {});
    const s = (await tab.session()).body as SessionAnswer;
    expect(s).toMatchObject({
      state: 'locked', dataClass: 'fictional', lockReason: 'manual', zone: 'America/New_York', workstation: 'bench-9',
      owner: { printedName: 'Ann Analyst', username: 'ann', nativeName: null, roles: ['Analyst', 'Reviewer'] },
    });
    if (s.state !== 'locked') throw new Error('not locked');
    expect(Math.abs(Date.parse(s.lockedAt) - Date.parse(locked.body.at as string))).toBeLessThan(1000);
  });
});
