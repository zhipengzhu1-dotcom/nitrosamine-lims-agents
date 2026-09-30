import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LAB_ZONE, mei } from '../dev/fixtures';
import type { Receipt } from '../model';
import { Rail, type RailPrimary } from './Rail';

const identity = {
  person: mei,
  signedInAt: { utc: '2026-01-14T13:02:00Z', zone: LAB_ZONE },
  idleLockAt: { utc: '2026-01-14T15:55:00Z', zone: LAB_ZONE },
  idleSecondsLeft: null,
};

function rail(primary: RailPrimary | null, receipt: Receipt | null = null) {
  return render(
    <Rail
      identity={identity}
      context={{ main: 'Test T26-04175', sub: null }}
      receipt={receipt}
      primary={primary}
      onSwitchUser={vi.fn()}
      onLock={vi.fn()}
    />,
  );
}

describe('Rail', () => {
  it('names who is signed in, the next act, Switch user and Lock', () => {
    rail({ kind: 'commit', label: 'Assign to Mei Chen', onCommit: async () => {} });
    expect(screen.getByText('Mei Chen')).toBeInTheDocument();
    expect(screen.getByText(/Analyst, .*signed in 08:02 EST/)).toBeInTheDocument();
    for (const name of ['Assign to Mei Chen', 'Switch user', 'Lock']) expect(screen.getByRole('button', { name })).toBeInTheDocument();
  });

  it('answers a press on a blocked primary with the reason, in the rail', async () => {
    rail({ kind: 'blocked', label: 'Sign Performed', reason: 'Hold H-26-0031 blocks it.' });
    expect(screen.queryByText('Hold H-26-0031 blocks it.')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sign Performed' }));
    expect(screen.getByRole('status')).toHaveTextContent('Sign Performed is not openHold H-26-0031 blocks it.');
  });

  it('shows the receipt with the server time and the zone at that instant', () => {
    rail(null, { summary: 'Assigned T26-04175 to Mei Chen.', at: { utc: '2026-07-14T14:40:12Z', zone: LAB_ZONE }, kind: 'audited' });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Assigned T26-04175 to Mei Chen.Recorded in the audit trail at 10:40 EDT. Audited, not signed.',
    );
  });
});
