import { type DB, postgresFault } from '@lims/db';
import {
  type ActorContext,
  type EquipmentStepBody,
  type EquipmentStepInputs,
  type EquipmentStepName,
  equipmentAccess,
  equipmentRegistrar,
  equipmentStepNames,
  equipmentStepRoute,
  equipmentSteps,
  type FitnessStatus,
  labStaff,
  type LogbookEntry,
  mayReadEquipment,
  type RoomRef,
  routes,
  type StoredFitnessStatus,
} from '@lims/domain';
import { type Kysely, sql, type Updateable } from 'kysely';
import type { App } from './app.ts';
import { type Credentials, reauthenticate, sourceAddressOf } from './auth.ts';
import { refuse } from './refuse.ts';
import { labScope, type Scope, type WriteQueries } from './scope.ts';
import { proveReauthentication, signingRefused, signRecord, statementInForce } from './signing.ts';

function readableBy(actor: ActorContext): void {
  if (!mayReadEquipment(actor.roles)) refuse('role', 'Equipment is read by the staff of its Lab.');
}

/**
 * The version a signing from this screen binds: the latest Record Version when it holds the Equipment's content, else
 * the next one, as lims.save_record_version decides. An earlier version with the same content is not it.
 */
const versionOf = (labId: string) => sql<number>`coalesce(
  (select case when v.content_hash = lims.equipment_content_hash(equipment) then v.version else v.version + 1 end
     from lims.record_version v
    where v.lab_id = ${labId} and v.record_table = 'equipment' and v.record_id = equipment.id
    order by v.version desc limit 1),
  1)`;

/** A person named by an Audit Trail actor (`person:<username>`) or by id, as the Logbook shows them. */
const byPerson = (username: string | null, displayName: string | null) => ({
  username: username ?? 'unknown',
  displayName: displayName ?? 'Unknown person',
});

/** A Logbook line as the API holds it, with its time as the database returned it. */
type Line = LogbookEntry extends infer E ? (E extends { at: unknown } ? Omit<E, 'at'> & { at: Date } : never) : never;

/** The Fitness Status a row of lims.equipment holds, which is never Expired: the database refuses it. */
function stored(status: FitnessStatus): StoredFitnessStatus {
  if (status === 'Expired') throw new Error('lims.equipment stores no Expired Fitness Status');
  return status;
}

/**
 * The Logbook: the Equipment Events, and the Fitness Status changes and Room moves the Audit Trail holds for it, in
 * the database's time order. It has no table of its own, so it can never disagree with the records it reads.
 */
