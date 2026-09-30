import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { keys, LAB_ZONE, mei } from '../dev/fixtures';
import type { CommitOutcome, Credentials, CommitKey } from '../model';
import { LockScreen, SignIn } from './LockScreen';

const now = { utc: '2026-07-14T14:52:00Z', zone: LAB_ZONE };
const workstation = { name: 'Bench PC RD-102-02', room: 'RD-102 Preparation lab' };

function lock() {
  const onUnlock = vi.fn<(c: Credentials, k: CommitKey) => Promise<CommitOutcome>>(async () => 'refused');
  const onTakeover = vi.fn<(c: Credentials, k: CommitKey) => Promise<CommitOutcome>>(async () => 'done');
  const key = keys()();
  render(
    <LockScreen dataClass="fictional"
      workstation={workstation}
      now={now}
      owner={mei}
      reason="manual"
      lockedAt={now}
      refusal={null}
      passkeyAllowed={false}
      commitKey={key}
      onUnlock={onUnlock}
      onTakeover={onTakeover}
    />,
  );
  return { onUnlock, onTakeover, key, user: userEvent.setup() };
}

async function typeAll(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('User ID'), 'mchen');
  await user.type(screen.getByLabelText('Password'), 'pw');
  const pad = screen.getByRole('group', { name: 'Code keypad' });
  for (const d of ['1', '2', '3', '4', '5', '6']) await user.click(within(pad).getByRole('button', { name: d }));
}

describe('LockScreen', () => {
  it('says who locked it and when, and fills nothing in: every field starts empty', () => {
    lock();
    expect(screen.getByText('Mei Chen locked this PC at 10:52 EDT.')).toBeInTheDocument();
    for (const label of ['User ID', 'Password', 'Code']) expect(screen.getByLabelText(label)).toHaveValue('');
    expect(screen.queryByRole('button', { name: /fill|demo|touch/i })).not.toBeInTheDocument();
  });

  it('types keypad digits into the code only, never the focused password', async () => {
    const { user } = lock();
    await user.click(screen.getByLabelText('Password'));
    const pad = screen.getByRole('group', { name: 'Code keypad' });
    await user.click(within(pad).getByRole('button', { name: '9' }));
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(screen.getByLabelText('Code')).toHaveValue('9');
  });

  it('never reuses a spent key when switching from unlock to takeover', async () => {
    const { user, onUnlock, onTakeover } = lock();
    await typeAll(user);
    await user.click(screen.getByRole('button', { name: 'Unlock as Mei Chen' }));
    expect(onUnlock).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('radio', { name: /Someone else/ }));
    await typeAll(user);
    const takeover = screen.getByRole('button', { name: "Sign in and end Mei Chen's session" });
    expect(takeover).toHaveAttribute('aria-disabled', 'true');
    await user.click(takeover);
    expect(onTakeover).not.toHaveBeenCalled();
  });
});

describe('SignIn', () => {
  it('names the deep link as a destination only, and signs in with typed credentials', async () => {
    const onSignIn = vi.fn<(c: Credentials, k: CommitKey) => Promise<CommitOutcome>>(async () => 'done');
    render(
      <SignIn dataClass="fictional" workstation={workstation} now={now} destination="Test T26-04175" refusal={null} passkeyAllowed={false} commitKey={keys()()} onSignIn={onSignIn} />,
    );
    expect(screen.getByText('After you sign in, Test T26-04175 opens.')).toBeInTheDocument();
    const user = userEvent.setup();
    await typeAll(user);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onSignIn.mock.calls[0]?.[0]).toEqual({ userId: 'mchen', password: 'pw', secondFactor: { kind: 'code', code: '123456' } });
  });
});
