import { type StepName, steps, type TestState } from '@lims/domain';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { api, type Lookups, type Me, signOut, useApi } from './api.ts';

export type FieldKind = 'text' | 'decimal' | 'date' | 'method' | 'analyst';
export interface Field { name: string; label: string; kind: FieldKind }

/** The web's only per-step table: what each step asks for. Role, states and Signature Meaning come from the registry. */
export const stepUi: Record<StepName, { label: string; fields: Field[]; record?: string }> = {
  submit: {
    label: 'Submit',
    fields: [{ name: 'methodId', label: 'Method', kind: 'method' }, { name: 'description', label: 'Sample description', kind: 'text' }],
  },
  receive: { label: 'Receive', fields: [] },
  assign: { label: 'Assign', fields: [{ name: 'assigneeId', label: 'Analyst', kind: 'analyst' }] },
  enterResult: {
    label: 'Enter Result',
    fields: [
      { name: 'analyte', label: 'Analyte', kind: 'text' },
      { name: 'value', label: 'Result as written', kind: 'decimal' },
      { name: 'unit', label: 'Unit', kind: 'text' },
      { name: 'injectionSequenceRef', label: 'Injection sequence', kind: 'text' },
      { name: 'notebookRef', label: 'Notebook reference', kind: 'text' },
      { name: 'performedOn', label: 'Performed on', kind: 'date' },
    ],
  },
  review: { label: 'Review', fields: [] },
  release: { label: 'Release', fields: [], record: 'The Test Report this release issues' },
};

type SignedMeaning = NonNullable<(typeof steps)[StepName]['signs']>;

export const meaningStatement: Record<SignedMeaning, string> = {
  Performed: 'I performed this Test and the Result is as I entered it.',
  Reviewed: 'I reviewed this Test, its Result and its record.',
  Released: 'I release this Test Report to the Customer.',
};

export const demoSigning = 'Demo: accounts share one password, and a signing re-enters the password only.';
const stateOrder = Object.values(steps).map((s) => s.to);
export const words = (name: string) => name.replace(/([a-z])([A-Z])/g, '$1 $2');

/**
 * The keys that were not in the list the last time it changed. Empty on the first render, so only a change that a
 * reload brought from the server is ever marked as new.
 */
export function useArrivals(keys: readonly string[]): ReadonlySet<string> {
  const id = keys.join('\n');
  const [seen, setSeen] = useState({ id, keys: new Set(keys), fresh: new Set<string>() });
  if (seen.id === id) return seen.fresh;
  const next = { id, keys: new Set(keys), fresh: new Set(keys.filter((k) => !seen.keys.has(k))) };
  setSeen(next);
  return next.fresh;
}

export function Status({ state }: { state: TestState }) {
  const at = stateOrder.indexOf(state);
  const fresh = useArrivals([state]).has(state);
  return (
    <span className={`status${state === 'Reported' ? ' status--done' : ''}${fresh ? ' status--fresh' : ''}`}>
      {words(state)}
      <span className="track" aria-hidden>
        {stateOrder.map((s, i) => <i key={s} className={`${i <= at ? 'on' : ''}${fresh && i === at ? ' just' : ''}`} />)}
      </span>
    </span>
  );
}

export interface RailAction {
  label: string;
  context: string;
  fields: readonly Field[];
  signs: { meaning: SignedMeaning; what: string[] } | null;
  run: (input: Record<string, string>, password: string | null) => Promise<string>;
}

export function stepAction(name: StepName, testId: string | null, what: string[], onDone: () => Promise<void>): RailAction {
  const step = steps[name];
  const ui = stepUi[name];
  return {
    label: ui.label,
    context: what[0] ?? '',
    fields: ui.fields,
    signs: step.signs && { meaning: step.signs, what: ui.record ? [...what, ui.record] : what },
    async run(input, password) {
      await api(`/api/steps/${name}`, { ...(testId && { testId }), input, ...(password !== null && { signature: { password } }) });
      await onDone();
      return `${ui.label} recorded in the Audit Trail. The Test is now ${words(step.to)}.`;
    },
  };
}

