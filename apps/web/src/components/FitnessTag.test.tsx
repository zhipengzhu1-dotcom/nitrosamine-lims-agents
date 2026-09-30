import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { parseFitness, type Fitness } from '../model';
import { FitnessTag } from './FitnessTag';

describe('FitnessTag', () => {
  it('prints the word and its reason or date as text', () => {
    render(<FitnessTag fitness={{ status: 'Suspended', note: 'DEV-26-0094' }} />);
    expect(screen.getByText('Suspended')).toBeVisible();
    expect(screen.getByText('DEV-26-0094')).toBeVisible();
  });

  it('renders "Status unknown" for an unknown status, and marks it as blocking', () => {
    const { container } = render(<FitnessTag fitness={{ status: 'unknown' }} />);
    expect(screen.getByText('Status unknown')).toBeInTheDocument();
    expect(screen.getByText('Cannot be used until its status is known')).toBeInTheDocument();
    expect(container.querySelector('[data-blocks]')).not.toBeNull();
  });

  it('renders "Status unknown" for a status string it does not know, even if a caller cast it', () => {
    const smuggled = { status: 'Out for repair', note: 'since Monday' } as unknown as Fitness;
    render(<FitnessTag fitness={smuggled} />);
    expect(screen.getByText('Status unknown')).toBeInTheDocument();
    expect(screen.queryByText('Out for repair')).not.toBeInTheDocument();
  });

  it('parses a status without its reason or date as unknown', () => {
    expect(parseFitness('In use', null)).toEqual({ status: 'unknown' });
    expect(parseFitness('In use', '')).toEqual({ status: 'unknown' });
    expect(parseFitness('Out for repair', 'x')).toEqual({ status: 'unknown' });
    expect(parseFitness('In use', 'calibrated until 2026-11-30')).toEqual({ status: 'In use', note: 'calibrated until 2026-11-30' });
  });

  it('keeps the word and the note as visible text in the compact form', () => {
    render(<FitnessTag compact fitness={{ status: 'In use', note: 'calibrated until 2026-11-30' }} />);
    for (const text of ['In use', 'calibrated until 2026-11-30']) {
      const el = screen.getByText(text);
      expect(el).toBeVisible();
      expect(el.closest('.sr-only')).toBeNull();
    }
  });
});
