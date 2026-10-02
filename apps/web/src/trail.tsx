import {
  type ActorContext,
  type AuditExport,
  type AuditExportFormat,
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
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { api, Refused, useApi, useFresh } from './api.ts';
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

interface Download {
  name: string;
  sha256: string;
  url: string;
}

function downloadOf(file: AuditExport['files'][number]): Download {
  const bytes = Uint8Array.from(atob(file.base64), (ch) => ch.codePointAt(0) ?? 0);
  return {
    name: file.name,
    sha256: file.sha256,
    url: URL.createObjectURL(new Blob([bytes], { type: file.mediaType })),
  };
}

export function AuditExportPage({ me }: { me: ActorContext }) {
  const customers = useApi(routes.auditExportCustomers);
  const [customerId, setCustomerId] = useState('');
  const [format, setFormat] = useState<AuditExportFormat>('JSON');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const [done, setDone] = useState<{ answer: AuditExport; downloads: Download[] } | null>(null);
  const inFlight = useRef(false);
  useEffect(() => () => done?.downloads.forEach((d) => URL.revokeObjectURL(d.url)), [done]);

  async function generate(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setRefusal('');
    try {
      const answer = await api(routes.auditExport, { customerId, format });
      setDone({ answer, downloads: answer.files.map((f) => downloadOf(f)) });
    } catch (error) {
      setRefusal(
        error instanceof Refused && error.kind !== 'failure'
          ? `Refused: ${error.message}. No export was generated.`
          : `Not finished: ${error instanceof Error ? error.message : 'the LIMS did not answer'}. Generate again to see what was recorded.`,
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <Shell me={me} active="audit-export" action={null}>
      <h1>Audit Export</h1>
      <p className="muted">
        One Customer&apos;s Audit Trail for a Customer audit: its Submissions, Samples, Tests and their records, with
        the shared records they use. Another Customer&apos;s identifiers read [redacted]. Generating an export is
        recorded in the Audit Trail.
      </p>
      {customers.error && <p className="note--bad">{customers.error}</p>}
      {customers.data && (
        <form className="export" onSubmit={(e) => void generate(e)}>
          <label>
            Customer
            <select required value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="" disabled>
                Choose a Customer
              </option>
              {customers.data.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Format
            <select value={format} onChange={(e) => setFormat(e.target.value === 'CSV' ? 'CSV' : 'JSON')}>
              <option value="JSON">JSON, with a PDF</option>
              <option value="CSV">CSV, with a PDF</option>
            </select>
          </label>
          <button type="submit" className="rbtn" disabled={busy} aria-busy={busy}>
            Generate export
          </button>
        </form>
      )}
      {refusal && (
        <p className="note--bad" role="alert">
          {refusal}
        </p>
      )}
      {done && (
        <section className="export__done" aria-label="Generated export">
          <h2>For {done.answer.customer.name}</h2>
          <p>
            Generated {time(done.answer.generatedAt)}: {done.answer.entryCount} entries.
          </p>
          <ul>
            {done.downloads.map((d) => (
              <li key={d.name}>
                <a className="btn" href={d.url} download={d.name}>
                  Download {d.name}
                </a>
                <code>SHA-256 {d.sha256}</code>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Shell>
  );
}
