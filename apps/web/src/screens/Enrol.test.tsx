import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createApi } from '../api/client';
import { ApiContext } from '../api/hooks';
import { Enrol } from './Enrol';

const TOKEN = 'tok_0123456789abcdefghij';
const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

function mount(answers: [number, unknown][]) {
  const sent: { name: string; input: Record<string, unknown> }[] = [];
  const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ name: String(url).replace('/api/commands/', ''), input: (JSON.parse(String(init?.body)) as { input: Record<string, unknown> }).input });
    const [status, body] = answers.shift() ?? [500, {}];
    return new Response(JSON.stringify(body), { status });
  });
  render(
    <ApiContext value={createApi({ fetch: fetch as never, onSessionLost: () => {} })}>
      <Enrol hash={`#${TOKEN}`} />
    </ApiContext>,
  );
  return { sent, user: userEvent.setup() };
}

const ok = (summary: string, data: unknown, once?: unknown) => [200, { kind: 'receipt', summary, at: '2026-09-30T14:40:00.000Z', act: 'audited', data, ...(once ? { once } : {}) }] as [number, unknown];

describe('Enrol', () => {
  it('shows the QR code drawn from the otpauth URI, never the secret as text, then finishes with password and code', async () => {
    const { sent, user } = mount([
      ok('Scan the code.', { username: 'dee', printedName: 'Dee Analyst' }, { otpauthUri: `otpauth://totp/LIMS:dee?secret=${SECRET}&issuer=LIMS` }),
      ok('Enrolled. Sign in as dee.', { username: 'dee' }),
    ]);
    expect(screen.queryByLabelText('Password')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show the code to scan' }));
    expect(await screen.findByRole('img', { name: 'QR code for your authenticator app' })).toBeInTheDocument();
    expect(sent[0]).toEqual({ name: 'identity.enrolStart', input: { token: TOKEN } });
    expect(document.body.textContent).not.toContain(SECRET);
    expect(screen.getByText('The password needs at least 15 characters.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Password'), 'Bench-Password-99!');
    await user.type(screen.getByLabelText('Type it again'), 'Bench-Password-98!');
    await user.type(screen.getByLabelText('Code'), '123456');
    expect(screen.getByText('The two passwords differ.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Finish setting up' })).toHaveAttribute('aria-disabled', 'true');
    await user.clear(screen.getByLabelText('Type it again'));
    await user.type(screen.getByLabelText('Type it again'), 'Bench-Password-99!');
    await user.click(screen.getByRole('button', { name: 'Finish setting up' }));
    expect(await screen.findByText('Enrolled. Sign in as dee.')).toBeInTheDocument();
    expect(sent[1]).toEqual({ name: 'identity.enrolFinish', input: { token: TOKEN, password: 'Bench-Password-99!', totp: '123456' } });
  });

  it('prints the server\'s refusal of a used or expired link', async () => {
    const { user } = mount([[403, { kind: 'refusal', refusal: { kind: 'not-permitted', message: 'This enrolment link has expired or was already used. Ask the Admin for a new one.' } }]]);
    await user.click(screen.getByRole('button', { name: 'Show the code to scan' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This enrolment link has expired or was already used.');
  });
});
