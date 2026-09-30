import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { PreparedSigningDto } from '@lims/contract';
import { createApi } from '../api/client';
import { ApiContext } from '../api/hooks';
import type { Receipt } from '../model';
import { SessionContext } from '../session/context';
import type { ActiveSession, SessionStore } from '../session/store';
import { RailContext } from '../shell/rail';
import { useSigning } from './useSigning';

const ZONE = 'America/New_York';
const H1 = '3f9a1c07b2e84d5a9c16f0e27a4b8d3c5e7f1029a6b4c8d0e2f4a6b8c0d2e4f6';
const H2 = 'a41d7e02c9b35f86e17a4c90d2b63f58e0a7c19b4d26f83a5c07e91b2d4f6a8c';

const session: ActiveSession = {
  person: { printedName: 'Bob Reviewer', nativeName: null, username: 'bob', role: 'Analyst, Reviewer' },
  roles: ['Analyst', 'Reviewer'],
  lab: { id: 'lab-1', code: 'RD', zone: ZONE },
  workstation: 'Bench PC 2',
  zone: ZONE,
  signedInAt: { utc: '2026-09-30T14:00:00Z', zone: ZONE },
  idleLockAt: { utc: '2026-09-30T14:15:00Z', zone: ZONE },
  epoch: 's1:0',
  customer: null,
  dataClass: 'fictional',
};

const prepared = (hash: string, versionNo: number, eligible = true): PreparedSigningDto => ({
  meaning: 'Verified',
  statement: 'I checked this entry against its source and it is correct.',
  items: [
    {
      record: 'v-1',
      kind: 'value',
      label: 'Widget W1, prep.weight (P1)',
      version: { versionId: `ver-${versionNo}`, versionNo, hash },
      body: { schema: 'value@1', field: 'prep.weight', subject: 'P1', value: { type: 'decimal', value: versionNo === 1 ? '100.12' : '100.21', unit: 'mg' } },
      pendingChanges: [],
    },
  ],
  attestation: null,
  consequence: 'The values are Verified, and any change waiting on them takes effect.',
  eligibility: {
    byRole: [
      { role: 'Analyst', eligible: eligible, reasons: eligible ? [] : ['You entered Widget W1, prep.weight (P1), so someone else must verify it.'], authorisation: { meaning: 'Performed', scope: 'METHOD-W', validUntil: '2027-01-01' } },
      { role: 'Reviewer', eligible: false, reasons: ['No Reviewed Authorisation for METHOD-W.'], authorisation: null },
    ],
    attemptsLeft: 5,
  },
});

type Sent = { name: string; commitKey: string; input: Record<string, unknown> };

function server(answers: Record<string, ((input: Record<string, unknown>) => [number, unknown])[]>) {
  const sent: Sent[] = [];
  const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const name = String(url).replace('/api/commands/', '');
    const body = JSON.parse(String(init?.body)) as { commitKey: string; input: Record<string, unknown> };
    sent.push({ name, ...body });
    const next = answers[name]?.shift();
    const [status, json] = next ? next(body.input) : [500, {}];
    return new Response(JSON.stringify(json), { status });
  });
  return { sent, fetch: fetch as unknown as typeof globalThis.fetch };
}

const receipt = (data: unknown, act = 'audited') => [200, { kind: 'receipt', summary: act === 'signed' ? 'Signed Verified: 1 record.' : 'Ready to sign.', at: '2026-09-30T14:40:00.000Z', act, data }] as [number, unknown];
const refusal = (status: number, r: object) => [status, { kind: 'refusal', refusal: r }] as [number, unknown];

function Screen({ onSigned }: { onSigned: () => void }) {
  const signing = useSigning();
  return (
    <>
      <button type="button" onClick={() => void signing.open({ meaning: 'Verified', targets: ['v-1'], attestation: null, actionLabel: 'Sign prep.weight (P1) as Verified', onSigned })}>
        Open
      </button>
      {signing.refusal && <p>{signing.refusal}</p>}
      {signing.sheet}
    </>
  );
}

function mount(s: ReturnType<typeof server>) {
  const receipts: Receipt[] = [];
  const onSigned = vi.fn();
  const wrap = (children: ReactNode) => (
    <ApiContext value={createApi({ fetch: s.fetch, onSessionLost: () => {} })}>
      <SessionContext value={{ active: session, store: { skewMs: () => 0 } as unknown as SessionStore }}>
        <RailContext value={{ setSlot: () => {}, clear: () => {}, showReceipt: (r) => receipts.push(r) }}>{children}</RailContext>
      </SessionContext>
    </ApiContext>
  );
  render(wrap(<Screen onSigned={onSigned} />));
  return { receipts, onSigned, user: userEvent.setup() };
}

async function typeCredentials(user: ReturnType<typeof userEvent.setup>, code = '123456') {
  const sheet = screen.getByRole('dialog');
  await user.clear(within(sheet).getByLabelText('User ID'));
  await user.type(within(sheet).getByLabelText('User ID'), 'bob');
  await user.type(within(sheet).getByLabelText('Password'), 'Bench-password-1!');
  const pad = within(sheet).getByRole('group', { name: 'Code keypad' });
  for (const d of code) await user.click(within(pad).getByRole('button', { name: d }));
}

