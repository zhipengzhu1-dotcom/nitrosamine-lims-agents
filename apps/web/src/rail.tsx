import {
  type ActorContext,
  type ChainVerdict,
  decimalPattern,
  mayTake,
  type IncidentState,
  type Lab,
  type RecordVersionRef,
  type Role,
  pressText,
  routes,
  type SignatureStatement,
  type StepInput,
  type StepName,
  staffRefusal,
  stepRoute,
  steps,
  type TestState,
  type TypedCredentials,
} from '@lims/domain';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { api, type LockMode, lock, Refused, signOut, useApi, useSecondsLeft } from './api.ts';
import { reducedMotion } from './motion.ts';

export type FieldKind = 'text' | 'decimal' | 'date' | 'method' | 'analyst' | 'room';
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

export const demoSigning =
  'Demo: accounts share one password, and a signing re-enters the user ID and password without a second factor.';

export interface SigningView {
  recordVersion: RecordVersionRef;
  statement: SignatureStatement;
}
const stateOrder = Object.values(steps).map((s) => s.to);
export const words = (name: string) => name.replace(/([a-z])([A-Z])/g, '$1 $2');

const unsignedLook = {
  tone: 'bad',
  glyph: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v3.5M8 11h0" />
    </>
  ),
} as const;
const markLook = {
  Intact: { tone: 'ok', glyph: <path d="M3 8.5l3.5 3.5L13 4.5" /> },
  Broken: { tone: 'bad', glyph: <path d="M4 4l8 8M12 4l-8 8" /> },
  Unsigned: unsignedLook,
  'Signatures unsigned': unsignedLook,
  Open: unsignedLook,
  Acknowledged: {
    tone: 'bad',
    glyph: (
      <>
        <circle cx="8" cy="8" r="6" />
        <path d="M8 5v3.5l2.5 1.5" />
      </>
    ),
  },
  Closed: {
    tone: 'done',
    glyph: (
      <>
        <circle cx="8" cy="8" r="6" />
        <path d="M5.5 8.2l1.8 1.8 3.2-3.5" />
      </>
    ),
  },
} as const satisfies Record<ChainVerdict | IncidentState | 'Unsigned' | 'Signatures unsigned', unknown>;

/**
 * A Test state with its track, or a mark with its glyph: a chain verdict, a System Incident's state, an unsigned
 * Signature, or a record with an unsigned Signature. `fresh` marks a state the server has just confirmed on this page:
 * the word and glyph are final, and an accent plays around them.
 */
export function Status(props: { state: TestState; fresh?: boolean } | { mark: keyof typeof markLook }) {
  if ('mark' in props) {
    const { tone, glyph } = markLook[props.mark];
    return (
      <span className={`status status--${tone}`}>
        {props.mark}
        <svg className="glyph" viewBox="0 0 16 16" aria-hidden>
          {glyph}
        </svg>
      </span>
    );
  }
  const { state, fresh = false } = props;
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
  signs: ({ meaning: SignedMeaning; what: string[]; role: Role } & SigningView) | null;
  run: (input: Record<string, string>, credentials: TypedCredentials | null) => Promise<string>;
}

