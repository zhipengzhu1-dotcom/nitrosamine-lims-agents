import {
  type ActorContext,
  type Equipment,
  type EquipmentChoices,
  type EquipmentRow,
  type EquipmentStepInputs,
  type EquipmentStepName,
  equipmentActingRole,
  equipmentRegistrar,
  equipmentStepRoute,
  equipmentSteps,
  type LogbookEntry,
  openEquipmentSteps,
  routes,
} from '@lims/domain';
import { type ReactNode, useMemo, useState } from 'react';
import { api, useApi, useFresh } from './api.ts';
import { type Field, type RailAction, Shell, Status, words } from './rail.tsx';
import { Split } from './split.tsx';
import { type Column, StackTable } from './stack.tsx';
import { time, When } from './time.tsx';

type Values = Record<string, string>;
interface StepUi<K extends EquipmentStepName> {
  label: string;
  fields: (view: Equipment, choices: EquipmentChoices) => readonly Field[];
  input: (values: Values) => EquipmentStepInputs[K];
  done: string;
}

const optionalText = (name: string, label: string): Field => ({ name, label, kind: 'text', optional: true });

const eventKinds: readonly EquipmentStepInputs['recordEvent']['kind'][] = [
  'Cleaning',
  'Maintenance',
  'Repair',
  'SoftwareChange',
  'FirmwareChange',
  'Note',
];

/** What each Equipment step asks for. Who may take it, from which Fitness Status, and what it signs come from the registry. */
const equipmentUi: { [K in EquipmentStepName]: StepUi<K> } = {
  approve: {
    label: 'Approve for use',
    fields: () => [],
    input: () => ({}),
    done: 'Approved Signature recorded in the Audit Trail. The Equipment is In use.',
  },
  markSuspect: {
    label: 'Mark suspect',
    fields: () => [{ name: 'reason', label: 'Why it is suspect', kind: 'text' }],
    input: (v) => ({ reason: v.reason ?? '' }),
    done: 'The Equipment is Suspended until QA approves it again.',
  },
  recordEvent: {
    label: 'Record Equipment Event',
    fields: () => [
      { name: 'kind', label: 'Kind', kind: 'pick', picks: eventKinds.map((k) => ({ value: k, text: words(k) })) },
      { name: 'note', label: 'What was done', kind: 'text' },
      optionalText('version', 'Version now installed (software or firmware change)'),
    ],
    input: (v) => {
      const kind = eventKinds.find((k) => k === v.kind);
      if (!kind) throw new Error('The Kind chosen is not one the LIMS records.');
      const note = v.note ?? '';
      return kind === 'SoftwareChange' || kind === 'FirmwareChange'
        ? { kind, note, version: v.version ?? '' }
        : { kind, note };
    },
    done: 'Performed Signature recorded in the Audit Trail. The Equipment Event is in the Logbook.',
  },
  move: {
    label: 'Move',
    fields: (view, choices) => [
      {
        name: 'roomId',
        label: 'To Room',
        kind: 'pick',
        picks: choices.rooms.filter((r) => r.id !== view.room.id).map((r) => ({ value: r.id, text: r.name })),
      },
    ],
    input: (v) => ({ roomId: v.roomId ?? '' }),
    done: 'The move is recorded in the Logbook.',
  },
  retire: { label: 'Retire', fields: () => [], input: () => ({}), done: 'The Equipment is Retired.' },
};

const whatLines = (e: Equipment) => [
  `Equipment ${e.name}: ${e.manufacturer} ${e.model}, serial ${e.serial}`,
  `Room: ${e.room.name}`,
  `Responsible Person: ${e.responsiblePerson.displayName}`,
];

/** The rail's action for one Equipment step; a signing step carries the Record Version it binds. */
function equipmentAction(
  name: EquipmentStepName,
  me: ActorContext,
  view: Equipment,
  choices: EquipmentChoices,
  onDone: () => Promise<void>,
): RailAction {
  const ui = equipmentUi[name];
  const { signs } = equipmentSteps[name];
  const role = equipmentActingRole(name, me.roles);
  const what = whatLines(view);
  return {
    label: ui.label,
    context: what[0] ?? '',
    fields: ui.fields(view, choices),
    signs:
      signs && role
        ? { meaning: signs, what, role, recordVersion: view.recordVersion, statement: view.statement }
        : null,
    async run(values, credentials) {
      const signature = credentials && {
        ...credentials,
        recordVersion: { version: view.recordVersion.version, contentHash: view.recordVersion.contentHash },
        statementVersion: view.statement.version,
      };
      await api(equipmentStepRoute(name), { id: view.id, input: ui.input(values), ...(signature && { signature }) });
      await onDone();
      return ui.done;
    },
  };
}

