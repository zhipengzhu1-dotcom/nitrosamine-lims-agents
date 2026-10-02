import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { controls, type DeploymentFacts, parseControlList, realDataGate } from '../src/index.ts';

const met: DeploymentFacts = {
  login: 'decided',
  anchoringLive: true,
  fileVaultPersonalKey: true,
  openExceptions: [],
  fictionalRecords: [],
};

it('the control registry is the table in docs/real-data-gate.md, row for row', async () => {
  const markdown = await readFile(new URL('../../../docs/real-data-gate.md', import.meta.url), 'utf8');
  assert.deepEqual(controls, parseControlList(markdown));
  assert.ok(controls.length > 40, 'the table was parsed');
  assert.equal(controls.filter((c) => c.phase === 'task').length, 4, 'the four tasks the spec names are on the list');
});

describe('the real-data gate names each unmet condition and allows real data only when every one is met', () => {
  const unbuilt = controls.filter((c) => c.built !== 'yes').length;
  const listCondition = `Every control on the list is built; ${unbuilt} are not, the first being ${controls.find((c) => c.built !== 'yes')?.control}.`;
  const built = controls.map((c) => ({ phase: c.phase, control: c.control, built: 'yes' as const }));
  const cases: { name: string; facts: DeploymentFacts; conditions: string[] }[] = [
    {
      name: 'the demo login is named with the decided values it must reach',
      facts: { ...met, login: 'demo' },
      conditions: [
        'The login runs at its decided values (TOTP, 15-character passwords, lockout at 5, 15-minute idle limit, a password per person, a pepper); it runs as demo.',
      ],
    },
    {
      name: 'an exception still standing is named',
      facts: { ...met, openExceptions: ['TwoRole', 'DemoLogin'] },
      conditions: ['Every demo exception is recorded as lapsed; TwoRole, DemoLogin still stand.'],
    },
    {
      name: 'anchoring that is not live is a condition',
      facts: { ...met, anchoringLive: false },
      conditions: ['Anchoring of the Audit Trail is live.'],
    },
    {
      name: 'a host without a personal FileVault key is a condition',
      facts: { ...met, fileVaultPersonalKey: false },
      conditions: ['The host holds a personal FileVault key.'],
    },
    {
      name: 'the tables holding a record created under fictional are named',
      facts: { ...met, fictionalRecords: ['customer', 'test'] },
      conditions: ['No record was created under fictional; customer, test hold one.'],
    },
  ];
  for (const c of cases) {
    it(`${c.name}, alone, on a fully built list`, () => {
      const verdict = realDataGate(c.facts, built);
      assert.ok(!verdict.allowed);
      assert.deepEqual(verdict.conditions, c.conditions);
    });
  }
  it('with every other condition met, the list alone refuses while it holds an unbuilt control', () => {
    assert.deepEqual(realDataGate(met), { allowed: false, conditions: [listCondition] });
  });
  it('the gate allows real data once the list is fully built and every other condition is met', () => {
    assert.deepEqual(realDataGate(met, built), { allowed: true });
  });
});
