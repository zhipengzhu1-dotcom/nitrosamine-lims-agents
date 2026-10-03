import assert from 'node:assert/strict';
import { it } from 'node:test';
import { type Equipment, equipmentStepRoute, routes, type SigningBody } from '@lims/domain';
import { type Account, type Client, ok, refusedWith, startApi } from './harness.ts';

const api = await startApi('lims_api_equipment_test');
const lena = api.person('lena');
const quinn = api.person('quinn');
const ana = api.person('ana');
const as = {
  lena: await api.login(lena),
  quinn: await api.login(quinn),
  ana: await api.login(ana),
  samir: await api.login(api.person('samir')),
  cora: await api.login(api.person('cora')),
};
const { rooms, staff } = ok(await as.lena.call(routes.equipmentChoices));
const [lcmsRoom, prepRoom] = rooms;
if (!lcmsRoom || !prepRoom) assert.fail('the seed gives the Lab two Rooms');
const responsible = staff.find((p) => p.username === lena.username) ?? assert.fail('the Lab Manager is on the staff');

let serial = 0;
const balance = () => {
  serial += 1;
  return {
    kind: 'Balance',
    name: `BAL-${serial} (fictional)`,
    manufacturer: 'Fictional Instruments',
    model: 'XR-205',
    serial: `SN-${serial}`,
    roomId: lcmsRoom.id,
    responsiblePersonId: responsible.id,
  };
};

const register = async () => ok(await as.lena.call(routes.registerEquipment, balance()));

const signing = (equipment: Equipment, account: Account): SigningBody => ({
  username: account.username,
  password: account.password,
  recordVersion: { version: equipment.recordVersion.version, contentHash: equipment.recordVersion.contentHash },
  statementVersion: equipment.statement.version,
});

const approve = (client: Client, equipment: Equipment, account: Account) =>
  client.call(equipmentStepRoute('approve'), { id: equipment.id, input: {}, signature: signing(equipment, account) });

const inUse = async () => ok(await approve(as.quinn, await register(), quinn));

it('the Lab Manager registers Equipment, which starts Quarantined', async () => {
  const equipment = await register();
  assert.equal(equipment.fitnessStatus, 'Quarantined');
  assert.equal(equipment.room.id, lcmsRoom.id);
  assert.equal(equipment.responsiblePerson.username, lena.username);
});

it('Equipment registered without its Room, Responsible Person, manufacturer, model or serial number is refused', async () => {
  for (const missing of ['roomId', 'responsiblePersonId', 'manufacturer', 'model', 'serial'] as const) {
    const { [missing]: _, ...body } = balance();
    // oxlint-disable-next-line typescript/consistent-type-assertions -- the body leaves out a required field on purpose
    const refused = await as.lena.call(routes.registerEquipment, body as ReturnType<typeof balance>);
    assert.equal(refused.kind, 'refused', missing);
    if (refused.kind === 'refused') assert.equal(refused.body.kind, 'malformed', missing);
  }
});

it('Equipment registered by anyone but the Lab Manager is refused', async () => {
  const refused = await as.quinn.call(routes.registerEquipment, balance());
  assert.equal(refusedWith(refused, 'role'), 'The Lab Manager registers Equipment.');
});

it("only QA's Approved signing moves Quarantined Equipment to In use", async () => {
  const equipment = await register();
  const byLabManager = await approve(as.lena, equipment, lena);
  assert.equal(refusedWith(byLabManager, 'role'), 'Only QA may take the step of approving Equipment for use.');
  const approved = ok(await approve(as.quinn, equipment, quinn));
  assert.equal(approved.fitnessStatus, 'InUse');
  const again = await approve(as.quinn, approved, quinn);
  assert.equal(refusedWith(again, 'state'), 'The step of approving Equipment for use is not open on In use Equipment.');
});

it('approving Equipment without a signature is refused', async () => {
  const equipment = await register();
  const refused = await as.quinn.call(equipmentStepRoute('approve'), { id: equipment.id, input: {} });
  assert.equal(refusedWith(refused, 'malformed'), "This step needs the signer's credentials.");
});

