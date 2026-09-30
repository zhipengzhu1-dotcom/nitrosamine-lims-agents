import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { decimalString, type Limit } from '../model';
import { limitText } from './LimitText';
import { ValueField } from './ValueField';

describe('limits print exactly as stored (rule 20)', () => {
  it('keeps written trailing zeros that a number would drop', () => {
    expect(limitText({ kind: 'NMT', value: decimalString('0.0300'), unit: 'ppm' })).toBe('NMT ≤ 0.0300 ppm');
    expect(limitText({ kind: 'NLT', value: decimalString('98.0'), unit: '%' })).toBe('NLT ≥ 98.0 %');
    expect(limitText({ kind: 'range', low: decimalString('15.0'), high: decimalString('25.0'), unit: '°C' })).toBe(
      'NLT ≥ 15.0 and NMT ≤ 25.0 °C',
    );
  });

  it('refuses a number where a stored decimal string belongs', () => {
    // @ts-expect-error a limit is never built from a JS number
    const fromNumber: Limit = { kind: 'NMT', value: 0.03, unit: 'ppm' };
    expect(fromNumber.kind).toBe('NMT');
    expect(() => decimalString('3e-2')).toThrow();
    expect(() => decimalString('.03')).toThrow();
  });

  it('prints the limits under a ValueField, with the unit inside the field', () => {
    render(
      <ValueField
        label="NDMA"
        unit="ppm"
        value="0.0112"
        onChange={() => {}}
        limits={[{ label: 'Limit', limit: { kind: 'NMT', value: decimalString('0.0300'), unit: 'ppm' } }]}
      />,
    );
    const field = screen.getByLabelText('NDMA');
    expect(field).toHaveValue('0.0112');
    expect(field).toHaveAccessibleDescription('Limit NMT ≤ 0.0300 ppm');
    expect(field).toHaveAttribute('inputmode', 'none');
  });
});
