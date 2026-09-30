import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { SessionAnswer } from '@lims/contract/session';
import { createApi } from '../api/client';
import { ApiContext, useApi, useCommand } from '../api/hooks';
import { SessionGate } from './SessionGate';
import { useSession } from './context';
import { createSessionStore, type SessionBus } from './store';

const ZONE = 'America/New_York';

const active = (username: string, epoch: string, idleLockAt = new Date(Date.now() + 10 * 60_000).toISOString()): SessionAnswer => ({
  state: 'active',
  dataClass: 'fictional',
  person: { printedName: username === 'ann' ? 'Ann Analyst' : 'Bob Reviewer', nativeName: null, username },
  lab: { id: 'lab-1', code: 'RD', zone: ZONE },
  customer: null,
  roles: ['Analyst'],
  workstation: 'Bench PC 2',
  startedAt: '2026-09-30T14:00:00.000Z',
  idleLockAt,
  absoluteEndAt: '2026-10-01T02:00:00.000Z',
  epoch,
});

const locked = (reason: 'manual' | 'switch-user' | 'idle' = 'manual'): SessionAnswer => ({
  state: 'locked',
  dataClass: 'fictional',
  owner: { printedName: 'Ann Analyst', username: 'ann', nativeName: null, roles: ['Analyst'] },
  lockReason: reason,
  lockedAt: '2026-09-30T14:30:00.000Z',
  zone: ZONE,
  workstation: 'Bench PC 2',
});

type Request = { method: string; path: string; body: { commitKey: string; input: Record<string, unknown> } | null };

/**
 * A stand-in server: the session answer is whatever the test last set, and each command answers
 * from `commands` and may move the session. It records every request.
 */
function fakeServer(initial: SessionAnswer) {
  let session = initial;
  let afterRead: SessionAnswer | null = null;
  const requests: Request[] = [];
  const commands: Record<string, (input: Record<string, unknown>) => { status: number; body: unknown; then?: SessionAnswer }> = {};
  const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    const body = init?.body ? (JSON.parse(String(init.body)) as Request['body']) : null;
    requests.push({ method: init?.method ?? 'GET', path, body });
    const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json', date: new Date().toUTCString() } });
    if (path === '/api/session') {
      const answer = json(200, session);
      if (afterRead) [session, afterRead] = [afterRead, null];
      return answer;
    }
    if (path === '/api/session/activity') return new Response(null, { status: session.state === 'active' ? 204 : 423 });
    if (path.startsWith('/api/views/')) {
      if (session.state === 'locked') return json(423, { kind: 'refusal', refusal: { kind: 'session', state: 'locked', message: 'Locked.' } });
      if (session.state === 'none') return json(401, { kind: 'refusal', refusal: { kind: 'session', state: 'none', message: 'Sign in.' } });
      return json(200, { note: `record for ${session.person.username}` });
    }
    const name = path.replace('/api/commands/', '');
    const handler = commands[name];
    if (!handler) return json(404, { kind: 'refusal', refusal: { kind: 'unknown-command', message: name } });
    const out = handler(body?.input ?? {});
    if (out.then) session = out.then;
    return json(out.status, out.body);
  });
  return {
    fetch: fetch as unknown as typeof globalThis.fetch,
    requests,
    commands,
    set: (s: SessionAnswer) => (session = s),
    /** The session changes on the server right after the next GET /api/session answers. */
    afterSessionRead: (s: SessionAnswer) => (afterRead = s),
  };
}

const ok = (summary: string, then?: SessionAnswer) => ({ status: 200, body: { kind: 'receipt', summary, at: '2026-09-30T14:40:00.000Z', act: 'audited', data: null }, ...(then ? { then } : {}) });

/** Two tabs of one browser share this. */
function bus(): SessionBus & { tabs: Set<() => void> } {
  const tabs = new Set<() => void>();
  return {
    tabs,
    post: () => {
      for (const t of tabs) t();
    },
    listen: (f) => {
      tabs.add(f);
      return () => tabs.delete(f);
    },
  };
}