/** The Lab Manager's registration: identity, Room and Responsible Person; the Equipment starts Quarantined. */
function registration(choices: EquipmentChoices, onDone: () => Promise<void>): RailAction {
  return {
    label: 'Register Equipment',
    context: 'Equipment of this Lab, Quarantined until QA approves it',
    fields: [
      { name: 'kind', label: 'Kind', kind: 'text' },
      { name: 'name', label: 'Equipment name', kind: 'text' },
      { name: 'manufacturer', label: 'Manufacturer', kind: 'text' },
      { name: 'model', label: 'Model', kind: 'text' },
      { name: 'serial', label: 'Serial number', kind: 'text' },
      optionalText('assetNumber', 'Asset number (optional)'),
      optionalText('softwareVersion', 'Software version (optional)'),
      optionalText('firmwareVersion', 'Firmware version (optional)'),
      { name: 'roomId', label: 'Room', kind: 'pick', picks: choices.rooms.map((r) => ({ value: r.id, text: r.name })) },
      {
        name: 'responsiblePersonId',
        label: 'Responsible Person',
        kind: 'pick',
        picks: choices.staff.map((p) => ({ value: p.id, text: `${p.displayName} (${p.username})` })),
      },
    ],
    signs: null,
    async run(v) {
      const given = (key: string) => (v[key] ? { [key]: v[key] } : {});
      const registered = await api(routes.registerEquipment, {
        kind: v.kind ?? '',
        name: v.name ?? '',
        manufacturer: v.manufacturer ?? '',
        model: v.model ?? '',
        serial: v.serial ?? '',
        ...given('assetNumber'),
        ...given('softwareVersion'),
        ...given('firmwareVersion'),
        roomId: v.roomId ?? '',
        responsiblePersonId: v.responsiblePersonId ?? '',
      });
      await onDone();
      return `Equipment ${registered.name} registered in the Audit Trail. It is Quarantined until QA approves it.`;
    },
  };
}

/** One Logbook line in one element, so a stacked row's grid takes it as one cell and never splits a Status from its words. */
function LogbookLine({ entry }: { entry: LogbookEntry }) {
  if (entry.entry === 'event')
    return (
      <span>
        <b>{words(entry.kind)}</b> {entry.note}
      </span>
    );
  if (entry.entry === 'move')
    return (
      <span>
        <b>Moved</b> from {entry.from.name} to {entry.to.name}
      </span>
    );
  if (entry.from === null)
    return (
      <span>
        <b>Registered</b> <Status fitness={entry.to} />
      </span>
    );
  return (
    <span>
      <Status fitness={entry.from} /> to <Status fitness={entry.to} />
    </span>
  );
}

const logbookColumns: Column<LogbookEntry>[] = [
  { head: 'When', cell: (l) => time(l.at) },
  { head: 'Entry', cell: (l) => <LogbookLine entry={l} /> },
  { head: 'By', cell: (l) => `${l.by.displayName} (${l.by.username})` },
];

