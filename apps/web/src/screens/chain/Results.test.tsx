import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TestDetailDto } from '@lims/contract';
import { Results } from './Results';

const detail = (performedStands: boolean): TestDetailDto => ({
  test: {} as TestDetailDto['test'],
  method: null,
  specification: { purpose: 'release', versionNo: 1, hash: 'a'.repeat(64), sections: [] },
  preparations: [],
  values: [],
  missingValues: [],
  runs: [],
  version: null,
  signatures: [],
  performedStands,
  reviews: [],
  verdicts: [],
  judgement: {
    outcome: 'conforms',
    variability: [],
    sections: [{
      jurisdiction: 'FDA', ruleSetVersion: 'FDA-RS@1', rounding: 'half-away-from-zero', outcome: 'conforms',
      lines: [{
        analyte: 'NDMA', limit: '0.30', unit: 'ppm', fullPrecision: '0.1217540000…', compared: '0.12', sharePercent: '40.6', outcome: 'conforms', because: null,
        preparations: [{ preparation: 'P1', fullPrecision: '0.1232520974…', compared: '0.12', sharePercent: '41.1', conforms: true }],
      }],
    }],
  },
});

describe('Results by Specification Section (rule 22)', () => {
  it('labels the full-precision value and prints the rounded value beside the limit as written, with the share of the limit', () => {
    render(<Results detail={detail(true)} />);
    const mean = screen.getByRole('row', { name: /Reportable Result/ });
    expect(mean).toHaveTextContent('0.1217540000… ppmfull precision');
    expect(mean).toHaveTextContent('0.12 ppm');
    expect(mean).toHaveTextContent('NMT ≤ 0.30 ppm');
    expect(mean).toHaveTextContent('40.6 %');
    expect(within(mean).getByText('Conforms')).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /P1/ })).toHaveTextContent('41.1 %');
  });

  it('says Provisional in word while Performed does not stand, and never Conforms', () => {
    render(<Results detail={detail(false)} />);
    expect(screen.queryByText('Conforms')).toBeNull();
    expect(screen.getAllByText('Provisional').length).toBeGreaterThan(0);
    expect(screen.getByText('Provisional until the Test is signed Performed')).toBeInTheDocument();
  });
});
