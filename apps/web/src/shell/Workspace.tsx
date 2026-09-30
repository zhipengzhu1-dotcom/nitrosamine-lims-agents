import { useCallback, useMemo, useState } from 'react';
import { useCommand } from '../api/hooks';
import { AppShell, TopBar } from '../components/AppShell';
import { Rail } from '../components/Rail';
import type { Receipt as ReceiptFact } from '../model';
import { useServerNow, useSession } from '../session/context';
import type { ActiveSession } from '../session/store';
import { RailContext, type RailSlot } from './rail';
import { homeFor, resolve, routes, type Audience, type Route } from './routes';

const audienceOf = (s: ActiveSession): Audience | null => (s.lab ? 'staff' : s.roles.includes('Admin') ? 'admin' : null);

/** The routed screen for this path and audience; the Admin's "/" is the People screen. */
function screenFor(path: string, audience: Audience): Route | 'wrong-audience' | null {
  const route = resolve(path === '/' ? homeFor(audience) : path);
  if (!route) return null;
  return route.audience === audience ? route : 'wrong-audience';
}

/**
 * The signed-in frame: the header names the PC, the reading plane holds the routed screen, and the
 * rail names the person from the server's session, counts down the idle lock in its last minute,
 * and answers each commit with the server's receipt.
 */
export function Workspace({ path }: { path: string }) {
  const { active, store } = useSession();
  const now = useServerNow(store.skewMs(), active.zone);
  const lock = useCommand<Record<string, never>>('session.lock');
  const switchUser = useCommand<Record<string, never>>('session.switchUser');
  const [slot, setSlot] = useState<RailSlot>({ context: null, primary: null });
  const [receipt, setReceipt] = useState<ReceiptFact | null>(null);
  const clear = useCallback(() => {
    setSlot({ context: null, primary: null });
    setReceipt(null);
  }, []);
  const rail = useMemo(() => ({ setSlot, clear, showReceipt: setReceipt }), [clear]);

  const audience = audienceOf(active);
  const screen = audience ? screenFor(path, audience) : null;
  // The clock ticks every second; the routed screen should not re-render with it.
  const content = useMemo(() => (screen && screen !== 'wrong-audience' ? screen.render() : null), [screen]);
  const secondsLeft = Math.ceil((Date.parse(active.idleLockAt.utc) - Date.parse(now.utc)) / 1000);

  const sessionAct = (command: typeof lock) => async () => {
    if (command.busy) return;
    const out = await command.run({});
    if (out.kind === 'receipt' || (out.kind === 'refusal' && out.refusal.kind === 'session')) await store.changed();
  };

  const nav = audience
    ? routes()
        .filter((r) => r.nav && r.audience === audience)
        .map((r) => ({ label: r.title, href: r.path, current: screen !== 'wrong-audience' && screen?.path === r.path }))
    : [];

  return (
    <RailContext value={rail}>
      <AppShell
        top={<TopBar workstation={{ name: active.workstation, room: null }} now={now} nav={nav} />}
        rail={
          <Rail
            identity={{ person: active.person, signedInAt: active.signedInAt, idleLockAt: active.idleLockAt, idleSecondsLeft: secondsLeft <= 60 ? Math.max(secondsLeft, 0) : null }}
            context={slot.context}
            receipt={receipt}
            primary={slot.primary}
            onSwitchUser={sessionAct(switchUser)}
            onLock={sessionAct(lock)}
          />
        }
      >
        {audience === null ? (
          <Notice title="No screen for this account yet" text="The Customer portal is not built in the skeleton." />
        ) : screen === null ? (
          <Notice title="No such screen" text={`Nothing lives at ${path}.`} />
        ) : screen === 'wrong-audience' ? (
          <Notice title="Not for this account" text={audience === 'admin' ? 'The Admin acts for the company and does not read Lab screens.' : 'This screen is for the Admin.'} />
        ) : (
          content
        )}
      </AppShell>
    </RailContext>
  );
}

function Notice(props: { title: string; text: string }) {
  return (
    <section className="notice">
      <h1 className="h-screen">{props.title}</h1>
      <p>{props.text}</p>
    </section>
  );
}
