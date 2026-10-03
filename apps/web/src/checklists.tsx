import {
  type ActorContext,
  type ChecklistDraft,
  type ChecklistItem,
  type ChecklistKind,
  type ChecklistVersions,
  checklistKinds,
  type EvidenceSource,
  itemKeyOf,
  routes,
  selfApprovalRefusal,
} from '@lims/domain';
import { useMemo, useState } from 'react';
import { api, useApi, useFresh } from './api.ts';
import { type RailAction, Shell, Status } from './rail.tsx';
import { Signatures } from './tests.tsx';

type Version = ChecklistVersions['versions'][number];
type Fill = 'tick' | 'comment' | EvidenceSource;
/** One item as QA edits it; `key` is the item's key on an earlier version, kept so its ticks stay comparable, or null for a new item. */
interface DraftRow {
  row: string;
  key: string | null;
  text: string;
  fill: Fill;
}

const sourceText: Record<EvidenceSource, string> = {
  runChecks: 'Run checks',
  runAdjustments: 'Run adjustments',
  msTune: 'MS tune',
  instrumentFitness: 'Instrument fitness',
  standardLots: 'Standard lots',
  performedSignature: 'Performed Signature',
};

const fillOf = (item: ChecklistItem): Fill => (item.ticked ? (item.needsComment ? 'comment' : 'tick') : item.evidence);
const fillText = (fill: Fill) =>
  fill === 'tick'
    ? 'Reviewer ticks'
    : fill === 'comment'
      ? 'Reviewer ticks with a comment'
      : `Evidence the LIMS shows: ${sourceText[fill]}`;
const rowsOf = (version: Version | undefined): DraftRow[] =>
  (version?.items ?? []).map((item) => ({
    row: crypto.randomUUID(),
    key: item.key,
    text: item.text,
    fill: fillOf(item),
  }));

function itemsOf(rows: readonly DraftRow[]): ChecklistDraft['items'] {
  const keys: string[] = [];
  return rows.map(({ key, text, fill }) => {
    const chosen = key ?? itemKeyOf(text, [...keys, ...rows.flatMap((r) => (r.key ? [r.key] : []))]);
    keys.push(chosen);
    return fill === 'tick' || fill === 'comment'
      ? { key: chosen, text, ticked: true, needsComment: fill === 'comment' }
      : { key: chosen, text, ticked: false, evidence: fill };
  });
}

/** QA's save of a new draft version, built from the rows on the page. */
function draftAction(kind: ChecklistKind, next: number, rows: readonly DraftRow[], onDone: () => Promise<void>) {
  const blank = rows.findIndex((r) => !r.text.trim());
  return {
    label: `Save version ${next}`,
    context: `${kind} Review Checklist, version ${next}, a draft until another QA approves it`,
    fields: [],
    signs: null,
    blocked:
      rows.length === 0 ? 'Add an item before saving the draft.' : blank >= 0 ? `Write item ${blank + 1}.` : null,
    async run() {
      await api(routes.draftChecklistVersion, { kind, items: itemsOf(rows) });
      await onDone();
      return `Version ${next} of the ${kind} Review Checklist saved as a draft.`;
    },
  } satisfies RailAction;
}

/** A QA's Approved signing of the newest draft, refused to the QA who drafted it. */
function approveAction(me: ActorContext, view: ChecklistVersions, version: Version, onDone: () => Promise<void>) {
  const { kind, statement } = view;
  // A version is approved once, and only the approval writes its Record Version, so it signs the version's first.
  const recordVersion = { version: 1, canonicalForm: 1, contentHash: version.contentHash };
  return {
    label: `Approve version ${version.version}`,
    context: `${kind} Review Checklist, version ${version.version}, drafted by ${version.draftedBy ?? 'the LIMS'}`,
    fields: [],
    signs: {
      meaning: 'Approved',
      role: 'QA',
      what: [
        `${kind} Review Checklist, version ${version.version}, drafted by ${version.draftedBy ?? 'the LIMS'}`,
        ...version.items.map((item, i) => `${i + 1}. ${item.text} (${fillText(fillOf(item))})`),
      ],
      recordVersion,
      statement,
    },
    blocked: selfApprovalRefusal(kind, version, me.person.username),
    async run(_, credentials) {
      if (!credentials) throw new Error('An Approved signing needs the signer’s credentials.');
      await api(routes.approveChecklistVersion, {
        kind,
        version: version.version,
        ...credentials,
        recordVersion: { version: recordVersion.version, contentHash: recordVersion.contentHash },
        statementVersion: statement.version,
      });
      await onDone();
      return `Approved Signature recorded in the Audit Trail. Version ${version.version} of the ${kind} Review Checklist is in force.`;
    },
  } satisfies RailAction;
}

