import {
  type ActorContext,
  decimalPattern,
  routes,
  type StepInput,
  type StepName,
  stepRoute,
  steps,
  type TestState,
} from '@lims/domain';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { api, Refused, signOut, useApi } from './api.ts';

export type FieldKind = 'text' | 'decimal' | 'date' | 'method' | 'analyst';
export interface Field<N extends string = string> {
  name: N;
  label: string;
  kind: FieldKind;
}

/** The web's only per-step table: what each step asks for. Role, states and Signature Meaning come from the registry. */
export const stepUi: {
  [K in StepName]: { label: string; fields: readonly Field<Extract<keyof StepInput<K>, string>>[]; record?: string };
} = {
  submit: {
    label: 'Submit',
    fields: [
      { name: 'methodId', label: 'Method', kind: 'method' },
      { name: 'description', label: 'Sample description', kind: 'text' },
    ],
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

/** `fresh` marks a state the server has just confirmed on this page: the word and glyph are final, and an accent plays around them. */
export function Status({ state, fresh = false }: { state: TestState; fresh?: boolean }) {
  const at = stateOrder.indexOf(state);
  return (
    <span className={`status ${state === 'Reported' ? 'status--done' : ''} ${fresh ? 'status--fresh' : ''}`}>
      {words(state)}
      <span className="track" aria-hidden>
        {stateOrder.map((s, i) => (
          <i key={s} className={i < at ? 'on' : i === at ? 'on now' : ''} />
        ))}
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

export function stepAction(
  name: StepName,
  testId: string | null,
  what: string[],
  onDone: () => Promise<void>,
): RailAction {
  const step = steps[name];
  const ui = stepUi[name];
  return {
    label: ui.label,
    context: what[0] ?? '',
    fields: ui.fields,
    signs: step.signs && { meaning: step.signs, what: ui.record ? [...what, ui.record] : what },
    async run(input, password) {
      // Kept until the server answers, even across a reload, so pressing again after no answer resends this press.
      const press = `commitKey:${name}:${testId ?? 'new'}`;
      const commitKey = sessionStorage.getItem(press) ?? crypto.randomUUID();
      sessionStorage.setItem(press, commitKey);
      await api(stepRoute(name), {
        commitKey,
        ...(testId && { testId }),
        input,
        ...(password !== null && { signature: { password } }),
      }).catch((e: unknown) => {
        if (e instanceof Refused && e.kind !== 'failure') sessionStorage.removeItem(press);
        throw e;
      });
      sessionStorage.removeItem(press);
      await onDone();
      return `${ui.label} recorded in the Audit Trail. The Test is now ${words(step.to)}.`;
    },
  };
}

export const modules = [
  { key: 'tests', name: 'Tests', holds: '' },
  {
    key: 'equipment',
    name: 'Equipment',
    holds: 'Each instrument, balance and storage unit with its Check Plan, Checks, Excursions and Equipment Logbook.',
  },
  {
    key: 'inventory',
    name: 'Inventory',
    holds: 'Materials, Material Lots, Packs and Solutions with their Fitness Status, CoA and SDS.',
  },
  {
    key: 'deviations',
    name: 'Deviations',
    holds: 'Deviations from investigation to QA closure, with their Kind, Risk Level and CAPA Actions.',
  },
  {
    key: 'documents',
    name: 'Documents',
    holds: 'The document vault: SOPs and Method Protocols by version, with Effective Dates and Periodic Review.',
  },
  {
    key: 'training',
    name: 'Training',
    holds: 'Training Records per person and Document version, with Training Runs and Competence Assessments.',
  },
  {
    key: 'stability',
    name: 'Stability',
    holds: 'Protocols, Studies, Placements and Pulls for each Storage Condition and Time Point.',
  },
  { key: 'notebooks', name: 'Notebooks', holds: 'Each Lab Notebook with its entries, Addenda and Late Entries.' },
  { key: 'dashboards', name: 'Dashboards', holds: 'Workload, turnaround and overdue Tests across the Lab.' },
] as const;
export type Module = (typeof modules)[number];
type ModuleKey = Module['key'];

/** `notice` is what the rail says when the person has no step to take here, such as which Signatures are unsigned. */
export function Shell({
  me,
  active,
  action,
  notice,
  children,
}: {
  me: ActorContext;
  active: ModuleKey;
  action: RailAction | null;
  notice?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="frame">
      <TopBar>
        <nav>
          {modules.map((m) => (
            <a key={m.key} href={`#/${m.key}`} className={m.key === active ? 'active' : ''}>
              {m.name}
            </a>
          ))}
        </nav>
      </TopBar>
      <main className="plane">{children}</main>
      <Rail me={me} action={action} notice={notice} />
    </div>
  );
}

export function TopBar({ children }: { children?: ReactNode }) {
  return (
    <header className="top">
      <span className="brand">
        <b>RD</b>Nitrosamine LIMS
      </span>
      {children}
      <span className="fict">Fictional data only</span>
    </header>
  );
}

interface Note {
  text: string;
  tone: 'ok' | 'bad';
  n: number;
}
/** The sheet keeps the action it opened for, so its closing frames never show the step that came next. */
type Sheet = { action: RailAction; closing: boolean } | null;

/** Longer than --dur-sheet-out, so the sheet unmounts even when no transitionend fires. */
const EXIT_FALLBACK_MS = 400;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function unansweredText(e: unknown, signs: boolean): string {
  if (!(e instanceof Refused))
    return `The LIMS did not answer. ${signs ? 'Type your password again and sign' : 'Press again'} with the same entries; they will not be saved twice.`;
  if (e.kind === 'failure') return `Not finished: ${e.message}.`;
  return `Refused: ${e.message}.${signs ? ' Nothing has been signed.' : ''}`;
}

function Rail({ me, action, notice }: { me: ActorContext; action: RailAction | null; notice?: string | undefined }) {
  const [sheet, setSheet] = useState<Sheet>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const [refusal, setRefusal] = useState<Note | null>(null);
  const [instant, setInstant] = useState(false);
  const inFlight = useRef(false);
  const count = useRef(0);
  const returnFocus = useRef(false);
  const clearOnClose = useRef(false);
  const fallback = useRef(0);
  const form = useRef<HTMLFormElement>(null);
  const commitButton = useRef<HTMLButtonElement>(null);
  const statusLine = useRef<HTMLDivElement>(null);
  const opened = sheet !== null && !sheet.closing;
  const firstField = () => form.current?.querySelector<HTMLElement>('input, select');

  useEffect(() => {
    if (!returnFocus.current || opened) return;
    returnFocus.current = false;
    (commitButton.current ?? statusLine.current)?.focus();
  });
  useEffect(() => {
    if (sheet || !clearOnClose.current) return;
    clearOnClose.current = false;
    setValues({});
  }, [sheet]);
  useEffect(() => {
    if (!opened) return;
    // A phone keeps its keyboard down on open, so the person reads what they sign before typing.
    if (!matchMedia('(pointer: coarse)').matches) firstField()?.focus({ preventScroll: true });
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || inFlight.current) return;
      returnFocus.current = true;
      flushSync(() => {
        setInstant(true);
        setSheet(null);
      });
    };
    addEventListener('keydown', escape);
    return () => removeEventListener('keydown', escape);
  }, [opened]);
  useEffect(() => {
    if (!refusal) return;
    const field = form.current?.querySelector<HTMLElement>('input[type=password]') ?? firstField();
    field?.focus({ preventScroll: true });
    field?.scrollIntoView({ block: 'nearest' });
  }, [refusal]);

  function open(a: RailAction) {
    if (inFlight.current) return;
    clearTimeout(fallback.current);
    setRefusal(null);
    setSheet({ action: a, closing: false });
  }
  function close(clear: boolean) {
    returnFocus.current = true;
    clearOnClose.current = clear;
    setInstant(false);
    if (reducedMotion()) {
      flushSync(() => setSheet(null));
      return;
    }
    setSheet((s) => s && { ...s, closing: true });
    fallback.current = window.setTimeout(closed, EXIT_FALLBACK_MS);
  }
  const closed = () => setSheet((s) => (s?.closing ? null : s));

  async function commit(a: RailAction) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const text = await a.run(values, a.signs ? password : null);
      setNote({ text, tone: 'ok', n: ++count.current });
      returnFocus.current = true;
      if (sheet) close(true);
    } catch (e) {
      const unanswered: Note = { text: unansweredText(e, a.signs !== null), tone: 'bad', n: ++count.current };
      setNote(unanswered);
      if (sheet) setRefusal(unanswered);
    } finally {
      inFlight.current = false;
      setBusy(false);
      setPassword('');
    }
  }

  const direct = action && !action.fields.length && !action.signs;
  const shown = sheet?.action;
  return (
    <>
      {shown && (
        <form
          ref={form}
          className="sheet"
          data-closing={sheet.closing || undefined}
          inert={sheet.closing}
          aria-labelledby="sheet-title"
          onSubmit={(e) => {
            e.preventDefault();
            void commit(shown);
          }}
          onTransitionEnd={(e) => e.target === e.currentTarget && closed()}
        >
          <fieldset className="sheet__set" disabled={busy}>
            <h2 id="sheet-title">
              {shown.signs ? `Sign ${shown.signs.meaning}` : shown.label}
              <span className="fict">Fictional data only</span>
            </h2>
            <div className="sheet__body">
              {shown.fields.length > 0 && (
                <fieldset className="card">
                  <legend>{shown.context}</legend>
                  {shown.fields.map((f) => (
                    <label key={f.name}>
                      {f.label}
                      <FieldInput
                        field={f}
                        value={values[f.name] ?? ''}
                        onChange={(v) => setValues({ ...values, [f.name]: v })}
                      />
                    </label>
                  ))}
                </fieldset>
              )}
              {shown.signs && (
                <>
                  <section className="card">
                    <h3>What you are signing</h3>
                    {shown.signs.what.map((line) => (
                      <p key={line}>{line}</p>
                    ))}
                    {shown.fields.map((f) => (
                      <p key={f.name}>
                        {f.label}: <b>{values[f.name] || '(not entered)'}</b>
                      </p>
                    ))}
                  </section>
                  <section className="card">
                    <h3>Who is signing</h3>
                    <p className="who__name">{me.person.displayName}</p>
                    <p className="muted">
                      <code>{me.person.username}</code> · {me.roles.map(words).join(', ')} · {me.lab.name}
                    </p>
                    <div className="meaning">
                      <b>{shown.signs.meaning}</b>
                      <i>{meaningStatement[shown.signs.meaning]}</i>
                    </div>
                    <label>
                      Password (type it again to sign)
                      <input
                        type="password"
                        required
                        autoComplete="off"
                        value={password}
                        aria-invalid={refusal !== null && !password}
                        aria-describedby="sheet-line"
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    </label>
                  </section>
                </>
              )}
            </div>
            <div className="sheet__foot">
              <p key={refusal?.n} id="sheet-line" className={`sheet__line ${refusal ? 'refusal' : ''}`}>
                <span hidden={refusal !== null}>{shown.signs ? demoSigning : shown.context}</span>
                {refusal && <span>{refusal.text}</span>}
              </p>
              <button type="button" className="rbtn rbtn--quiet" onClick={() => close(false)}>
                Cancel
              </button>
              <button type="submit" className="rbtn" aria-busy={busy}>
                {shown.signs ? `Sign as ${shown.signs.meaning}` : shown.label}
              </button>
            </div>
          </fieldset>
        </form>
      )}
      <footer className="rail">
        <div className="who">
          <b>{me.person.displayName}</b>
          <span>
            {me.roles.map(words).join(', ')} · <code>{me.person.username}</code>
          </span>
        </div>
        <div ref={statusLine} className="rail__context" role="status" tabIndex={-1}>
          <p key={note?.n} className={`note ${note ? `note--${note.tone}` : ''}`}>
            {note?.text ?? action?.context ?? notice ?? 'Nothing for you to commit here.'}
          </p>
        </div>
        {action && !opened && (
          <button
            ref={commitButton}
            type="button"
            className="rbtn rbtn--commit"
            data-instant={instant || undefined}
            disabled={busy}
            aria-busy={busy}
            onClick={() => (direct ? void commit(action) : open(action))}
          >
            {action.label}
          </button>
        )}
        <button type="button" className="rbtn rbtn--quiet rail__out" onClick={() => void signOut()}>
          Sign out
        </button>
      </footer>
    </>
  );
}

function FieldInput({ field, value, onChange }: { field: Field; value: string; onChange: (v: string) => void }) {
  const change = (e: { target: { value: string } }) => onChange(e.target.value);
  if (field.kind === 'method' || field.kind === 'analyst')
    return <LookupSelect field={field} value={value} onChange={change} />;
  const props = { required: true, value, onChange: change };
  if (field.kind === 'date') return <input type="date" {...props} />;
  if (field.kind === 'decimal') return <input inputMode="decimal" pattern={decimalPattern} {...props} />;
  return <input {...props} />;
}

function LookupSelect({
  field,
  value,
  onChange,
}: {
  field: Field;
  value: string;
  onChange: (e: { target: { value: string } }) => void;
}) {
  const { data } = useApi(routes.lookups);
  const options =
    field.kind === 'method'
      ? data?.methods.map((m) => ({ id: m.id, text: `${m.code} v${m.version} ${m.title}` }))
      : data?.analysts.map((a) => ({ id: a.id, text: a.displayName }));
  return (
    <select required value={value} onChange={onChange}>
      <option value="">Choose…</option>
      {options?.map((o) => (
        <option key={o.id} value={o.id}>
          {o.text}
        </option>
      ))}
    </select>
  );
}