const signButton = () => screen.getByRole('button', { name: /Sign prep.weight \(P1\) as Verified/ });

describe('useSigning', () => {
  it('prepares under a role the person holds, then shows what is signed and the eligibility before any credential', async () => {
    const s = server({ 'signing.prepare': [() => receipt(prepared(H1, 1))] });
    const { user } = mount(s);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    const sheet = await screen.findByRole('dialog');
    expect(s.sent[0]).toMatchObject({ name: 'signing.prepare', input: { meaning: 'Verified', role: 'Analyst', targets: ['v-1'], attestation: null } });
    const what = within(sheet).getByRole('region', { name: 'What you are signing' });
    expect(within(what).getByText('Widget W1, prep.weight (P1)')).toBeInTheDocument();
    expect(within(what).getByText('1')).toBeInTheDocument();
    expect(within(what).getByText('3f9a1c07').parentElement?.textContent).toBe(H1);
    expect(within(what).getByText('100.12 mg')).toBeInTheDocument();
    expect(within(sheet).getByText('Performed for METHOD-W, valid until 2027-01-01')).toBeInTheDocument();
    expect(within(sheet).getByText('The values are Verified, and any change waiting on them takes effect.')).toBeInTheDocument();
    expect(within(sheet).getByText(/Analyst, Bench PC 2/)).toBeInTheDocument();
  });

  it('refuses before credentials when the server says the signer is not eligible', async () => {
    const s = server({ 'signing.prepare': [() => receipt(prepared(H1, 1, false))] });
    const { user } = mount(s);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByRole('alert')).toHaveTextContent('You entered Widget W1, prep.weight (P1), so someone else must verify it.');
    expect(within(sheet).queryByLabelText('Password')).toBeNull();
  });

  it('signs exactly the versions it showed, then closes and puts the server\'s receipt in the rail', async () => {
    const s = server({
      'signing.prepare': [() => receipt(prepared(H1, 1))],
      'signing.sign': [() => receipt({ signatures: [] }, 'signed')],
    });
    const { user, receipts, onSigned } = mount(s);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await screen.findByRole('dialog');
    await typeCredentials(user);
    await user.click(signButton());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(s.sent[1]).toMatchObject({
      name: 'signing.sign',
      input: { meaning: 'Verified', role: 'Analyst', targets: [{ versionId: 'ver-1', hash: H1 }], attestation: null, credentials: { typedUserId: 'bob', password: 'Bench-password-1!', totp: '123456' } },
    });
    expect(receipts).toEqual([{ summary: 'Signed Verified: 1 record.', at: { utc: '2026-09-30T14:40:00.000Z', zone: ZONE }, kind: 'signed' }]);
    expect(onSigned).toHaveBeenCalledTimes(1);
  });

  it('prints a refusal with the attempts left, and the next attempt carries a new key', async () => {
    const s = server({
      'signing.prepare': [() => receipt(prepared(H1, 1))],
      'signing.sign': [
        () => refusal(401, { kind: 'credentials', attemptsLeft: 3, message: 'The user ID, password or code is wrong.' }),
        () => refusal(409, { kind: 'totp-already-used', message: 'Wait for the next code.' }),
      ],
    });
    const { user } = mount(s);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await screen.findByRole('dialog');
    await typeCredentials(user);
    await user.click(signButton());
    expect(await screen.findByText('The user ID, password or code is wrong. Nothing has been signed.')).toBeInTheDocument();
    expect(screen.getByText('3 attempts left before this account locks.')).toBeInTheDocument();
    await typeCredentials(user, '654321');
    await user.click(signButton());
    expect(await screen.findByText('Wait for the next code. Nothing has been signed.')).toBeInTheDocument();
    const [a, b] = s.sent.filter((x) => x.name === 'signing.sign').map((x) => x.commitKey);
    expect(a).not.toBe(b);
  });

  it('on stale-version shows the version to sign now and signs nothing until pressed again', async () => {
    const s = server({
      'signing.prepare': [() => receipt(prepared(H1, 1)), () => receipt(prepared(H2, 2))],
      'signing.sign': [() => refusal(409, { kind: 'stale-version', message: 'Widget W1, prep.weight (P1) changed after it was shown.' })],
    });
    const { user } = mount(s);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await screen.findByRole('dialog');
    await typeCredentials(user);
    await user.click(signButton());
    expect(await screen.findByText(/changed after it was shown\. The prompt now shows the version to sign\. Nothing has been signed\./)).toBeInTheDocument();
    const what = screen.getByRole('region', { name: 'What you are signing' });
    expect(within(what).getByText('a41d7e02').parentElement?.textContent).toBe(H2);
    expect(within(what).getByText('100.21 mg')).toBeInTheDocument();
    expect(s.sent.map((x) => x.name)).toEqual(['signing.prepare', 'signing.sign', 'signing.prepare']);
  });
});
