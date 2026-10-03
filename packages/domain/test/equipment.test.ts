import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type EquipmentUse,
  equipmentRefusal,
  type Fitness,
  type FitnessStatus,
  fitFor,
  fitnessOf,
  openEquipmentSteps,
} from '../src/index.ts';

describe('the fitness check says whether Equipment may serve a Test, take an item or give one up', () => {
  const table: [FitnessStatus, EquipmentUse, Fitness][] = [
    ['InUse', 'use', { fit: true }],
    ['InUse', 'place', { fit: true }],
    ['InUse', 'remove', { fit: true }],
    ['Quarantined', 'use', { fit: false, reason: 'This Equipment is Quarantined: QA has not approved it for use.' }],
    ['Quarantined', 'place', { fit: false, reason: 'This Equipment is Quarantined: QA has not approved it for use.' }],
    ['Quarantined', 'remove', { fit: true }],
    [
      'Suspended',
      'use',
      { fit: false, reason: 'This Equipment is Suspended: it must be checked and approved again before use.' },
    ],
    [
      'Suspended',
      'place',
      { fit: false, reason: 'This Equipment is Suspended: it must be checked and approved again before use.' },
    ],
    ['Suspended', 'remove', { fit: true }],
    ['Expired', 'use', { fit: false, reason: 'This Equipment is Expired: its Calibration is past due.' }],
    ['Expired', 'place', { fit: false, reason: 'This Equipment is Expired: its Calibration is past due.' }],
    ['Expired', 'remove', { fit: true }],
    ['Retired', 'use', { fit: false, reason: 'This Equipment is Retired.' }],
    ['Retired', 'place', { fit: false, reason: 'This Equipment is Retired.' }],
    ['Retired', 'remove', { fit: true }],
  ];
  for (const [status, use, fitness] of table)
    it(`${status} Equipment asked to ${use} is ${fitness.fit ? 'fit' : 'refused'}`, () => {
      assert.deepEqual(fitFor(status, use), fitness);
    });
});

describe('Expired is derived from the due date and never stored', () => {
  it('In use Equipment past its due date is Expired', () => {
    assert.equal(fitnessOf('InUse', '2026-09-30', '2026-10-01'), 'Expired');
  });
  it('In use Equipment on its due date, or with none, stays In use', () => {
    assert.equal(fitnessOf('InUse', '2026-10-01', '2026-10-01'), 'InUse');
    assert.equal(fitnessOf('InUse', null, '2026-10-01'), 'InUse');
  });
  it('Suspended Equipment past its due date stays Suspended', () => {
    assert.equal(fitnessOf('Suspended', '2026-09-30', '2026-10-01'), 'Suspended');
  });
});

describe('the Equipment steps refuse by role, then by Fitness Status', () => {
  it('only QA approves Equipment for use', () => {
    assert.deepEqual(equipmentRefusal('approve', 'Quarantined', ['LabManager']), {
      kind: 'role',
      message: 'Only QA may take the step of approving Equipment for use.',
    });
    assert.equal(equipmentRefusal('approve', 'Quarantined', ['QA']), null);
  });
  it('approving In use Equipment is refused', () => {
    assert.deepEqual(equipmentRefusal('approve', 'InUse', ['QA']), {
      kind: 'state',
      message: 'The step of approving Equipment for use is not open on In use Equipment.',
    });
  });
  it('anyone on the Lab staff marks Equipment suspect, a Customer never', () => {
    for (const role of ['SampleCustodian', 'Analyst', 'Reviewer', 'QA', 'LabManager'] as const)
      assert.equal(equipmentRefusal('markSuspect', 'InUse', [role]), null, role);
    assert.equal(equipmentRefusal('markSuspect', 'InUse', ['Customer'])?.kind, 'role');
  });
  it('only the Lab Manager retires Equipment', () => {
    assert.deepEqual(equipmentRefusal('retire', 'InUse', ['QA']), {
      kind: 'role',
      message: 'Only the Lab Manager may take the step of retiring Equipment.',
    });
  });
  it('no step is open on Retired Equipment', () => {
    assert.deepEqual(openEquipmentSteps('Retired', ['QA', 'LabManager', 'Analyst']), []);
  });
  it('the Lab Manager may record an Event on, move, retire and mark suspect In use Equipment, but not approve it', () => {
    assert.deepEqual(openEquipmentSteps('InUse', ['LabManager']), ['markSuspect', 'recordEvent', 'move', 'retire']);
  });
});