function DraftEditor({
  rows,
  sources,
  onChange,
}: {
  rows: DraftRow[];
  sources: readonly EvidenceSource[];
  onChange: (rows: DraftRow[]) => void;
}) {
  const edit = (row: string, change: Partial<DraftRow>) =>
    onChange(rows.map((r) => (r.row === row ? { ...r, ...change } : r)));
  return (
    <section className="card draft" aria-labelledby="draft-title">
      <h2 id="draft-title">Next version</h2>
      <ol className="draft__items">
        {rows.map((r, i) => (
          <li key={r.row} className="draft__item">
            <label>
              Item {i + 1}
              <input type="text" value={r.text} onChange={(e) => edit(r.row, { text: e.target.value })} />
            </label>
            <label>
              Filled by
              <select
                value={r.fill}
                onChange={(e) =>
                  edit(r.row, { fill: fills(sources, r.fill).find((f) => f === e.target.value) ?? r.fill })
                }
              >
                {fills(sources, r.fill).map((f) => (
                  <option key={f} value={f}>
                    {fillText(f)}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn" onClick={() => onChange(rows.filter((x) => x.row !== r.row))}>
              Remove item {i + 1}
            </button>
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="btn"
        onClick={() => onChange([...rows, { row: crypto.randomUUID(), key: null, text: '', fill: 'tick' }])}
      >
        Add item
      </button>
    </section>
  );
}

/** The fills an item may take: ticked, ticked with a comment, or evidence this kind of checklist computes. */
const fills = (sources: readonly EvidenceSource[], current: Fill): Fill[] => [
  'tick',
  'comment',
  ...sources,
  ...(current !== 'tick' && current !== 'comment' && !sources.includes(current) ? [current] : []),
];

function VersionCard({ version, fresh }: { version: Version; fresh: boolean }) {
  const mark = version.state;
  const approval = useMemo(() => (version.approval ? [version.approval] : []), [version.approval]);
  return (
    <article className="card checklist-version" aria-labelledby={`version-${version.version}`}>
      <h3 id={`version-${version.version}`}>
        Version {version.version} <Status key={mark} mark={mark} fresh={fresh} />
      </h3>
      <p className="muted">Drafted by {version.draftedBy ?? 'the LIMS, as seeded'}</p>
      {approval.length > 0 && <Signatures rows={approval} />}
      <ol className="checklist-version__items">
        {version.items.map((item) => (
          <li key={item.key}>
            {item.text} <span className="muted">· {fillText(fillOf(item))}</span>
          </li>
        ))}
      </ol>
    </article>
  );
}

/** QA's Review Checklists: every version of one kind, the next version as a draft, and the newest draft to approve. */
export function ChecklistsPage({ me, kind }: { me: ActorContext; kind: ChecklistKind }) {
  const { data: view, error, reload } = useApi(routes.reviewChecklists, { kind });
  const fresh = useFresh(view, (v) => v.versions.map((x) => `${x.version}:${x.state}`));
  const newest = view?.versions.at(-1);
  const [base, setBase] = useState<string | undefined>();
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [picked, setPicked] = useState<'draft' | 'approve'>('approve');
  // A new version from the server starts the next draft from it and offers its approval first.
  if (newest && newest.id !== base) {
    setBase(newest.id);
    setRows(rowsOf(newest));
    setPicked('approve');
  }
  const pending = view?.versions.find((v) => v.state === 'Draft');
  const step = pending ? picked : 'draft';
  const action =
    view &&
    (step === 'approve' && pending
      ? approveAction(me, view, pending, reload)
      : draftAction(kind, (newest?.version ?? 0) + 1, rows, reload));
  return (
    <Shell me={me} active="checklists" action={action ?? null} railKey={kind}>
      <h1>Review Checklists</h1>
      <nav className="pipeline" aria-label="Review Checklist">
        {checklistKinds.map((k) => (
          <a key={k} className="pipe tap" href={`#/checklists/${k}`} aria-current={k === kind ? 'page' : undefined}>
            {k}
          </a>
        ))}
      </nav>
      {error && <p className="note--bad">{error}</p>}
      {view && (
        <>
          {pending && (
            <div className="pipeline record-steps" role="radiogroup" aria-label="Step the rail offers">
              <label className="pipe">
                <input
                  type="radio"
                  name="checklist-step"
                  checked={step === 'approve'}
                  onChange={() => setPicked('approve')}
                />
                Approve version {pending.version}
              </label>
              <label className="pipe">
                <input
                  type="radio"
                  name="checklist-step"
                  checked={step === 'draft'}
                  onChange={() => setPicked('draft')}
                />
                Draft version {pending.version + 1}
              </label>
            </div>
          )}
          {step === 'draft' && <DraftEditor rows={rows} sources={view.evidenceSources} onChange={setRows} />}
          <h2>
            {kind} Review Checklist versions{' '}
            <span className="muted">{view.inForce ? `· version ${view.inForce} in force` : '· none in force'}</span>
          </h2>
          {view.versions.toReversed().map((v) => (
            <VersionCard key={v.id} version={v} fresh={fresh.has(`${v.version}:${v.state}`)} />
          ))}
        </>
      )}
    </Shell>
  );
}
