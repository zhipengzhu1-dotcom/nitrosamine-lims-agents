import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createApi } from '../api/client';
import { ApiContext } from '../api/hooks';
import { SessionContext } from '../session/context';
import type { ActiveSession, SessionStore } from '../session/store';
import { RailContext, type RailSlot } from '../shell/rail';
import { AdminPeople } from './AdminPeople';

const admin: ActiveSession = {
  person: { printedName: 'Adam Admin', nativeName: null, username: 'adam', role: 'Admin' },
  roles: ['Admin'],
  lab: null,
  workstation: 'Office PC',
  zone: 'America/New_York',
  signedInAt: { utc: '2026-09-30T14:00:00Z', zone: 'America/New_York' },
  idleLockAt: { utc: '2026-09-30T14:15:00Z', zone: 'America/New_York' },
  epoch: 's1:0',
  customer: null,
  dataClass: 'fictional',
};

describe('AdminPeople', () => {
  it('creates a person with role grants in a Lab and hands over the one-time link the server delivered', async () => {
    const sent: { name: string; input: unknown }[] = [];
    const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      sent.push({ name: String(url).replace('/api/commands/', ''), input: (JSON.parse(String(init?.body)) as { input: unknown }).input });
      return new Response(JSON.stringify({ kind: 'receipt', summary: 'Created Dee Analyst (dee).', at: '2026-09-30T14:40:00.000Z', act: 'audited', data: { personId: 'p-1', username: 'dee', expiresAt: '2026-10-01T14:40:00.000Z' }, once: { enrolmentToken: 'tok_abcdefghijklmnop' } }), { status: 200 });
    });
    let slot: RailSlot = { context: null, primary: null };
    render(
      <ApiContext value={createApi({ fetch: fetch as never, onSessionLost: () => {} })}>
        <SessionContext value={{ active: admin, store: { skewMs: () => 0 } as unknown as SessionStore }}>
          <RailContext value={{ setSlot: (s) => (slot = s), clear: () => {}, showReceipt: () => {} }}>
            <AdminPeople />
          </RailContext>
        </SessionContext>
      </ApiContext>,
    );
    const user = userEvent.setup();
    expect(slot.primary).toMatchObject({ kind: 'blocked', label: 'Create person and enrolment link' });
    await user.type(screen.getByLabelText('Printed name'), 'Dee Analyst');
    await user.type(screen.getByLabelText('User ID'), 'dee');
    await user.click(screen.getByRole('checkbox', { name: 'Analyst' }));
    await user.click(screen.getByRole('checkbox', { name: 'Reviewer' }));
    await user.type(screen.getByLabelText('Lab ID'), 'lab-uuid');
    expect(slot.primary?.kind).toBe('commit');
    await act(async () => {
      if (slot.primary?.kind === 'commit') await slot.primary.onCommit();
    });
    expect(sent).toEqual([{ name: 'identity.createPerson', input: { printedName: 'Dee Analyst', nativeName: null, username: 'dee', grants: [{ role: 'Analyst', lab: 'lab-uuid' }, { role: 'Reviewer', lab: 'lab-uuid' }] } }]);
    expect(screen.getByText(`${window.location.origin}/enrol#tok_abcdefghijklmnop`)).toBeInTheDocument();
    expect(screen.getByText(/It works once and expires at 10:40 EDT on 2026-10-01\. It is not shown again\./)).toBeInTheDocument();
  });

  it('never combines Admin with a Lab role', async () => {
    render(
      <ApiContext value={createApi({ fetch: vi.fn() as never, onSessionLost: () => {} })}>
        <SessionContext value={{ active: admin, store: { skewMs: () => 0 } as unknown as SessionStore }}>
          <RailContext value={{ setSlot: () => {}, clear: () => {}, showReceipt: () => {} }}>
            <AdminPeople />
          </RailContext>
        </SessionContext>
      </ApiContext>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: 'QA' }));
    await user.click(screen.getByRole('checkbox', { name: 'Admin' }));
    expect(screen.getByRole('checkbox', { name: 'QA' })).not.toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: 'Analyst' }));
    expect(screen.getByRole('checkbox', { name: 'Admin' })).not.toBeChecked();
  });
});
