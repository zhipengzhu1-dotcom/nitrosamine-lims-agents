import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CommitButton } from './CommitButton';

describe('CommitButton', () => {
  it('fires once for two presses in the same frame, and stays disabled until onCommit settles', async () => {
    let settle: () => void = () => {};
    const onCommit = vi.fn(() => new Promise<void>((resolve) => (settle = resolve)));
    render(<CommitButton onCommit={onCommit}>Assign to Mei Chen</CommitButton>);
    const button = screen.getByRole('button', { name: 'Assign to Mei Chen' });

    fireEvent.click(button);
    fireEvent.click(button);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(button).toHaveAttribute('aria-disabled', 'true');

    fireEvent.click(button);
    expect(onCommit).toHaveBeenCalledTimes(1);

    await act(async () => settle());
    expect(button).toHaveAttribute('aria-disabled', 'false');
    fireEvent.click(button);
    expect(onCommit).toHaveBeenCalledTimes(2);
  });

  it('does nothing while its owner holds it disabled', () => {
    const onCommit = vi.fn(async () => {});
    render(
      <CommitButton disabled onCommit={onCommit}>
        Sign
      </CommitButton>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sign' }));
    expect(onCommit).not.toHaveBeenCalled();
  });
});