async function logbookOf(scope: Scope, id: string, rooms: Map<string, RoomRef>): Promise<Line[]> {
  const events = await scope
    .from('equipmentEvent')
    .innerJoin('person', 'person.id', 'equipmentEvent.recordedBy')
    .select([
      'equipmentEvent.kind',
      'equipmentEvent.note',
      'equipmentEvent.recordedAt as at',
      'person.username',
      'person.displayName',
    ])
    .where('equipmentEvent.equipmentId', '=', id)
    .execute();
  const changes = await scope
    .trail()
    .leftJoin('person', (j) => j.on(sql<boolean>`'person:' || person.username = audit_entry.actor`))
    .select([
      'auditEntry.at',
      sql<FitnessStatus | null>`(audit_entry.old_row ->> 'fitness_status')::lims.fitness_status`.as('fromStatus'),
      sql<FitnessStatus | null>`(audit_entry.new_row ->> 'fitness_status')::lims.fitness_status`.as('toStatus'),
      sql<string | null>`audit_entry.old_row ->> 'room_id'`.as('fromRoom'),
      sql<string | null>`audit_entry.new_row ->> 'room_id'`.as('toRoom'),
      'person.username',
      'person.displayName',
    ])
    .where('auditEntry.tableName', '=', 'equipment')
    .where(sql<boolean>`audit_entry.new_row ->> 'id' = ${id}`)
    .orderBy('auditEntry.seq')
    .execute();
  const room = (roomId: string): RoomRef => rooms.get(roomId) ?? { id: roomId, name: 'Unknown Room' };
  const entries: Line[] = events.map((e) => ({
    entry: 'event',
    kind: e.kind,
    note: e.note,
    by: byPerson(e.username, e.displayName),
    at: e.at,
  }));
  for (const c of changes) {
    const by = byPerson(c.username, c.displayName);
    if (c.toStatus && c.toStatus !== c.fromStatus)
      entries.push({
        entry: 'status',
        from: c.fromStatus && stored(c.fromStatus),
        to: stored(c.toStatus),
        by,
        at: c.at,
      });
    if (c.fromRoom && c.toRoom && c.fromRoom !== c.toRoom)
      entries.push({ entry: 'move', from: room(c.fromRoom), to: room(c.toRoom), by, at: c.at });
  }
  return entries.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** The Equipment as its Lab's staff see it, with the Record Version an Approved signing from this session binds. */
async function readEquipment(scope: Scope, db: Kysely<DB>, id: string) {
  const row =
    (await scope
      .from('equipment')
      .innerJoin('person', 'person.id', 'equipment.responsiblePersonId')
      .select([
        'equipment.id',
        'equipment.kind',
        'equipment.name',
        'equipment.manufacturer',
        'equipment.model',
        'equipment.serial',
        'equipment.assetNumber',
        'equipment.softwareVersion',
        'equipment.firmwareVersion',
        'equipment.roomId',
        'equipment.fitnessStatus',
        'equipment.registeredAt',
        'person.username',
        'person.displayName',
        sql<string>`encode(lims.equipment_content_hash(equipment), 'hex')`.as('contentHash'),
        versionOf(scope.ctx.lab.id).as('version'),
      ])
      .where('equipment.id', '=', id)
      .executeTakeFirst()) ?? refuse('notFound', 'No Equipment of this Lab has that id.');
  const rooms = new Map((await scope.from('room').select(['id', 'name']).execute()).map((r) => [r.id, r]));
  const { roomId, username, displayName, contentHash, version, fitnessStatus, ...facts } = row;
  return {
    ...facts,
    fitnessStatus: stored(fitnessStatus),
    room: rooms.get(roomId) ?? { id: roomId, name: 'Unknown Room' },
    responsiblePerson: { username, displayName },
    recordVersion: { version, canonicalForm: 1, contentHash },
    statement: await statementInForce(db),
    logbook: await logbookOf(scope, id, rooms),
  };
}

const movedOnMessage = 'The Equipment has moved on since this screen loaded it. Reload it.';

/** The database's refusal of a Fitness Status move (LA014) means another session changed the Equipment first. */
function movedOn(error: unknown): never {
  if (postgresFault(error)?.sqlstate === 'LA014' && error instanceof Error) refuse('stale', movedOnMessage);
  throw new Error('the Equipment step failed in the database', { cause: error });
}

/** The columns a step writes on Equipment; the database grants the app role no other. */
type EquipmentChange = Partial<
  Pick<Updateable<DB['equipment']>, 'fitnessStatus' | 'roomId' | 'softwareVersion' | 'firmwareVersion'>
>;

/**
 * Writes `change` to the Equipment as the step read it: a row whose Fitness Status moved on since the screen loaded it
 * is left alone and the step is refused as stale, because the step was decided on the status shown.
 */
async function changeEquipment(q: WriteQueries, { id, status }: Target, change: EquipmentChange): Promise<void> {
  const { numUpdatedRows } = await q
    .update('equipment')
    .set(change)
    .where('id', '=', id)
    .where('fitnessStatus', '=', status)
    .executeTakeFirstOrThrow()
    .catch(movedOn);
  if (!numUpdatedRows) refuse('stale', movedOnMessage);
}

/** Writes the Record Version of the record as it is now, for the signing `proof` names, and returns its id. */
async function versionForSigning(
  q: WriteQueries,
  proof: string,
  table: 'equipment' | 'equipment_event',
  id: string,
): Promise<string> {
  const { rows } = await sql<{ id: string }>`select lims.version_equipment_record(${proof}, ${table}, ${id}) as id`
    .execute(q.company)
    .catch(signingRefused);
  const [latest] = rows;
  if (!latest) throw new Error('lims.version_equipment_record returned no version');
  return latest.id;
}

/** The Equipment a step acts on, as the step read it, and the person taking the step. */
interface Target {
  id: string;
  status: StoredFitnessStatus;
  personId: string;
}

type Effect<K extends EquipmentStepName> = (
  q: WriteQueries,
  target: Target,
  input: EquipmentStepInputs[K],
) => Promise<string | null>;

/** What each step writes. A step that records an Equipment Event returns its id, so a Performed signing can bind it. */
const effects: { [K in EquipmentStepName]: Effect<K> } = {
  approve: async (q, target) => {
    await changeEquipment(q, target, { fitnessStatus: 'InUse' });
    return null;
  },
  markSuspect: async (q, target, input) => recordEvent(q, target, 'Suspect', input.reason),
  recordEvent: async (q, target, input) => {
    // The version now installed is written first, on the status shown; the Event then records it on the suspended row.
    if ('version' in input)
      await changeEquipment(
        q,
        target,
        input.kind === 'SoftwareChange' ? { softwareVersion: input.version } : { firmwareVersion: input.version },
      );
    return recordEvent(q, target, input.kind, input.note);
  },
  move: async (q, target, input) => {
    const known = await q.from('room').select('id').where('id', '=', input.roomId).executeTakeFirst();
    if (!known) refuse('notFound', 'No Room of this Lab has that id.');
    await changeEquipment(q, target, { roomId: input.roomId });
    return null;
  },
  retire: async (q, target) => {
    await changeEquipment(q, target, { fitnessStatus: 'Retired' });
    return null;
  },
};

/** Records an Equipment Event; the database stamps who recorded it, from the acting person, and when. */
async function recordEvent(
  q: WriteQueries,
  target: Target,
  kind: EquipmentStepInputs['recordEvent']['kind'] | 'Suspect',
  note: string,
) {
  const event = await q
    .insert('equipmentEvent', { equipmentId: target.id, kind, note, recordedBy: target.personId })
    .returning('id')
    .executeTakeFirstOrThrow()
    .catch(movedOn);
  return event.id;
}

function registerEquipmentStep<K extends EquipmentStepName>(
  app: App,
  db: Kysely<DB>,
  credentials: Credentials,
  name: K,
  release: string,
) {
  const step = equipmentSteps[name];
  const route = equipmentStepRoute(name);
  app.post<{ Body: EquipmentStepBody<K> }>(route.url, { schema: route.schema }, async (req) => {
    const { actor, body } = req;
    readableBy(actor);
    const scope = labScope(db, actor);
    const view = await readEquipment(scope, db, body.id);
    const access = equipmentAccess(name, view.fitnessStatus, actor.roles);
    if (access.refused) refuse(access.refused.kind, access.refused.message);
    const { role } = access;
    const signs = step.signs;
    const signature =
      signs === null ? null : (body.signature ?? refuse('malformed', "This step needs the signer's credentials."));
    if (signature) {
      if (
        signature.recordVersion.version !== view.recordVersion.version ||
        signature.recordVersion.contentHash !== view.recordVersion.contentHash
      )
        refuse('recordChanged', 'The Equipment changed since this screen loaded it. Read it again before signing.');
      if (view.statement.version !== signature.statementVersion)
        refuse(
          'signingRefused',
          'The Signature Statement changed since this screen loaded it. Read it again before signing.',
        );
    }
    const reauthenticated = signature
      ? await reauthenticate(
          db,
          credentials,
          { actor, session: req.sessionKey },
          { username: signature.username, password: signature.password, code: signature.code },
          role,
          sourceAddressOf(req),
          'ReauthenticationFailed',
        )
      : undefined;
    const sessionId = req.sessionKey.id;
    await scope.write(
      name,
      role,
      async (q) => {
        const target = { id: body.id, status: view.fitnessStatus, personId: actor.person.id };
        if (!(signs && signature && reauthenticated)) {
          // Every Equipment write holds the Lab's chain before its row: a signed step through its re-authentication
          // record, an Event through its trigger, and an unsigned step here, so no two of them lock in opposite orders.
          await sql`select lims.lock_chains(${actor.lab.id})`.execute(q.company);
          await effects[name](q, target, body.input);
          return;
        }
        const proof = await proveReauthentication(q, actor, sessionId, signs, reauthenticated);
        // The signer was shown the Equipment, so its version as shown is what either signing binds as seen; it is
        // written before the step changes the row.
        const seen = {
          id: await versionForSigning(q, proof, 'equipment', body.id),
          contentHash: signature.recordVersion.contentHash,
        };
        const sign = (table: 'equipment' | 'equipment_event', recordId: string) =>
          signRecord(q, {
            proof,
            sessionId,
            meaning: signs,
            table,
            recordId,
            seen,
            statementVersion: signature.statementVersion,
            release,
          });
        if (signs === 'Approved') await sign('equipment', body.id);
        const eventId = await effects[name](q, target, body.input);
        if (signs === 'Performed' && eventId) {
          await versionForSigning(q, proof, 'equipment_event', eventId);
          await sign('equipment_event', eventId);
        }
      },
      reauthenticated,
    );
    req.log.info({ step: name, equipmentId: body.id }, 'equipment step taken');
    return readEquipment(scope, db, body.id);
  });
}

/** The Equipment list, view and registration for the Lab's staff, and `POST /api/equipment-steps/:step`, one route per registry entry. */
export function equipmentRoutes(app: App, db: Kysely<DB>, credentials: Credentials, release: string): void {
  app.route({
    ...routes.equipmentList,
    handler: async (req) => {
      readableBy(req.actor);
      return labScope(db, req.actor)
        .from('equipment')
        .innerJoin('room', (j) =>
          j.onRef('room.labId', '=', 'equipment.labId').onRef('room.id', '=', 'equipment.roomId'),
        )
        .select(['equipment.id', 'equipment.name', 'equipment.kind', 'room.name as room', 'equipment.fitnessStatus'])
        .orderBy('equipment.name')
        .execute()
        .then((rows) => rows.map(({ fitnessStatus, ...row }) => ({ ...row, fitnessStatus: stored(fitnessStatus) })));
    },
  });
  app.route({
    ...routes.equipmentChoices,
    handler: async (req) => {
      readableBy(req.actor);
      const scope = labScope(db, req.actor);
      const rooms = await scope.from('room').select(['id', 'name']).orderBy('name').execute();
      const staff = await scope
        .from('membership')
        .innerJoin('person', 'person.id', 'membership.personId')
        .select(['person.id', 'person.username', 'person.displayName'])
        .where('membership.role', 'in', labStaff)
        .distinct()
        .orderBy('person.displayName')
        .execute();
      return { rooms, staff };
    },
  });
  app.route({
    ...routes.equipment,
    handler: async (req) => {
      readableBy(req.actor);
      return readEquipment(labScope(db, req.actor), db, req.params.id);
    },
  });
  app.route({
    ...routes.registerEquipment,
    handler: async (req) => {
      const { actor, body } = req;
      if (!actor.roles.includes(equipmentRegistrar)) refuse('role', 'The Lab Manager registers Equipment.');
      const scope = labScope(db, actor);
      const room = await scope.from('room').select('id').where('id', '=', body.roomId).executeTakeFirst();
      if (!room) refuse('notFound', 'No Room of this Lab has that id.');
      const staff = await scope
        .from('membership')
        .select('personId')
        .where('personId', '=', body.responsiblePersonId)
        .where('role', 'in', labStaff)
        .executeTakeFirst();
      if (!staff) refuse('guard', "The Responsible Person is a member of this Lab's staff.");
      const named = await scope.from('equipment').select('id').where('name', '=', body.name).executeTakeFirst();
      if (named) refuse('guard', 'Equipment of this name is already registered in this Lab.');
      const { id } = await scope.write('registerEquipment', equipmentRegistrar, (q) =>
        q.insert('equipment', body).returning('id').executeTakeFirstOrThrow(),
      );
      req.log.info({ step: 'registerEquipment', equipmentId: id }, 'equipment registered');
      return readEquipment(scope, db, id);
    },
  });
  for (const name of equipmentStepNames) registerEquipmentStep(app, db, credentials, name, release);
}