export const modules = [
  { key: 'tests', name: 'Tests', holds: '' },
  { key: 'equipment', name: 'Equipment', holds: 'Each instrument, balance and storage unit with its Check Plan, Checks, Excursions and Equipment Logbook.' },
  { key: 'inventory', name: 'Inventory', holds: 'Materials, Material Lots, Packs and Solutions with their Fitness Status, CoA and SDS.' },
  { key: 'deviations', name: 'Deviations', holds: 'Deviations from investigation to QA closure, with their Kind, Risk Level and CAPA Actions.' },
  { key: 'documents', name: 'Documents', holds: 'The document vault: SOPs and Method Protocols by version, with Effective Dates and Periodic Review.' },
  { key: 'training', name: 'Training', holds: 'Training Records per person and Document version, with Training Runs and Competence Assessments.' },
  { key: 'stability', name: 'Stability', holds: 'Protocols, Studies, Placements and Pulls for each Storage Condition and Time Point.' },
  { key: 'notebooks', name: 'Notebooks', holds: 'Each Lab Notebook with its entries, Addenda and Late Entries.' },
  { key: 'dashboards', name: 'Dashboards', holds: 'Workload, turnaround and overdue Tests across the Lab.' },
] as const;
export type ModuleKey = (typeof modules)[number]['key'];

export function Shell({ me, active, action, children }: { me: Me; active: ModuleKey; action: RailAction | null; children: ReactNode }) {
  return (
    <div className="frame">
      <TopBar>
        <nav>{modules.map((m) => <a key={m.key} href={`#/${m.key}`} className={m.key === active ? 'active' : ''}>{m.name}</a>)}</nav>
      </TopBar>
      <main className="plane">{children}</main>
      <Rail me={me} action={action} />
    </div>
  );
}

export function TopBar({ children }: { children?: ReactNode }) {
  return (
    <header className="top">
      <span className="brand"><b>RD</b>Nitrosamine LIMS</span>
      {children}
      <span className="fict">Fictional data only</span>
    </header>
  );
}

