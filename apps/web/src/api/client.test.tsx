import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createApi } from './client';
import { ApiContext, useCommand, useView } from './hooks';

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

/** A fetch that records each request and answers from a queue of [status, body] pairs. */
function server(...answers: [number, unknown][]) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    const [status, body] = answers.shift() ?? [500, {}];
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  });
  return { calls, fetch: fetch as unknown as typeof globalThis.fetch };
}

const receipt = (summary: string) => [200, { kind: 'receipt', summary, at: '2026-09-30T14:40:00.000Z', act: 'audited', data: null }] as [number, unknown];
const refusal = (status: number, r: object) => [status, { kind: 'refusal', refusal: r }] as [number, unknown];

describe('createApi', () => {
  it('sends a command as POST with the command header, its commit key and input', async () => {
    const s = server(receipt('Locked.'));
    const api = createApi({ fetch: s.fetch, onSessionLost: () => {} });
    const out = await api.command('session.lock', {}, 'k-1' as never);
    expect(s.calls).toEqual([{ url: '/api/commands/session.lock', method: 'POST', headers: { 'content-type': 'application/json', 'x-lims-command': '1' }, body: { commitKey: 'k-1', input: {} } }]);
    expect(out).toMatchObject({ kind: 'receipt', summary: 'Locked.', at: '2026-09-30T14:40:00.000Z', replayed: false });
  });

  it('reports a locked or ended session from any answer, and nothing else', async () => {
    const lost = vi.fn();
    const s = server(
      refusal(423, { kind: 'session', state: 'locked', message: 'Locked.' }),
      refusal(401, { kind: 'session', state: 'ended', message: 'Ended.' }),
      refusal(401, { kind: 'credentials', attemptsLeft: 3, message: 'The user ID, password or code is wrong.' }),
      refusal(423, { kind: 'locked-out', message: 'Locked out.' }),
    );
    const api = createApi({ fetch: s.fetch, onSessionLost: lost });
    await api.view('record.audit', { recordId: 'r' });
    expect(lost).toHaveBeenCalledTimes(1);
    await api.command('value.record', {}, 'k' as never);
    expect(lost).toHaveBeenCalledTimes(2);
    const wrong = await api.command('session.unlock', {}, 'k2' as never);
    const lockedOut = await api.command('signing.sign', {}, 'k3' as never);
    expect(lost, 'a refused credential is the sheet\'s answer, not a lost session').toHaveBeenCalledTimes(2);
    expect(wrong).toEqual({ kind: 'refusal', refusal: { kind: 'credentials', attemptsLeft: 3, message: 'The user ID, password or code is wrong.' } });
    expect(lockedOut).toMatchObject({ kind: 'refusal', refusal: { kind: 'locked-out' } });
  });

  it('says a command is unconfirmed when no answer arrives', async () => {
    const api = createApi({ fetch: (async () => { throw new TypeError('network'); }) as never, onSessionLost: () => {} });
    expect((await api.command('session.lock', {}, 'k' as never)).kind).toBe('unreachable');
  });

  it('reads the view by name with its query as a GET', async () => {
    const s = server([200, { entries: [] }]);
    const api = createApi({ fetch: s.fetch, onSessionLost: () => {} });
    expect(await api.view('record.audit', { recordId: 'abc' })).toEqual({ kind: 'ok', data: { entries: [] } });
    expect(s.calls[0]).toMatchObject({ url: '/api/views/record.audit?recordId=abc', method: 'GET' });
  });
});

function Lock() {
  const lock = useCommand<Record<string, never>>('session.lock');
  return (
    <button type="button" onClick={() => void lock.run({})}>
      Lock {lock.key}
    </button>
  );
}

describe('useCommand', () => {
  it('carries one commit key per attempt and a new one after each answer', async () => {
    const s = server(refusal(409, { kind: 'transition', message: 'No.' }), receipt('Locked.'));
    render(
      <ApiContext value={createApi({ fetch: s.fetch, onSessionLost: () => {} })}>
        <Lock />
      </ApiContext>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button'));
    await user.click(screen.getByRole('button'));
    const [first, second] = s.calls.map((c) => (c.body as { commitKey: string }).commitKey);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).not.toBe(first);
  });
});

function Trail({ recordId }: { recordId: string }) {
  const v = useView<{ entries: string[] }>('record.audit', { recordId });
  return <p>{v.status === 'ok' ? v.data.entries.join(',') : v.status}</p>;
}

describe('useView', () => {
  it('reads on mount and again when its query changes, and never sends a command', async () => {
    const s = server([200, { entries: ['a'] }], [200, { entries: ['b'] }]);
    const api = createApi({ fetch: s.fetch, onSessionLost: () => {} });
    const view = render(
      <ApiContext value={api}>
        <Trail recordId="r1" />
      </ApiContext>,
    );
    expect(await screen.findByText('a')).toBeInTheDocument();
    await act(async () =>
      view.rerender(
        <ApiContext value={api}>
          <Trail recordId="r2" />
        </ApiContext>,
      ),
    );
    expect(await screen.findByText('b')).toBeInTheDocument();
    expect(s.calls.map((c) => `${c.method} ${c.url}`)).toEqual(['GET /api/views/record.audit?recordId=r1', 'GET /api/views/record.audit?recordId=r2']);
  });

  it('keeps showing what it read while a reload of the same query is on its way, so nothing on the screen remounts', async () => {
    let release: (r: Response) => void = () => {};
    const answers = [
      Promise.resolve(new Response(JSON.stringify({ entries: ['a'] }), { status: 200 })),
      new Promise<Response>((r) => (release = r)),
    ];
    const fetch = vi.fn(async () => answers.shift() as Promise<Response>);
    const api = createApi({ fetch: fetch as never, onSessionLost: () => {} });
    let reload: () => void = () => {};
    function Reloading() {
      const v = useView<{ entries: string[] }>('record.audit', { recordId: 'r1' });
      reload = v.reload;
      return <p>{v.status === 'ok' ? v.data.entries.join(',') : v.status}</p>;
    }
    render(
      <ApiContext value={api}>
        <Reloading />
      </ApiContext>,
    );
    expect(await screen.findByText('a')).toBeInTheDocument();
    act(() => reload());
    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.queryByText('loading')).toBeNull();
    await act(async () => release(new Response(JSON.stringify({ entries: ['b'] }), { status: 200 })));
    expect(await screen.findByText('b')).toBeInTheDocument();
  });
});