it('marking In use Equipment suspect suspends it and records who marked it and why', async () => {
  const equipment = await inUse();
  const marked = ok(
    await as.samir.call(equipmentStepRoute('markSuspect'), {
      id: equipment.id,
      input: { reason: 'The level bubble is off centre.' },
    }),
  );
  assert.equal(marked.fitnessStatus, 'Suspended');
  const event = marked.logbook.find((line) => line.entry === 'event');
  assert.deepEqual(event && { kind: event.kind, note: event.note, by: event.by.username }, {
    kind: 'Suspect',
    note: 'The level bubble is off centre.',
    by: api.person('samir').username,
  });
});

it('a Customer marking Equipment suspect is refused', async () => {
  const equipment = await inUse();
  const refused = await as.cora.call(equipmentStepRoute('markSuspect'), {
    id: equipment.id,
    input: { reason: 'Looks broken.' },
  });
  assert.equal(refusedWith(refused, 'role'), 'Equipment is read by the staff of its Lab.');
});

it('a Repair recorded and signed Performed on In use Equipment suspends it', async () => {
  const equipment = await inUse();
  const repaired = ok(
    await as.ana.call(equipmentStepRoute('recordEvent'), {
      id: equipment.id,
      input: { kind: 'Repair', note: 'Replaced the draught shield.' },
      signature: signing(equipment, ana),
    }),
  );
  assert.equal(repaired.fitnessStatus, 'Suspended');
});

it('an Equipment Event without the Performed signing is refused', async () => {
  const equipment = await inUse();
  const refused = await as.ana.call(equipmentStepRoute('recordEvent'), {
    id: equipment.id,
    input: { kind: 'Cleaning', note: 'Wiped the pan.' },
  });
  assert.equal(refusedWith(refused, 'malformed'), "This step needs the signer's credentials.");
});

it('retiring Equipment is refused for anyone but the Lab Manager, and any step on Retired Equipment is refused', async () => {
  const equipment = await inUse();
  const byQa = await as.quinn.call(equipmentStepRoute('retire'), { id: equipment.id, input: {} });
  assert.equal(refusedWith(byQa, 'role'), 'Only the Lab Manager may take the step of retiring Equipment.');
  const retired = ok(await as.lena.call(equipmentStepRoute('retire'), { id: equipment.id, input: {} }));
  assert.equal(retired.fitnessStatus, 'Retired');
  const suspect = await as.samir.call(equipmentStepRoute('markSuspect'), {
    id: equipment.id,
    input: { reason: 'Still on the bench.' },
  });
  assert.equal(
    refusedWith(suspect, 'state'),
    'The step of marking Equipment suspect is not open on Retired Equipment.',
  );
  const approved = await approve(as.quinn, retired, quinn);
  assert.equal(
    refusedWith(approved, 'state'),
    'The step of approving Equipment for use is not open on Retired Equipment.',
  );
});

it('moving Equipment to another Room adds to its location history and keeps the old Room', async () => {
  const equipment = await inUse();
  const moved = ok(
    await as.lena.call(equipmentStepRoute('move'), { id: equipment.id, input: { roomId: prepRoom.id } }),
  );
  assert.equal(moved.room.id, prepRoom.id);
  assert.equal(moved.fitnessStatus, 'Suspended');
  const move = moved.logbook.find((line) => line.entry === 'move');
  assert.deepEqual(move && [move.from.id, move.to.id], [lcmsRoom.id, prepRoom.id]);
});

it('the Logbook lists Events, Fitness Status changes and moves in time order', async () => {
  const equipment = await inUse();
  ok(
    await as.ana.call(equipmentStepRoute('recordEvent'), {
      id: equipment.id,
      input: { kind: 'Cleaning', note: 'Wiped the pan.' },
      signature: signing(equipment, ana),
    }),
  );
  const moved = ok(
    await as.lena.call(equipmentStepRoute('move'), { id: equipment.id, input: { roomId: prepRoom.id } }),
  );
  assert.deepEqual(
    moved.logbook.map((line) =>
      line.entry === 'event' ? `event ${line.kind}` : line.entry === 'status' ? `status ${line.to}` : 'move',
    ),
    ['status Quarantined', 'status InUse', 'event Cleaning', 'status Suspended', 'move'],
  );
  // ISO 8601 UTC instants of one format sort as strings.
  const times = moved.logbook.map((line) => String(line.at));
  assert.deepEqual(times, [...times].sort());
});
