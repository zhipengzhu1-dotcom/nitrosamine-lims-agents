import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { DataClass } from '@lims/contract';
import type { CommandOutcome } from '../api/client';
import { useApi, useCommand } from '../api/hooks';
import { LockScreen, SignIn } from '../components/LockScreen';
import type { CommitKey, CommitOutcome, Credentials } from '../model';
import { SessionContext, useAttemptKey, useServerNow, wireCredentials, workstationName } from './context';
import { browserZone, type LockedSession, type SessionStore } from './store';
import './session.css';

/** Input from a person, which is what keeps a session from idling (sessions.md). */
const ACTIVITY_EVENTS = ['pointerdown', 'keydown'] as const;
const ACTIVITY_EVERY_MS = 60_000;
/** The server locks at the deadline by its own clock; the tab looks a little after, so both agree. */
const IDLE_GRACE_MS = 2_000;
const IDLE_RECHECK_MS = 5_000;

/**
 * Every page load asks the server first (rule 1). Until it answers, nothing record-shaped renders;
 * then the answer alone picks sign-in, the lock screen or the routed screens, keyed on the
 * session's epoch so an unlock or a new person remounts them with nothing carried over.
 */
export function SessionGate(props: { store: SessionStore; destination: string | null; children: ReactNode }) {
  const { store } = props;
  const phase = useSyncExternalStore(store.subscribe, store.get);

  useEffect(() => {
    void store.refresh();
  }, [store]);

  switch (phase.phase) {
    case 'asking':
      return <GateMessage title="Checking the session" text="Asking the server who is signed in on this PC." />;
    case 'unreachable':
      return (
        <GateMessage title="The server did not answer" text={phase.message}>
          <button type="button" className="rbtn rbtn--primary" onClick={() => void store.refresh()}>
            Ask again
          </button>
        </GateMessage>
      );
    case 'none':
      return <SignInGate store={store} destination={props.destination} dataClass={phase.dataClass} />;
    case 'locked':
      return <LockGate store={store} locked={phase.locked} />;
    case 'active':
      return (
        <SessionContext value={{ active: phase.active, store }}>
          <ActivityReporter store={store} />
          <IdleLock store={store} deadline={phase.active.idleLockAt.utc} />
          <Fragment key={phase.active.epoch}>{props.children}</Fragment>
        </SessionContext>
      );
  }
}

function GateMessage(props: { title: string; text: string; children?: ReactNode }) {
  return (
    <main className="gate" aria-busy={props.children ? undefined : true}>
      <h1 className="h-screen">{props.title}</h1>
      <p>{props.text}</p>
      {props.children}
    </main>
  );
}

/** Maps a session command's answer onto what the credential form shows. */
function answered(out: CommandOutcome<unknown>, setRefusal: (r: string | null) => void): CommitOutcome {
  if (out.kind === 'receipt') {
    setRefusal(null);
    return 'done';
  }
  setRefusal(out.kind === 'refusal' ? out.refusal.message : out.message);
  return 'refused';
}

function SignInGate(props: { store: SessionStore; destination: string | null; dataClass: DataClass }) {
  const login = useCommand('session.login');
  const attempt = useAttemptKey();
  const [refusal, setRefusal] = useState<string | null>(null);
  const workstation = workstationName();
  const now = useServerNow(props.store.skewMs(), browserZone());

  const signIn = async (credentials: Credentials, key: CommitKey) => {
    const out = await login.run({ ...wireCredentials(credentials), workstation }, key);
    attempt.next();
    const result = answered(out, setRefusal);
    if (result === 'done') await props.store.changed();
    return result;
  };

  return (
    <SignIn
      workstation={{ name: workstation, room: null }}
      now={now}
      destination={props.destination}
      dataClass={props.dataClass}
      refusal={refusal}
      passkeyAllowed={false}
      commitKey={attempt.key}
      onSignIn={signIn}
    />
  );
}

function LockGate(props: { store: SessionStore; locked: LockedSession }) {
  const unlock = useCommand('session.unlock');
  const takeover = useCommand('session.takeover');
  const attempt = useAttemptKey();
  const [refusal, setRefusal] = useState<string | null>(null);
  const now = useServerNow(props.store.skewMs(), props.locked.zone);

  const submit = (command: typeof unlock) => async (credentials: Credentials, key: CommitKey) => {
    const out = await command.run(wireCredentials(credentials), key);
    attempt.next();
    const result = answered(out, setRefusal);
    if (result === 'done') await props.store.changed();
    return result;
  };

  return (
    <LockScreen
      workstation={{ name: props.locked.workstation, room: null }}
      now={now}
      owner={props.locked.owner}
      reason={props.locked.reason}
      lockedAt={props.locked.lockedAt}
      dataClass={props.locked.dataClass}
      refusal={refusal}
      passkeyAllowed={false}
      commitKey={attempt.key}
      onUnlock={submit(unlock)}
      onTakeover={submit(takeover)}
    />
  );
}

/**
 * Posts "the person is here" on real input, at most once a minute, then asks for the new idle
 * deadline. Background reads never count (sessions.md), so a screen left open still locks.
 */
function ActivityReporter({ store }: { store: SessionStore }) {
  const api = useApi();
  const last = useRef(0);
  useEffect(() => {
    const onInput = () => {
      const now = Date.now();
      if (now - last.current < ACTIVITY_EVERY_MS) return;
      last.current = now;
      void api.activity().then(() => store.refresh());
    };
    for (const e of ACTIVITY_EVENTS) window.addEventListener(e, onInput, { capture: true, passive: true });
    return () => {
      for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, onInput, { capture: true });
    };
  }, [api, store]);
  return null;
}

/** Shows the lock screen when the server's idle deadline passes, without waiting for a request. */
function IdleLock({ store, deadline }: { store: SessionStore; deadline: string }) {
  useEffect(() => {
    const due = Date.parse(deadline) - store.skewMs() + IDLE_GRACE_MS - Date.now();
    // The server said active after this deadline already fired once: its clock is behind ours.
    const wait = store.idleFiredFor() === deadline ? Math.max(due, IDLE_RECHECK_MS) : Math.max(due, 0);
    const t = setTimeout(() => store.idleDeadlinePassed(), wait);
    return () => clearTimeout(t);
  }, [store, deadline]);
  return null;
}
