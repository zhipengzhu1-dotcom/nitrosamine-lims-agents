import {
  type ActorContext,
  type AuditedTable,
  auditedRecords,
  type AuditTrailVerification,
  isTestState,
  type ShownValue,
  routes,
  type Trail,
  type TrailChange,
  type TrailEntry,
} from '@lims/domain';
import { useEffect, useRef, useState } from 'react';
import { api, useApi, useFresh } from './api.ts';
import { Shell, Status, words } from './rail.tsx';
import { labTime, time } from './time.ts';

const entryKey = (e: TrailEntry) => `${e.chain}:${e.seq}`;
const action = { INSERT: 'created', UPDATE: 'changed', DELETE: 'removed' } as const;
const chainWords = { lab: 'Lab chain', company: 'Company chain' } as const;
const SHORT = 48;
const NONE = 'none';

function searchText(e: TrailEntry): string {
  return [
    `#${e.seq}`,
    chainWords[e.chain],
    time(e.at),
    e.atLab ? labTime(e.atLab) : '',
    e.actor.label,
    words(e.actor.role),
    action[e.op],
    e.reason,
    e.record.kind,
    e.record.label,
    ...e.changes.flatMap((c) => [c.label, c.old?.text ?? NONE, c.new?.text ?? NONE]),
  ]
    .join(' ')
    .toLowerCase();
}

function Value({ value, change, e }: { value: ShownValue | null; change: TrailChange; e: TrailEntry }) {
  if (value === null) return <i className="muted">{NONE}</i>;
  if (change.field === 'state' && e.record.table === 'test' && isTestState(value.text))
    return <Status state={value.text} />;
  const text = value.ref ? (
    <a href={`#/trails/${value.ref.table}/${value.ref.id}`}>{value.text}</a>
  ) : (
    <span>{value.text}</span>
  );
  if (value.text.length <= SHORT) return text;
  return (
    <details className="long">
      <summary>{value.text.slice(0, SHORT)}…</summary>
      {text}
    </details>
  );
}

