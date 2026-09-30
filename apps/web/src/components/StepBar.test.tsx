import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StepBar } from './StepBar';

describe('StepBar', () => {
  it('reads Blocked on a blocked step and prints each reason as text', () => {
    render(
      <StepBar
        steps={[
          { name: 'Run', state: 'done', note: 'R26-0412' },
          { name: 'Sign Performed', state: 'blocked', note: null, reasons: [{ text: 'Run Check Failure DEV-26-0097 on Run R26-0412' }] },
          { name: 'Review', state: 'next', note: null },
        ]}
      />,
    );
    const blocked = screen.getByText('Sign Performed').closest('li');
    if (!blocked) throw new Error('no step');
    expect(within(blocked).getByText('Blocked')).toBeVisible();
    expect(within(blocked).getByText('Run Check Failure DEV-26-0097 on Run R26-0412')).toBeVisible();
  });
});