const shake: Keyframe[] = [
  { transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(5px)' },
  { transform: 'translateX(-3px)' }, { transform: 'translateX(0)' },
];
const prefers = (query: string) => matchMedia(query).matches;

function Rail({ me, action }: { me: Me; action: RailAction | null }) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<RailAction | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<{ text: string; seq: number } | null>(null);
  const [note, setNote] = useState<{ text: string; tone: 'ok' | 'bad'; seq: number } | null>(null);
  const inFlight = useRef(false);
  const seq = useRef(0);
  const sheet = useRef<HTMLFormElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const actionKey = action && `${action.label} ${action.context}`;
  useEffect(() => { setOpen(false); }, [actionKey]);

  useEffect(() => {
    if (!open) return;
    if (prefers('(pointer: fine)')) sheet.current?.querySelector<HTMLElement>('input, select')?.focus({ preventScroll: true });
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape' && !inFlight.current) setOpen(false); };
    addEventListener('keydown', close);
    return () => removeEventListener('keydown', close);
  }, [open]);

  useEffect(() => {
    const input = passwordInput.current;
    if (!refusal || !input) return;
    input.focus({ preventScroll: true });
    if (!prefers('(prefers-reduced-motion: reduce)')) input.animate(shake, { duration: 360, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
  }, [refusal]);

  function openSheet(take: RailAction) {
    setShown(take);
    setValues({});
    setPassword('');
    setRefusal(null);
    setOpen(true);
  }

  async function commit(take: RailAction) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    seq.current += 1;
    try {
      const text = await take.run(values, take.signs ? password : null);
      setNote({ text, tone: 'ok', seq: seq.current });
      setOpen(false);
    } catch (e) {
      const text = `Refused: ${e instanceof Error ? e.message : String(e)}.${take.signs ? ' Nothing has been signed.' : ''}`;
      setNote({ text, tone: 'bad', seq: seq.current });
      setRefusal({ text, seq: seq.current });
    } finally {
      inFlight.current = false;
      setBusy(false);
      setPassword('');
    }
  }

  const direct = action && !action.fields.length && !action.signs;
  const refused = refusal && <p key={refusal.seq} id="sheet-refusal" className="refusal" role="alert">{refusal.text}</p>;
  return (
    <div className="bench">
      {shown && (
        <form ref={sheet} className="sheet" data-open={open} inert={!open} aria-busy={busy}
          onSubmit={(e) => { e.preventDefault(); void commit(shown); }}>
          <h2>{shown.signs ? `Sign ${shown.signs.meaning}` : shown.label}<span className="fict">Fictional data only</span></h2>
          <div className="sheet__body">
            {shown.fields.length > 0 && (
              <fieldset className="card">
                <legend>{shown.context}</legend>
                {shown.fields.map((f) => (
                  <label key={f.name}>{f.label}
                    <FieldInput field={f} locked={busy} value={values[f.name] ?? ''} onChange={(v) => setValues({ ...values, [f.name]: v })} />
                  </label>
                ))}
              </fieldset>
            )}
            {shown.signs && (
              <>
                <section className="card">
                  <h3>What you are signing</h3>
                  {shown.signs.what.map((line) => <p key={line}>{line}</p>)}
                  {shown.fields.map((f) => <p key={f.name}>{f.label}: <b>{values[f.name] || '(not entered)'}</b></p>)}
                </section>
                <section className="card">
                  <h3>Who is signing</h3>
                  <p className="who__name">{me.person.displayName}</p>
                  <p className="muted"><code>{me.person.username}</code> · {me.roles.map(words).join(', ')} · {me.lab.name}</p>
                  <div className="meaning"><b>{shown.signs.meaning}</b><i>{meaningStatement[shown.signs.meaning]}</i></div>
                  <label>Password (type it again to sign)
                    <input ref={passwordInput} type="password" required autoComplete="off" readOnly={busy}
                      aria-invalid={refusal !== null} aria-describedby={refusal ? 'sheet-refusal' : undefined}
                      value={password} onChange={(e) => setPassword(e.target.value)} />
                  </label>
                  {refused}
                  <p className="fict">{demoSigning}</p>
                </section>
              </>
            )}
          </div>
          {!shown.signs && refused}
          <div className="sheet__foot">
            <button type="button" className="rbtn rbtn--quiet" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="rbtn rbtn--commit" disabled={busy} aria-busy={busy}>
              {shown.signs ? `Sign as ${shown.signs.meaning}` : shown.label}{busy && <span className="spin" aria-hidden />}
            </button>
          </div>
        </form>
      )}
      <footer className="rail">
        <div className="who">
          <b>{me.person.displayName}</b>
          <span>{me.roles.map(words).join(', ')} · <code>{me.person.username}</code></span>
        </div>
        <div className={`rail__context ${note ? `note--${note.tone}` : ''}`} role="status">
          <span key={note?.seq ?? 0} className={note ? `note-text note-text--${note.tone}` : undefined}>{note?.text ?? action?.context ?? 'Nothing for you to commit here.'}</span>
        </div>
        {action && !open && (
          <button type="button" className="rbtn rbtn--commit" disabled={busy} aria-busy={busy && direct === true}
            onClick={() => (direct ? void commit(action) : openSheet(action))}>
            {action.label}{busy && direct && <span className="spin" aria-hidden />}
          </button>
        )}
        <button type="button" className="rbtn rbtn--quiet rbtn--out" onClick={() => void signOut()}>Sign out</button>
      </footer>
    </div>
  );
}

function FieldInput({ field, value, locked, onChange }: { field: Field; value: string; locked: boolean; onChange: (v: string) => void }) {
  const change = (e: { target: { value: string } }) => onChange(e.target.value);
  if (field.kind === 'method' || field.kind === 'analyst') return <LookupSelect field={field} value={value} locked={locked} onChange={change} />;
  const props = { required: true, readOnly: locked, value, onChange: change };
  if (field.kind === 'date') return <input type="date" {...props} />;
  if (field.kind === 'decimal') return <input inputMode="decimal" pattern="-?[0-9]+(\.[0-9]+)?" {...props} />;
  return <input {...props} />;
}

function LookupSelect({ field, value, locked, onChange }: {
  field: Field; value: string; locked: boolean; onChange: (e: { target: { value: string } }) => void;
}) {
  const { data } = useApi<Lookups>('/api/lookups');
  const options = field.kind === 'method'
    ? data?.methods.map((m) => ({ id: m.id, text: `${m.code} v${m.version} ${m.title}` }))
    : data?.analysts.map((a) => ({ id: a.id, text: a.displayName }));
  return (
    <select required disabled={locked} value={value} onChange={onChange}>
      <option value="">Choose…</option>
      {options?.map((o) => <option key={o.id} value={o.id}>{o.text}</option>)}
    </select>
  );
}