/** A record screen: it reads a View on mount and offers Lock, the way every routed screen does. */
function RecordScreen() {
  const api = useApi();
  const { store, active: session } = useSession();
  const lock = useCommand('session.lock');
  const switchUser = useCommand('session.switchUser');
  const [note, setNote] = useState('reading');
  useEffect(() => {
    void api.view<{ note: string }>('record.audit', { recordId: 'r1' }).then((r) => setNote(r.kind === 'ok' ? r.data.note : r.kind));
  }, [api]);
  return (
    <section aria-label="Record">
      <p>{note}</p>
      <p>Signed in as {session.person.username}</p>
      <button type="button" onClick={async () => (await lock.run({})).kind === 'receipt' && (await store.changed())}>
        Lock
      </button>
      <button type="button" onClick={async () => (await switchUser.run({})).kind === 'receipt' && (await store.changed())}>
        Switch user
      </button>
    </section>
  );
}

function mount(server: ReturnType<typeof fakeServer>, destination: string | null = null, shared = bus()) {
  let store: ReturnType<typeof createSessionStore> | null = null;
  const api = createApi({ fetch: server.fetch, onSessionLost: () => void store?.refresh() });
  store = createSessionStore(api, shared);
  const view = render(
    <ApiContext value={api}>
      <SessionGate store={store} destination={destination}>
        <RecordScreen />
      </SessionGate>
    </ApiContext>,
  );
  return { store, view, user: userEvent.setup() };
}

async function typeCredentials(user: ReturnType<typeof userEvent.setup>, userId: string) {
  await user.type(screen.getByLabelText('User ID'), userId);
  await user.type(screen.getByLabelText('Password'), 'Bench-password-1!');
  const pad = screen.getByRole('group', { name: 'Code keypad' });
  for (const d of '123456') await user.click(within(pad).getByRole('button', { name: d }));
}