async function commitKeySlot(press: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(press));
  return `commitKey:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function stepAction(
  name: StepName,
  testId: string | null,
  what: string[],
  onDone: () => Promise<void>,
  signing: SigningView | null = null,
): RailAction {
  const step = steps[name];
  const ui = stepUi[name];
  return {
    label: ui.label,
    context: what[0] ?? '',
    fields: ui.fields,
    signs:
      step.signs && signing
        ? { meaning: step.signs, what: ui.record ? [...what, ui.record] : what, role: step.role, ...signing }
        : null,
    async run(input, credentials) {
      // Kept, even across a reload, sign-in or refusal, until the LIMS answers that it recorded the press: no other answer
      // proves the LIMS does not already hold it, and a new key would record it twice. A key the LIMS does not hold is
      // claimed by the next press as if new. The slot names the press by a digest, so no entries are kept in the browser.
      const slot = await commitKeySlot(pressText(name, testId, input));
      const commitKey = sessionStorage.getItem(slot) ?? crypto.randomUUID();
      sessionStorage.setItem(slot, commitKey);
      await api(stepRoute(name), {
        commitKey,
        ...(testId && { testId }),
        input,
        ...(credentials &&
          signing && {
            signature: {
              ...credentials,
              recordVersion: { version: signing.recordVersion.version, contentHash: signing.recordVersion.contentHash },
              statementVersion: signing.statement.version,
            },
          }),
      }).catch(async (e: unknown) => {
        // The record or the statement moved on: the page reads it again, so the next sheet shows what is current.
        if (e instanceof Refused && (e.kind === 'recordChanged' || e.kind === 'signingRefused')) await onDone();
        throw e;
      });
      sessionStorage.removeItem(slot);
      await onDone();
      return `${step.signs ? `${step.signs} Signature` : ui.label} recorded in the Audit Trail. The Test is now ${words(step.to)}.`;
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
  { key: 'audit-export', name: 'Audit Export', holds: '', takes: 'generateAuditExport' },
  { key: 'workstations', name: 'Workstations', holds: '' },
  { key: 'staff', name: 'Staff', holds: '' },
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
  active: ModuleKey | null;
  action: RailAction | null;
  notice?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="frame">
      <TopBar lab={me.lab}>
        <nav>
          {modules
            .filter((m) => m.key !== 'staff' || staffRefusal(me.roles) === null)
            .filter((m) => !('takes' in m) || mayTake(m.takes, me.roles))
            .map((m) => (
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

export function TopBar({ lab, children }: { lab?: Lab; children?: ReactNode }) {
  return (
    <header className="top">
      <span className="brand">{lab && <b title={lab.name}>{lab.code}</b>}Nitrosamine LIMS</span>
      {children}
      <span className="fict">Fictional data only</span>
    </header>
  );
}

interface Note {
  text: string;
  tone: 'ok' | 'bad';
  n: number;
  /** The action whose answer this is, so opening another action clears it. */
  action?: string;
}
/** The sheet keeps the action it opened for, so its closing frames never show the step that came next. */
type Sheet = { action: RailAction; closing: boolean } | null;

/** Longer than --dur-sheet-out, so the sheet unmounts even when no transitionend fires. */
const EXIT_FALLBACK_MS = 400;

function unansweredText(e: unknown, signs: boolean): string {
  if (!(e instanceof Refused))
    return `The LIMS did not answer. ${signs ? 'Type your password again and sign' : 'Press again'} with the same entries; they will not be saved twice.`;
  if (e.kind === 'failure') return `Not finished: ${e.message}`;
  return `Refused: ${e.message}${signs ? ' Nothing has been signed.' : ''}`;
}

function Rail({ me, action, notice }: { me: ActorContext; action: RailAction | null; notice?: string | undefined }) {
  const [sheet, setSheet] = useState<Sheet>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const [refusal, setRefusal] = useState<Note | null>(null);
  const [instant, setInstant] = useState(false);
  const [locking, setLocking] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
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
    setNote((n) => (n?.action === a.label ? n : null));
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
    setRefusal(null);
    try {
      const text = await a.run(values, a.signs ? { username, password } : null);
      setNote({ text, tone: 'ok', n: ++count.current, action: a.label });
      setUsername('');
      returnFocus.current = true;
      if (sheet) close(true);
    } catch (e) {
      const unanswered: Note = {
        text: unansweredText(e, a.signs !== null),
        tone: 'bad',
        n: ++count.current,
        action: a.label,
      };
      setNote(unanswered);
      if (sheet && e instanceof Refused && (e.kind === 'recordChanged' || e.kind === 'signingRefused')) close(false);
      else if (sheet) setRefusal(unanswered);
    } finally {
      inFlight.current = false;
      setBusy(false);
      setPassword('');
    }
  }

  async function lockAs(mode: LockMode) {
    if (inFlight.current) return;
    inFlight.current = true;
    setLocking(true);
    try {
      await lock(mode);
    } catch (e) {
      setNote({
        text:
          e instanceof Refused
            ? `${e.kind === 'failure' ? 'Not finished' : 'Refused'}: ${e.message}`
            : 'The LIMS did not answer. Press again.',
        tone: 'bad',
        n: ++count.current,
      });
    } finally {
      inFlight.current = false;
      setLocking(false);
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
          aria-hidden={sheet.closing || undefined}
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
                    <h3>Meaning</h3>
                    <div className="meaning">
                      <b>{shown.signs.meaning}</b>
                      <i>{shown.signs.statement.text}</i>
                      <small>Signature statement version {shown.signs.statement.version}</small>
                    </div>
                    <dl className="facts">
                      <dt>Eligibility</dt>
                      <dd>
                        {me.person.displayName} may sign {shown.signs.meaning} as {words(shown.signs.role)} in{' '}
                        {me.lab.name}
                      </dd>
                      <dt>Record Version</dt>
                      <dd>{shown.signs.recordVersion.version}</dd>
                      <dt>SHA-256</dt>
                      <dd>
                        <code className="hash">{shown.signs.recordVersion.contentHash}</code>
                      </dd>
                    </dl>
                    {(shown.fields.length > 0 || shown.signs.what.length > 1) && (
                      <p className="muted">
                        The Signature binds the Record Version this step writes from what is shown and entered.
                      </p>
                    )}
                  </section>
                  <section className="card">
                    <h3>Who is signing</h3>
                    <p className="who__name">{me.person.displayName}</p>
                    <p className="muted">
                      <code>{me.person.username}</code> · {me.roles.map(words).join(', ')} · {me.lab.name}
                    </p>
                    <label>
                      User ID (type it to sign)
                      <input
                        type="text"
                        required
                        autoComplete="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        value={username}
                        aria-invalid={refusal !== null && !username}
                        aria-describedby="sheet-line"
                        onChange={(e) => setUsername(e.target.value)}
                      />
                    </label>
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
      <footer className="rail" data-session-open={sessionOpen || undefined}>
        <button
          type="button"
          className="rail__toggle"
          aria-label={`${me.person.displayName}, your session`}
          aria-describedby="rail-clock"
          aria-expanded={sessionOpen}
          aria-controls={me.workstation ? 'rail-who rail-sign-out' : 'rail-who rail-switch-lab rail-sign-out'}
          onClick={() => setSessionOpen((open) => !open)}
        >
          <span className="rail__name">
            <b>{me.person.displayName}</b>
            <span className="rail__chevron" />
          </span>
          <SessionCountdown id="rail-clock" />
        </button>
        <div id="rail-who" className="who">
          <b>
            <a href="#/preferences" aria-label={`${me.person.displayName}, your preferences`}>
              {me.person.displayName}
            </a>
          </b>
          <span>
            {me.lab.code} · {me.roles.map(words).join(', ')} · <code>{me.person.username}</code>
          </span>
          <span>{me.workstation ? `${me.workstation.name} · ${me.workstation.room}` : 'Unregistered device'}</span>
          <SessionCountdown />
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
        <fieldset id="rail-session" className="rail__session" disabled={busy || locking}>
          {!me.workstation && (
            <button
              type="button"
              id="rail-switch-lab"
              className="rbtn rbtn--quiet rail__out rail__folded"
              onClick={() => {
                location.hash = '#/switch-lab';
              }}
            >
              Switch Lab
            </button>
          )}
          <button type="button" className="rbtn rbtn--quiet rail__out" onClick={() => void lockAs('switch')}>
            Switch user
          </button>
          <button type="button" className="rbtn rbtn--quiet rail__out" onClick={() => void lockAs('unlock')}>
            Lock
          </button>
          <button
            type="button"
            id="rail-sign-out"
            className="rbtn rbtn--quiet rail__out rail__folded"
            onClick={() => void signOut()}
          >
            Sign out
          </button>
        </fieldset>
      </footer>
    </>
  );
}

const twoDigits = (n: number) => String(n).padStart(2, '0');

function SessionCountdown({ id }: { id?: string }) {
  const left = useSecondsLeft();
  if (left === null) return null;
  const [h, m, s] = [Math.floor(left / 3600), Math.floor(left / 60) % 60, left % 60];
  return (
    <span id={id} className="who__clock">
      Session ends in <time>{h > 0 ? `${h}:${twoDigits(m)}:${twoDigits(s)}` : `${m}:${twoDigits(s)}`}</time>
    </span>
  );
}

function FieldInput({ field, value, onChange }: { field: Field; value: string; onChange: (v: string) => void }) {
  const change = (e: { target: { value: string } }) => onChange(e.target.value);
  if (field.kind === 'method' || field.kind === 'analyst')
    return <LookupSelect field={field} value={value} onChange={change} />;
  if (field.kind === 'room') return <RoomSelect value={value} onChange={change} />;
  const props = { required: true, value, onChange: change };
  if (field.kind === 'date') return <input type="date" {...props} />;
  if (field.kind === 'decimal') return <input inputMode="decimal" pattern={decimalPattern} {...props} />;
  return <input {...props} />;
}

function RoomSelect({ value, onChange }: { value: string; onChange: (e: { target: { value: string } }) => void }) {
  const { data } = useApi(routes.workstations);
  return (
    <select required value={value} onChange={onChange}>
      <option value="">Choose…</option>
      {data?.rooms.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name}
        </option>
      ))}
    </select>
  );
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
