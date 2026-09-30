import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { keys } from '../dev/fixtures';
import type { CommitOutcome } from '../model';
import { CriticalDataChangeDialog, type CriticalDataChangeRequest } from './CriticalDataChangeDialog';

function setup() {
  const onSubmit = vi.fn<(r: CriticalDataChangeRequest) => Promise<CommitOutcome>>(async () => 'done');
  const onClosed = vi.fn();
  const key = keys()();
  render(
    <CriticalDataChangeDialog
      record="Preparation 1 of Test T26-04175"
      changes={[{ field: 'Net weight', from: '100.12', to: '100.21', unit: 'mg' }]}
      reasons={[{ code: 'transcription-error', label: 'Transcription error' }]}
      refusal={null}
      commitKey={key}
      onSubmit={onSubmit}
      onClosed={onClosed}
    />,
  );
  return { onSubmit, onClosed, key, user: userEvent.setup() };
}

const propose = () => screen.getByRole('button', { name: 'Propose the change for approval' });

describe('CriticalDataChangeDialog', () => {
  it('shows each field old → new and that the change stays pending', () => {
    setup();
    expect(screen.getByRole('row', { name: /Net weight/ })).toHaveTextContent('Net weight100.12 mg→ 100.21 mg');
    expect(screen.getByText(/current value stays in effect until someone other than you approves/)).toBeInTheDocument();
  });

  it('needs a reason, and free text when the reason is Other', async () => {
    const { user, onSubmit, key } = setup();
    expect(propose()).toHaveAttribute('aria-disabled', 'true');
    await user.selectOptions(screen.getByLabelText('Reason'), 'Other (describe it)');
    expect(propose()).toHaveAttribute('aria-disabled', 'true');
    await user.click(propose());
    expect(onSubmit).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Describe the reason'), '  Balance printout misread  ');
    await user.click(propose());
    expect(onSubmit).toHaveBeenCalledWith({ commitKey: key, reason: { kind: 'other', text: 'Balance printout misread' } });
  });

  it('sends a picklist reason by its code, once, then closes', async () => {
    const { user, onSubmit, onClosed } = setup();
    await user.selectOptions(screen.getByLabelText('Reason'), 'Transcription error');
    await user.dblClick(propose());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0].reason).toEqual({ kind: 'picklist', code: 'transcription-error' });
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
  });

  it('closes on Escape without submitting', async () => {
    const { user, onSubmit, onClosed } = setup();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