describe('SessionGate', () => {
  it('asks the server before anything renders, and shows no record until it answers', async () => {
    const server = fakeServer({ state: 'none', dataClass: 'fictional' });
    mount(server);
    expect(screen.getByText('Checking the session')).toBeInTheDocument();
    expect(server.requests[0]).toMatchObject({ method: 'GET', path: '/api/session' });
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Record' })).toBeNull();
    expect(server.requests.filter((r) => r.path.startsWith('/api/views/'))).toEqual([]);
  });

  it('opens a deep link only after sign-in, with the typed credentials and this PC\'s name', async () => {
    const server = fakeServer({ state: 'none', dataClass: 'fictional' });
    server.commands['session.login'] = () => ok('Signed in as Ann Analyst.', active('ann', 's1:0'));
    const { user } = mount(server, 'Deviations');
    expect(await screen.findByText('After you sign in, Deviations opens.')).toBeInTheDocument();
    await typeCredentials(user, 'ann');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('record for ann')).toBeInTheDocument();
    const login = server.requests.find((r) => r.path === '/api/commands/session.login');
    expect(login?.body?.input).toEqual({ typedUserId: 'ann', password: 'Bench-password-1!', totp: '123456', workstation: 'Unnamed workstation' });
  });

  it('prints a refused sign-in with the server\'s words, and the next attempt carries a new key', async () => {
    const server = fakeServer({ state: 'none', dataClass: 'fictional' });
    server.commands['session.login'] = () => ({ status: 401, body: { kind: 'refusal', refusal: { kind: 'credentials', attemptsLeft: 4, message: 'The user ID, password or code is wrong. 4 attempts left.' } } });
    const { user } = mount(server);
    await screen.findByRole('heading', { name: 'Sign in' });
    await typeCredentials(user, 'ann');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The user ID, password or code is wrong. 4 attempts left.');
    expect(screen.getByLabelText('User ID')).toHaveValue('ann');
    expect(screen.getByLabelText('Password')).toHaveValue('');
    await user.type(screen.getByLabelText('Password'), 'Bench-password-2!');
    const pad = screen.getByRole('group', { name: 'Code keypad' });
    for (const d of '654321') await user.click(within(pad).getByRole('button', { name: d }));
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(server.requests.filter((r) => r.path === '/api/commands/session.login')).toHaveLength(2));
    const [a, b] = server.requests.filter((r) => r.path === '/api/commands/session.login').map((r) => r.body?.commitKey);
    expect(a).not.toBe(b);
  });

  it('on lock, unmounts the record and drops what it read; unlock remounts it and reads again', async () => {
    const server = fakeServer(active('ann', 's1:0'));
    server.commands['session.lock'] = () => ok('Locked.', locked('manual'));
    server.commands['session.unlock'] = () => ok('Unlocked.', active('ann', 's1:1'));
    const { user } = mount(server);
    expect(await screen.findByText('record for ann')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Lock' }));
    expect(await screen.findByRole('heading', { name: 'Locked' })).toBeInTheDocument();
    expect(screen.queryByText('record for ann')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Record' })).toBeNull();
    expect(screen.getByText(/Ann Analyst locked this PC at 10:30 EDT/)).toBeInTheDocument();
    await typeCredentials(user, 'ann');
    await user.click(screen.getByRole('button', { name: 'Unlock as Ann Analyst' }));
    expect(await screen.findByText('record for ann')).toBeInTheDocument();
    expect(server.requests.filter((r) => r.path.startsWith('/api/views/'))).toHaveLength(2);
    expect(server.requests.find((r) => r.path === '/api/commands/session.unlock')?.body?.input).toEqual({ typedUserId: 'ann', password: 'Bench-password-1!', totp: '123456' });
  });

  it('shows the lock screen when any request answers that the session is locked', async () => {
    const server = fakeServer(active('ann', 's1:0'));
    server.afterSessionRead(locked('idle'));
    mount(server);
    expect(await screen.findByRole('heading', { name: 'Locked' })).toBeInTheDocument();
    expect(server.requests.map((r) => r.path)).toEqual(['/api/session', '/api/views/record.audit?recordId=r1', '/api/session']);
    expect(screen.queryByText('record for ann')).toBeNull();
  });

  it('remounts the screens with nothing carried over when another person\'s session replaces this one', async () => {
    const shared = bus();
    const server = fakeServer(active('ann', 's1:0'));
    mount(server, null, shared);
    expect(await screen.findByText('record for ann')).toBeInTheDocument();
    server.set(active('bob', 's2:0'));
    await act(async () => shared.post());
    expect(await screen.findByText('record for bob')).toBeInTheDocument();
    expect(screen.queryByText('record for ann')).toBeNull();
  });

  it('switch user locks at once, and a takeover by the next person replaces the session in every tab', async () => {
    const shared = bus();
    const server = fakeServer(active('ann', 's1:0'));
    server.commands['session.switchUser'] = () => ok('Locked for the next person.', locked('switch-user'));
    server.commands['session.takeover'] = () => ok('Signed in as Bob Reviewer; the previous session has ended.', active('bob', 's2:0'));
    const tab1 = mount(server, null, shared);
    let otherTabAsked = 0;
    shared.listen(() => otherTabAsked++);
    expect(await screen.findByText('record for ann')).toBeInTheDocument();
    await tab1.user.click(screen.getByRole('button', { name: 'Switch user' }));
    expect(await screen.findByText(/Ann Analyst handed this PC over/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Someone else/ })).toHaveAttribute('aria-checked', 'true');
    await typeCredentials(tab1.user, 'bob');
    await tab1.user.click(screen.getByRole('button', { name: "Sign in and end Ann Analyst's session" }));
    expect(await screen.findByText('Signed in as bob')).toBeInTheDocument();
    expect(server.requests.find((r) => r.path === '/api/commands/session.takeover')?.body?.input).toMatchObject({ typedUserId: 'bob' });
    expect(otherTabAsked, 'switch user and the takeover each told the other tabs').toBe(2);
  });

  it('a message from another tab makes this tab ask the server again', async () => {
    const shared = bus();
    const server = fakeServer(active('ann', 's1:0'));
    mount(server, null, shared);
    expect(await screen.findByText('record for ann')).toBeInTheDocument();
    server.set(locked('manual'));
    await act(async () => shared.post());
    expect(await screen.findByRole('heading', { name: 'Locked' })).toBeInTheDocument();
  });

  it('locks at the server\'s idle deadline without waiting for a request', async () => {
    const soon = new Date(Date.now() - 1_000).toISOString();
    const server = fakeServer(active('ann', 's1:0', soon));
    mount(server);
    await screen.findByText('record for ann');
    server.set(locked('idle'));
    expect(await screen.findByRole('heading', { name: 'Locked' }, { timeout: 4_000 })).toBeInTheDocument();
    expect(screen.getByText(/locked itself/)).toBeInTheDocument();
  });

  it('posts activity on real input at most once a minute, and never for a background read', async () => {
    const server = fakeServer(active('ann', 's1:0'));
    const { user } = mount(server);
    await screen.findByText('record for ann');
    expect(server.requests.filter((r) => r.path === '/api/session/activity')).toHaveLength(0);
    await user.click(screen.getByText('record for ann'));
    await user.keyboard('a');
    await user.click(screen.getByText('record for ann'));
    await waitFor(() => expect(server.requests.filter((r) => r.path === '/api/session/activity')).toHaveLength(1));
  });
});
