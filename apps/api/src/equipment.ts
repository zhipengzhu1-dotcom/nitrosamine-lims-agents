import { type DB, postgresFault } from '@lims/db';
import {
  type ActorContext,
  type EquipmentStepBody,
  type EquipmentStepInputs,
  type EquipmentStepName,
  equipmentActingRole,
  equipmentRefusal,
  equipmentRegistrar,
  equipmentStepNames,
  equipmentStepRoute,
  equipmentSteps,
  labStaff,
  type LogbookEntry,
  mayReadEquipment,
  type RoomRef,
  routes,
  type StoredFitnessStatus,
} from '@lims/domain';
import { type Kysely, sql } from 'kysely';
import type { App } from './app.ts';
import { reauthenticate, sourceAddressOf } from './auth.ts';
import { refuse } from './refuse.ts';
import { labScope, type Scope, type WriteQueries } from './scope.ts';
import { proveReauthentication, signingRefused, signRecord, statementInForce } from './signing.ts';

function readableBy(actor: ActorContext): void {
  if (!mayReadEquipment(actor.roles)) refuse('role', 'Equipment is read by the staff of its Lab.');
}

/** The version an Approved signing binds: the one that already holds the Equipment's content, else the next. */
const versionOf = (labId: string) => sql<number>`coalesce(
  (select v.version from lims.record_version v
    where v.lab_id = ${labId} and v.record_table = 'equipment' and v.record_id = equipment.id
      and v.content_hash = lims.equipment_content_hash(equipment)),
  (select coalesce(max(v.version), 0) + 1 from lims.record_version v
    where v.lab_id = ${labId} and v.record_table = 'equipment' and v.record_id = equipment.id))`;

/** A person named by an Audit Trail actor (`person:<username>`) or by id, as the Logbook shows them. */
const byPerson = (username: string | null, displayName: string | null) => ({
  username: username ?? 'unknown',
  displayName: displayName ?? 'Unknown person',
});

/** A Logbook line as the API holds it, with its time as the database returned it. */
type Line = LogbookEntry extends infer E ? (E extends { at: unknown } ? Omit<E, 'at'> & { at: Date } : never) : never;

type Snapshot = { fitness_status?: StoredFitnessStatus; room_id?: string } | null;

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
    .select(['auditEntry.at', 'auditEntry.oldRow', 'auditEntry.newRow', 'person.username', 'person.displayName'])
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
    // oxlint-disable-next-line typescript/consistent-type-assertions -- an Audit Trail snapshot holds the stored row of lims.equipment
    const [before, after] = [c.oldRow as Snapshot, c.newRow as Snapshot];
    const by = byPerson(c.username, c.displayName);
    if (after?.fitness_status && after.fitness_status !== before?.fitness_status)
      entries.push({ entry: 'status', from: before?.fitness_status ?? null, to: after.fitness_status, by, at: c.at });
    if (before?.room_id && after?.room_id && before.room_id !== after.room_id)
      entries.push({ entry: 'move', from: room(before.room_id), to: room(after.room_id), by, at: c.at });
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
  if (fitnessStatus === 'Expired') throw new Error('lims.equipment stores no Expired Fitness Status');
  return {
    ...facts,
    fitnessStatus,
    room: rooms.get(roomId) ?? { id: roomId, name: 'Unknown Room' },
    responsiblePerson: { username, displayName },
    recordVersion: { version, canonicalForm: 1, contentHash },
    statement: await statementInForce(db),
    logbook: await logbookOf(scope, id, rooms),
  };
}

/** The database's refusal of a Fitness Status move (LA014) means another session changed the Equipment first. */
function movedOn(error: unknown): never {
  if (postgresFault(error)?.sqlstate === 'LA014' && error instanceof Error)
    refuse('stale', 'The Equipment has moved on since this screen loaded it. Reload it.');
  throw new Error('the Equipment step failed in the database', { cause: error });
}

