import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createApi } from '../api/client';
import { ApiContext } from '../api/hooks';
import type { Receipt } from '../model';
import { SessionContext } from '../session/context';
import type { ActiveSession, SessionStore } from '../session/store';
import { RailContext } from '../shell/rail';
import { RecordedValueField, type SavedValue } from './RecordedValueField';

const ZONE = 'America/New_York';
const H = '3f9a1c07b2e84d5a9c16f0e27a4b8d3c5e7f1029a6b4c8d0e2f4a6b8c0d2e4f6';

const session: ActiveSession = {
  person: { printedName: 'Ann Analyst', nativeName: null, username: 'ann', role: 'Analyst' },
  roles: ['Analyst'],
  lab: { id: 'lab-1', code: 'RD', zone: ZONE },
  workstation: 'Bench PC 2',
  zone: ZONE,
  signedInAt: { utc: '2026-09-30T14:00:00Z', zone: ZONE },
  idleLockAt: { utc: '2026-09-30T14:15:00Z', zone: ZONE },
  epoch: 's1:0',
};

type Sent = { name: string; commitKey: string; input: Record<string, unknown> };

function server(answers: [number, unknown][]) {
  const sent: Sent[] = [];
  const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { commitKey: string; input: Record<string, unknown> };
    sent.push({ name: String(url).replace('/api/commands/', ''), ...body });
    const [status, json] = answers.shift() ?? [500, {}];
    return new Response(JSON.stringify(json), { status });
  });
  return { sent, fetch: fetch as unknown as typeof globalThis.fetch };
}

const saved = (standing: 'effective' | 'pending', versionNo: number, summary: string) =>
  [200, { kind: 'receipt', summary, at: '2026-09-30T14:40:00.000Z', act: 'audited', data: { value: 'v-1', version: { versionId: `ver-${versionNo}`, versionNo, hash: H }, standing } }] as [number, unknown];

function Host({ critical, onSaved }: { critical: boolean; onSaved: (s: SavedValue) => void }) {
  const [value, setValue] = useState<SavedValue | null>(null);
  return (
    <RecordedValueField
      parent="w-1"
      field="prep.weight"
      subject="P1"
      label="Preparation 1 weight"
      unit="mg"
      role="Analyst"
      critical={critical}
      limits={[]}
      saved={value}
      onSaved={(s) => {
        setValue(s);
        onSaved(s);
      }}
    />
  );
}

function mount(s: ReturnType<typeof server>, critical = true) {
  const receipts: Receipt[] = [];
  const onSaved = vi.fn();
  render(
    <ApiContext value={createApi({ fetch: s.fetch, onSessionLost: () => {} })}>
      <SessionContext value={{ active: session, store: { skewMs: () => 0 } as unknown as SessionStore }}>
        <RailContext value={{ setSlot: () => {}, clear: () => {}, showReceipt: (r) => receipts.push(r) }}>
          <Host critical={critical} onSaved={onSaved} />
        </RailContext>
      </SessionContext>
    </ApiContext>,
  );
  return { receipts, onSaved, user: userEvent.setup() };
}

const field = () => screen.getByLabelText('Preparation 1 weight');
const save = () => screen.getByRole('button', { name: 'Save Preparation 1 weight' });

describe('RecordedValueField', () => {
  it('saves the first value as typed, with its unit, and the rail shows the server\'s receipt', async () => {
    const s = server([saved('effective', 1, 'Recorded prep.weight (P1).')]);
    const { user, receipts, onSaved } = mount(s);
    await user.type(field(), '100.120');
    await user.click(save());
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(s.sent).toEqual([
      { name: 'value.record', commitKey: expect.stringMatching(/^[0-9a-f-]{36}$/), input: { role: 'Analyst', parent: 'w-1', field: 'prep.weight', subject: 'P1', value: { type: 'decimal', value: '100.120', unit: 'mg' } } },
    ]);
    expect(onSaved).toHaveBeenCalledWith({ valueId: 'v-1', text: '100.120', versionNo: 1, standing: 'effective', pendingText: null });
    expect(receipts).toEqual([{ summary: 'Recorded prep.weight (P1).', at: { utc: '2026-09-30T14:40:00.000Z', zone: ZONE }, kind: 'audited' }]);
  });

  it('a change after the first save goes through the Critical Data Change dialog and stays pending', async () => {
    const s = server([
      saved('effective', 1, 'Recorded prep.weight (P1).'),
      saved('pending', 2, 'Proposed. The earlier value stays current until a second person approves the change.'),
    ]);
    const { user } = mount(s);
    await user.type(field(), '100.12');
    await user.click(save());
    await waitFor(() => expect(s.sent).toHaveLength(1));
    await user.clear(field());
    await user.type(field(), '100.21');
    await user.click(save());
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('row', { name: /Preparation 1 weight/ })).toHaveTextContent('100.12 mg→ 100.21 mg');
    expect(s.sent, 'nothing is sent before a reason is chosen').toHaveLength(1);
    await user.selectOptions(within(dialog).getByLabelText('Reason'), 'Other (describe it)');
    await user.type(within(dialog).getByLabelText('Describe the reason'), 'Balance printout misread');
    await user.click(within(dialog).getByRole('button', { name: 'Propose the change for approval' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(s.sent[1]).toMatchObject({
      name: 'value.change',
      input: { role: 'Analyst', value: 'v-1', to: { type: 'decimal', value: '100.21', unit: 'mg' }, reason: { code: 'other', text: 'Balance printout misread' } },
    });
    expect(screen.getByText('Change to 100.21 mg pending approval; 100.12 mg stays current')).toBeInTheDocument();
  });

  it('prints a refusal in the server\'s words and keeps what was typed', async () => {
    const s = server([[409, { kind: 'refusal', refusal: { kind: 'not-permitted', message: 'This record is locked by its release.' } }]]);
    const { user, onSaved } = mount(s);
    await user.type(field(), '5.5');
    await user.click(save());
    expect(await screen.findByRole('alert')).toHaveTextContent('This record is locked by its release.');
    expect(field()).toHaveValue('5.5');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('offers no save for text that is not a decimal', async () => {
    const s = server([]);
    const { user } = mount(s);
    await user.type(field(), '1.2.3');
    expect(save()).toHaveAttribute('aria-disabled', 'true');
    await user.click(save());
    expect(s.sent).toEqual([]);
  });
});