function Entry({ e, root, fresh, onRaw }: { e: TrailEntry; root: Trail['record']; fresh: boolean; onRaw: () => void }) {
  const own = e.record.table === root.table && e.record.id === root.id;
  return (
    <li className={`entry ${e.afterFirstSave ? 'entry--changed' : ''} ${fresh ? 'entry--fresh' : ''}`}>
      <div className="entry__head">
        <span className={`chain chain--${e.chain}`}>{chainWords[e.chain]}</span>
        <span className="entry__seq">#{e.seq}</span>
        <span className="entry__time">
          {time(e.at)}
          {e.atLab && <span className="muted"> · {labTime(e.atLab)}</span>}
        </span>
      </div>
      <p className="entry__line">
        <b>{e.actor.label}</b> <span className="muted">({words(e.actor.role)})</span> {action[e.op]} the{' '}
        {own ? (
          <span>
            {e.record.kind} {e.record.label}
          </span>
        ) : (
          <a href={`#/trails/${e.record.table}/${e.record.id}`}>
            {e.record.kind} {e.record.label}
          </a>
        )}
        <span className="muted"> · reason: {e.reason}</span>
      </p>
      {e.changes.length > 0 && (
        <dl className="changes">
          {e.changes.map((c) => (
            <div key={c.field}>
              <dt>{c.label}</dt>
              <dd>
                {e.op === 'UPDATE' ? (
                  <>
                    <Value value={c.old} change={c} e={e} /> → <Value value={c.new} change={c} e={e} />
                  </>
                ) : (
                  <Value value={e.op === 'INSERT' ? c.new : c.old} change={c} e={e} />
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <button type="button" className="btn btn--small" onClick={onRaw}>
        Raw entry {e.seq}
      </button>
    </li>
  );
}

function RawDialog({ entry, onClose }: { entry: TrailEntry | null; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (entry) dialog.current?.showModal();
    else dialog.current?.close();
  }, [entry]);
  return (
    <dialog ref={dialog} className="raw" onClose={onClose} aria-label={entry ? `raw entry ${entry.seq}` : 'raw entry'}>
      {entry && (
        <>
          <h2>
            Raw entry {entry.seq}, {chainWords[entry.chain]}
          </h2>
          <p className="muted">
            The stored values the hash covers, with the entry&apos;s SHA-256 and the previous one.
          </p>
          <pre>{JSON.stringify(entry.raw, null, 2)}</pre>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </>
      )}
    </dialog>
  );
}

function VerifyChain() {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<{ text: string; tone: 'ok' | 'bad' } | null>(null);
  async function verify() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const found: AuditTrailVerification = await api(routes.verifyAuditTrail);
      const broken = found.chains.some((c) => c.firstFailure !== null);
      const chains = found.chains.map((c) => `${chainWords[c.chain]} ${c.report}`).join('; ');
      setVerdict({
        text: `Recomputed at ${time(found.at)}: ${chains}. Not anchored off-server (demo).`,
        tone: broken ? 'bad' : 'ok',
      });
    } catch (error) {
      setVerdict({ text: error instanceof Error ? error.message : 'the LIMS did not answer', tone: 'bad' });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="verify">
      <button type="button" className="btn" onClick={() => void verify()} disabled={busy} aria-busy={busy}>
        Verify chain
      </button>
      {verdict && (
        <p className={`verdict note--${verdict.tone}`} aria-live="polite">
          {verdict.text}
        </p>
      )}
    </div>
  );
}

export function TrailPanel({ me, trail }: { me: ActorContext; trail: Trail | undefined }) {
  const [search, setSearch] = useState('');
  const [newestFirst, setNewestFirst] = useState(false);
  const [raw, setRaw] = useState<TrailEntry | null>(null);
  const fresh = useFresh(trail, (t) => t.entries.map(entryKey));
  const needle = search.trim().toLowerCase();
  const shown = (trail?.entries ?? []).filter((e) => needle === '' || searchText(e).includes(needle));
  if (newestFirst) shown.reverse();
  return (
    <section className="trail" aria-label="Audit Trail">
      <div className="trail__head">
        <h2>Audit Trail</h2>
        {trail && (
          <p className="muted">
            {trail.entries.length} entries. Times in UTC
            {trail.entries.some((e) => e.atLab !== null) ? ` and in the Lab's zone, ${trail.labZone}` : ''}.
          </p>
        )}
      </div>
      <div className="trail__tools">
        <label>
          Search the trail
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <label>
          Order
          <select
            value={newestFirst ? 'newest' : 'oldest'}
            onChange={(e) => setNewestFirst(e.target.value === 'newest')}
          >
            <option value="oldest">Oldest first</option>
            <option value="newest">Newest first</option>
          </select>
        </label>
        {me.roles.includes('QA') && <VerifyChain />}
      </div>
      {trail && (
        <ol className="entries">
          {shown.map((e) => (
            <Entry key={entryKey(e)} e={e} root={trail.record} fresh={fresh.has(entryKey(e))} onRaw={() => setRaw(e)} />
          ))}
        </ol>
      )}
      {trail && shown.length === 0 && <p className="muted">No entry matches.</p>}
      <RawDialog entry={raw} onClose={() => setRaw(null)} />
    </section>
  );
}

/** The Test's trail; `onReload` receives the function that refetches it, so a step's commit can wait for the new entries. */
export function TestTrail({
  me,
  id,
  onReload,
}: {
  me: ActorContext;
  id: string;
  onReload: (reload: () => Promise<void>) => void;
}) {
  const { data, error, reload } = useApi(routes.testTrail, { id });
  const latest = useRef(reload);
  useEffect(() => {
    latest.current = reload;
  });
  useEffect(() => onReload(() => latest.current()), [onReload]);
  if (error) return <p className="note--bad">{error}</p>;
  return <TrailPanel me={me} trail={data} />;
}

export function TrailPage({ me, table, id }: { me: ActorContext; table: AuditedTable; id: string }) {
  const { data, error } = useApi(routes.recordTrail, { table, id });
  return (
    <Shell me={me} active="tests" action={null}>
      <h1>
        {auditedRecords[table].kind} {data?.record.label ?? ''}
      </h1>
      {error && <p className="note--bad">{error}</p>}
      <TrailPanel me={me} trail={data} />
    </Shell>
  );
}
