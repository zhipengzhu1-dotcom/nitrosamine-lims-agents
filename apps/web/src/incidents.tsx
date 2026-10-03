import {
  type ActorContext,
  type BreakInRange,
  forcesYes,
  type IncidentRow,
  type IncidentStepName,
  incidentStepRoute,
  incidentSteps,
  openIncidentSteps,
  type RecordedText,
  type SystemIncident,
} from '@lims/domain';
import { routes } from '@lims/domain';
import { type ReactNode, useMemo } from 'react';
import { api, useApi, useFresh } from './api.ts';
import { type Field, type RailAction, Shell, Status, words } from './rail.tsx';
import { Split } from './split.tsx';
import { type Column, StackTable } from './stack.tsx';
import { unsignedNotice } from './tests.tsx';
import { time, When } from './time.tsx';

const incidentUi: { [K in IncidentStepName]: { label: string; fields: readonly Field[]; done: string } } = {
  answerImpact: {
    label: 'Answer impact',
    fields: [
      {
        name: 'answer',
        label: 'Could this have affected results or records?',
        kind: 'choice',
        options: ['Yes', 'No'],
      },
    ],
    done: "QA's answer is recorded in the Audit Trail.",
  },
  recordImmediateAction: {
    label: 'Record immediate action',
    fields: [{ name: 'text', label: 'Immediate action', kind: 'text' }],
    done: 'The immediate action is recorded in the Audit Trail.',
  },
  recordCorrectiveAction: {
    label: 'Record corrective action',
    fields: [{ name: 'text', label: 'Corrective action', kind: 'text' }],
    done: 'The corrective action is recorded in the Audit Trail.',
  },
  acknowledge: { label: 'Acknowledge', fields: [], done: 'The System Incident is Acknowledged.' },
  close: { label: 'Close', fields: [], done: 'The System Incident is Closed.' },
};

const whatLine = (i: SystemIncident) =>
  `System Incident ${i.reference}: ${words(i.kind)}${i.step ? ` on ${i.step}` : ''}, opened ${time(i.openedAt)}`;

/** The rail's action for the next step the person may take on the incident; a signing step carries the Record Version it binds. */
function incidentAction(name: IncidentStepName, view: SystemIncident, onDone: () => Promise<void>): RailAction {
  const step = incidentSteps[name];
  const ui = incidentUi[name];
  const what = [
    whatLine(view),
    `QA's answer: ${view.impact?.answer ?? '(not recorded)'}`,
    `Immediate action: ${view.immediateAction?.text ?? '(not recorded)'}`,
    `Corrective action: ${view.correctiveAction?.text ?? '(not recorded)'}`,
  ];
  return {
    label: ui.label,
    context: what[0] ?? '',
    fields:
      name === 'answerImpact' && forcesYes(view.kind)
        ? ui.fields.map((field) => ({ ...field, options: ['Yes'] }))
        : ui.fields,
    signs: step.signs
      ? { meaning: step.signs, what, role: step.role, recordVersion: view.recordVersion, statement: view.statement }
      : null,
    async run(input, credentials) {
      const signature = credentials && {
        ...credentials,
        recordVersion: { version: view.recordVersion.version, contentHash: view.recordVersion.contentHash },
        statementVersion: view.statement.version,
      };
      // The fields go as typed; the route's schema refuses an answer or a text it does not take, as stepAction's do.
      await api(incidentStepRoute(name), { reference: view.reference, input, ...(signature && { signature }) });
      await onDone();
      return ui.done;
    },
  };
}

const noIncidents: IncidentRow[] = [];
const incidentColumns = (open: string | null): Column<IncidentRow>[] => [
  {
    head: 'Reference',
    cell: (i) => (
      <a className="tap" href={`#/incidents/${i.reference}`} aria-current={i.reference === open ? 'true' : undefined}>
        {i.reference}
      </a>
    ),
  },
  { head: 'Kind', cell: (i) => words(i.kind) },
  { head: 'State', cell: (i) => <Status mark={i.state} /> },
  { head: 'Where', cell: (i) => i.step ?? (i.chain ? `chain ${i.chain}` : '') },
  { head: 'Opened', cell: (i) => time(i.openedAt) },
];
const besideHeads = new Set(['Reference', 'State']);

type Recording = Omit<RecordedText, 'text'> & ({ text: string } | { answer: string });
function Recorded({ record }: { record: Recording | null }) {
  if (!record) return <dd className="muted">not recorded</dd>;
  return (
    <dd>
      {'text' in record ? record.text : record.answer}
      <br />
      <small className="muted">
        {record.by.displayName} ({record.by.username}), {time(record.at)}
      </small>
    </dd>
  );
}

const breakColumns: Column<BreakInRange>[] = [
  { head: 'Entry', cell: (b) => b.entry },
  { head: 'Kind', cell: (b) => words(b.kind) },
  { head: 'Last entry', cell: (b) => b.through },
];

/** Every break inside a chain-verify incident's range as the chain reads now, and whether they are the ones it recorded. */
function IncidentBreaks({ reference }: { reference: string }) {
  const { data, error } = useApi(routes.incidentBreaks, { reference });
  return (
    <section aria-labelledby="incident-breaks">
      <h2 id="incident-breaks">Breaks in this range</h2>
      {error && <p className="note--bad">{error}</p>}
      {data && (
        <>
          <p className={data.asRecorded ? 'muted' : 'note--bad'}>
            {data.asRecorded
              ? `Recomputed ${time(data.recomputedAt)}. These are the breaks this System Incident recorded.`
              : `Recomputed ${time(data.recomputedAt)}. The chain has changed inside this range since this System Incident was opened; Verify chain records the change as a new System Incident.`}
          </p>
          <StackTable columns={breakColumns} rows={data.breaks} rowKey={(b) => b.entry} />
        </>
      )}
    </section>
  );
}

