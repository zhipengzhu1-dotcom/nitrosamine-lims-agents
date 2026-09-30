import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { eligibleAnswer, keys, mei, notEligibleAnswer, PERFORMED_STATEMENT, performedTestItem, runItem } from '../dev/fixtures';
import type { CommitKey, CommitOutcome } from '../model';
import { SignaturePrompt, type SignaturePromptProps, type SignRequest } from './SignaturePrompt';

function setup(overrides: Partial<SignaturePromptProps> = {}) {
  const nextKey = keys();
  const { onSign: answer = async () => 'done' as const, ...rest } = overrides;
  const onSign = vi.fn<(r: SignRequest) => Promise<CommitOutcome>>(answer);
  const onClosed = vi.fn();
  const props: SignaturePromptProps = {
    meaning: 'Performed',
    statement: PERFORMED_STATEMENT,
    items: [performedTestItem, runItem],
    consequences: ['Test T26-04175 moves to Submitted for Review.'],
    signer: mei,
    lab: 'RD Newark',
    workstation: 'Bench PC RD-102-02',
    eligibility: eligibleAnswer,
    attemptsLeft: 5,
    refusal: null,
    actionLabel: 'Sign Test T26-04175 as Performed',
    passkeyAllowed: false,
    commitKey: nextKey(),
    onSign,
    onClosed,
    ...rest,
  };
  const view = render(<SignaturePrompt {...props} />);
  const rerenderWith = (more: Partial<SignaturePromptProps>) => view.rerender(<SignaturePrompt {...props} {...more} />);
  return { props, onSign, onClosed, nextKey, rerenderWith, user: userEvent.setup() };
}

async function typeCredentials(user: ReturnType<typeof userEvent.setup>) {
  await user.clear(screen.getByLabelText('User ID'));
  await user.type(screen.getByLabelText('User ID'), 'mchen');
  await user.type(screen.getByLabelText('Password'), 'correct horse');
  const pad = screen.getByRole('group', { name: 'Code keypad' });
  for (const d of ['4', '8', '1', '5', '2', '9']) await user.click(within(pad).getByRole('button', { name: d }));
}

const signButton = () => screen.getByRole('button', { name: /Sign Test T26-04175 as Performed/ });

describe('SignaturePrompt', () => {
  it('shows what is signed first: each Record Version and its full SHA-256 with the first 8 highlighted', () => {
    setup();
    const what = screen.getByRole('region', { name: 'What you are signing' });
    expect(within(what).getByText('Test T26-04175')).toBeInTheDocument();
    expect(within(what).getByText('Run R26-0412')).toBeInTheDocument();
    const highlighted = within(what).getByText('3f9a1c07');
    expect(highlighted.tagName).toBe('B');
    expect(highlighted.parentElement?.textContent).toBe(performedTestItem.version.hash);
  });

  it('sends the versions and hashes it showed, with the commit key it was given', async () => {
    const { user, onSign, props } = setup();
    await typeCredentials(user);
    await user.click(signButton());
    expect(onSign).toHaveBeenCalledTimes(1);
    expect(onSign.mock.calls[0]?.[0]).toEqual({
      commitKey: props.commitKey,
      credentials: { userId: 'mchen', password: 'correct horse', secondFactor: { kind: 'code', code: '481529' } },
      versions: [
        { versionId: performedTestItem.version.versionId, hash: performedTestItem.version.hash },
        { versionId: runItem.version.versionId, hash: runItem.version.hash },
      ],
    });
  });

  it('disables the sign button on the first press, so a double press signs once', async () => {
    let answer: (o: CommitOutcome) => void = () => {};
    const { user, onSign } = setup({
      onSign: () => new Promise<CommitOutcome>((resolve) => (answer = resolve)),
    });
    await typeCredentials(user);
    await user.dblClick(signButton());
    expect(signButton()).toHaveAttribute('aria-disabled', 'true');
    await user.click(signButton());
    expect(onSign).toHaveBeenCalledTimes(1);
    await act(async () => answer('refused'));
  });

  it('never signs again from a press during the closing animation, even with a fresh key and typed credentials', async () => {
    const { user, onSign, onClosed, nextKey, rerenderWith } = setup();
    await typeCredentials(user);
    await user.click(signButton());
    expect(onSign).toHaveBeenCalledTimes(1);
    expect(onClosed).not.toHaveBeenCalled();

    rerenderWith({ commitKey: nextKey() });
    await typeCredentials(user);
    await user.click(signButton());
    expect(onSign).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
  });

  it('never sends a spent key again: after a refusal it waits for a fresh key', async () => {
    const { user, nextKey, rerenderWith, onSign } = setup({ onSign: async () => 'refused' });
    await typeCredentials(user);
    await user.click(signButton());
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(screen.getByLabelText('Code')).toHaveValue('');
    expect(screen.getByLabelText('User ID')).toHaveValue('mchen');

    await typeCredentials(user);
    await user.click(signButton());
    expect(onSign).toHaveBeenCalledTimes(1);

    const fresh: CommitKey = nextKey();
    rerenderWith({ commitKey: fresh, refusal: 'Wrong user ID, password or code.', attemptsLeft: 4 });
    expect(screen.getByRole('alert')).toHaveTextContent('Wrong user ID, password or code. Nothing has been signed.');
    await user.click(signButton());
    expect(onSign).toHaveBeenCalledTimes(2);
    expect(onSign.mock.calls[1]?.[0].commitKey).toBe(fresh);
  });

  it('closes on Escape', async () => {
    const { user, onClosed, onSign } = setup();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
    expect(onSign).not.toHaveBeenCalled();
  });

  it('closes on Cancel', async () => {
    const { user, onClosed } = setup();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
  });

  it('types keypad digits into the code field only, never into the focused password', async () => {
    const { user } = setup();
    await user.type(screen.getByLabelText('Password'), 'pw');
    expect(screen.getByLabelText('Password')).toHaveFocus();
    const pad = screen.getByRole('group', { name: 'Code keypad' });
    for (const d of ['7', '3', '0']) await user.click(within(pad).getByRole('button', { name: d }));
    expect(screen.getByLabelText('Password')).toHaveValue('pw');
    expect(screen.getByLabelText('Password')).toHaveFocus();
    expect(screen.getByLabelText('Code')).toHaveValue('730');
  });

  it('refuses an ineligible signer before asking for any credential, with the reason', () => {
    setup({ eligibility: notEligibleAnswer });
    expect(screen.getByRole('alert')).toHaveTextContent('Her Authorisation for Method RD-M-017 ended on 2026-09-01.');
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sign Test/ })).not.toBeInTheDocument();
  });

  it('shows the eligibility answer before the credentials', () => {
    setup();
    const who = screen.getByRole('region', { name: 'Who is signing' });
    const authorisation = within(who).getByText(/valid until 2027-03-31/);
    const userId = within(who).getByLabelText('User ID');
    expect(authorisation.compareDocumentPosition(userId) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