/** Writes the Record Version a signing binds and returns it with its hash, as lims.sign is shown it. */
async function versionForSigning(q: WriteQueries, proof: string, table: 'equipment' | 'equipment_event', id: string) {
  const { rows } = await sql<{ id: string }>`select lims.version_equipment_record(${proof}, ${table}, ${id}) as id`
    .execute(q.company)
    .catch(signingRefused);
  const [latest] = rows;
  if (!latest) throw new Error('lims.version_equipment_record returned no version');
  // A second statement, because the version the function writes is not visible to the statement that calls it.
  return q
    .from('recordVersion')
    .select(['id', sql<string>`encode(record_version.content_hash, 'hex')`.as('contentHash')])
    .where('id', '=', latest.id)
    .executeTakeFirstOrThrow();
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
  approve: async (q, { id, status }) => {
    const moved = await q
      .update('equipment')
      .set({ fitnessStatus: 'InUse' })
      .where('id', '=', id)
      .where('fitnessStatus', '=', status)
      .executeTakeFirstOrThrow()
      .catch(movedOn);
    if (!moved.numUpdatedRows) refuse('stale', 'The Equipment has moved on since this screen loaded it. Reload it.');
    return null;
  },
  markSuspect: async (q, target, input) => recordEvent(q, target, 'Suspect', input.reason),
  recordEvent: async (q, target, input) => recordEvent(q, target, input.kind, input.note),
  move: async (q, { id, status }, input) => {
    const known = await q.from('room').select('id').where('id', '=', input.roomId).executeTakeFirst();
    if (!known) refuse('notFound', 'No Room of this Lab has that id.');
    await q
      .update('equipment')
      .set({ roomId: input.roomId })
      .where('id', '=', id)
      .where('fitnessStatus', '=', status)
      .executeTakeFirstOrThrow()
      .catch(movedOn);
    return null;
  },
  retire: async (q, { id, status }) => {
    await q
      .update('equipment')
      .set({ fitnessStatus: 'Retired' })
      .where('id', '=', id)
      .where('fitnessStatus', '=', status)
      .executeTakeFirstOrThrow()
      .catch(movedOn);
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

function registerEquipmentStep<K extends EquipmentStepName>(app: App, db: Kysely<DB>, name: K, release: string) {
  const step = equipmentSteps[name];
  const route = equipmentStepRoute(name);
  app.post<{ Body: EquipmentStepBody<K> }>(route.url, { schema: route.schema }, async (req) => {
    const { actor, body } = req;
    readableBy(actor);
    const scope = labScope(db, actor);
    const view = await readEquipment(scope, db, body.id);
    const refused = equipmentRefusal(name, view.fitnessStatus, actor.roles);
    if (refused) refuse(refused.kind, refused.message);
    const role = equipmentActingRole(name, actor.roles) ?? refuse('role', 'Equipment is read by the staff of its Lab.');
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
          { actor, session: req.sessionKey },
          { username: signature.username, password: signature.password },
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
        const proof = signs && signature ? await proveReauthentication(q, actor, sessionId, signs) : null;
        if (proof && signs === 'Approved' && signature) {
          const latest = await versionForSigning(q, proof, 'equipment', body.id);
          await signRecord(q, {
            proof,
            sessionId,
            meaning: signs,
            table: 'equipment',
            recordId: body.id,
            seen: { id: latest.id, contentHash: signature.recordVersion.contentHash },
            statementVersion: signature.statementVersion,
            release,
          });
        }
        const target = { id: body.id, status: view.fitnessStatus, personId: actor.person.id };
        const eventId = await effects[name](q, target, body.input);
        if (proof && signs === 'Performed' && signature && eventId) {
          // The Event is written by this press, so the version the signer is shown is the one written for it here.
          const latest = await versionForSigning(q, proof, 'equipment_event', eventId);
          await signRecord(q, {
            proof,
            sessionId,
            meaning: signs,
            table: 'equipment_event',
            recordId: eventId,
            seen: latest,
            statementVersion: signature.statementVersion,
            release,
          });
        }
      },
      reauthenticated,
    );
    req.log.info({ step: name, equipmentId: body.id }, 'equipment step taken');
    return readEquipment(scope, db, body.id);
  });
}

/** The Equipment list, view and registration for the Lab's staff, and `POST /api/equipment-steps/:step`, one route per registry entry. */
export function equipmentRoutes(app: App, db: Kysely<DB>, release: string): void {
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
        .then((rows) =>
          rows.map(({ fitnessStatus, ...row }) => {
            if (fitnessStatus === 'Expired') throw new Error('lims.equipment stores no Expired Fitness Status');
            return { ...row, fitnessStatus };
          }),
        );
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
  for (const name of equipmentStepNames) registerEquipmentStep(app, db, name, release);
}