/** One piece of Equipment with its identity, location and Logbook, and the step the signed-in person chose in the rail. */
function EquipmentRecord({
  me,
  id,
  list,
  choices,
  afterStep,
}: {
  me: ActorContext;
  id: string;
  list: ReactNode;
  choices: EquipmentChoices | undefined;
  afterStep: () => Promise<void>;
}) {
  const { data: view, error, reload } = useApi(routes.equipment, { id });
  const freshStatus = useFresh(view, (v) => [v.fitnessStatus]);
  const open = view ? openEquipmentSteps(view.fitnessStatus, me.roles) : [];
  const [picked, setPicked] = useState<EquipmentStepName | null>(null);
  const chosen = picked && open.includes(picked) ? picked : open[0];
  const done = async () => {
    await Promise.all([reload(), afterStep()]);
  };
  const action = view && choices && chosen ? equipmentAction(chosen, me, view, choices, done) : null;
  const frame = (record: ReactNode) => (
    <Shell me={me} active="equipment" action={action} railKey={id}>
      <Split list={list} record={record} closeHref="#/equipment" />
    </Shell>
  );
  if (!view) return frame(error ? <p className="note--bad">{error}</p> : null);
  return frame(
    <>
      <h1 className="record-head">
        {view.name}{' '}
        <Status key={view.fitnessStatus} fitness={view.fitnessStatus} fresh={freshStatus.has(view.fitnessStatus)} />
      </h1>
      {open.length > 1 && (
        <div className="pipeline record-steps" role="radiogroup" aria-label="Step the rail offers">
          {open.map((name) => (
            <label key={name} className="pipe">
              <input type="radio" name="equipment-step" checked={chosen === name} onChange={() => setPicked(name)} />
              {equipmentUi[name].label}
            </label>
          ))}
        </div>
      )}
      <dl className="facts">
        <dt>Kind</dt>
        <dd>{view.kind}</dd>
        <dt>Manufacturer</dt>
        <dd>{view.manufacturer}</dd>
        <dt>Model</dt>
        <dd>{view.model}</dd>
        <dt>Serial number</dt>
        <dd>{view.serial}</dd>
        <dt>Asset number</dt>
        <dd>{view.assetNumber ?? <span className="muted">none</span>}</dd>
        <dt>Software version</dt>
        <dd>{view.softwareVersion ?? <span className="muted">none</span>}</dd>
        <dt>Firmware version</dt>
        <dd>{view.firmwareVersion ?? <span className="muted">none</span>}</dd>
        <dt>Room</dt>
        <dd>{view.room.name}</dd>
        <dt>Responsible Person</dt>
        <dd>
          {view.responsiblePerson.displayName} ({view.responsiblePerson.username})
        </dd>
        <dt>Registered</dt>
        <dd>
          <When at={view.registeredAt} atLab={null} />
        </dd>
        <dt>Record Version</dt>
        <dd>
          {view.recordVersion.version} · <code className="hash">{view.recordVersion.contentHash}</code>
        </dd>
      </dl>
      <h2>Logbook</h2>
      <StackTable columns={logbookColumns} rows={view.logbook} rowKey={(l) => JSON.stringify(l)} />
    </>,
  );
}

const noEquipment: EquipmentRow[] = [];
const equipmentColumns = (open: string | null): Column<EquipmentRow>[] => [
  {
    head: 'Equipment',
    cell: (e) => (
      <a className="tap" href={`#/equipment/${e.id}`} aria-current={e.id === open ? 'true' : undefined}>
        {e.name}
      </a>
    ),
  },
  { head: 'Fitness Status', label: 'Status', cell: (e) => <Status fitness={e.fitnessStatus} /> },
  { head: 'Kind', cell: (e) => e.kind },
  { head: 'Room', cell: (e) => e.room },
];
const besideHeads = new Set(['Equipment', 'Fitness Status']);

/** The Lab's Equipment for its staff, with one open beside the list; the Lab Manager registers more from the rail. */
export function EquipmentPage({ me, open }: { me: ActorContext; open: string | null }) {
  const { data: rows, error, reload } = useApi(routes.equipmentList);
  const { data: choices } = useApi(routes.equipmentChoices);
  const fresh = useFresh(rows, (r) => r.map((e) => `${e.id}:${e.fitnessStatus}`));
  const columns = useMemo(() => equipmentColumns(open).filter((c) => !open || besideHeads.has(c.head)), [open]);
  const Title = open ? 'h2' : 'h1';
  const list = (
    <>
      <Title className="worklist__head">Equipment</Title>
      {error && <p className="note--bad">{error}</p>}
      <StackTable
        columns={columns}
        rows={rows ?? noEquipment}
        rowKey={(e) => e.id}
        rowClass={(e) =>
          [fresh.has(`${e.id}:${e.fitnessStatus}`) ? 'row--fresh' : '', e.id === open ? 'row--open' : '']
            .join(' ')
            .trim() || undefined
        }
      />
      {rows?.length === 0 && <p className="muted">No Equipment registered yet.</p>}
    </>
  );
  if (open) return <EquipmentRecord key={open} me={me} id={open} list={list} choices={choices} afterStep={reload} />;
  const action = choices && me.roles.includes(equipmentRegistrar) ? registration(choices, reload) : null;
  return (
    <Shell me={me} active="equipment" action={action}>
      {list}
    </Shell>
  );
}
