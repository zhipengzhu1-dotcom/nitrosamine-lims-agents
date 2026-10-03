import assert from 'node:assert/strict';
import { it } from 'node:test';
import { audited, type FitnessStatus } from '@lims/db';
import { type Equipment, equipmentStepRoute, routes, type SigningBody } from '@lims/domain';
import { sql } from 'kysely';
import { type Account, type Client, ok, onLabClock, refusedWith, startApi, toMillis } from './harness.ts';

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

it('a software or firmware change records the version now installed and suspends In use Equipment', async () => {
  const equipment = await inUse();
  const updated = ok(
    await as.ana.call(equipmentStepRoute('recordEvent'), {
      id: equipment.id,
      input: { kind: 'SoftwareChange', note: 'Installed the vendor patch.', version: '2.4.1' },
      signature: signing(equipment, ana),
    }),
  );
  assert.deepEqual([updated.softwareVersion, updated.fitnessStatus], ['2.4.1', 'Suspended']);
  const flashed = ok(
    await as.ana.call(equipmentStepRoute('recordEvent'), {
      id: equipment.id,
      input: { kind: 'FirmwareChange', note: 'Flashed the load cell firmware.', version: 'FW 7' },
      signature: signing(updated, ana),
    }),
  );
  assert.deepEqual([flashed.softwareVersion, flashed.firmwareVersion], ['2.4.1', 'FW 7']);
  const unnamed = await as.ana.send(equipmentStepRoute('recordEvent'), {
    id: equipment.id,
    input: { kind: 'SoftwareChange', note: 'Installed something.' },
    signature: signing(flashed, ana),
  });
  refusedWith(unnamed, 'malformed');
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

/**
 * Runs `press` after the Lab Manager, in another session, moved the Equipment to `status` but before that commits, so
 * the press reads the Equipment as the screen showed it, waits on the change (its row, or the Lab's chain) and writes
 * against the Equipment as it then is.
 */
async function movedUnder<T>(equipmentId: string, status: FitnessStatus, press: () => Promise<T>): Promise<T> {
  const as = {
    actor: `person:${lena.username}`,
    role: 'LabManager',
    reason: 'Change Equipment under a press',
  } as const;
  const { answer } = await audited(api.superuser, as, async (tx) => {
    await tx.updateTable('equipment').set({ fitnessStatus: status }).where('id', '=', equipmentId).execute();
    const answer = press();
    // A press left behind by a failed wait must not surface as an unhandled rejection.
    answer.catch(() => {});
    await api.untilWaitingOnLocks(1);
    return { answer };
  });
  return answer;
}

const stale = 'The Equipment has moved on since this screen loaded it. Reload it.';

it('a move pressed on Equipment that is retired before the write lands is refused as stale, and the Logbook keeps no move', async () => {
  const equipment = await inUse();
  const answer = await movedUnder(equipment.id, 'Retired', () =>
    as.lena.call(equipmentStepRoute('move'), { id: equipment.id, input: { roomId: prepRoom.id } }),
  );
  assert.equal(refusedWith(answer, 'stale'), stale);
  const after = ok(await as.lena.call(routes.equipment, { id: equipment.id }));
  assert.deepEqual([after.fitnessStatus, after.room.id], ['Retired', lcmsRoom.id]);
  assert.ok(!after.logbook.some((line) => line.entry === 'move'), 'the Logbook holds no move');
});

it('a retire pressed on Equipment that is suspended before the write lands is refused as stale, and the Equipment stays Suspended', async () => {
  const equipment = await inUse();
  const answer = await movedUnder(equipment.id, 'Suspended', () =>
    as.lena.call(equipmentStepRoute('retire'), { id: equipment.id, input: {} }),
  );
  assert.equal(refusedWith(answer, 'stale'), stale);
  assert.equal(ok(await as.lena.call(routes.equipment, { id: equipment.id })).fitnessStatus, 'Suspended');
});

it('a Note pressed on Equipment that is retired before the write lands is refused as stale, and the Logbook keeps no Note', async () => {
  const equipment = await inUse();
  const answer = await movedUnder(equipment.id, 'Retired', () =>
    as.ana.call(equipmentStepRoute('recordEvent'), {
      id: equipment.id,
      input: { kind: 'Note', note: 'Pan looks clean.' },
      signature: signing(equipment, ana),
    }),
  );
  assert.equal(refusedWith(answer, 'stale'), stale);
  const after = ok(await as.lena.call(routes.equipment, { id: equipment.id }));
  assert.ok(!after.logbook.some((line) => line.entry === 'event'), 'the Logbook holds no Event');
});

it('a Suspect and a retire sent at once on In use Equipment both answer: the Suspect suspends it and the retire is refused as stale', async () => {
  const equipment = await inUse();
  const held = { actor: 'svc:test', role: 'system', reason: 'Hold the Lab chain under two presses' } as const;
  // The chain is held while both presses queue on it, the Suspect first, so that the Suspect takes it first once released.
  const { suspect, retire } = await audited(api.superuser, held, async (tx) => {
    await sql`select lims.lock_chains(${api.labId})`.execute(tx);
    const suspect = as.samir.call(equipmentStepRoute('markSuspect'), {
      id: equipment.id,
      input: { reason: 'The pan rocks.' },
    });
    suspect.catch(() => {});
    await api.untilWaitingOnLocks(1);
    const retire = as.lena.call(equipmentStepRoute('retire'), { id: equipment.id, input: {} });
    retire.catch(() => {});
    await api.untilWaitingOnLocks(2);
    return { suspect, retire };
  });
  assert.equal(ok(await suspect).fitnessStatus, 'Suspended');
  assert.equal(refusedWith(await retire, 'stale'), stale);
  assert.equal(ok(await as.lena.call(routes.equipment, { id: equipment.id })).fitnessStatus, 'Suspended');
});

const recorders: [string, (equipment: Equipment) => Promise<void>][] = [
  [
    'a Suspect',
    async (equipment) => {
      ok(
        await as.samir.call(equipmentStepRoute('markSuspect'), {
          id: equipment.id,
          input: { reason: 'Reads 0.3 mg high.' },
        }),
      );
    },
  ],
  [
    'a signed Cleaning',
    async (equipment) => {
      const shown = ok(await as.ana.call(routes.equipment, { id: equipment.id }));
      ok(
        await as.ana.call(equipmentStepRoute('recordEvent'), {
          id: equipment.id,
          input: { kind: 'Cleaning', note: 'Wiped the pan.' },
          signature: signing(shown, ana),
        }),
      );
    },
  ],
];

for (const [event, record] of recorders)
  it(`QA's Approved over Quarantined Equipment loaded before ${event} was recorded on it is refused, and the Equipment stays Quarantined`, async () => {
    const equipment = await register();
    await record(equipment);
    const refused = await approve(as.quinn, equipment, quinn);
    assert.equal(
      refusedWith(refused, 'recordChanged'),
      'The Equipment changed since this screen loaded it. Read it again before signing.',
    );
    const after = ok(await as.quinn.call(routes.equipment, { id: equipment.id }));
    assert.equal(after.fitnessStatus, 'Quarantined');
    assert.notEqual(after.recordVersion.contentHash, equipment.recordVersion.contentHash);
  });

/** The version of the Equipment that its latest Approved Signature binds. */
async function boundVersion(equipmentId: string): Promise<number> {
  const bound = await api.superuser
    .selectFrom('signature')
    .innerJoin('recordVersion', 'recordVersion.id', 'signature.recordVersionId')
    .select('recordVersion.version')
    .where('recordVersion.recordTable', '=', 'equipment')
    .where('recordVersion.recordId', '=', equipmentId)
    .orderBy('recordVersion.version', 'desc')
    .executeTakeFirstOrThrow();
  return bound.version;
}

/** Moves In use Equipment to the other Room, then has QA approve it on the version shown, which its Signature must bind. */
const moveAndApprove = async (equipment: Equipment, round: number): Promise<Equipment> => {
  const roomId = equipment.room.id === lcmsRoom.id ? prepRoom.id : lcmsRoom.id;
  const moved = ok(await as.lena.call(equipmentStepRoute('move'), { id: equipment.id, input: { roomId } }));
  const shown = ok(await as.quinn.call(routes.equipment, { id: equipment.id })).recordVersion;
  assert.deepEqual(shown, moved.recordVersion, `round ${round}: the step's reply shows what a reload shows`);
  const approved = ok(await approve(as.quinn, moved, quinn));
  assert.equal(await boundVersion(approved.id), shown.version, `round ${round}`);
  return approved;
};

it('the Record Version shown is the one the next Approved signing binds, even when a move returns the Equipment to an earlier state', async () => {
  let equipment = await inUse();
  for (let round = 1; round <= 6; round++) equipment = await moveAndApprove(equipment, round);
});

it('a Performed signing keeps the Equipment as the signer saw it as a Record Version', async () => {
  const equipment = await inUse();
  ok(
    await as.ana.call(equipmentStepRoute('recordEvent'), {
      id: equipment.id,
      input: { kind: 'Cleaning', note: 'Wiped the pan.' },
      signature: signing(equipment, ana),
    }),
  );
  const kept = await api.superuser
    .selectFrom('recordVersion')
    .select(sql<string>`encode(content_hash, 'hex')`.as('contentHash'))
    .where('recordTable', '=', 'equipment')
    .where('recordId', '=', equipment.id)
    .where('version', '=', equipment.recordVersion.version)
    .executeTakeFirst();
  assert.equal(kept?.contentHash, equipment.recordVersion.contentHash);
});

/** Renames a person through the Audit Trail after they signed, so a reply can be checked for the printed name as signed. */
const rename = (account: Account, displayName: string) =>
  audited(api.superuser, { actor: 'svc:test', role: 'system', reason: 'Rename a signer after signing' }, (tx) =>
    tx.updateTable('person').set({ displayName }).where('id', '=', account.id).execute(),
  );

it('the Equipment and the Logbook line that moved it to In use show the Approved Signature with the printed name as signed', async () => {
  const signer = await api.addPerson('qa.manifest', ['QA']);
  const equipment = await register();
  ok(await approve(await api.login(signer), equipment, signer));
  await rename(signer, 'Renamed After Approving');

  const view = ok(await as.quinn.call(routes.equipment, { id: equipment.id }));
  const [approved, ...others] = view.signatures;
  assert.deepEqual(others, [], 'the Equipment carries one Signature');
  assert.ok(approved, 'the Equipment carries its Approved Signature');
  assert.deepEqual(
    {
      meaning: approved.meaning,
      signer: approved.signer,
      username: approved.username,
      role: approved.role,
      record: approved.record,
      recordVersion: approved.recordVersion,
      unsigned: approved.unsigned,
    },
    {
      meaning: 'Approved',
      signer: 'qa.manifest',
      username: 'qa.manifest',
      role: 'QA',
      record: 'Equipment',
      recordVersion: equipment.recordVersion,
      unsigned: false,
    },
  );
  assert.equal(toMillis(approved.signedAtLab), onLabClock(approved.signedAt));
  const toInUse = view.logbook.find((line) => line.entry === 'status' && line.to === 'InUse');
  assert.deepEqual(toInUse?.entry === 'status' && toInUse.signature, approved, 'the In use line binds that Signature');
  const registered = view.logbook.find((line) => line.entry === 'status' && line.from === null);
  assert.equal(registered?.entry === 'status' && registered.signature, null, 'the registration line is unsigned');
});

const changesAfterApproval: [string, (equipment: Equipment) => Promise<Equipment>][] = [
  [
    'a Room move',
    async (equipment) =>
      ok(await as.lena.call(equipmentStepRoute('move'), { id: equipment.id, input: { roomId: prepRoom.id } })),
  ],
  [
    'a Suspect',
    async (equipment) =>
      ok(await as.samir.call(equipmentStepRoute('markSuspect'), { id: equipment.id, input: { reason: 'It drifts.' } })),
  ],
  [
    'retiring it',
    async (equipment) => ok(await as.lena.call(equipmentStepRoute('retire'), { id: equipment.id, input: {} })),
  ],
];

for (const [change, make] of changesAfterApproval)
  it(`${change} after QA's Approved shows that Approved Signature unsigned, on the Equipment and on its In use line`, async () => {
    const changed = await make(await inUse());
    const [approved] = changed.signatures;
    assert.equal(approved?.unsigned, true, 'the Equipment shows its Approved Signature unsigned');
    const toInUse = changed.logbook.find((line) => line.entry === 'status' && line.to === 'InUse');
    assert.equal(toInUse?.entry === 'status' && toInUse.signature?.unsigned, true, 'the In use line shows it unsigned');
  });

/** The hash, hex-encoded, that the stored Record Version `version` of the Equipment holds, if one is stored. */
async function storedHash(equipmentId: string, version: number): Promise<string | undefined> {
  const stored = await api.superuser
    .selectFrom('recordVersion')
    .select(sql<string>`encode(content_hash, 'hex')`.as('contentHash'))
    .where('recordTable', '=', 'equipment')
    .where('recordId', '=', equipmentId)
    .where('version', '=', version)
    .executeTakeFirst();
  return stored?.contentHash;
}

it('the Record Version the Equipment shows is stored with the hash it shows, whatever step came last', async () => {
  const registered = await register();
  const approved = ok(await approve(as.quinn, registered, quinn));
  const cleaned = ok(
    await as.ana.call(equipmentStepRoute('recordEvent'), {
      id: approved.id,
      input: { kind: 'Cleaning', note: 'Wiped the pan.' },
      signature: signing(approved, ana),
    }),
  );
  const moved = ok(await as.lena.call(equipmentStepRoute('move'), { id: approved.id, input: { roomId: prepRoom.id } }));
  const retired = ok(await as.lena.call(equipmentStepRoute('retire'), { id: approved.id, input: {} }));
  for (const [step, shown] of Object.entries({ registered, approved, cleaned, moved, retired }))
    assert.equal(
      await storedHash(shown.id, shown.recordVersion.version),
      shown.recordVersion.contentHash,
      `${step}: Record Version ${shown.recordVersion.version}`,
    );
});

it('an Equipment Event line shows its Performed Signature with the printed name as signed, and a Suspect line none', async () => {
  const signer = await api.addPerson('analyst.manifest', ['Analyst']);
  const equipment = await inUse();
  ok(
    await (await api.login(signer)).call(equipmentStepRoute('recordEvent'), {
      id: equipment.id,
      input: { kind: 'Cleaning', note: 'Wiped the weighing pan.' },
      signature: signing(equipment, signer),
    }),
  );
  await rename(signer, 'Renamed After Performing');
  ok(await as.samir.call(equipmentStepRoute('markSuspect'), { id: equipment.id, input: { reason: 'It drifts.' } }));

  const view = ok(await as.quinn.call(routes.equipment, { id: equipment.id }));
  const event = view.logbook.find((line) => line.entry === 'event' && line.kind === 'Cleaning');
  const performed = event?.entry === 'event' ? event.signature : null;
  assert.ok(performed, 'the Cleaning line carries its Performed Signature');
  assert.deepEqual(
    {
      meaning: performed.meaning,
      signer: performed.signer,
      username: performed.username,
      role: performed.role,
      record: performed.record,
      unsigned: performed.unsigned,
    },
    {
      meaning: 'Performed',
      signer: 'analyst.manifest',
      username: 'analyst.manifest',
      role: 'Analyst',
      record: 'Equipment Event',
      unsigned: false,
    },
  );
  assert.equal(toMillis(performed.signedAtLab), onLabClock(performed.signedAt));
  const suspect = view.logbook.find((line) => line.entry === 'event' && line.kind === 'Suspect');
  assert.equal(suspect?.entry === 'event' && suspect.signature, null, 'a Suspect line is not signed');
  assert.deepEqual(
    view.signatures.map((s) => s.meaning),
    ['Approved'],
    'the Performed Signature binds the Event, not the Equipment',
  );
});