/** One System Incident with what QA and the Admin have recorded on it, and the rail's next step for the signed-in person. */
function IncidentRecord({
  me,
  reference,
  list,
  afterStep,
}: {
  me: ActorContext;
  reference: string;
  list: ReactNode;
  afterStep: () => Promise<void>;
}) {
  const { data: view, error, reload } = useApi(routes.incident, { reference });
  const freshState = useFresh(view, (v) => [v.state]);
  const next = view ? openIncidentSteps(view, me.roles)[0] : undefined;
  const done = async () => {
    await Promise.all([reload(), afterStep()]);
  };
  const action = view && next ? incidentAction(next, view, done) : null;
  const frame = (record: ReactNode) => (
    <Shell
      me={me}
      active="incidents"
      action={action}
      notice={view?.acknowledged ? unsignedNotice([view.acknowledged]) : undefined}
      railKey={reference}
    >
      <Split list={list} record={record} closeHref="#/incidents" />
    </Shell>
  );
  if (!view) return frame(error ? <p className="note--bad">{error}</p> : null);
  return frame(
    <>
      <h1 className="record-head">
        {view.reference} <Status key={view.state} mark={view.state} fresh={freshState.has(view.state)} />
        {view.acknowledged?.unsigned && <Status mark="Signatures unsigned" />}
      </h1>
      <dl className="facts">
        <dt>Kind</dt>
        <dd>{words(view.kind)}</dd>
        <dt>Opened</dt>
        <dd>
          <When at={view.openedAt} atLab={null} />
        </dd>
        {view.step && (
          <>
            <dt>Step</dt>
            <dd>{view.step}</dd>
          </>
        )}
        {view.chain && (
          <>
            <dt>Chain</dt>
            <dd>
              {view.chain}
              {view.breakCount && view.lastFailure
                ? `, ${view.breakCount} ${view.breakCount === 1 ? 'break' : 'breaks'} from entry ${view.firstFailure} to entry ${view.lastFailure}`
                : view.firstFailure && `, first failing entry ${view.firstFailure}`}
            </dd>
          </>
        )}
        {view.errorClass && (
          <>
            <dt>Failure</dt>
            <dd>
              {view.errorClass}
              {view.sqlstate && ` ${view.sqlstate}`}
              {view.constraintName && ` on ${view.constraintName}`}
            </dd>
          </>
        )}
        <dt>Record Version</dt>
        <dd>
          {view.recordVersion.version} · <code className="hash">{view.recordVersion.contentHash}</code>
        </dd>
      </dl>
      {view.chain && view.lastFailure && <IncidentBreaks reference={view.reference} />}
      <h2>Impact and actions</h2>
      <p className="muted">QA answers whether this could have affected results or records.</p>
      <dl className="facts">
        <dt>QA&apos;s answer</dt>
        <Recorded record={view.impact} />
        <dt>Immediate action</dt>
        <Recorded record={view.immediateAction} />
        <dt>Corrective action</dt>
        <Recorded record={view.correctiveAction} />
        <dt>Acknowledged</dt>
        {view.acknowledged ? (
          <dd>
            <span className="sig-line">
              <span className="sig">Acknowledged</span>
              {view.acknowledged.unsigned && <Status mark="Unsigned" />}
            </span>{' '}
            by {view.acknowledged.signer} ({view.acknowledged.username}, {words(view.acknowledged.role)}),{' '}
            <When at={view.acknowledged.signedAt} atLab={view.acknowledged.signedAtLab} />
            <br />
            <small className="muted">
              Record Version {view.acknowledged.recordVersion.version} ·{' '}
              <code className="hash">{view.acknowledged.recordVersion.contentHash}</code>
            </small>
          </dd>
        ) : (
          <dd className="muted">not signed</dd>
        )}
      </dl>
    </>,
  );
}

/** The open System Incidents for Admin and QA, with one open beside them. */
export function IncidentsPage({ me, open }: { me: ActorContext; open: string | null }) {
  const { data: rows, error, reload } = useApi(routes.incidents);
  const fresh = useFresh(rows, (r) => r.map((i) => `${i.reference}:${i.state}`));
  const columns = useMemo(() => incidentColumns(open).filter((c) => !open || besideHeads.has(c.head)), [open]);
  const Title = open ? 'h2' : 'h1';
  const list = (
    <>
      <Title className="worklist__head">Incidents</Title>
      {error && <p className="note--bad">{error}</p>}
      <StackTable
        columns={columns}
        rows={rows ?? noIncidents}
        rowKey={(i) => i.reference}
        rowClass={(i) =>
          [fresh.has(`${i.reference}:${i.state}`) ? 'row--fresh' : '', i.reference === open ? 'row--open' : '']
            .join(' ')
            .trim() || undefined
        }
      />
      {rows?.length === 0 && <p className="muted">No open System Incidents.</p>}
    </>
  );
  if (open) return <IncidentRecord key={open} me={me} reference={open} list={list} afterStep={reload} />;
  return (
    <Shell me={me} active="incidents" action={null}>
      {list}
    </Shell>
  );
}
